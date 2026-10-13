// Never trust a client Content-Length alone: it is an early rejection hint.
// The actual stream is independently capped and timed out.
export function rejectQuery(request, ErrorType, message = 'Query parameters are not accepted.') {
  const url = new URL(request.url);
  if (url.search) throw new ErrorType(400, message);
}
export function exactObjectFields(value, fields, ErrorType, message = 'Invalid request fields.') {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).sort().join(',') !== [...fields].sort().join(',')) {
    throw new ErrorType(400, message);
  }
  return value;
}
export async function boundedJsonObject(request, {
  ErrorType,
  message = 'Invalid JSON request.',
  maxBytes,
  timeoutMs = 3000,
  allowedFields,
}) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs < 1)
    throw new Error('Invalid server body-limit configuration.');
  const bad = () => new ErrorType(400, message);
  if (request.headers.get('content-type') !== 'application/json') throw bad();
  const declared = request.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maxBytes)) throw bad();
  if (!request.body) throw bad();

  const reader = request.body.getReader();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    void reader.cancel().catch(() => {});
  }, timeoutMs);
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) throw bad();
      size += value.byteLength;
      if (size > maxBytes) {
        void reader.cancel().catch(() => {});
        throw bad();
      }
      chunks.push(Buffer.from(value));
    }
    if (timedOut || size === 0 || (declared !== null && Number(declared) !== size)) throw bad();
    const parsed = JSON.parse(Buffer.concat(chunks, size).toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw bad();
    if (allowedFields) return exactObjectFields(parsed, allowedFields, ErrorType, message);
    return parsed;
  } catch {
    throw bad();
  } finally {
    clearTimeout(timeout);
    reader.releaseLock();
  }
}
