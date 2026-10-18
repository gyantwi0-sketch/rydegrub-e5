# Authenticated cart and unpaid draft API

This implements the backend portion of #4 and advances #1/#2/#12/#14/#44.
The browser cart and checkout remain explicit demos. Do not close their integration
issues or represent these drafts as confirmed deliveries or payable orders.

## Requirements

Use the existing native ACCOUNT_* configuration and DOMAIN_DATA_DIR on a private,
backed-up persistent Node 24.7+ host. Production requires the existing Redis REST
limiter. Initialize schemas with `pnpm data:init`. Paths under public/ or .next/
are rejected. Legacy profile/tracking JWTs are not commerce credentials.

The verified native session supplies both owner and account ID. `ensureAccount`
creates the immutable domain identity mapping; conflicting mappings fail closed.
The browser must never submit owner, subject, account ID, price or status.

DomainStore's operational catalog is separate from CatalogStore's browsing menu.
A trusted provisioning/import integration must map real station/vendor/SKU data
before these APIs can order browsed products. Nothing automatically seeds sample
products or converts a fictional browser journey into a verified journey. An
empty/unprovisioned domain catalog rejects cart items. Approved PNR integration
must create owner-bound journeys. These are explicit rollout blockers.

## Contract

All responses have no-store, nosniff, no-referrer and an opaque request ID.
Errors are `{error:string}`; 400 invalid input, 401 no session, 403 unverified or
cross-origin, 404 inaccessible record, 409 stale/unavailable/conflicting state,
429 quota exhausted (Retry-After), 503 configuration/storage/provider unavailable.
Unknown query parameters and extra JSON fields are rejected. JSON bodies must
have Content-Type application/json and fit within 8192 bytes; read timeout is 3s.

| Method | Path | Input | Result |
| --- | --- | --- | --- |
| GET | /api/cart | none | `{cart:{version,items}}` |
| PUT | /api/cart | `{expectedVersion,items:[{sku,quantity}]}` | updated cart |
| GET | /api/cart/quote | none | `{quote:{cartVersion,currency,subtotalPaise,quoteHash,items,payable:false}}` |
| POST | /api/orders/drafts | `{journeyId,cartVersion,quoteHash}` + Idempotency-Key UUIDv4 header | 201 `{draft,payable:false}` |
| GET | /api/orders/drafts/{id} | none | owner-only draft with frozen item prices |

PUT and POST require exact application Origin, plus same-origin Sec-Fetch-Site
when supplied. Authentication is a Secure/HttpOnly cookie; client code must not
read it. Cart updates replace the complete cart, support clearing with [], and
require the last server version. A 409 requires reload/review; do not silently
retry with a newer version. Limits: 30 distinct SKUs, 1–99 per SKU, ₹20,000 subtotal.

Quotes snapshot current active products/vendors/stations in one transaction.
The hash covers owner, cart version, quantities, names, prices, vendor and station.
It is an optimistic snapshot identifier, not a secret or payment authorization.
Draft creation rechecks it inside the order transaction. On price/catalog changes,
show a new quote and require customer review. Browser totals are never accepted.
Taxes, discounts, delivery fees, inventory reservations, train-stop eligibility and
payment authorization are not implemented by this subtotal-only API.

Use a new idempotency UUID for a new confirmed draft request. Retry uncertain
network outcomes with the identical key and body: the original result replays,
including after a catalog price change. Reuse with changed fields conflicts.
Expired keys conflict rather than creating a second order. Draft reads check the
owner and draft state and expose no passenger data or payment credentials.

## Frontend integration acceptance (still pending)

1. Replace browser-only account carts with GET/PUT, including empty/loading/error states.
2. Never overwrite a server cart automatically with a local/guest cart at login.
3. Implement the separate reviewed guest-cart lifecycle before supporting a merge.
4. Review quote changes and persist the current idempotency key only for retrying
   the same draft request. Do not show success as payment or vendor acceptance.
5. Test two browsers, logout/login as another user, stale tabs, changed prices,
   unavailable products, Redis outage and application restart on staging.
6. Connect trusted domain catalog/journey provisioning; then separately implement
   stock/fees/eligible delivery, gateway verification and fulfilment integration.

## Verification

`node --test tests/commerce.test.mjs` exercises native session lookup/revocation,
owner isolation, restart persistence, CSRF, strict input and body limits, quote
drift, idempotent draft creation, inaccessible journeys, safe failures and quotas.
The full suite and compiled HTTP smoke checks include these routes. No test
sends messages, charges money or looks up a real passenger.
