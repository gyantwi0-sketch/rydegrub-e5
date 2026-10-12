import { AccessError, authenticateScoped, sameOrigin, serviceConfig } from './scoped-auth.mjs';
import { TrackingStore } from './tracking-store.mjs';

const stores = new Map();
export const trackingConfig = (env = process.env) => serviceConfig(env, 'TRACKING');
const HEADERS = {
  'Cache-Control': 'private, no-store', Vary: 'Cookie, Origin',
  'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff',
  'Cross-Origin-Resource-Policy': 'same-origin',
};
function json(body, status = 200) {
  return Response.json(body, { status, headers: { ...HEADERS, ...(status === 429 ? { 'Retry-After': '60' } : {}) } });
}
function getStore(config) {
  if (!stores.has(config.dataDir)) stores.set(config.dataDir, new TrackingStore(config.dataDir));
  return stores.get(config.dataDir);
}

export async function readTrackingCode(request) {
  if (request.headers.get('content-type') !== 'application/json') throw new AccessError(400, 'Invalid tracking request.');
  const length = request.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > 512)) throw new AccessError(400, 'Invalid tracking request.');
  if (!request.body) throw new AccessError(400, 'Invalid tracking request.');
  const reader = request.body.getReader();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; void reader.cancel().catch(() => {}); }, 3000);
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 512) { await reader.cancel(); throw new Error(); }
      chunks.push(Buffer.from(value));
    }
    if (timedOut || (length !== null && Number(length) !== size)) throw new Error();
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!body || typeof body !== 'object' || Array.isArray(body) ||
        Object.keys(body).length !== 1 || typeof body.token !== 'string') throw new Error();
    return body.token;
  } catch { throw new AccessError(400, 'Invalid tracking request.'); }
  finally { clearTimeout(timer); reader.releaseLock(); }
}

export function trackingHandlers({ config = trackingConfig, store = getStore } = {}) {
  async function handle(request, operation) {
    try {
      const settings = config();
      if (new URL(request.url).search) throw new AccessError(400, 'Query parameters are not accepted.');
      if (request.method !== 'GET') sameOrigin(request, settings);
      const database = store(settings);
      // Fixed global bucket: untrusted forwarded IPs or IDs cannot evade the limit.
      database.limit('global', 600);
      return await operation(settings, database);
    } catch (error) {
      // Intentionally no request, cookie, token, decoder or database logging.
      return json({ error: error instanceof AccessError ? error.message : 'Tracking service unavailable.' },
        error instanceof AccessError ? error.status : 503);
    }
  }
  function owner(request, settings, database, hidden = false) {
    let identity;
    try { identity = authenticateScoped(request, settings, '__Host-ryde-orders', 'orders:track'); }
    catch (error) {
      if (hidden && error instanceof AccessError && [401, 403].includes(error.status))
        throw new AccessError(404, 'Tracking is unavailable.');
      throw error;
    }
    database.limit(`owner:${identity}`, 120);
    return identity;
  }
  return {
    list: request => handle(request, (settings, database) =>
      json({ orders: database.list(owner(request, settings, database)) })),
    read: (request, id) => handle(request, (settings, database) =>
      json({ tracking: database.readOwner(id, owner(request, settings, database, true)), access: 'owner' })),
    readWithCode: (request, id) => handle(request, async (_settings, database) =>
      json({ tracking: database.readToken(id, await readTrackingCode(request)), access: 'code' })),
    issueCode: (request, id) => handle(request, (settings, database) => {
      const identity = owner(request, settings, database, true);
      database.limit(`issue:${identity}`, 5);
      return json(database.issueToken(id, identity), 201);
    }),
    revokeCode: (request, id) => handle(request, (settings, database) => {
      database.revokeToken(id, owner(request, settings, database, true));
      return new Response(null, { status: 204, headers: HEADERS });
    }),
  };
}
export const tracking = trackingHandlers();
