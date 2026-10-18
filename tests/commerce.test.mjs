import { cartContext } from '../lib/server/cart-context.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { AccountStore } from '../lib/server/account-store.mjs';
import { SESSION_COOKIE, sessionToken } from '../lib/server/account-http.mjs';
import { DomainStore } from '../lib/server/domain-store.mjs';
import { commerceConfig, commerceHandlers } from '../lib/server/commerce-http.mjs';
import { MemoryLimiter, RateLimitError } from '../lib/server/rate-limit.mjs';
import { serviceLimits } from '../lib/server/service-limits.mjs';

const origin = 'https://app.example';
const secret = 'test-only-key-that-is-more-than-32-characters';
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'ryde-commerce-'));
  const db = new DomainStore(join(dir, 'domain')), accounts = new AccountStore(join(dir, 'accounts'));
  t.after(() => { db.close(); accounts.db.close(); rmSync(dir, { recursive: true, force: true }); });
  // Real native session lookup; fixture creation bypasses password KDF only.
  const members = [true, true, false].map((verified, i) => {
    const id = randomUUID(), owner = createHash('sha256').update(`ryde-account:${id}`).digest('hex');
    accounts.db.prepare('INSERT INTO members VALUES(?,?,?,?,?,?,?)').run(id, owner,
      `fixture${i}@example.test`, 'Fixture User', 'unused-test-password', Number(verified), Date.now());
    const token = Buffer.alloc(32, i + 1).toString('base64url');
    accounts.db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(createHash('sha256').update(token).digest('hex'), id, Date.now() + 60000, Date.now());
    return { id, owner, token, verified };
  });
  db.addStation({ code: 'NDLS', name: 'New Delhi' });
  db.addStation({ code: 'KOTA', name: 'Kota Junction' });
  const vendorId = db.addVendor({ stationCode: 'KOTA', name: 'Fixture Kitchen' });
  const product = { sku: 'thali', name: 'Veg Thali', vendorId, pricePaise: 12900, active: true };
  db.putProduct(product);
  const logs = [], limiter = new MemoryLimiter();
  const options = { config: () => ({ origin, dataDir: join(dir, 'domain') }),
    store: () => db, authenticate: request => accounts.session(sessionToken(request)),
    limits: serviceLimits({ limiter: () => limiter, config: () => ({ secret }) }), logger: value => logs.push(value) };
  const api = commerceHandlers(options);
  const request = (path, method = 'GET', body, member = members[0], headers = {}) => new Request(origin + path, {
    method, headers: { origin, ...(member ? { 'x-ryde-cart-context': cartContext(member.owner) } : {}), ...(member ? { cookie: `${SESSION_COOKIE}=${member.token}` } : {}),
      'content-type': 'application/json', ...headers }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const fill = async () => {
    const r = await api.replaceCart(request('/api/cart', 'PUT', { expectedVersion: 0, items: [{ sku: 'thali', quantity: 2 }] }));
    assert.equal(r.status, 200);
    const journeyId = db.addJourney(members[0].owner, { pnrDigest: 'c'.repeat(64), trainNo: '12952', origin: 'NDLS', destination: 'KOTA' });
    const quote = (await (await api.quoteCart(request('/api/cart/quote'))).json()).quote;
    return { journeyId, cartVersion: quote.cartVersion, quoteHash: quote.quoteHash };
  };
  return { db, accounts, dir, members, api, request, fill, logs, product, options };
}
test('verified session binds persistent carts to accounts and rejects cross-owner data', async t => {
  const f = fixture(t);
  assert.equal((await f.api.readCart(f.request('/api/cart', 'GET', undefined, null))).status, 401);
  assert.equal((await f.api.readCart(f.request('/api/cart', 'GET', undefined, f.members[2]))).status, 403);
  await f.fill();
  const other = await f.api.readCart(f.request('/api/cart', 'GET', undefined, f.members[1]));
  assert.deepEqual((await other.json()).cart, { version: 0, items: [] });
  const restarted = new DomainStore(join(f.dir, 'domain'));
  try { assert.equal(restarted.readCart(f.members[0].owner).items[0].quantity, 2); } finally { restarted.close(); }
  f.accounts.logout(f.members[0].token);
  assert.equal((await f.api.readCart(f.request('/api/cart'))).status, 401);
});
test('cart API rejects forged identity, prices, stale writes and cross-origin mutations', async t => {
  const f = fixture(t), input = { expectedVersion: 0, items: [{ sku: 'thali', quantity: 1 }] };
  for (const extra of [{ owner: f.members[1].owner }, { pricePaise: 1 }, { status: 'paid' }])
    assert.equal((await f.api.replaceCart(f.request('/api/cart', 'PUT', { ...input, ...extra }))).status, 400);
  for (const headers of [{ origin: 'https://evil.example' }, { origin: '' }, { 'sec-fetch-site': 'same-site' }])
    assert.equal((await f.api.replaceCart(f.request('/api/cart', 'PUT', input, f.members[0], headers))).status, 403);
  assert.equal((await f.api.readCart(f.request('/api/cart?owner=other'))).status, 400);
  assert.equal((await f.api.replaceCart(f.request('/api/cart', 'PUT', input))).status, 200);
  assert.equal((await f.api.replaceCart(f.request('/api/cart', 'PUT', input))).status, 409);
  assert.equal((await f.api.replaceCart(f.request('/api/cart', 'PUT', { expectedVersion: 1, items: [] }))).status, 200);
  assert.equal((await f.api.quoteCart(f.request('/api/cart/quote'))).status, 409);
});
test('bounded cart JSON rejects nested price injection, quantity errors and malformed payloads', async t => {
  const f = fixture(t);
  for (const items of [[{ sku: 'thali', quantity: 1, unitPaise: 1 }], [{ sku: 'thali', quantity: -1 }], [{ sku: 'missing', quantity: 1 }], [{ sku: 'thali', quantity: 1 }, { sku: 'thali', quantity: 1 }]]) {
    const r = await f.api.replaceCart(f.request('/api/cart', 'PUT', { expectedVersion: 0, items }));
    assert.ok([400, 409].includes(r.status));
  }
  assert.equal((await f.api.replaceCart(f.request('/api/cart', 'PUT', { expectedVersion: 0, items: [], extra: 'a'.repeat(9000) }))).status, 400);
  assert.equal((await f.api.replaceCart(new Request(origin + '/api/cart', { method: 'PUT', headers: { origin, 'x-ryde-cart-context': cartContext(f.members[0].owner), cookie: `${SESSION_COOKIE}=${f.members[0].token}`, 'content-type': 'application/json' }, body: '{' }))).status, 400);
  assert.equal(f.db.readCart(f.members[0].owner).version, 0);
});
test('draft APIs require current server quote and persist idempotent owner-only snapshots', async t => {
  const f = fixture(t), input = await f.fill(), key = randomUUID();
  const create = () => f.api.createDraft(f.request('/api/orders/drafts', 'POST', input, f.members[0], { 'idempotency-key': key }));
  assert.equal((await f.api.createDraft(f.request('/api/orders/drafts', 'POST', input))).status, 400);
  const first = await create(); assert.equal(first.status, 201);
  const result = await first.json(); assert.equal(result.payable, false); assert.equal(result.draft.subtotalPaise, 25800);
  assert.deepEqual(await (await create()).json(), result);
  const context = { params: Promise.resolve({ id: result.draft.id }) };
  assert.equal((await f.api.readDraft(f.request('/api/orders/drafts/' + result.draft.id), context)).status, 200);
  assert.equal((await f.api.readDraft(f.request('/api/orders/drafts/' + result.draft.id, 'GET', undefined, f.members[1]), context)).status, 404);
  assert.equal((await f.api.createDraft(f.request('/api/orders/drafts', 'POST', input, f.members[1], { 'idempotency-key': randomUUID() }))).status, 404);
  f.db.putProduct({ ...f.product, pricePaise: 15000 });
  assert.deepEqual(await (await create()).json(), result, 'replay must retain original price snapshot');
  const freshKey = { 'idempotency-key': randomUUID() };
  assert.equal((await f.api.createDraft(f.request('/api/orders/drafts', 'POST', input, f.members[0], freshKey))).status, 409);
  const quote = (await (await f.api.quoteCart(f.request('/api/cart/quote'))).json()).quote;
  const updated = { ...input, quoteHash: quote.quoteHash };
  assert.equal((await f.api.createDraft(f.request('/api/orders/drafts', 'POST', updated, f.members[0], { 'idempotency-key': key }))).status, 409);
  const second = await f.api.createDraft(f.request('/api/orders/drafts', 'POST', updated, f.members[0], freshKey));
  assert.equal((await second.json()).draft.subtotalPaise, 30000);
  assert.equal(f.db.db.prepare('SELECT count(*) AS n FROM payment_attempts').get().n, 0);
});
test('quotes detect changed vendor assignment and reject unavailable inventory metadata', async t => {
  const f = fixture(t), input = await f.fill();
  const vendorId = f.db.addVendor({ stationCode: 'KOTA', name: 'Another Kitchen' });
  f.db.putProduct({ ...f.product, vendorId });
  assert.equal((await f.api.createDraft(f.request('/api/orders/drafts', 'POST', input, f.members[0], { 'idempotency-key': randomUUID() }))).status, 409);
  f.db.db.prepare('UPDATE vendors SET enabled=0 WHERE id=?').run(vendorId);
  assert.equal((await f.api.quoteCart(f.request('/api/cart/quote'))).status, 409);
  assert.equal((await f.api.createDraft(f.request('/api/orders/drafts', 'POST', input, f.members[0], { 'idempotency-key': randomUUID() }))).status, 409);
});
test('commerce limit outages fail closed, retain retry headers and never leak internals', async t => {
  const f = fixture(t);
  for (const error of [new RateLimitError(429, 17), new RateLimitError(503), new Error('private-db-path-and-secret')]) {
    const api = commerceHandlers({ ...f.options, limits: { before: async () => { throw error; } } });
    const response = await api.readCart(f.request('/api/cart'));
    assert.equal(response.status, error.status ?? 503);
    if (response.status === 429) assert.equal(response.headers.get('retry-after'), '17');
    assert.match(response.headers.get('cache-control'), /no-store/);
    assert.ok(response.headers.get('x-request-id'));
    assert.doesNotMatch(await response.text(), /private-db-path-and-secret/);
  }
  assert.doesNotMatch(f.logs.join(''), new RegExp(f.members[0].owner + '|' + f.members[0].token));
});
test('identity creation rolls back audit failure and returns service error instead of false conflict', async t => {
  const f = fixture(t);
  f.db.db.exec("CREATE TRIGGER fail_identity BEFORE INSERT ON accounts BEGIN SELECT RAISE(ABORT,'private audit failure'); END");
  const response = await f.api.readCart(f.request('/api/cart'));
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /private audit/);
  assert.equal(f.db.db.prepare('SELECT count(*) AS n FROM accounts').get().n, 0);
});
test('commerce configuration rejects absent, relative and publicly served storage', () => {
  const good = { ACCOUNT_APP_ORIGIN: origin, ACCOUNT_DATA_DIR: resolve('/tmp/account-fixture'), ACCOUNT_RATE_SECRET: secret, DOMAIN_DATA_DIR: resolve('/tmp/domain-fixture') };
  assert.equal(commerceConfig(good).origin, origin);
  for (const dir of [undefined, 'relative', resolve('public/data'), resolve('.next/data')])
    assert.throws(() => commerceConfig({ ...good, DOMAIN_DATA_DIR: dir }));
});
