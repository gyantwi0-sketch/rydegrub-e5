import { createHash, createPublicKey, verify, constants } from 'node:crypto';

export class MediaError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function mediaConfig(env = process.env) {
  try {
    const origin = new URL(env.MEDIA_APP_ORIGIN);
    if (origin.protocol !== 'https:' || origin.origin !== env.MEDIA_APP_ORIGIN ||
        !env.MEDIA_TOKEN_ISSUER || !env.MEDIA_TOKEN_AUDIENCE || !env.MEDIA_DATA_DIR)
      throw new Error();
    const key = createPublicKey(env.MEDIA_TOKEN_PUBLIC_KEY.replace(/\\n/g, '\n'));
    if (key.asymmetricKeyType !== 'rsa' || key.asymmetricKeyDetails.modulusLength < 2048)
      throw new Error();
    return { origin: origin.origin, issuer: env.MEDIA_TOKEN_ISSUER,
      audience: env.MEDIA_TOKEN_AUDIENCE, key, dataDir: env.MEDIA_DATA_DIR };
  } catch { throw new MediaError(503, 'Media service is not configured.'); }
}

// A deliberately narrow RS256 token contract, issued by the trusted auth service.
// No key, algorithm, issuer or URL supplied by the request is trusted.
export function authenticate(request, config, now = Math.floor(Date.now() / 1000)) {
  try {
    const cookies = (request.headers.get('cookie') || '').split(';')
      .map(v => v.trim()).filter(v => v.startsWith('__Host-ryde-media='));
    if (cookies.length !== 1) throw new Error();
    const token = cookies[0].slice('__Host-ryde-media='.length);
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
        typeof p.sub !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(p.sub) ||
        !Number.isInteger(p.exp) || !Number.isInteger(p.iat) ||
        p.exp <= now || p.iat > now || p.exp <= p.iat || p.exp - p.iat > 900 ||
        (p.nbf !== undefined && (!Number.isInteger(p.nbf) || p.nbf > now))) throw new Error();
    if (typeof p.scope !== 'string' || !p.scope.split(' ').includes('media:profile'))
      throw new MediaError(403, 'Profile media permission is required.');
    return createHash('sha256').update(JSON.stringify([p.iss, p.sub])).digest('hex');
  } catch (error) {
    if (error instanceof MediaError) throw error;
    throw new MediaError(401, 'Sign in with a verified account to use profile photos.');
  }
}

export function requireOrigin(request, config) {
  if (request.headers.get('origin') !== config.origin ||
      (request.headers.get('sec-fetch-site') && request.headers.get('sec-fetch-site') !== 'same-origin'))
    throw new MediaError(403, 'Same-origin request required.');
}

