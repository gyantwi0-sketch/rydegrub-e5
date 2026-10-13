import assert from 'node:assert/strict';
import test from 'node:test';
import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { checkEnvironment } from '../scripts/check-env.mjs';

const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const sampleKey = publicKey.export({ type: 'spki', format: 'pem' });
const good = { PROFILE_OTP_PEPPER: 'a-random-32-byte-production-pepper-placeholder' };
for (const prefix of ['MEDIA', 'TRACKING', 'PROFILE']) {
  Object.assign(good, {
    [`${prefix}_APP_ORIGIN`]: 'https://ryde.example',
    [`${prefix}_TOKEN_ISSUER`]: 'https://auth.example',
    [`${prefix}_TOKEN_AUDIENCE`]: `rydegrub-${prefix.toLowerCase()}`,
    [`${prefix}_TOKEN_PUBLIC_KEY`]: sampleKey,
    [`${prefix}_DATA_DIR`]: `/srv/rydegrub/${prefix.toLowerCase()}`,
  });
}
test('production preflight accepts only complete secure environment', () => {
  assert.equal(checkEnvironment(good), true);
  for (const [key, value] of [
    ['MEDIA_APP_ORIGIN', 'http://ryde.example'],
    ['TRACKING_TOKEN_PUBLIC_KEY', 'not a public key'],
    ['PROFILE_OTP_PEPPER', 'short'],
    ['PROFILE_DATA_DIR', 'relative/profile'],
    ['PROFILE_APP_ORIGIN', 'https://evil.example'],
  ]) assert.throws(() => checkEnvironment({ ...good, [key]: value }));
  assert.throws(() => checkEnvironment({ ...good, NEXT_PUBLIC_PROFILE_TOKEN_SECRET: 'dummy' }));
  assert.throws(() => checkEnvironment({ ...good, PROFILE_SMS_KEY: 'dummy' }));
  assert.throws(() => checkEnvironment({ ...good, CATALOG_DATA_DIR: '/tmp/catalog' }));
  assert.equal(checkEnvironment({ ...good, CATALOG_ADMIN_TOKEN: 'some-catalog-admin-token-with-32-chars', CATALOG_DATA_DIR: '/tmp/catalog' }), true);
});
test('local environment files are ignored and sample contains no real credentials', () => {
  const ignore = readFileSync(new URL('../.gitignore', import.meta.url), 'utf8');
  const example = readFileSync(new URL('../.env.example', import.meta.url), 'utf8');
  const packageJSON = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const scan = readFileSync(new URL('../.github/workflows/secrets.yml', import.meta.url), 'utf8');
  assert.match(ignore, /\.env\.\*/);
  assert.match(ignore, /!\.env\.example/);
  assert.match(packageJSON.scripts.start, /check-env\.mjs/);
  assert.match(scan, /gitleaks\/gitleaks-action@v3/);
  assert.match(example, /REPLACE_WITH_VERIFICATION_PUBLIC_KEY_PEM/);
  assert.doesNotMatch(example, /-----BEGIN (?:RSA )?PRIVATE KEY-----/);
});
