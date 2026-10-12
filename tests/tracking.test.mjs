import assert from 'node:assert/strict';
import test from 'node:test';
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { authenticateScoped, identityKey, serviceConfig } from '../lib/server/scoped-auth.mjs';
import { TrackingStore, TOKEN_LIFETIME, RETENTION } from '../lib/server/tracking-store.mjs';
import { trackingHandlers, readTrackingCode } from '../lib/server/tracking-http.mjs';
import { applyTrackingEvent } from '../lib/server/tracking-admin.mjs';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const config = { origin: 'https://app.example', issuer: 'https://auth.example', audience: 'orders', key: publicKey };
const alice = identityKey(config.issuer, 'account-a');
const bob = identityKey(config.issuer, 'account-b');
const snapshot = { stage: 'confirmed', station: 'Kota Junction', eta: null };
function jwt(subject = 'account-a', claims = {}, header = {}) {
  const now = Math.floor(Date.now() / 1000);
  const parts = [{ alg: 'RS256', typ: 'JWT', ...header },
    { iss: config.issuer, aud: config.audience, sub: subject, scope: 'orders:track', iat: now, exp: now + 300, ...claims }]
    .map(value => Buffer.from(JSON.stringify(value)).toString('base64url'));
  return [...parts, sign('RSA-SHA256', Buffer.from(parts.join('.')), privateKey).toString('base64url')].join('.');
}
function request({ method = 'GET', subject = 'account-a', body, headers = {}, query = '' } = {}) {
  return new Request(`${config.origin}/api/orders/tracking${query}`, { method,
    headers: { origin: config.origin, cookie: subject ? `__Host-ryde-orders=${jwt(subject)}` : '',
      'content-type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'ryde-tracking-test-'));
  const store = new TrackingStore(root);
  const order = store.create(alice, snapshot);
  const other = store.create(bob, snapshot);
  const api = trackingHandlers({ config: () => config, store: () => store });
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }); });
  return { root, store, order, other, api };
}
test('tracking config fails closed and does not use media credentials', () => {
  assert.throws(() => serviceConfig({}, 'TRACKING'), { status: 503 });
  const env = { TRACKING_APP_ORIGIN: config.origin, TRACKING_TOKEN_ISSUER: config.issuer,
    TRACKING_TOKEN_AUDIENCE: config.audience, TRACKING_DATA_DIR: tmpdir(),
    TRACKING_TOKEN_PUBLIC_KEY: publicKey.export({ type: 'spki', format: 'pem' }) };
  assert.equal(serviceConfig(env, 'TRACKING').audience, 'orders');
  assert.throws(() => serviceConfig({ ...env, TRACKING_APP_ORIGIN: 'http://app.example' }, 'TRACKING'), { status: 503 });
});
test('order auth rejects missing, forged, expired, future, wrong-scope and wrong-audience JWTs', () => {
  const auth = req => authenticateScoped(req, config, '__Host-ryde-orders', 'orders:track');
  assert.equal(auth(request()), alice);
  assert.throws(() => auth(request({ subject: '' })), { status: 401 });
  for (const claims of [{ exp: 1 }, { iat: 9999999999 }, { nbf: 9999999999 }, { aud: 'media' }, { iss: 'untrusted' }, { sub: 'a@private.example' }, { iat: 1 }])
    assert.throws(() => auth(request({ headers: { cookie: `__Host-ryde-orders=${jwt('account-a', claims)}` } })), { status: 401 });
  for (const header of [{ alg: 'none' }, { alg: 'HS256' }, { crit: ['b64'] }, { b64: false }])
    assert.throws(() => auth(request({ headers: { cookie: `__Host-ryde-orders=${jwt('account-a', {}, header)}` } })), { status: 401 });
  assert.throws(() => auth(request({ headers: { cookie: `__Host-ryde-orders=${jwt('account-a', { scope: 'media:profile' })}` } })), { status: 403 });
  const pieces = jwt().split('.'); pieces[1] = Buffer.from(JSON.stringify({ sub: 'account-b' })).toString('base64url');
  assert.throws(() => auth(request({ headers: { cookie: `__Host-ryde-orders=${pieces.join('.')}` } })), { status: 401 });
  assert.throws(() => auth(request({ headers: { cookie: `__Host-ryde-orders=${jwt()}; __Host-ryde-orders=${jwt()}` } })), { status: 401 });
});
test('anonymous, wrong owner, malformed and nonexistent IDs give identical non-enumerating responses', async t => {
  const { api, order, other } = fixture(t);
  const replies = await Promise.all([
    api.read(request({ subject: '' }), order.id), api.read(request(), other.id),
    api.read(request(), randomUUID()), api.read(request(), '../private'), api.read(request(), 'RG-00000001'),
    api.read(request({ subject: '', headers: { 'x-owner': alice, 'x-user-id': 'account-a' } }), order.id),
  ]);
  for (const response of replies) {
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: 'Tracking is unavailable.' });
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  }
});
test('owner and code receive only the explicit fulfilment projection, never private database fields', async t => {
  const { api, store, order } = fixture(t);
  const ownerResponse = await api.read(request(), order.id);
  assert.equal(ownerResponse.status, 200);
  const body = await ownerResponse.json();
  assert.deepEqual(Object.keys(body.tracking).sort(), ['eta', 'id', 'stage', 'station', 'updatedAt', 'version']);
  const { token } = store.issueToken(order.id, alice);
  const shared = await api.readWithCode(request({ method: 'POST', subject: '', body: { token } }), order.id);
  assert.equal(shared.status, 200);
  assert.deepEqual((await shared.json()).tracking, body.tracking);
  const serialized = JSON.stringify(body);
  for (const forbidden of ['owner', 'digest', 'phone', 'mobile', 'passenger', 'pnr', 'payment', 'coach', 'seat'])
    assert.equal(Object.hasOwn(body.tracking, forbidden), false);
  assert.equal(serialized.includes(alice), false);
});
test('tracking code is order-scoped, hashed at rest, short-lived, rotated and revocable', t => {
  const { store, order, other } = fixture(t);
  const now = Date.now();
  const first = store.issueToken(order.id, alice, now);
  assert.equal(first.token.length, 43);
  assert.equal(first.expiresAt, now + TOKEN_LIFETIME);
  assert.equal(store.readToken(order.id, first.token, now).id, order.id);
  const row = store.db.prepare('SELECT * FROM tokens WHERE order_id=?').get(order.id);
  assert.equal(JSON.stringify(row).includes(first.token), false);
  assert.throws(() => store.readToken(other.id, first.token, now), { status: 404 });
  assert.throws(() => store.readToken(order.id, first.token, first.expiresAt), { status: 404 });
  const second = store.issueToken(order.id, alice, now);
  assert.notEqual(first.token, second.token);
  assert.throws(() => store.readToken(order.id, first.token, now), { status: 404 });
  assert.throws(() => store.revokeToken(order.id, bob, now), { status: 404 });
  assert.equal(store.readToken(order.id, second.token, now).id, order.id);
  store.revokeToken(order.id, alice, now);
  assert.throws(() => store.readToken(order.id, second.token, now), { status: 404 });
});
test('code holders cannot list orders, mint tokens, revoke tokens or mutate status', async t => {
  const { store, api, order, other } = fixture(t);
  const { token } = store.issueToken(order.id, alice);
  const guest = request({ method: 'POST', subject: '', body: { token } });
  assert.equal((await api.issueCode(guest, order.id)).status, 404);
  assert.equal((await api.revokeCode(request({ method: 'DELETE', subject: '', headers: { authorization: `Bearer ${token}` } }), order.id)).status, 404);
  assert.equal((await api.list(request({ subject: '', headers: { authorization: `Bearer ${token}` } }))).status, 401);
  assert.equal((await api.issueCode(request({ method: 'POST' }), other.id)).status, 404);
  assert.equal((await api.readWithCode(request({ method: 'POST', body: { token, stage: 'delivered' } }), order.id)).status, 400);
  assert.equal(store.readOwner(order.id, alice).stage, 'confirmed');
});
test('all token POST/DELETE operations reject cross-origin requests and query credentials', async t => {
  const { api, store, order } = fixture(t);
  const { token } = store.issueToken(order.id, alice);
  for (const headers of [{ origin: 'https://evil.example' }, { origin: '' }, { 'sec-fetch-site': 'cross-site' }]) {
    assert.equal((await api.issueCode(request({ method: 'POST', headers }), order.id)).status, 403);
    assert.equal((await api.revokeCode(request({ method: 'DELETE', headers }), order.id)).status, 403);
    assert.equal((await api.readWithCode(request({ method: 'POST', headers, body: { token } }), order.id)).status, 403);
  }
  assert.equal((await api.read(request({ query: '?token=do-not-put-secrets-in-urls' }), order.id)).status, 400);
  assert.equal((await api.read(request({ subject: '', headers: { authorization: `Bearer ${token}` } }), order.id)).status, 404);
});
test('JSON read checks actual stream size, exact shape and content length', async () => {
  for (const body of [{ token: 'x', owner: 'a' }, null, [], {}, { token: 5 }])
    await assert.rejects(readTrackingCode(request({ method: 'POST', body })), { status: 400 });
  await assert.rejects(readTrackingCode(request({ method: 'POST', body: { token: 'a'.repeat(600) } })), { status: 400 });
  await assert.rejects(readTrackingCode(request({ method: 'POST', body: { token: 'a' }, headers: { 'content-length': '500' } })), { status: 400 });
  await assert.rejects(readTrackingCode(request({ method: 'POST', body: { token: 'a' }, headers: { 'content-type': 'text/plain' } })), { status: 400 });
});
test('stalled token request is cancelled without treating partial bytes as a credential', async () => {
  let cancelled = false;
  const body = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('{"token":"a"}')); }, cancel() { cancelled = true; } });
  const req = new Request(config.origin, { method: 'POST', body, duplex: 'half', headers: { 'content-type': 'application/json' } });
  await assert.rejects(readTrackingCode(req), { status: 400 });
  assert.equal(cancelled, true);
});
test('rate limits persist across workers and forged forwarded IPs do not bypass global admission', async t => {
  const { store, api, root, order } = fixture(t);
  const worker = new TrackingStore(root);
  const now = Date.now();
  const limit = store.limit.bind(store);
  store.limit = (bucket, maximum) => limit(bucket, maximum, now);
  try {
    for (let i = 0; i < 5; i++) store.limit(`issue:${alice}`, 5);
    assert.throws(() => worker.limit(`issue:${alice}`, 5, now), { status: 429 });
    assert.equal((await api.issueCode(request({ method: 'POST' }), order.id)).status, 429);
    for (let i = 1; i < 600; i++) store.limit('global', 600);
    const response = await api.read(request({ headers: { 'x-forwarded-for': '10.20.30.40' } }), order.id);
    assert.equal(response.status, 429); assert.equal(response.headers.get('retry-after'), '60');
  } finally { worker.close(); }
});
test('owner list is bounded and isolated, expiry and account purge revoke code access', t => {
  const { store, order, other } = fixture(t);
  const code = store.issueToken(order.id, alice);
  assert.deepEqual(store.list(bob).map(row => row.id), [other.id]);
  for (let i = 0; i < 51; i++) store.create(alice, snapshot);
  assert.equal(store.list(alice).length, 50);
  assert.throws(() => store.readOwner(order.id, alice, Date.now() + RETENTION), { status: 404 });
  assert.equal(store.purgeOwner(alice), 52);
  assert.throws(() => store.readToken(order.id, code.token), { status: 404 });
  store.revokeOrder(other.id);
  assert.throws(() => store.readOwner(other.id, bob), { status: 404 });
  assert.equal(store.cleanup(), 1);
});
test('trusted fulfilment writes validate schemas, immutable ownership, versions and transitions', t => {
  const { store, order } = fixture(t);
  for (const extra of ['owner', 'name', 'phone', 'pnr', 'payment'])
    assert.throws(() => store.update(order.id, 1, { ...snapshot, [extra]: 'sensitive' }), { status: 400 });
  assert.throws(() => store.create(alice, { ...snapshot, stage: 'delivered' }), { status: 409 });
  assert.throws(() => store.update(order.id, 1, { ...snapshot, stage: 'invented' }), { status: 400 });
  store.update(order.id, 1, { ...snapshot, stage: 'packed' });
  assert.throws(() => store.update(order.id, 1, { ...snapshot, stage: 'arriving' }), { status: 409 });
  assert.throws(() => store.update(order.id, 2, snapshot), { status: 409 });
  store.update(order.id, 2, { ...snapshot, stage: 'delivered' });
  assert.throws(() => store.update(order.id, 3, { ...snapshot, stage: 'cancelled' }), { status: 409 });
  assert.throws(() => applyTrackingEvent(store, config.issuer, 'update', { id: order.id, subject: 'account-b', expectedVersion: 3, snapshot }), { status: 400 });
});
test('tracking persists across restarts and internal failures return no exception detail', async t => {
  const { root, order } = fixture(t);
  const reopened = new TrackingStore(root);
  try { assert.equal(reopened.readOwner(order.id, alice).id, order.id); } finally { reopened.close(); }
  const api = trackingHandlers({ config: () => config, store: () => { throw new Error('sensitive credential, PNR or database path'); } });
  const result = await api.read(request(), order.id);
  assert.equal(result.status, 503);
  assert.deepEqual(await result.json(), { error: 'Tracking service unavailable.' });
});
test('trusted command creates records usable by the API and reports invalid input without echoing it', async t => {
  const { root, api } = fixture(t);
  const path = join(root, 'event.json');
  writeFileSync(path, JSON.stringify({ subject: 'account-a', snapshot }));
  const env = { ...process.env, TRACKING_DATA_DIR: root, TRACKING_TOKEN_ISSUER: config.issuer };
  const created = spawnSync(process.execPath, ['scripts/tracking-admin.mjs', 'create', path], { encoding: 'utf8', env });
  assert.equal(created.status, 0);
  const id = JSON.parse(created.stdout).id;
  assert.equal((await api.read(request(), id)).status, 200);
  writeFileSync(path, '{"pnr":"sensitive-test-data"}');
  const failed = spawnSync(process.execPath, ['scripts/tracking-admin.mjs', 'create', path], { encoding: 'utf8', env });
  assert.equal(failed.status, 1);
  assert.equal(failed.stderr.includes('sensitive-test-data'), false);
  assert.equal(failed.stdout, '');
});
test('HTTP owner list and complete create-code/read/rotate/revoke flow enforce the same permissions', async t => {
  const { api, order } = fixture(t);
  const listed = await api.list(request());
  assert.deepEqual((await listed.json()).orders.map(row => row.id), [order.id]);
  const issued = await api.issueCode(request({ method: 'POST' }), order.id);
  assert.equal(issued.status, 201);
  assert.equal(issued.headers.get('cache-control'), 'private, no-store');
  const first = await issued.json();
  assert.equal((await api.readWithCode(request({ method: 'POST', subject: '', body: { token: first.token } }), order.id)).status, 200);
  const second = await (await api.issueCode(request({ method: 'POST' }), order.id)).json();
  assert.equal((await api.readWithCode(request({ method: 'POST', subject: '', body: { token: first.token } }), order.id)).status, 404);
  assert.equal((await api.revokeCode(request({ method: 'DELETE' }), order.id)).status, 204);
  assert.equal((await api.readWithCode(request({ method: 'POST', subject: '', body: { token: second.token } }), order.id)).status, 404);
});
