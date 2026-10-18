import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DomainStore } from '../lib/server/domain-store.mjs';
import { guestHandlers } from '../lib/server/guest-http.mjs';
import { guestToken, GUEST_COOKIE } from '../lib/server/guest-cookie.mjs';
import { commerceHandlers } from '../lib/server/commerce-http.mjs';
import { commerceCatalogHandlers } from '../lib/server/commerce-catalog-http.mjs';
import { cartContext } from '../lib/server/cart-context.mjs';
import { RateLimitError } from '../lib/server/rate-limit.mjs';
const owner = 'a'.repeat(64), origin = 'https://app.example';
const limits = { before: async () => {}, owner: async () => {} };
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'ryde-guest-')), db = new DomainStore(dir), id = randomUUID();
  t.after(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
  db.ensureAccount(owner, id); db.addStation({ code: 'KOTA', name: 'Kota Junction' });
  const vendorId = db.addVendor({ stationCode: 'KOTA', name: 'Fixture Kitchen' });
  const product = { sku: 'thali', vendorId, name: 'Veg Thali', pricePaise: 12900, active: true };
  db.putProduct(product);
  const options = { config: () => ({ origin, dataDir: dir }), store: () => db, limits, logger: () => {} };
  return { db, dir, product, options, api: guestHandlers(options),
    account: commerceHandlers({ ...options, authenticate: () => ({ owner, id, verified: true }) }) };
}
const req = (method, token, body, headers = {}) => new Request(origin + '/api/guest/cart', { method,
  headers: { origin, 'content-type': 'application/json', ...(token ? { cookie: `${GUEST_COOKIE}=${token}` } : {}), ...headers },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
test('guest capability is opaque, hashed at rest, secure-cookie-only and expires absolutely', async t => {
  const f = fixture(t), response = await f.api.create(req('POST', null, {}));
  assert.equal(response.status, 200);
  const cookie = response.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly; Secure; SameSite=Strict; Max-Age=86400/);
  const token = cookie.split(';')[0].split('=')[1], payload = await response.json();
  assert.doesNotMatch(JSON.stringify(payload), new RegExp(token));
  const row = f.db.db.prepare('SELECT * FROM guest_carts').get();
  assert.notEqual(row.token_digest, token); assert.equal(row.token_digest.length, 64);
  assert.equal((await f.api.create(req('POST', token, {}))).headers.get('set-cookie'), null);
  assert.equal(f.db.readGuestCart(token, row.expires_at - 1).expiresAt, row.expires_at);
  assert.throws(() => f.db.readGuestCart(token, row.expires_at), { status: 401 });
  assert.doesNotMatch(JSON.stringify(f.db.db.prepare('SELECT * FROM security_audit').all()), new RegExp(token + '|' + row.token_digest));
});
test('guest update persists, rejects stale workers, owner spoofing, CSRF, and duplicate cookies', async t => {
  const f = fixture(t), { token } = f.db.createGuestCart();
  const input = { expectedVersion: 0, items: [{ sku: 'thali', quantity: 2 }] };
  assert.equal((await f.api.replace(req('PUT', token, input, { origin: 'https://evil.example' }))).status, 403);
  assert.equal((await f.api.replace(req('PUT', token, { ...input, owner }))).status, 400);
  assert.equal((await f.api.replace(req('PUT', token, input))).status, 200);
  const other = new DomainStore(f.dir);
  try { assert.equal(other.readGuestCart(token).items[0].quantity, 2); assert.throws(() => other.replaceGuestCart(token, 0, []), { status: 409 }); } finally { other.close(); }
  assert.equal((await f.api.replace(req('PUT', token, input))).status, 409);
  assert.equal(guestToken(req('GET', token, undefined, { cookie: `${GUEST_COOKIE}=${token}; ${GUEST_COOKIE}=${token}` })), null);
  assert.equal((await f.api.read(req('GET', 'x'.repeat(43)))).status, 401);
});
test('confirmed guest merge is atomic, validates prices/limits and consumes capability once', t => {
  const { db } = fixture(t), { token } = db.createGuestCart();
  db.replaceCart(owner, 0, [{ sku: 'thali', quantity: 1 }]);
  db.replaceGuestCart(token, 0, [{ sku: 'thali', quantity: 2 }]);
  assert.throws(() => db.mergeGuestCart(owner, token, 0, 1, 'combine'), { status: 409 });
  assert.throws(() => db.mergeGuestCart(owner, token, 1, 0, 'combine'), { status: 409 });
  assert.equal(db.readGuestCart(token).version, 1);
  const cart = db.mergeGuestCart(owner, token, 1, 1, 'combine');
  assert.equal(cart.items[0].quantity, 3);
  assert.throws(() => db.readGuestCart(token), { status: 401 });
  assert.throws(() => db.mergeGuestCart(owner, token, 2, 1, 'combine'), { status: 401 });
});
test('failed guest merge leaves both carts intact, including audit failure and quantity overflow', t => {
  const { db, product } = fixture(t), { token } = db.createGuestCart();
  db.putProduct({ ...product, pricePaise: 100 });
  db.replaceCart(owner, 0, [{ sku: 'thali', quantity: 90 }]);
  db.replaceGuestCart(token, 0, [{ sku: 'thali', quantity: 20 }]);
  assert.throws(() => db.mergeGuestCart(owner, token, 1, 1, 'combine'), { status: 400 });
  db.db.exec("CREATE TRIGGER fail_merge BEFORE DELETE ON guest_carts BEGIN SELECT RAISE(ABORT,'fixture audit failure'); END");
  assert.throws(() => db.mergeGuestCart(owner, token, 1, 1, 'replace'));
  assert.equal(db.readCart(owner).items[0].quantity, 90);
  assert.equal(db.readCart(owner).version, 1);
  assert.equal(db.readGuestCart(token).items[0].quantity, 20);
});
test('guest merge endpoint requires matching account context and clears cookie on success', async t => {
  const f = fixture(t), { token } = f.db.createGuestCart();
  f.db.replaceGuestCart(token, 0, [{ sku: 'thali', quantity: 1 }]);
  const input = { expectedVersion: 0, guestVersion: 1, mode: 'combine' };
  assert.equal((await f.account.mergeGuest(req('POST', token, input))).status, 409);
  const result = await f.account.mergeGuest(req('POST', token, input, { 'x-ryde-cart-context': cartContext(owner) }));
  assert.equal(result.status, 200); assert.match(result.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal((await result.json()).cart.items[0].quantity, 1);
});
test('guest limiter outages and malformed requests fail closed without creating records', async t => {
  const f = fixture(t);
  const blocked = guestHandlers({ ...f.options, limits: { before: async () => { throw new RateLimitError(429, 42); } } });
  const response = await blocked.create(req('POST', null, {}));
  assert.equal(response.status, 429); assert.equal(response.headers.get('retry-after'), '42');
  assert.equal((await f.api.create(req('POST', null, { token: 'chosen' }))).status, 400);
  assert.equal(f.db.db.prepare('SELECT count(*) AS n FROM guest_carts').get().n, 0);
});
test('commerce catalog uses explicit authenticated provisioning and server catalog prices', async t => {
  const f = fixture(t), token = 'fixture-admin-token-with-at-least-32-characters';
  const handlers = commerceCatalogHandlers({ ...f.options, env: () => ({ DOMAIN_DATA_DIR: f.dir }),
    catalogSettings: () => ({ mode: 'managed', token }), catalog: () => ({ list: () => [{ id: 'rice', name: 'Rice Bowl', price: 80 }] }) });
  const request = (body, auth = token) => new Request(origin + '/api/admin/commerce', { method: 'POST', headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + auth }, body: JSON.stringify(body) });
  const map = { action: 'product', record: { sku: 'rice', vendorId: f.product.vendorId, active: true } };
  assert.equal((await handlers.provision(request(map, 'wrong'))).status, 401);
  assert.equal((await handlers.provision(request({ ...map, record: { ...map.record, pricePaise: 1 } }))).status, 400);
  assert.equal((await handlers.provision(request(map))).status, 200);
  const response = await handlers.list(new Request(origin + '/api/commerce/catalog'));
  assert.equal((await response.json()).items.find(x => x.sku === 'rice').unitPaise, 8000);
});
