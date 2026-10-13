import assert from 'node:assert/strict';
import test from 'node:test';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { identityKey } from '../lib/server/scoped-auth.mjs';
import { ProfileStore } from '../lib/server/profile-store.mjs';
import { profileHandlers, profileConfig } from '../lib/server/profile-http.mjs';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const cfg = { origin: 'https://app.example', issuer: 'https://issuer.example', audience: 'profiles',
  key: publicKey, pepper: 'long-secret-test-pepper-should-be-32-bytes', smsUrl: 'https://sms.example/send', smsKey: 'secret' };
const owner = identityKey(cfg.issuer, 'alice');
const other = identityKey(cfg.issuer, 'bob');
function token(subject = 'alice', claims = {}) {
  const now = Math.floor(Date.now() / 1000);
  const parts = [{ alg: 'RS256', typ: 'JWT' }, { iss: cfg.issuer, aud: cfg.audience, sub: subject,
    scope: 'profile:manage', iat: now, exp: now + 300, ...claims }]
    .map(x => Buffer.from(JSON.stringify(x)).toString('base64url'));
  return [...parts, sign('RSA-SHA256', Buffer.from(parts.join('.')), privateKey).toString('base64url')].join('.');
}
function request({ method = 'GET', subject = 'alice', body, headers = {}, query = '' } = {}) {
  return new Request(`${cfg.origin}/api/profile${query}`, {
    method, headers: { cookie: subject ? `__Host-ryde-profile=${token(subject)}` : '',
      origin: cfg.origin, 'content-type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'ryde-profile-'));
  const db = new ProfileStore(dir);
  let sms = [];
  const api = profileHandlers({ config: () => cfg, store: () => db, send: async (_config, phone, code) => {
    sms.push({ phone, code });
  } });
  t.after(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
  return { db, api, sms };
}
test('profile config fails closed without verified service settings and OTP secret', () => {
  assert.throws(() => profileConfig({}), { status: 503 });
  const env = { PROFILE_APP_ORIGIN: cfg.origin, PROFILE_TOKEN_ISSUER: cfg.issuer,
    PROFILE_TOKEN_AUDIENCE: cfg.audience, PROFILE_TOKEN_PUBLIC_KEY: publicKey.export({ type: 'spki', format: 'pem' }),
    PROFILE_DATA_DIR: tmpdir(), PROFILE_OTP_PEPPER: cfg.pepper };
  assert.equal(profileConfig(env).audience, 'profiles');
  assert.throws(() => profileConfig({ ...env, PROFILE_SMS_URL: 'http://sms.example' }), { status: 503 });
});
test('auth and cross-origin enforcement apply to profile reads and writes', async t => {
  const { api } = fixture(t);
  assert.equal((await api.read(request({ subject: '' }))).status, 401);
  assert.equal((await api.read(request({ headers: { cookie: `__Host-ryde-profile=${token('alice', { scope: 'orders:track' })}` } }))).status, 403);
  for (const headers of [{ origin: 'https://evil.example' }, { 'sec-fetch-site': 'cross-site' }])
    assert.equal((await api.update(request({ method: 'PATCH', headers, body: { name: 'Alice', preferences: [] } }))).status, 403);
  assert.equal((await api.read(request({ query: '?phone=123' }))).status, 400);
});
test('profile persistence, owner isolation, strict shape and least-data projection', async t => {
  const { db, api } = fixture(t);
  const initial = await (await api.read(request())).json();
  assert.deepEqual(initial.profile.consents.marketing, { granted: false, updatedAt: null });
  const result = await api.update(request({ method: 'PATCH', body: { name: 'Alice', preferences: ['Vegetarian'] } }));
  assert.equal(result.status, 200);
  assert.deepEqual((await result.json()).profile.preferences, ['Vegetarian']);
  assert.equal(db.read(other).name, '');
  assert.equal(db.read(owner).name, 'Alice');
  assert.equal((await api.update(request({ method: 'PATCH', body: { name: 'Alice', preferences: [], phone: '9999999999' } }))).status, 400);
  assert.equal((await api.update(request({ method: 'PATCH', body: { name: 'Alice', preferences: ['Vegetarian', 'Vegetarian'] } }))).status, 400);
  assert.equal((await api.update(request({ method: 'PATCH', body: { name: 'Alice', preferences: ['Unknown'] } }))).status, 400);
  assert.equal(db.read(owner).phone, '');
  assert.equal(JSON.stringify(db.read(owner)).includes(owner), false);
});
test('explicit consent opt-ins/withdrawals are timestamped, scoped and audited', async t => {
  const { db, api } = fixture(t);
  const grant = await api.changeConsent(request({ method: 'PATCH', body: { purpose: 'marketing', granted: true } }));
  assert.equal(grant.status, 200);
  assert.equal((await grant.json()).consents.marketing.granted, true);
  const ts = db.read(owner).consents.marketing.updatedAt;
  assert.equal(typeof ts, 'number');
  const withdraw = await api.changeConsent(request({ method: 'PATCH', body: { purpose: 'marketing', granted: false } }));
  assert.equal(withdraw.status, 200);
  assert.equal(db.read(owner).consents.marketing.granted, false);
  const audit = await (await api.history(request())).json();
  assert.equal(audit.events.length, 2);
  assert.deepEqual(audit.events.map(x => x.granted), [false, true]);
  assert.deepEqual(db.consentHistory(other), []);
  assert.equal((await api.changeConsent(request({ method: 'PATCH', body: { purpose: 'marketing', granted: 'yes' } }))).status, 400);
});
test('SMS verification preserves existing phone until validated, never returns OTP', async t => {
  const { db, api, sms } = fixture(t);
  const started = await api.startPhone(request({ method: 'POST', body: { phone: '9876543210' } }));
  assert.equal(started.status, 202);
  assert.equal(JSON.stringify(await started.json()).includes(sms[0].code), false);
  assert.equal(db.read(owner).phone, '');
  assert.equal((await api.confirmPhone(request({ method: 'POST', body: { code: '00000000' } }))).status, sms[0].code === '00000000' ? 200 : 400);
  const confirmed = await api.confirmPhone(request({ method: 'POST', body: { code: sms[0].code } }));
  assert.equal(confirmed.status, sms[0].code === '00000000' ? 400 : 200);
  assert.equal(db.read(owner).phone, '9876543210');
  assert.equal(db.read(other).phone, '');
  assert.equal(db.db.prepare('SELECT COUNT(*) AS n FROM challenges').get().n, 0);
});
test('wrong codes persist failed attempts; expired and exhausted challenges never change phone', t => {
  const { db } = fixture(t);
  const now = Date.now();
  const c = db.beginPhone(owner, '9876543210', cfg.pepper, now);
  assert.equal(db.db.prepare('SELECT hex(digest) AS digest FROM challenges WHERE owner=?').get(owner).digest.includes(c.code), false);
  for (let i = 0; i < 5; i++) assert.throws(() => db.finishPhone(owner, c.code === '11111111' ? '22222222' : '11111111', cfg.pepper, now), { status: 400 });
  assert.throws(() => db.finishPhone(owner, c.code, cfg.pepper, now), { status: 400 });
  assert.equal(db.read(owner).phone, '');
  const newer = db.beginPhone(other, '9123456789', cfg.pepper, now);
  assert.throws(() => db.finishPhone(other, newer.code, cfg.pepper, now + 600000), { status: 400 });
  assert.equal(db.read(other).phone, '');
});
test('rate limits are durable and consent/profile deletion purges private records', t => {
  const { db } = fixture(t);
  const now = Date.now();
  for (let i = 0; i < 3; i++) db.beginPhone(owner, '9876543210', cfg.pepper, now);
  assert.throws(() => db.beginPhone(owner, '9876543210', cfg.pepper, now), { status: 429 });
  db.update(owner, { name: 'Alice', preferences: ['Mild spice'] });
  db.consent(owner, { purpose: 'personalization', granted: true });
  assert.equal(db.purge(owner), 1);
  assert.equal(db.read(owner).name, '');
  assert.deepEqual(db.consentHistory(owner), []);
});
