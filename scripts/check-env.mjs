import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serviceConfig } from '../lib/server/scoped-auth.mjs';
import { profileConfig } from '../lib/server/profile-http.mjs';

// This is a production startup gate, not a development auth bypass. Do not
// print a failing environment value, credential, PEM key or private path.
export function checkEnvironment(env = process.env) {
  if (Object.keys(env).some(key => /^NEXT_PUBLIC_/i.test(key) &&
      /(PRIVATE|SECRET|TOKEN|PASSWORD|CREDENTIAL|OTP_PEPPER)/i.test(key))) {
    throw new Error('Sensitive variable cannot use NEXT_PUBLIC_ prefix.');
  }
  let origin;
  for (const prefix of ['MEDIA', 'TRACKING', 'PROFILE']) {
    const config = prefix === 'PROFILE' ? profileConfig(env) : serviceConfig(env, prefix);
    if (!isAbsolute(config.dataDir)) throw new Error('Service storage must use a private absolute directory.');
    if (origin && origin !== config.origin) throw new Error('Secure API services must share a trusted application origin.');
    origin = config.origin;
  }
  const catalogKeys = ['CATALOG_DATA_DIR', 'CATALOG_ADMIN_TOKEN'];
  if (catalogKeys.some(key => env[key] !== undefined)) {
    const root = env.CATALOG_DATA_DIR, token = env.CATALOG_ADMIN_TOKEN;
    if (typeof root !== 'string' || !isAbsolute(root) ||
        typeof token !== 'string' || token.length < 32)
      throw new Error('Catalog service is not configured.');
  }
  return true;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    checkEnvironment();
    process.stdout.write('Secure service environment verified.\n');
  } catch {
    // No exception details: do not leak deployment configuration into logs.
    process.stderr.write('Secure service environment is missing or invalid.\n');
    process.exitCode = 1;
  }
}
