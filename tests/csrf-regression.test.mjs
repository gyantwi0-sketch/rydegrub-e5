import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sameOrigin, AccessError } from '../lib/server/scoped-auth.mjs';

const root = fileURLToPath(new URL('../app/api/', import.meta.url));
const config = { origin: 'https://app.example' };
const request = (origin, site) => new Request('https://app.example/api/profile', {
  method: 'PATCH',
  headers: { ...(origin === null ? {} : { origin }),
    ...(site === null ? {} : { 'sec-fetch-site': site }) },
});
test('strict same-origin guard rejects missing, cross-site and same-site attempts', () => {
  assert.equal(sameOrigin(request('https://app.example', 'same-origin'), config), undefined);
  assert.equal(sameOrigin(request('https://app.example', null), config), undefined);
  for (const [origin, site] of [
    [null, null], ['https://evil.example', 'same-origin'],
    ['http://app.example', 'same-origin'], ['https://app.example', 'cross-site'],
    ['https://app.example', 'same-site'], ['https://app.example', 'none'],
  ]) assert.throws(() => sameOrigin(request(origin, site), config),
    error => error instanceof AccessError && error.status === 403);
});
test('unsafe API routes are registered through server-side security wrappers', () => {
  // Fail CI on a newly added cookie-authenticated mutation unless its route
  // has been explicitly classified and added to the CSRF policy.
  const paths = readdirSync(root, { recursive: true })
    .filter(path => path.endsWith('route.ts'))
    .map(path => path.replace(/\\/g, '/'));
  const methods = /export (?:const|async function) (POST|PUT|PATCH|DELETE)\b/g;
  const classified = new Map([
    ['v1/auth/register/route.ts', 'account.register'],
    ['v1/auth/signin/route.ts', 'account.signin'],
    ['v1/auth/logout/route.ts', 'account.logout'],
    ['v1/auth/verification/request/route.ts', 'account.requestVerification'],
    ['v1/auth/verification/confirm/route.ts', 'account.verify'],
    ['v1/auth/password/request/route.ts', 'account.requestReset'],
    ['v1/auth/password/reset/route.ts', 'account.reset'],

    ['media/route.ts', 'media.upload'],
    ['media/[id]/route.ts', 'media.remove'],
    ['profile/route.ts', 'profile.update'],
    ['profile/personalization/route.ts', 'profile.savePersonalization'],
    ['profile/consent/route.ts', 'profile.changeConsent'],
    ['profile/phone/start/route.ts', 'profile.startPhone'],
    ['profile/phone/confirm/route.ts', 'profile.confirmPhone'],
    ['orders/[id]/tracking-access/route.ts', 'tracking.issueCode'],
    ['orders/[id]/tracking/route.ts', 'tracking.readWithCode'],
  ]);
  const catalogBearerOnly = 'admin/catalog/route.ts';
  let found = 0;
  for (const path of paths) {
    const source = readFileSync(join(root, path), 'utf8');
    const methodsFound = [...source.matchAll(methods)];
    if (!methodsFound.length) continue;
    found += methodsFound.length;
    if (path === catalogBearerOnly) {
      assert.match(source, /catalogHandlers/);
      continue; // Bearer-only service credentials, not a cookie session.
    }
    assert.ok(classified.has(path), `Unreviewed unsafe endpoint: ${path}`);
    assert.ok(source.includes(classified.get(path)), `Missing guarded route binding in ${path}`);
  }
  assert.ok(found >= 8, 'Expected active session mutation routes.');
  const media = readFileSync(new URL('../lib/server/media-http.mjs', import.meta.url), 'utf8');
  const tracking = readFileSync(new URL('../lib/server/tracking-http.mjs', import.meta.url), 'utf8');
  const profile = readFileSync(new URL('../lib/server/profile-http.mjs', import.meta.url), 'utf8');
  assert.match(media, /request\.method !== 'GET'\) requireOrigin\(request, config\)/);
  assert.match(tracking, /request\.method !== 'GET'\) sameOrigin\(request, settings\)/);
  assert.match(profile, /request\.method !== 'GET'\) sameOrigin\(request, settings\)/);
});

