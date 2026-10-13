import { accountConfig, authenticatedAccount, SESSION_COOKIE } from './account-http.mjs';
import { constants, createHash, createPublicKey, verify } from 'node:crypto';

export class AccessError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function identityKey(issuer, subject) {
  if (typeof issuer !== 'string' || !issuer || typeof subject !== 'string' ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(subject)) throw new AccessError(400, 'Invalid account identity.');
  return createHash('sha256').update(JSON.stringify([issuer, subject])).digest('hex');
}

export function serviceConfig(env, prefix) {
  try {
    if (env.ACCOUNT_APP_ORIGIN && !env[`${prefix}_TOKEN_PUBLIC_KEY`]) {
      const settings = accountConfig(env);
      if (!env[`${prefix}_DATA_DIR`]) throw new Error();
      return { origin: settings.origin, dataDir: env[`${prefix}_DATA_DIR`], nativeAccounts: true };
    }
    const origin = new URL(env[`${prefix}_APP_ORIGIN`]);
    const issuer = env[`${prefix}_TOKEN_ISSUER`];
    const audience = env[`${prefix}_TOKEN_AUDIENCE`];
    const dataDir = env[`${prefix}_DATA_DIR`];
    if (origin.protocol !== 'https:' || origin.origin !== env[`${prefix}_APP_ORIGIN`] ||
        !issuer || !audience || !dataDir) throw new Error();
    const key = createPublicKey(env[`${prefix}_TOKEN_PUBLIC_KEY`].replace(/\\n/g, '\n'));
    if (key.asymmetricKeyType !== 'rsa' || key.asymmetricKeyDetails.modulusLength < 2048)
      throw new Error();
    return { origin: origin.origin, issuer, audience, key, dataDir };
  } catch { throw new AccessError(503, 'Service is not configured.'); }
}

// Cookie name and scope are fixed by the server route, never chosen by a request.
export function authenticateScoped(request, config, cookieName, scope, now = Math.floor(Date.now() / 1000)) {
  try {
    if (config.nativeAccounts || (request.headers.get('cookie') || '').split(';').some(v => v.trim().startsWith(`${SESSION_COOKIE}=`))) {
      if (!['profile:manage', 'media:profile', 'orders:track'].includes(scope)) throw new AccessError(403, 'Required account permission is missing.');
      try { return authenticatedAccount(request).owner; }
      catch (error) { throw new AccessError(error.status === 403 ? 403 : 401, error.status === 403 ? 'Verify your email first.' : 'Sign in required.'); }
    }
    const cookies = (request.headers.get('cookie') || '').split(';')
      .map(v => v.trim()).filter(v => v.startsWith(`${cookieName}=`));
    if (cookies.length !== 1) throw new Error();
    const token = cookies[0].slice(cookieName.length + 1);
    if (token.length > 4096) throw new Error();
    const parts = token.split('.');
    if (parts.length !== 3 || parts.some(p => !/^[A-Za-z0-9_-]+$/.test(p))) throw new Error();
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    if (header.alg !== 'RS256' || header.typ !== 'JWT' || header.crit || header.b64 !== undefined)
      throw new Error();
    if (!verify('RSA-SHA256', Buffer.from(parts.slice(0, 2).join('.')),
      { key: config.key, padding: constants.RSA_PKCS1_PADDING }, Buffer.from(parts[2], 'base64url')))
      throw new Error();
    const p = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (p.iss !== config.issuer || p.aud !== config.audience ||
      !Number.isInteger(p.exp) || !Number.isInteger(p.iat) ||
      p.exp <= now || p.iat > now || p.exp <= p.iat || p.exp - p.iat > 900 ||
      (p.nbf !== undefined && (!Number.isInteger(p.nbf) || p.nbf > now))) throw new Error();
    const owner = identityKey(p.iss, p.sub);
    if (typeof p.scope !== 'string' || !p.scope.split(' ').includes(scope))
      throw new AccessError(403, 'Required account permission is missing.');
    return owner;
  } catch (error) {
    if (error instanceof AccessError && error.status === 403) throw error;
    throw new AccessError(401, 'A verified account is required.');
  }
}

export function sameOrigin(request, config) {
  if (request.headers.get('origin') !== config.origin ||
      (request.headers.get('sec-fetch-site') && request.headers.get('sec-fetch-site') !== 'same-origin'))
    throw new AccessError(403, 'Same-origin request required.');
}

