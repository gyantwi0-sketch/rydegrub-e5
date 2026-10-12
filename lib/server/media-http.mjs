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
export function mediaHandlers({ getConfig = mediaConfig, getStore = storeFor } = {}) {
  async function handle(request, operation) {
    try {
      const config = getConfig();
      const owner = authenticate(request, config);
      if (request.method !== 'GET') requireOrigin(request, config);
      return await operation(owner, getStore(config));
    } catch (error) {
      // Never log requests, tokens, filenames, bodies or decoder/database error details.
      return json({ error: error instanceof MediaError ? error.message : 'Media service unavailable.' },
        error instanceof MediaError ? error.status : 503);
    }
  }
  return {
    current: request => handle(request, (owner, store) => json({ media: store.current(owner) })),
    upload: request => handle(request, async (owner, store) => {
      const id = store.reserve(owner);
      try {
        const { bytes, mime } = await readImageBody(request);
        const variants = await generateVariants(bytes, mime);
        return json({ media: store.publish(id, owner, variants) }, 201);
      } catch (error) { store.abandon(id, owner); throw error; }
    }),
    read: (request, id, variant) => handle(request, (owner, store) =>
      new Response(store.read(id, variant, owner), { headers: {
        ...PRIVATE, 'Content-Type': 'image/webp', 'Content-Disposition': 'inline',
        'Cross-Origin-Resource-Policy': 'same-origin',
      } })),
    remove: (request, id) => handle(request, (owner, store) => {
      store.remove(id, owner);
      return new Response(null, { status: 204, headers: PRIVATE });
    }),
  };
}
export const media = mediaHandlers();

