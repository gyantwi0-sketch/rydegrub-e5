import assert from 'node:assert/strict';
import test from 'node:test';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { identityKey } from '../lib/server/scoped-auth.mjs';
import { recommend } from '../lib/server/recommendations.mjs';
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
  const api = profileHandlers({ catalog: () => [
    {id: 'veg', category: 'Meals', tags: ['Vegetarian']},
    {id: 'protein', category: 'Meals', tags: ['High-protein']},
    {id: 'baby', category: 'Toddler Food', tags: ['Vegetarian']},
  ], config: () => cfg, store: () => db, send: async (_config, phone, code) => {
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



test('recommendations require verified identity and ignore preferences without recorded consent', async t => {
  const { db, api } = fixture(t);
  db.update(owner, { name: 'Alice', preferences: ['High-protein'] });
  assert.equal((await api.recommendations(request({ subject: '' }))).status, 401);
  assert.equal((await api.recommendations(request({ query: '?preferences=High-protein' }))).status, 400);
  const general = await api.recommendations(request());
  assert.match(general.headers.get('cache-control'), /no-store/);
  assert.equal((await general.json()).mode, 'general');
  assert.deepEqual(db.personalization(owner), { granted: false, preferences: [] });
  const saved = await api.savePersonalization(request({ method: 'PATCH', body: { granted: true, preferences: ['High-protein'] } }));
  assert.equal(saved.status, 200);
  const personalized = await (await api.recommendations(request())).json();
  assert.equal(personalized.mode, 'personalized');
  assert.deepEqual(personalized.items, [{ id: 'protein', reasons: ['Matches High-protein'] }]);
  assert.equal(JSON.stringify(personalized).includes('Alice'), false);
  assert.equal((await (await api.recommendations(request({ subject: 'bob' }))).json()).mode, 'general');
  assert.equal(db.read(owner).name, 'Alice');
  db.consent(owner, { purpose: 'personalization', granted: false });
  assert.equal((await (await api.recommendations(request())).json()).mode, 'general');
});

test('personalization reset clears preferences and revokes consent together, preserving contact and marketing choices', async t => {
  const { db, api } = fixture(t);
  db.update(owner, { name: 'Alice', preferences: [] });
  db.consent(owner, { purpose: 'marketing', granted: true });
  db.savePersonalization(owner, { granted: true, preferences: ['Vegetarian'] });
  assert.equal((await api.resetPersonalization(request({ method: 'DELETE', headers: { origin: 'https://evil.example' }, body: {} }))).status, 403);
  const result = await api.resetPersonalization(request({ method: 'DELETE', body: {} }));
  assert.equal(result.status, 200);
  assert.deepEqual((await result.json()).settings, { granted: false, preferences: [] });
  const profile = db.read(owner);
  assert.deepEqual(profile.preferences, []); assert.equal(profile.name, 'Alice');
  assert.equal(profile.consents.marketing.granted, true);
  assert.equal(profile.consents.personalization.granted, false);
  assert.equal(db.consentHistory(owner)[0].granted, false);
  assert.equal((await api.savePersonalization(request({ method: 'PATCH', headers: { origin: 'https://evil.example' }, body: { granted: true, preferences: [] } }))).status, 403);
  for (const body of [{ granted: true, preferences: [], owner: other }, { granted: 'yes', preferences: [] },
    { granted: false, preferences: ['Vegetarian'] }, { granted: true, preferences: ['unknown'] }])
    assert.equal((await api.savePersonalization(request({ method: 'PATCH', body }))).status, 400);
});

test('consent write failure rolls back personalization changes', t => {
  const { db } = fixture(t);
  db.savePersonalization(owner, { granted: true, preferences: ['Vegetarian'] });
  db.db.exec("CREATE TRIGGER reject_consent BEFORE INSERT ON consent_events BEGIN SELECT RAISE(ABORT,'test'); END;");
  assert.throws(() => db.savePersonalization(owner, { granted: false, preferences: [] }));
  assert.deepEqual(db.personalization(owner), { granted: true, preferences: ['Vegetarian'] });
});

test('recommendation fallback never relaxes selected diet constraints or recommends infant food', () => {
  const catalog = [
    { id: 'baby', category: 'Toddler Food', tags: ['Vegetarian'] },
    { id: 'inactive', active: false, category: 'Meals', tags: ['Vegetarian'] },
    { id: 'veg', category: 'Meals', tags: ['Vegetarian'] },
  ];
  assert.deepEqual(recommend(catalog, { granted: true, preferences: ['High-protein'] }).items, []);
  assert.deepEqual(recommend(catalog, { granted: false, preferences: ['High-protein'] }).items.map(p => p.id), ['veg']);
  assert.equal(recommend(catalog, { granted: false, preferences: [] }).mode, 'general');
});
