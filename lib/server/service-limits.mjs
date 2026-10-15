import { isIP } from 'node:net';
import { configuredLimiter, fingerprint, RateLimitError } from './rate-limit.mjs';

const SERVICES = new Set(['media', 'profile', 'tracking', 'catalog']);
const OPERATIONS = new Set(['upload', 'phone', 'phone-owner', 'tracking-code']);
export function serviceLimitConfig(env = process.env) {
  const secret = env.RATE_LIMIT_KEY_SECRET || env.ACCOUNT_RATE_SECRET;
  if (env.NODE_ENV === 'production' && (typeof secret !== 'string' || secret.length < 32))
    throw new RateLimitError(503);
  return { secret: secret || 'development-only-limit-key-not-for-production',
    ipHeader: env.RATE_LIMIT_TRUSTED_IP_HEADER };
}
// Trust an IP header only when ingress replaces and strips client copies.
// Missing/invalid headers share a conservative bucket, never arbitrary XFF.
export function clientBucket(request, config) {
  const value = config.ipHeader ? request.headers.get(config.ipHeader) : null;
  return fingerprint(config.secret, 'client-ip', value && isIP(value) ? value : 'shared');
}
export function serviceLimits({ limiter = configuredLimiter, config = serviceLimitConfig } = {}) {
  const checked = service => { if (!SERVICES.has(service)) throw new RateLimitError(503); };
  return {
    async before(request, service) {
      checked(service);
      const settings = config(), limits = limiter();
      await limits.consume(`${service}:global`, 600, 60000);
      await limits.consume(`${service}:ip:${clientBucket(request, settings)}`, 300, 60000);
    },
    async owner(service, owner) {
      checked(service);
      if (typeof owner !== 'string' || !/^[a-f0-9]{64}$/.test(owner)) throw new RateLimitError(503);
      await limiter().consume(`${service}:owner:${fingerprint(config().secret, 'owner', owner)}`, 120, 60000);
    },
    async action(service, operation, identity, maximum, windowMs) {
      checked(service);
      if (!OPERATIONS.has(operation)) throw new RateLimitError(503);
      await limiter().consume(`${service}:${operation}:${fingerprint(config().secret, operation, identity)}`, maximum, windowMs);
    },
  };
}
export const sharedServiceLimits = serviceLimits();
