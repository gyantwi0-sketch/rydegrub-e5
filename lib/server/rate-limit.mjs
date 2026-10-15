import { metrics } from './metrics.mjs';
import { createHmac } from 'node:crypto';

export class RateLimitError extends Error {
  constructor(status, retryAfter = 1) {
    super(status === 429 ? 'Too many requests. Try again later.' : 'Request limiting unavailable.');
    this.status = status; this.retryAfter = retryAfter;
  }
}
const SCRIPT = `local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('PEXPIRE',KEYS[1],ARGV[1]) end; return {n,redis.call('PTTL',KEYS[1])}`;
function validate(key, limit, windowMs) {
  if (!/^[a-z0-9:-]{1,160}$/.test(key) || !Number.isSafeInteger(limit) || limit < 1 ||
      !Number.isSafeInteger(windowMs) || windowMs < 1000 || windowMs > 86400000) throw new RateLimitError(503);
}
export function fingerprint(secret, purpose, value) {
  if (typeof secret !== 'string' || secret.length < 32 || typeof value !== 'string') throw new RateLimitError(503);
  return createHmac('sha256', secret).update(JSON.stringify([purpose, value])).digest('hex');
}
export class MemoryLimiter {
  constructor({ now = Date.now, maximumKeys = 10000 } = {}) { this.entries = new Map(); this.now = now; this.maximumKeys = maximumKeys; }
  async consume(key, limit, windowMs) {
    validate(key, limit, windowMs);
    const now = this.now();
    for (const [k, v] of this.entries) if (v.expires <= now) this.entries.delete(k);
    let entry = this.entries.get(key);
    if (!entry) {
      if (this.entries.size >= this.maximumKeys) { metrics.limit('unavailable'); throw new RateLimitError(503); }
      entry = { count: 0, expires: now + windowMs }; this.entries.set(key, entry);
    }
    entry.count++;
    if (entry.count > limit) { metrics.limit('limited'); throw new RateLimitError(429, Math.max(1, Math.ceil((entry.expires - now) / 1000))); }
    metrics.limit('allowed');
  }
}
export class RedisLimiter {
  constructor({ url, token, fetchImpl = fetch, logger = console.info }) {
    try { const u = new URL(url); if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash || !token) throw new Error(); }
    catch { throw new RateLimitError(503); }
    this.url = url; this.token = token; this.fetch = fetchImpl; this.logger = logger;
  }
  async consume(key, limit, windowMs) {
    validate(key, limit, windowMs);
    let outcome = 'unavailable';
    try {
      const r = await this.fetch(this.url, { method: 'POST', redirect: 'error', cache: 'no-store',
        headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(['EVAL', SCRIPT, '1', `ryde:limit:${key}`, String(windowMs)]), signal: AbortSignal.timeout(2000) });
      if (!r.ok) throw new Error();
      const data = await r.json();
      if (data.error || !Array.isArray(data.result) || data.result.length !== 2 ||
          !data.result.every(Number.isSafeInteger) || data.result[0] < 1 || data.result[1] < 0) throw new Error();
      if (data.result[0] > limit) { outcome = 'limited'; throw new RateLimitError(429, Math.max(1, Math.ceil(data.result[1] / 1000))); }
      outcome = 'allowed';
    } catch (error) { if (error instanceof RateLimitError) throw error; throw new RateLimitError(503); }
    finally { metrics.limit(outcome); try { this.logger(JSON.stringify({ event: 'rate_limit', outcome })); } catch { /* best effort */ } }
  }
}
let cached, cachedConfiguration;
export function configuredLimiter(env = process.env) {
  const configuration = JSON.stringify([env.NODE_ENV, env.RATE_LIMIT_REDIS_URL, env.RATE_LIMIT_REDIS_TOKEN]);
  if (cached && cachedConfiguration === configuration) return cached;
  if (env.RATE_LIMIT_REDIS_URL && env.RATE_LIMIT_REDIS_TOKEN)
    cached = new RedisLimiter({ url: env.RATE_LIMIT_REDIS_URL, token: env.RATE_LIMIT_REDIS_TOKEN });
  else if (env.NODE_ENV === 'production') throw new RateLimitError(503);
  else cached = new MemoryLimiter();
  cachedConfiguration = configuration;
  return cached;
}
