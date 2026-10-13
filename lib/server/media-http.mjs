import { rejectQuery } from './request-validation.mjs';
import { completeRequest, requestTrace, safeError } from './request-observability.mjs';
import { authenticate, mediaConfig, MediaError, requireOrigin } from './media-auth.mjs';
import { generateVariants, readImageBody } from './media-image.mjs';
import { MediaStore } from './media-store.mjs';

const stores = new Map();
const PRIVATE = { 'Cache-Control': 'private, no-store', 'Vary': 'Cookie', 'X-Content-Type-Options': 'nosniff' };
function storeFor(config) {
  if (!stores.has(config.dataDir)) stores.set(config.dataDir, new MediaStore(config.dataDir));
  return stores.get(config.dataDir);
}
function json(body, status = 200) { return Response.json(body, { status, headers: PRIVATE }); }

// Dependencies can be supplied by tests; production routes always use verified config/auth.
export function mediaHandlers({ getConfig = mediaConfig, getStore = storeFor, logger = console.info } = {}) {
  async function handle(request, action, operation) {
    const trace = requestTrace('media', action);
    let response;
    try {
      const config = getConfig();
      const owner = authenticate(request, config);
      rejectQuery(request, MediaError);
      if (request.method !== 'GET') requireOrigin(request, config);
      response = await operation(owner, getStore(config));
    } catch (error) {
      const failure = safeError(error, MediaError, 'Media service unavailable.');
      response = json(failure.body, failure.status);
    }
    return completeRequest(response, trace, logger);
  }
  return {
    current: request => handle(request, 'current', (owner, store) => json({ media: store.current(owner) })),
    upload: request => handle(request, 'upload', async (owner, store) => {
      const id = store.reserve(owner);
      try {
        const { bytes, mime } = await readImageBody(request);
        const variants = await generateVariants(bytes, mime);
        return json({ media: store.publish(id, owner, variants) }, 201);
      } catch (error) { store.abandon(id, owner); throw error; }
    }),
    read: (request, id, variant) => handle(request, 'read', (owner, store) =>
      new Response(store.read(id, variant, owner), { headers: {
        ...PRIVATE, 'Content-Type': 'image/webp', 'Content-Disposition': 'inline',
        'Cross-Origin-Resource-Policy': 'same-origin',
      } })),
    remove: (request, id) => handle(request, 'remove', (owner, store) => {
      store.remove(id, owner);
      return new Response(null, { status: 204, headers: PRIVATE });
    }),
  };
}
export const media = mediaHandlers();

