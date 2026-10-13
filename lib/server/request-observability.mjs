import { randomUUID } from 'node:crypto';

const ALLOWED_SERVICES = new Set(['media', 'tracking', 'profile']);
const OPERATION = /^[a-z][a-zA-Z]{0,32}$/;
const SAFE_KNOWN_STATUS = status => Number.isInteger(status) &&
  ((status >= 400 && status <= 499) || status === 503);

// Only allow compile-time route names as telemetry dimensions. Never use URL,
// cookie, query, client x-request-id, identity, token, PNR or user body.
export function requestTrace(service, operation, started = Date.now()) {
  if (!ALLOWED_SERVICES.has(service) || typeof operation !== 'string' ||
      !OPERATION.test(operation)) throw new Error('Invalid observability operation.');
  return { requestId: randomUUID(), service, operation, started };
}

export function safeError(error, KnownError, fallback) {
  const known = error instanceof KnownError && SAFE_KNOWN_STATUS(error.status);
  return {
    status: known ? error.status : 503,
    body: { error: known ? error.message : fallback },
  };
}

export function completeRequest(response, trace, log = console.info, finished = Date.now()) {
  if (!(response instanceof Response)) throw new Error('Expected HTTP response.');
  response.headers.set('X-Request-ID', trace.requestId);
  response.headers.set('Cache-Control', 'private, no-store');
  response.headers.set('Referrer-Policy', 'no-referrer');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  const record = {
    event: 'http_request',
    requestId: trace.requestId,
    service: trace.service,
    operation: trace.operation,
    status: response.status,
    durationMs: Math.min(3_600_000, Math.max(0, Math.floor(finished - trace.started))),
  };
  // Logging failures must never affect customer responses. Record no
  // request-derived content apart from a newly generated opaque correlation ID.
  try { log(JSON.stringify(record)); } catch { /* Monitoring is best effort. */ }
  return response;
}
