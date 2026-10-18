import { cartContext } from './cart-context.mjs';
import { guestToken, guestCookie } from './guest-cookie.mjs';
import { isAbsolute, relative, resolve } from 'node:path';
import { accountConfig, authenticatedAccount } from './account-http.mjs';
import { AccountError } from './account-store.mjs';
import { DomainError, DomainStore } from './domain-store.mjs';
import { AccessError, sameOrigin } from './scoped-auth.mjs';
import { boundedJsonObject, rejectQuery } from './request-validation.mjs';
import { completeRequest, requestTrace, safeError } from './request-observability.mjs';
import { sharedServiceLimits } from './service-limits.mjs';

const stores = new Map();
export function commerceConfig(env = process.env) {
  const account = accountConfig(env);
  const dir = env.DOMAIN_DATA_DIR;
  if (typeof dir !== 'string' || !isAbsolute(dir))
    throw new DomainError(503, 'Commerce storage is not configured.');
  for (const webRoot of ['public', '.next']) {
    const child = relative(resolve(webRoot), resolve(dir));
    if (child === '' || (!child.startsWith('..') && !isAbsolute(child)))
      throw new DomainError(503, 'Commerce storage must be private.');
  }
  return { origin: account.origin, dataDir: dir };
}
export function commerceDatabase(config) {
  if (!stores.has(config.dataDir)) stores.set(config.dataDir, new DomainStore(config.dataDir));
  return stores.get(config.dataDir);
}
const json = (body, status = 200) => Response.json(body, { status,
  headers: { Vary: 'Cookie, Origin', 'Cross-Origin-Resource-Policy': 'same-origin' } });
const body = (request, fields) => boundedJsonObject(request, {
  ErrorType: DomainError, maxBytes: 8192, allowedFields: fields,
});

// Native verified accounts only. Legacy tracking tokens are not checkout tokens.
export function commerceHandlers({ config = commerceConfig, authenticate = authenticatedAccount,
  store = commerceDatabase, limits = sharedServiceLimits, logger = console.info } = {}) {
  async function handle(request, operation, method, action) {
    const trace = requestTrace('commerce', operation);
    let response;
    try {
      await limits.before(request, 'commerce');
      const settings = config();
      if (request.method !== method) throw new DomainError(405, 'Method not allowed.');
      rejectQuery(request, DomainError);
      if (request.method !== 'GET') sameOrigin(request, settings);
      const member = authenticate(request);
      if (member.verified !== true) throw new DomainError(403, 'Verify your email first.');
      await limits.owner('commerce', member.owner);
      if (['replaceCart','mergeGuest'].includes(operation) && request.headers.get('x-ryde-cart-context') !== cartContext(member.owner))
        throw new DomainError(409, 'Account changed. Reload your cart.');
      const db = store(settings);
      db.ensureAccount(member.owner, member.id);
      response = await action(member.owner, db);
    } catch (error) {
      const normalized = error instanceof AccountError || error instanceof AccessError
        ? new DomainError(error.status, error.message) : error;
      const failure = safeError(normalized, DomainError, 'Commerce service unavailable.');
      response = json(failure.body, failure.status);
      if (failure.status === 429) response.headers.set('Retry-After', String(failure.retryAfter ?? 60));
    }
    return completeRequest(response, trace, logger);
  }
  return {
    mergeGuest: request => handle(request, 'mergeGuest', 'POST', async (owner, db) => {
      const input = await body(request, ['expectedVersion','guestVersion','mode']);
      const response = json({ cart: db.mergeGuestCart(owner, guestToken(request), input.expectedVersion, input.guestVersion, input.mode) });
      response.headers.set('Set-Cookie', guestCookie(''));
      return response;
    }),
    readCart: request => handle(request, 'readCart', 'GET', (owner, db) => json({ cart: db.readCart(owner), context: cartContext(owner) })),
    replaceCart: request => handle(request, 'replaceCart', 'PUT', async (owner, db) => {
      const input = await body(request, ['expectedVersion', 'items']);
      return json({ cart: db.replaceCart(owner, input.expectedVersion, input.items), context: cartContext(owner) });
    }),
    quoteCart: request => handle(request, 'quoteCart', 'GET', (owner, db) =>
      json({ quote: db.transaction(() => db.quoteCart(owner)) })),
    createDraft: request => handle(request, 'createDraft', 'POST', async (owner, db) => {
      const input = await body(request, ['journeyId', 'cartVersion', 'quoteHash']);
      if (typeof input.quoteHash !== 'string' || !/^[a-f0-9]{64}$/.test(input.quoteHash))
        throw new DomainError(400, 'Review a current cart quote first.');
      const draft = db.createDraftOrder(owner, input.journeyId, input.cartVersion,
        request.headers.get('idempotency-key'), Date.now(), input.quoteHash);
      return json({ draft, payable: false }, 201);
    }),
    readDraft: (request, context) => handle(request, 'readDraft', 'GET', async (owner, db) => {
      const { id } = await context.params;
      return json({ draft: db.readDraft(owner, id), payable: false });
    }),
  };
}
export const commerce = commerceHandlers();
