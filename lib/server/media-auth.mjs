import { AccessError, authenticateScoped, sameOrigin, serviceConfig } from './scoped-auth.mjs';

export { AccessError as MediaError } from './scoped-auth.mjs';
export function mediaConfig(env = process.env) {
  try { return serviceConfig(env, 'MEDIA'); }
  catch { throw new AccessError(503, 'Media service is not configured.'); }
}
export function authenticate(request, config, now = Math.floor(Date.now() / 1000)) {
  return authenticateScoped(request, config, '__Host-ryde-media', 'media:profile', now);
}
export const requireOrigin = sameOrigin;
