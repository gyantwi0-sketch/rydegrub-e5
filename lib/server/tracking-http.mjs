import { sharedServiceLimits } from './service-limits.mjs';
import { boundedJsonObject, rejectQuery } from './request-validation.mjs';
import { completeRequest, requestTrace, safeError } from './request-observability.mjs';
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
  const body = await boundedJsonObject(request, {
    ErrorType: AccessError,
    message: 'Invalid tracking request.',
    maxBytes: 512,
    allowedFields: ['token'],
  });
  if (typeof body.token !== 'string') throw new AccessError(400, 'Invalid tracking request.');
  return body.token;
}

export function trackingHandlers({ config = trackingConfig, store = getStore, limits = sharedServiceLimits, logger = console.info } = {}) {
  async function handle(request, action, operation) {
    const trace = requestTrace('tracking', action);
    let response;
    try {
      await limits.before(request, 'tracking');
      const settings = config();
      rejectQuery(request, AccessError);
      if (request.method !== 'GET') sameOrigin(request, settings);
      const database = store(settings);
      database.limit('global', 600);
      response = await operation(settings, database);
    } catch (error) {
      const failure = safeError(error, AccessError, 'Tracking service unavailable.');
      response = json(failure.body, failure.status);
      if (failure.status === 429 && failure.retryAfter) response.headers.set('Retry-After', String(failure.retryAfter));
    }
    return completeRequest(response, trace, logger);
  }
  async function owner(request, settings, database, hidden = false) {
    let identity;
    try { identity = authenticateScoped(request, settings, '__Host-ryde-orders', 'orders:track'); }
    catch (error) {
      if (hidden && error instanceof AccessError && [401, 403].includes(error.status))
        throw new AccessError(404, 'Tracking is unavailable.');
      throw error;
    }
    await limits.owner('tracking', identity);
    database.limit(`owner:${identity}`, 120);
    return identity;
  }
  return {
    list: request => handle(request, 'list', async (settings, database) =>
      json({ orders: database.list(await owner(request, settings, database)) })),
    read: (request, id) => handle(request, 'read', async (settings, database) =>
      json({ tracking: database.readOwner(id, await owner(request, settings, database, true)), access: 'owner' })),
    readWithCode: (request, id) => handle(request, 'readWithCode', async (_settings, database) =>
      json({ tracking: database.readToken(id, await readTrackingCode(request)), access: 'code' })),
    issueCode: (request, id) => handle(request, 'issueCode', async (settings, database) => {
      const identity = await owner(request, settings, database, true);
      await limits.action('tracking', 'tracking-code', identity, 5, 60000);
      database.limit(`issue:${identity}`, 5);
      return json(database.issueToken(id, identity), 201);
    }),
    revokeCode: (request, id) => handle(request, 'revokeCode', async (settings, database) => {
      database.revokeToken(id, await owner(request, settings, database, true));
      return new Response(null, { status: 204, headers: HEADERS });
    }),
  };
}
export const tracking = trackingHandlers();

