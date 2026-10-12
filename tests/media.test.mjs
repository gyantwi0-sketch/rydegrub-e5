import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { authenticate, mediaConfig } from '../lib/server/media-auth.mjs';
import { MAX_BYTES, generateVariants, readImageBody } from '../lib/server/media-image.mjs';
import { MediaStore } from '../lib/server/media-store.mjs';
import { mediaHandlers } from '../lib/server/media-http.mjs';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const config = { origin: 'https://app.example', issuer: 'https://auth.example', audience: 'ryde-media', key: publicKey };
function token(sub = 'user-a', claims = {}, header = {}) {
  const now = Math.floor(Date.now() / 1000);
  const parts = [ { alg: 'RS256', typ: 'JWT', ...header },
    { sub, iss: config.issuer, aud: config.audience, iat: now, exp: now + 300, scope: 'media:profile', ...claims } ]
    .map(p => Buffer.from(JSON.stringify(p)).toString('base64url'));
  return [...parts, sign('RSA-SHA256', Buffer.from(parts.join('.')), privateKey).toString('base64url')].join('.');
}
function request(method = 'GET', sub = 'user-a', body, headers = {}) {
  return new Request(config.origin + '/api/media', { method, body,
    headers: { cookie: `__Host-ryde-media=${token(sub)}`, origin: config.origin, 'content-type': 'image/png', ...headers } });
}
async function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'ryde-media-test-'));
  const store = new MediaStore(root);
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }); });
  const handlers = mediaHandlers({ getConfig: () => config, getStore: () => store });
  const png = await sharp({ create: { width: 128, height: 80, channels: 3, background: 'red' } }).png().toBuffer();
  return { root, store, handlers, png };
}
test('configuration fails closed and requires HTTPS + a strong public RSA key', () => {
  assert.throws(() => mediaConfig({}), { status: 503 });
  const env = { MEDIA_APP_ORIGIN: config.origin, MEDIA_TOKEN_ISSUER: config.issuer,
    MEDIA_TOKEN_AUDIENCE: config.audience, MEDIA_DATA_DIR: tmpdir(),
    MEDIA_TOKEN_PUBLIC_KEY: publicKey.export({ type: 'spki', format: 'pem' }) };
  assert.equal(mediaConfig(env).origin, config.origin);
  assert.throws(() => mediaConfig({ ...env, MEDIA_APP_ORIGIN: 'http://app.example' }), { status: 503 });
});
test('auth rejects missing, forged, wrong algorithm, expired and wrong claims', () => {
  assert.throws(() => authenticate(new Request(config.origin), config), { status: 401 });
  for (const [claims, header] of [ [{ exp: 1 }, {}], [{ iss: 'evil' }, {}], [{ aud: 'other' }, {}],
    [{ sub: '../../other' }, {}], [{ iat: 1 }, {}], [{ nbf: 9999999999 }, {}], [{}, { alg: 'HS256' }],
    [{}, { crit: ['jku'] }] ]) {
    const req = request('GET', 'a', undefined, { cookie: `__Host-ryde-media=${token('a', claims, header)}` });
    assert.throws(() => authenticate(req, config), { status: 401 });
  }
  const forged = token().split('.'); forged[1] = Buffer.from('{"sub":"other"}').toString('base64url');
  assert.throws(() => authenticate(request('GET', 'a', undefined, { cookie: `__Host-ryde-media=${forged.join('.')}` }), config), { status: 401 });
  assert.throws(() => authenticate(request('GET', 'a', undefined, { cookie: `__Host-ryde-media=${token('a', { scope: '' })}` }), config), { status: 403 });
  assert.equal(authenticate(request(), config).length, 64);
});
test('unauthenticated and cross-origin mutations never reserve or decode', async t => {
  const { handlers, store, png } = await fixture(t);
  assert.equal((await handlers.upload(request('POST', 'a', png, { cookie: '' }))).status, 401);
  assert.equal((await handlers.upload(request('POST', 'a', png, { origin: 'https://evil.example' }))).status, 403);
  assert.equal((await handlers.upload(request('POST', 'a', png, { 'sec-fetch-site': 'cross-site' }))).status, 403);
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM media').get().n, 0);
});
test('body rejects URLs, multipart, missing bytes and dishonest lengths', async () => {
  for (const mime of ['application/json', 'image/svg+xml', 'multipart/form-data', 'video/mp4'])
    await assert.rejects(readImageBody(request('POST', 'a', 'https://localhost/secret', { 'content-type': mime })), { status: 415 });
  await assert.rejects(readImageBody(request('POST', 'a', undefined)), { status: 400 });
  await assert.rejects(readImageBody(request('POST', 'a', 'abc', { 'content-length': '9' })), { status: 400 });
  await assert.rejects(readImageBody(request('POST', 'a', 'abc', { 'content-length': String(MAX_BYTES + 1) })), { status: 413 });
});
test('streamed actual bytes are capped even without Content-Length', async () => {
  let canceled = false;
  const stream = new ReadableStream({ start(c) { c.enqueue(new Uint8Array(MAX_BYTES)); c.enqueue(new Uint8Array(1)); }, cancel() { canceled = true; } });
  const req = new Request(config.origin, { method: 'POST', body: stream, duplex: 'half', headers: { 'content-type': 'image/png' } });
  await assert.rejects(readImageBody(req), { status: 413 });
  assert.equal(canceled, true);
});
test('malformed, spoofed, too-small, oversized and animated images are rejected', async t => {
  const { png } = await fixture(t);
  await assert.rejects(generateVariants(png, 'image/jpeg'), { status: 415 });
  await assert.rejects(generateVariants(Buffer.from('<svg></svg>'), 'image/png'), { status: 422 });
  await assert.rejects(generateVariants(png.subarray(0, 40), 'image/png'), { status: 422 });
  for (const width of [32, 4097]) {
    const bytes = await sharp({ create: { width, height: 64, channels: 3, background: 'blue' } }).png().toBuffer();
    await assert.rejects(generateVariants(bytes, 'image/png'), { status: 422 });
  }
  const pixels = Buffer.concat([Buffer.alloc(64 * 64 * 3, 0), Buffer.alloc(64 * 64 * 3, 255)]);
  const animated = await sharp(pixels, { raw: { width: 64, height: 128, channels: 3, pageHeight: 64 } })
    .webp({ loop: 0, delay: [100, 100] }).toBuffer();
  assert.equal((await sharp(animated, { animated: true }).metadata()).pages, 2);
  await assert.rejects(generateVariants(animated, 'image/webp'), { status: 422 });
});
test('accepted formats produce fixed WebP variants with stripped metadata', async t => {
  const { png } = await fixture(t);
  for (const [format, mime] of [['jpeg', 'image/jpeg'], ['png', 'image/png'], ['webp', 'image/webp']]) {
    const input = await sharp(png)[format]().withMetadata().toBuffer();
    const result = await generateVariants(input, mime);
    for (const [name, side] of [['thumbnail', 96], ['display', 512]]) {
      const meta = await sharp(result[name]).metadata();
      assert.equal(meta.format, 'webp'); assert.equal(meta.width, side); assert.equal(meta.height, side);
      assert.equal(meta.exif, undefined); assert.equal(meta.icc, undefined);
    }
  }
});
test('HTTP upload, private reads, ownership isolation, replacement and deletion', async t => {
  const { handlers, store, root, png } = await fixture(t);
  const response = await handlers.upload(request('POST', 'user-a', png));
  assert.equal(response.status, 201);
  const first = (await response.json()).media;
  const read = await handlers.read(request(), first.id, 'thumbnail');
  assert.equal(read.status, 200); assert.equal(read.headers.get('content-type'), 'image/webp');
  assert.equal(read.headers.get('cache-control'), 'private, no-store');
  assert.equal((await handlers.read(request('GET', 'user-b'), first.id, 'thumbnail')).status, 404);
  assert.equal((await handlers.remove(request('DELETE', 'user-b'), first.id)).status, 404);
  for (const [id, variant] of [[first.id, 'original'], [first.id, '__proto__'], ['../media.sqlite', 'display']])
    assert.equal((await handlers.read(request(), id, variant)).status, 404);
  const second = (await (await handlers.upload(request('POST', 'user-a', png))).json()).media;
  assert.equal((await handlers.read(request(), first.id, 'thumbnail')).status, 404);
  assert.equal((await (await handlers.current(request())).json()).media.id, second.id);
  assert.equal((await handlers.remove(request('DELETE'), second.id)).status, 204);
  assert.equal((await handlers.read(request(), second.id, 'thumbnail')).status, 404);
  assert.equal((await (await handlers.current(request())).json()).media, null);
  assert.equal(store.cleanup(), 2);
  assert.equal(readdirSync(root).filter(v => !v.startsWith('media.sqlite')).length, 0);
});
test('server admission enforces per-owner concurrency, global concurrency and rate limits', async t => {
  const { store } = await fixture(t);
  const id = store.reserve('owner');
  assert.throws(() => store.reserve('owner'), { status: 429 });
  store.abandon(id, 'owner');
  for (let n = 1; n < 20; n++) { const id = store.reserve('owner'); store.abandon(id, 'owner'); }
  assert.throws(() => store.reserve('owner'), { status: 429 });
  for (let n = 0; n < 4; n++) store.reserve(`user-${n}`);
  assert.throws(() => store.reserve('another'), { status: 429 });
});
test('expiry, restart persistence, failed writes and scheduled cleanup', async t => {
  const { store, png } = await fixture(t);
  const variants = await generateVariants(png, 'image/png');
  const id = store.reserve('a'); store.publish(id, 'a', variants);
  const another = new MediaStore(store.root);
  try { assert.equal(another.current('a').id, id); } finally { another.close(); }
  const future = Date.now() + 31 * 86400000;
  assert.equal(store.current('a', future), null);
  assert.throws(() => store.read(id, 'display', 'a', future), { status: 404 });
  const pending = store.reserve('b');
  assert.throws(() => store.publish(pending, 'b', { thumbnail: variants.thumbnail }), TypeError);
  assert.equal(store.current('b'), null);
  store.abandon(pending, 'b');
  const stale = store.reserve('c', Date.now() - 16 * 60000);
  assert.throws(() => store.publish(stale, 'c', variants), { status: 409 });
  assert.equal(store.cleanup(future), 3);
});
test('failed validation releases admission without replacing current photo', async t => {
  const { handlers, png } = await fixture(t);
  const id = (await (await handlers.upload(request('POST', 'user-a', png))).json()).media.id;
  assert.equal((await handlers.upload(request('POST', 'user-a', 'bad image'))).status, 422);
  assert.equal((await (await handlers.current(request())).json()).media.id, id);
  assert.equal((await handlers.upload(request('POST', 'user-a', png))).status, 201);
});
test('admission limits apply across independent database connections', async t => {
  const { store } = await fixture(t);
  const worker = new MediaStore(store.root);
  try {
    const id = store.reserve('same-owner');
    assert.throws(() => worker.reserve('same-owner'), { status: 429 });
    worker.abandon(id, 'same-owner');
    assert.ok(store.reserve('same-owner'));
  } finally { worker.close(); }
});
test('stalled body is canceled and never accepted as a partial photo', async () => {
  let canceled = false;
  const stream = new ReadableStream({ start(c) { c.enqueue(new Uint8Array([1, 2, 3])); }, cancel() { canceled = true; } });
  const req = new Request(config.origin, { method: 'POST', body: stream, duplex: 'half', headers: { 'content-type': 'image/png' } });
  await assert.rejects(readImageBody(req), { status: 400 });
  assert.equal(canceled, true);
});

