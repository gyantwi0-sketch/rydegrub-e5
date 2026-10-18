import { commerceConfig, commerceDatabase } from './commerce-http.mjs';
import { DomainError } from './domain-store.mjs';
import { AccountError } from './account-store.mjs';
import { AccessError, sameOrigin } from './scoped-auth.mjs';
import { sharedServiceLimits } from './service-limits.mjs';
import { boundedJsonObject, rejectQuery } from './request-validation.mjs';
import { requestTrace, completeRequest, safeError } from './request-observability.mjs';

import { guestToken, guestCookie } from './guest-cookie.mjs';
export function guestHandlers({ config = commerceConfig, store = commerceDatabase, limits = sharedServiceLimits, logger = console.info } = {}) {
  async function handle(request, action, method) {
    const trace = requestTrace('commerce', action);
    let response;
    try {
      await limits.before(request, 'commerce');
      const settings = config();
      rejectQuery(request, DomainError);
      if (request.method !== method) throw new DomainError(405, 'Method not allowed.');
      if (method !== 'GET') sameOrigin(request, settings);
      const input = method === 'GET' ? {} : await boundedJsonObject(request, {
        ErrorType: DomainError, maxBytes: 8192, allowedFields: action === 'replaceGuest' ? ['expectedVersion','items'] : [],
      });
      const db = store(settings), token = guestToken(request);
      let cart, cookie;
      if (action === 'createGuest') {
        // Explicit same-origin creation can replace an expired/missing cookie,
        // but never resets a still-valid cart or extends its absolute expiry.
        if (token) { try { cart = db.readGuestCart(token); } catch (e) { if (!(e instanceof DomainError) || e.status !== 401) throw e; } }
        if (!cart) { const created = db.createGuestCart(); cart = created.cart; cookie = guestCookie(created.token); }
      } else if (action === 'readGuest') cart = db.readGuestCart(token);
      else if (action === 'replaceGuest') cart = db.replaceGuestCart(token, input.expectedVersion, input.items);
      else { if (token) db.removeGuestCart(token); cookie = guestCookie(''); }
      response = Response.json(cart ? { cart } : { ok: true }, { headers: { Vary: 'Cookie, Origin', ...(cookie ? { 'Set-Cookie': cookie } : {}) } });
    } catch (error) {
      const normalized = error instanceof AccountError || error instanceof AccessError ? new DomainError(error.status, error.message) : error;
      const failure = safeError(normalized, DomainError, 'Guest cart unavailable.');
      response = Response.json(failure.body, { status: failure.status,
        headers: { ...(failure.status === 429 ? { 'Retry-After': String(failure.retryAfter ?? 60) } : {}) } });
    }
    return completeRequest(response, trace, logger);
  }
  return {
    create: request => handle(request, 'createGuest', 'POST'),
    read: request => handle(request, 'readGuest', 'GET'),
    replace: request => handle(request, 'replaceGuest', 'PUT'),
    remove: request => handle(request, 'removeGuest', 'DELETE'),
  };
}
export const guest = guestHandlers();
