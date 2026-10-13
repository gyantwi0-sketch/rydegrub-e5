import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { AccountStore, passwordPolicy } from '../lib/server/account-store.mjs';
import { accountHandlers, checkBreachedPassword } from '../lib/server/account-http.mjs';
import { MemoryLimiter, RedisLimiter, fingerprint } from '../lib/server/rate-limit.mjs';
const password = 'river violet railway song 482!';
const safe = async () => false;
function setup(t) { const dir = mkdtempSync(join(tmpdir(), 'ryde-auth-')); const db = new AccountStore(dir); t.after(() => { db.close(); rmSync(dir, { recursive: true, force: true }); }); return db; }
const status = n => e => e.status === n;
test('registration persists Argon2id hashes; duplicate registration is generic', async t => {
  const db = setup(t);
  const member = await db.register({ name: 'Test User', email: 'USER@example.com', password }, safe);
  assert.ok(member.owner.match(/^[a-f0-9]{64}$/));
  const stored = db.db.prepare('SELECT * FROM members').get();
  assert.ok(stored.password.startsWith('argon2id:')); assert.ok(!stored.password.includes(password));
  assert.equal(stored.email, 'user@example.com');
  assert.equal(await db.register({ name: 'Test User', email: 'user@example.com', password }, safe), null);
});
test('password boundaries, breached rejection and unavailable screening fail closed', async () => {
  await assert.rejects(passwordPolicy('a'.repeat(14), safe), status(400));
  await passwordPolicy('a'.repeat(15), safe); await passwordPolicy('a'.repeat(128), safe);
  await assert.rejects(passwordPolicy('a'.repeat(129), safe), status(400));
  await assert.rejects(passwordPolicy(password, async () => true), status(400));
  await assert.rejects(passwordPolicy(password), status(503));
});
test('sign-in, session rotation, expiry, logout and cross-account isolation', async t => {
  const db = setup(t); await db.register({ email: 'a@example.com', name: 'User One', password }, safe);
  await assert.rejects(db.signIn('a@example.com', 'wrong'), status(401));
  await assert.rejects(db.signIn('missing@example.com', password), status(401));
  const first = await db.signIn('a@example.com', password, null, 1000);
  assert.equal(db.session(first.token, 1001).email, 'a@example.com');
  const next = await db.signIn('a@example.com', password, first.token, 2000);
  assert.throws(() => db.session(first.token, 2001), status(401));
  assert.throws(() => db.session(next.token, 2000 + 8 * 3600000), status(401));
  db.logout(next.token); assert.throws(() => db.session(next.token, 2001), status(401));
});
test('email codes are hashed, single-use and expire; reset revokes all sessions', async t => {
  const db = setup(t); await db.register({ email: 'a@example.com', name: 'User One', password }, safe);
  const session = await db.signIn('a@example.com', password);
  const verify = db.issueToken('a@example.com', 'verify');
  assert.ok(!JSON.stringify(db.db.prepare('SELECT * FROM tokens').all()).includes(verify.token));
  await db.redeem(verify.token, 'verify'); assert.equal(db.session(session.token).verified, true);
  await assert.rejects(db.redeem(verify.token, 'verify'), status(400));
  const expired = db.issueToken('a@example.com', 'reset', 0);
  await assert.rejects(db.redeem(expired.token, 'reset', password, safe, 900000), status(400));
  const reset = db.issueToken('a@example.com', 'reset');
  await db.redeem(reset.token, 'reset', 'new passphrase railway 784', safe);
  assert.throws(() => db.session(session.token), status(401));
  await assert.rejects(db.signIn('a@example.com', password), status(401));
  await db.signIn('a@example.com', 'new passphrase railway 784');
});
test('HTTP auth enforces origin, strict schema, safe cookies and account throttling', async t => {
  const db = setup(t); const limit = new MemoryLimiter(); const sent = [];
  const config = { origin: 'https://ryde.test', secret: 's'.repeat(32), emailUrl: 'https://mail.test', emailKey: 'test' };
  const handlers = accountHandlers({ config: () => config, store: () => db, limiter: () => limit, breached: safe, send: async (...args) => sent.push(args), logger: () => {} });
  const req = (action, body, origin = config.origin) => new Request(`https://ryde.test/api/v1/auth/${action}`, { method: 'POST', headers: { origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await handlers.register(req('register', {}, 'https://evil.test'))).status, 403);
  assert.equal((await handlers.register(req('register', { email: 'a@example.com', name: 'Test User', password, owner: 'spoof' }))).status, 400);
  assert.equal((await handlers.register(req('register', { email: 'a@example.com', name: 'Test User', password }))).status, 202);
  assert.equal(sent.length, 1);
  const signed = await handlers.signin(req('signin', { email: 'a@example.com', password }));
  assert.equal(signed.status, 200); assert.match(signed.headers.get('set-cookie'), /HttpOnly; Secure; SameSite=Lax/);
  const cookie = signed.headers.get('set-cookie').split(';')[0];
  const session = await handlers.session(new Request('https://ryde.test/api/v1/auth/session', { headers: { cookie } }));
  assert.equal(session.status, 200); assert.equal(session.headers.get('cache-control'), 'private, no-store');
  for (let i = 0; i < 4; i++) await handlers.signin(req('signin', { email: 'a@example.com', password: 'wrong' }));
  const blocked = await handlers.signin(req('signin', { email: 'a@example.com', password }));
  assert.equal(blocked.status, 429); assert.ok(Number(blocked.headers.get('retry-after')) > 0);
});
test('breach lookup sends only padded SHA-1 prefix and rejects malformed responses', async () => {
  const hash = createHash('sha1').update(password).digest('hex').toUpperCase();
  assert.equal(await checkBreachedPassword(password, async (url, options) => {
    assert.ok(url.endsWith(hash.slice(0, 5))); assert.ok(!url.includes(password));
    assert.equal(options.headers['Add-Padding'], 'true'); return new Response(`${hash.slice(5)}:1\r\n`);
  }), true);
  assert.equal(await checkBreachedPassword(password, async () => new Response(`${hash.slice(5)}:0`)), false);
  await assert.rejects(checkBreachedPassword(password, async () => new Response('invalid')), status(503));
});
test('development limiter resets and distributed limiter uses atomic expiry with fail-closed errors', async () => {
  let now = 0; const memory = new MemoryLimiter({ now: () => now });
  await memory.consume('test', 1, 1000); await assert.rejects(memory.consume('test', 1, 1000), status(429));
  now = 1000; await memory.consume('test', 1, 1000);
  let count = 0; const logs = [];
  const redis = new RedisLimiter({ url: 'https://redis.test', token: 'secret', logger: v => logs.push(v), fetchImpl: async (_url, options) => {
    const command = JSON.parse(options.body); assert.equal(command[0], 'EVAL'); assert.ok(command[1].includes('PEXPIRE'));
    return Response.json({ result: [++count, 1000] });
  } });
  await redis.consume('test', 1, 1000); await assert.rejects(redis.consume('test', 1, 1000), status(429));
  assert.ok(!logs.join('').includes('secret')); assert.ok(!logs.join('').includes('test'));
  const broken = new RedisLimiter({ url: 'https://redis.test', token: 'secret', logger: () => {}, fetchImpl: async () => { throw new Error('secret upstream data'); } });
  await assert.rejects(broken.consume('test', 1, 1000), e => e.status === 503 && !e.message.includes('secret'));
  assert.notEqual(fingerprint('s'.repeat(32), 'email', 'x'), fingerprint('s'.repeat(32), 'ip', 'x'));
});

test('native sessions require verification for protected scopes and revoked sessions fail immediately', async t => {
  const { serviceConfig, authenticateScoped } = await import('../lib/server/scoped-auth.mjs');
  const { accountConfig, accountDatabase } = await import('../lib/server/account-http.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'ryde-native-'));
  const keys = ['ACCOUNT_APP_ORIGIN','ACCOUNT_DATA_DIR','ACCOUNT_RATE_SECRET'];
  const before = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  Object.assign(process.env, { ACCOUNT_APP_ORIGIN: 'https://ryde.test', ACCOUNT_DATA_DIR: dir, ACCOUNT_RATE_SECRET: 's'.repeat(32) });
  const db = accountDatabase(accountConfig());
  t.after(() => { db.close(); for (const k of keys) { if (before[k] === undefined) delete process.env[k]; else process.env[k] = before[k]; } rmSync(dir, { recursive: true, force: true }); });
  await db.register({ email: 'native@example.com', name: 'Native User', password }, safe);
  const session = await db.signIn('native@example.com', password);
  const settings = serviceConfig({ ...process.env, PROFILE_DATA_DIR: dir }, 'PROFILE');
  const req = new Request('https://ryde.test/api/profile', { headers: { cookie: `__Host-ryde-session=${session.token}` } });
  assert.throws(() => authenticateScoped(req, settings, '__Host-ryde-profile', 'profile:manage'), status(403));
  await db.redeem(db.issueToken('native@example.com', 'verify').token, 'verify');
  assert.equal(authenticateScoped(req, settings, '__Host-ryde-profile', 'profile:manage'), session.account.owner);
  assert.throws(() => authenticateScoped(req, settings, '__Host-ryde-profile', 'admin:write'), status(403));
  db.logout(session.token);
  assert.throws(() => authenticateScoped(req, settings, '__Host-ryde-profile', 'profile:manage'), status(401));
});

test('generic registration/recovery responses do not expose email-adapter failure or account existence', async t => {
  const db = setup(t); const logs = [];
  const handlers = accountHandlers({ config: () => ({ origin: 'https://ryde.test', secret: 's'.repeat(32), emailUrl: 'https://email.test', emailKey: 'secret' }),
    store: () => db, limiter: () => new MemoryLimiter(), breached: safe, send: async () => { throw new Error('mailbox secret'); }, logger: x => logs.push(x) });
  const req = body => new Request('https://ryde.test/api/v1/auth/register', { method: 'POST', headers: { origin: 'https://ryde.test', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const first = await handlers.register(req({ email: 'exists@example.com', name: 'Test User', password }));
  const second = await handlers.register(req({ email: 'exists@example.com', name: 'Test User', password }));
  assert.equal(first.status, 202); assert.deepEqual(await first.json(), await second.json());
  const exists = await handlers.requestReset(req({ email: 'exists@example.com' }));
  const missing = await handlers.requestReset(req({ email: 'missing@example.com' }));
  assert.equal(exists.status, missing.status); assert.deepEqual(await exists.json(), await missing.json());
  assert.ok(!logs.join('').includes('exists@example.com')); assert.ok(!logs.join('').includes('mailbox secret'));
});
