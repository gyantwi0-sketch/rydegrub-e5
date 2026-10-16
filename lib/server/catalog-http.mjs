import { timingSafeEqual } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { CatalogError, CatalogStore } from './catalog-store.mjs';
import { boundedJsonObject, exactObjectFields } from './request-validation.mjs';
import { completeRequest, requestTrace, safeError } from './request-observability.mjs';
import { sharedServiceLimits } from './service-limits.mjs';
import { MemoryLimiter } from './rate-limit.mjs';
const stores = new Map();
const demoLimits = new MemoryLimiter();
export function catalogConfig(env = process.env) {
  const token = env.CATALOG_ADMIN_TOKEN, root = env.CATALOG_DATA_DIR;
  // Only fully unconfigured installations get public read-only sample data.
  // Broken/partial managed configuration never silently falls back to samples.
  if (token === undefined && root === undefined) return { mode: 'demo' };
  if (typeof token !== 'string' || !/^[A-Za-z0-9._~-]{32,512}$/.test(token) ||
      typeof root !== 'string' || !isAbsolute(root)) throw new CatalogError(503, 'Catalog service is not configured.');
  return { token, root, mode: 'managed' };
}
function database(c) {
  const key = c.mode === 'demo' ? 'demo' : c.root;
  if (!stores.has(key)) stores.set(key, new CatalogStore(c.root, { demo: c.mode === 'demo' }));
  return stores.get(key);
}
export function resetCatalogStores() {
  for (const store of stores.values()) {
    try {
      if (typeof store.close === 'function') store.close();
      else store.db?.close();
    } catch {}
  }
  stores.clear();
}
export const readCatalog = () => database(catalogConfig());
function out(data, status = 200) { return Response.json(data, { status, headers: {
  'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
} }); }
function auth(req, c) {
  if (c.mode !== 'managed') throw new CatalogError(503, 'Managed catalog is not configured.');
  const m = /^Bearer ([A-Za-z0-9._~-]{32,512})$/.exec(req.headers.get('authorization') || '');
  if (!m) throw new CatalogError(401, 'Admin authorization required.');
  const a = Buffer.from(m[1]), b = Buffer.from(c.token);
  if (a.length !== b.length || !timingSafeEqual(a,b)) throw new CatalogError(403, 'Admin authorization failed.');
}
const body = req => boundedJsonObject(req, { ErrorType: CatalogError, maxBytes: 16384, timeoutMs: 3000 });
export function createCatalogHandlers({ config = catalogConfig, store = database, limits = sharedServiceLimits, logger = console.info } = {}) {
  async function run(req, method, action, fn, admin = false, search = false) {
    const trace = requestTrace('catalog', action);
    let response;
    try {
      if (req.method !== method) throw new CatalogError(405, 'Method not allowed.');
      const c = config();
      if (!search && new URL(req.url).search) throw new CatalogError(400, 'Query parameters are not accepted.');
      if (c.mode === 'managed') await limits.before(req, 'catalog');
      else await demoLimits.consume('catalog-demo:global', 600, 60000);
      if (admin) auth(req, c);
      response = await fn(store(c), c);
    } catch(error) {
      const failure = safeError(error, CatalogError, 'Catalog service unavailable.');
      response = out(failure.body, failure.status);
      if (failure.retryAfter) response.headers.set('Retry-After', String(failure.retryAfter));
    }
    return completeRequest(response, trace, logger);
  }
  return {
    list: req => run(req, 'GET', 'list', (db,c) => {
      const products = db.list();
      return out({ products, categories: ['All', ...new Set(products.map(p => p.category))], mode: c.mode });
    }),
    search: req => run(req, 'GET', 'search', (db,c) => {
      const params = new URL(req.url).searchParams, input = Object.create(null);
      for (const [key,value] of params) {
        if (params.getAll(key).length !== 1) throw new CatalogError(400, 'Repeated search parameter.');
        input[key] = ['page','limit'].includes(key) ? (/^\d+$/.test(value) ? Number(value) : NaN) : value;
      }
      return out({ ...db.search(input), mode: c.mode });
    }, false, true),
    create: req => run(req, 'POST', 'create', async db => out({ product: db.create(await body(req)) },201), true),
    update: req => run(req, 'PUT', 'update', async db => out({ product: db.update(await body(req)) }), true),
    remove: req => run(req, 'DELETE', 'remove', async db => out({ removed: db.remove(exactObjectFields(await body(req), ['id'], CatalogError).id) }), true),
  };
}
export const catalogHandlers = createCatalogHandlers();
