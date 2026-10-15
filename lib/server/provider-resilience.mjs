import { metrics } from './metrics.mjs';
// Trusted outbound service adapter, not a user-controlled URL proxy.
// Retries are limited to idempotent GET/HEAD requests. Never retry SMS POST,
// payment collection, order creation or other side-effecting calls implicitly.
const PROVIDERS = new Set(['sms', 'pnr', 'payment', 'email', 'password-screening']);
const TRANSIENT = new Set([429, 500, 502, 503, 504]);
const internalCircuits = new Map();

export class ProviderUnavailableError extends Error {
  constructor() { super('External service temporarily unavailable.'); this.status = 503; }
}

export class ProviderCircuit {
  constructor({ threshold = 3, cooldownMs = 30_000 } = {}) {
    if (!Number.isSafeInteger(threshold) || threshold < 1 ||
        !Number.isSafeInteger(cooldownMs) || cooldownMs < 1000) throw new Error('Invalid circuit settings.');
    this.threshold = threshold;
    this.cooldownMs = cooldownMs;
    this.failures = 0;
    this.openUntil = 0;
    this.probing = false;
  }
  before(now) {
    if (this.probing || (this.openUntil && now < this.openUntil))
      throw new ProviderUnavailableError();
    if (this.openUntil) this.probing = true;
  }
  success() {
    this.failures = 0;
    this.openUntil = 0;
    this.probing = false;
  }
  failure(now) {
    this.probing = false;
    this.failures++;
    if (this.failures >= this.threshold) this.openUntil = now + this.cooldownMs;
  }
  state(now = Date.now()) {
    return this.openUntil && now < this.openUntil ? 'open' :
      this.probing ? 'probe' : this.openUntil ? 'half-open' : 'closed';
  }
}
const circuitFor = provider => {
  if (!internalCircuits.has(provider)) internalCircuits.set(provider, new ProviderCircuit());
  return internalCircuits.get(provider);
};

export async function providerRequest({
  provider, url, method = 'GET', headers, body, timeoutMs = 5000,
  fetchImpl = fetch, circuit, now = Date.now, sleep = ms => new Promise(r => setTimeout(r, ms)),
  logger = console.info, maxResponseBytes = 262144,
}) {
  if (!PROVIDERS.has(provider) || !['GET','HEAD','POST'].includes(method) ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 10_000 ||
      !Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 1 || maxResponseBytes > 1048576)
    throw new ProviderUnavailableError();
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password ||
        parsed.hash || parsed.search || !parsed.hostname || parsed.port)
      throw new Error();
  } catch { throw new ProviderUnavailableError(); }
  if (method !== 'POST' && body !== undefined) throw new ProviderUnavailableError();

  const breaker = circuit ?? circuitFor(provider);
  const started = now();
  let attempts = 0;
  let success = false;
  let opened = false;
  try {
    breaker.before(started);
    const maxAttempts = ['GET','HEAD'].includes(method) ? 3 : 1;
    for (let i = 0; i < maxAttempts; i++) {
      attempts++;
      try {
        const controller = new AbortController();
        let timer;
        const deadline = new Promise((_, reject) => {
          timer = setTimeout(() => { controller.abort(); reject(new ProviderUnavailableError()); }, timeoutMs);
        });
        const work = async () => {
        const response = await fetchImpl(url, {
          method, headers, body, redirect: 'error', cache: 'no-store',
          signal: controller.signal,
        });
        if (!response.ok) {
          void response.body?.cancel().catch(() => {});
          return response;
        }
        if (controller.signal.aborted) {
          void response.body?.cancel().catch(() => {});
          throw new ProviderUnavailableError();
        }
        const reader = response.body?.getReader();
        const cancel = () => { if (reader) void reader.cancel().catch(() => {}); };
        controller.signal.addEventListener('abort', cancel, { once: true });
        const chunks = []; let size = 0;
        try {
          if (reader) while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > maxResponseBytes) throw new ProviderUnavailableError();
            chunks.push(value);
          }
        } catch (error) {
          controller.abort();
          if (reader) void reader.cancel().catch(() => {});
          throw error;
        } finally { controller.signal.removeEventListener('abort', cancel); }
        if (controller.signal.aborted) throw new ProviderUnavailableError();
        return new Response(reader ? Buffer.concat(chunks, size) : null, {
          status: response.status, statusText: response.statusText, headers: response.headers,
        });
        };
        let response;
        try { response = await Promise.race([work(), deadline]); }
        finally { clearTimeout(timer); }
        if (response.ok) {
          success = true;
          breaker.success();
          return response;
        }
        if (i === maxAttempts - 1 || !TRANSIENT.has(response.status))
          break;
      } catch {
        // Network errors and timeout are retried only for read-only calls.
        if (i === maxAttempts - 1) break;
      }
      await sleep(Math.min(1000, 100 * 2 ** i));
    }
    breaker.failure(now());
    throw new ProviderUnavailableError();
  } catch {
    // A circuit rejection or upstream exception is always mapped to a safe
    // 503; never leak request headers, URLs, response bodies or exceptions.
    opened = breaker.state(now()) === 'open' || breaker.state(now()) === 'probe';
    throw new ProviderUnavailableError();
  } finally {
    const record = {
      event: 'provider_request',
      provider, method,
      outcome: success ? 'ok' : opened ? 'circuit_open' : 'unavailable',
      attempts,
      durationMs: Math.max(0, Math.min(600_000, Math.floor(now() - started))),
    };
    metrics.provider(record.provider, record.method, record.outcome, record.durationMs);
    try { logger(JSON.stringify(record)); } catch { /* Logging must not affect response. */ }
  }
}

