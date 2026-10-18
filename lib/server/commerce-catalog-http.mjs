import { timingSafeEqual } from 'node:crypto';
import { commerceConfig, commerceDatabase } from './commerce-http.mjs';
import { catalogConfig, readCatalog } from './catalog-http.mjs';
import { DomainError } from './domain-store.mjs';
import { boundedJsonObject, exactObjectFields, rejectQuery } from './request-validation.mjs';
import { sharedServiceLimits } from './service-limits.mjs';
import { completeRequest, requestTrace, safeError } from './request-observability.mjs';
import { MemoryLimiter } from './rate-limit.mjs';

const demoLimiter = new MemoryLimiter();
export function commerceCatalogHandlers({ env = () => process.env, config = commerceConfig, store = commerceDatabase,
  catalogSettings = catalogConfig, catalog = readCatalog, limits = sharedServiceLimits, logger = console.info } = {}) {
  async function run(request, action) {
    const trace = requestTrace('commerce', action);
    let response;
    try {
      rejectQuery(request, DomainError);
      if (request.method !== (action === 'provision' ? 'POST' : 'GET')) throw new DomainError(405, 'Method not allowed.');
      if (action === 'publicCatalog' && env().DOMAIN_DATA_DIR === undefined) {
        await demoLimiter.consume('commerce-demo:global', 600, 60000);
        response = Response.json({ mode: 'demo', items: [] });
      } else {
        await limits.before(request, 'commerce');
        const settings = config(env());
        if (action === 'provision') {
          const cs = catalogSettings(env());
          if (cs.mode !== 'managed') throw new DomainError(503, 'Managed catalog required.');
          const supplied = /^Bearer ([A-Za-z0-9._~-]{32,512})$/.exec(request.headers.get('authorization') || '')?.[1];
          if (!supplied) throw new DomainError(401, 'Admin authorization required.');
          const a = Buffer.from(supplied), b = Buffer.from(cs.token);
          if (a.length !== b.length || !timingSafeEqual(a,b)) throw new DomainError(403, 'Admin authorization failed.');
          const input = await boundedJsonObject(request, { ErrorType: DomainError, maxBytes: 4096, allowedFields: ['action','record'] });
          const db = store(settings);
          if (input.action === 'station') {
            db.addStation(input.record); response = Response.json({ ok: true });
          } else if (input.action === 'vendor') {
            response = Response.json({ id: db.addVendor(input.record) }, { status: 201 });
          } else if (input.action === 'product') {
            const p = exactObjectFields(input.record, ['sku','vendorId','active'], DomainError);
            const source = catalog().list().find(item => item.id === p.sku);
            if (!source) throw new DomainError(404, 'Catalog product not found.');
            db.putProduct({ sku: p.sku, vendorId: p.vendorId, active: p.active, name: source.name, pricePaise: source.price * 100 });
            response = Response.json({ ok: true });
          } else throw new DomainError(400, 'Unknown provisioning action.');
        } else response = Response.json({ mode: 'server', items: store(settings).commerceCatalog() });
      }
    } catch (error) {
      const failure = safeError(error, DomainError, 'Commerce configuration unavailable.');
      response = Response.json(failure.body, { status: failure.status,
        headers: failure.retryAfter ? { 'Retry-After': String(failure.retryAfter) } : {} });
    }
    return completeRequest(response, trace, logger);
  }
  return { list: request => run(request, 'publicCatalog'), provision: request => run(request, 'provision') };
}
export const commerceCatalog = commerceCatalogHandlers();
