# Secure order tracking and recorded events (#41, #42)

`#tracking/{uuid}` now reads persisted server fulfilment records. Browser order
objects cannot supply or authorize real tracking. Demo orders stay at “Demo created”; no client timer advances them. Existing sample checkout/orders use the explicitly separate
`#demo-tracking/{demo-id}` route. The Orders screen lists up to 50 of the verified
owner's active records and also accepts an order ID for guests with a tracking code.

## Access contract

- `GET /api/orders/tracking`: owner-only recent tracking list.
- `GET /api/orders/{uuid}/tracking`: owner-only tracking view.
- `POST /api/orders/{uuid}/tracking`: guest read using exactly `{"token":"..."}`
  in a JSON body; never put codes in URLs, query strings, cookies or analytics.
- `POST /api/orders/{uuid}/tracking-access`: owner creates a 15-minute code.
  Creating a code invalidates the previous code atomically.
- `DELETE /api/orders/{uuid}/tracking-access`: owner revokes the code immediately.

Every order is assigned a random UUID v4 by the server. The identifier alone
grants no access. Missing/invalid auth, non-owner IDs, malformed IDs, unknown IDs,
expired/revoked records and invalid guest codes receive the same 404 tracking
response. This prevents an API existence oracle; it is not a constant-time network
response guarantee. Lists require authentication and never enumerate other owners.
Request-supplied owner headers/IDs, browser storage, demo sign-in and a media-scoped
token are never accepted as order credentials. Responses are explicitly projected
to ID, fulfilment stage, delivery station, ETA, update time and revision. Detail views also include up to 100 chronological events with these same public fields, recording time and a fixed source label. Lists remain compact.
No name, mobile, email, PNR, coach/seat, payment, basket or owner key is returned.

All responses, including errors and issued codes, are private/no-store with
no-referrer and nosniff. POST/DELETE require the exact configured Origin, and
Sec-Fetch-Site must be same-origin when present. No CORS is enabled. Query strings
are rejected. The guest JSON body is limited to 512 actual bytes and three seconds,
including chunked requests and false Content-Length values. Codes are 256 random
bits, stored only as SHA-256 digests, scoped to exactly one order and read-only.
They cannot list orders, create another code, revoke access or mutate fulfilment.
Expiry is checked on every request, even before scheduled cleanup. Access codes
are never persisted in browser storage; the UI keeps them in memory only.

SQLite atomically enforces 600 tracking requests/minute/host, 120 requests/minute
per authenticated owner and five code-creation attempts/minute per owner. All
admitted attempts count, including failed order authorization. Cross-origin writes
are rejected before admission. No request-controlled forwarded
IP header is trusted. Limits are shared across workers; 429 includes Retry-After.
Add trusted ingress IP/connection limits to handle distributed floods; the shared
global application ceiling can otherwise be exhausted by an attacker.

## Configuration and real authentication

Requires Node 24, HTTPS and durable local storage on one host. Multiple workers on
that host share SQLite WAL; do not use NFS, ephemeral/serverless disks or separate
hosts with independent databases. Set server-only variables:

| Variable | Required value |
| --- | --- |
| `TRACKING_APP_ORIGIN` | Exact HTTPS origin, no trailing slash |
| `TRACKING_TOKEN_ISSUER` | Exact issuer of your trusted authentication service |
| `TRACKING_TOKEN_AUDIENCE` | Dedicated orders audience, e.g. `rydegrub-orders` |
| `TRACKING_TOKEN_PUBLIC_KEY` | RSA public key PEM, 2048+ bits; literal `\n` supported |
| `TRACKING_DATA_DIR` | Absolute service-private directory outside any web/static root |

Invalid/missing configuration fails closed with 503. No signing private key is
needed by this service and no development auth bypass exists. The trusted login
gateway must issue `__Host-ryde-orders` with Secure, HttpOnly, SameSite=Strict,
Path=/ and no Domain. Use RS256/JWT with exact issuer/audience, an opaque stable
subject (`[A-Za-z0-9_-]{1,128}`), integer iat/exp, at most 900 seconds lifetime and
scope `orders:track`. Optional nbf is enforced. Future/expired timestamps, forged
signatures, algorithm confusion, critical extensions and duplicate cookies fail.
The fixed public key is configured by operators, never downloaded from token URLs.

This reuses the media API's verification logic through `scoped-auth.mjs`, while
keeping the media cookie/scope and orders cookie/scope distinct. Use dedicated
audiences. Owner hashes derive from issuer and subject, so the fulfilment adapter
must use that same verified identity. Neither customer-entered emails nor PNRs are
account IDs. Logout must clear the cookie and reload the page to clear displayed
state. Account deactivation stops credential renewal; an issued owner JWT can
otherwise remain valid for up to 15 minutes. Use `purge-account` for immediate
removal of all that account's tracking records/codes. Key rotation requires
deployment; only one current verification public key is supported.

Native account authentication is available via ACCOUNT_AUTH_NATIVE=1; external scoped authentication remains supported. Checkout is still a demo. Operators must connect their accepted-order pipeline to the trusted ingestion adapter before production orders appear. Tracking records do not prove that payment was taken or create vendor fulfilment work.

## Trusted fulfilment integration

`applyTrackingEvent` in `lib/server/tracking-admin.mjs` is the integration boundary.
Call it only after the order backend has established the immutable owner from its
verified account and accepted the order. Never forward a browser body directly.
There is intentionally no public create/update-status web endpoint.

For an operator or local provider worker, use a restricted JSON file:

```sh
pnpm tracking:admin create /private/event.json
pnpm tracking:admin update /private/event.json
pnpm tracking:admin revoke-order /private/event.json
pnpm tracking:admin purge-account /private/event.json
pnpm tracking:cleanup
```

Schemas (unknown fields, including passenger/payment data, are rejected):

```json
{"subject":"opaque_account_id","snapshot":{"stage":"confirmed","station":"Kota Junction","eta":null}}
```

Create outputs only the generated order tracking ID and version. Persist that ID
in the trusted order record and include it in the customer's confirmation. Retry
creation only after checking that mapping; creation is not idempotent and must not
be called again for each provider event.

```json
{"id":"<returned UUID>","expectedVersion":1,"snapshot":{"stage":"preparing","station":"Kota Junction","eta":null}}
```

Update requires the current revision; stale/conflicting writes fail with 409 and
must be reconciled by the worker, not blindly replayed. Allowed stages are
confirmed → preparing → packed → arriving → delivered; skipped stages and backward updates are rejected. Cancellation is allowed before delivery. Delivered/cancelled
states are terminal and cannot be edited. Same-stage ETA updates are allowed before completion. ETA is null
or epoch milliseconds within yesterday through seven days ahead at ingestion.
Station names are bounded to 80 characters; do not place freeform passenger notes
in that field. Owner, creation time and expiry cannot be edited by updates.

Revoke-order takes `{"id":"<UUID>"}` and immediately denies owner and code access.
Purge-account takes `{"subject":"opaque_account_id"}` and atomically deletes that
issuer/account's records and codes. Connect it to account deletion/deactivation.
CLI output contains only IDs/versions, removal counts or a generic failure message.
Input files are bounded at 4 KiB; protect and remove them under your retention policy.

## Operations, retention and verification

Schedule `pnpm tracking:cleanup` every five minutes with TRACKING_DATA_DIR set.
Tracking records expire 30 days after creation; updates cannot prolong retention.
Cleanup removes expired/revoked rows, expired codes and old rate counters. API
access ends immediately at expiry or revocation, regardless of cleanup timing.
Keep the directory service-private (0700 on POSIX; restricted ACLs on Windows),
and never serve it statically. Schema version is 2; unknown versions fail closed.
Stop writers before backing up SQLite/WAL, and apply retention/deletion policies
to backups too. Monitor aggregate error counts, 429s and disk space without
capturing request bodies or identity credentials.

The tracking service logs no requests, cookies, tokens, database exception detail,
secrets, payment credentials, raw PNRs or passenger information. Disable body,
cookie and Authorization capture in proxy/APM instrumentation too. Tracking codes
are entered as password fields and copied only on explicit user action. The UI
polls every 30 seconds after successful reads and clears data/stops on failures.
No client timer fabricates fulfilment status.

Run `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm build`. Tests use real RSA
verification and temporary SQLite databases for owner/code isolation, uniform
denials, token rotation/expiry/revocation, minimum-data projection, cross-origin
rejection, quotas across connections, bounded bodies, trusted ingestion, monotonic
status updates, persistence, account purge and privacy-safe failures. Existing
media tests also exercise the shared verifier after extraction.

Before production, verify with two real accounts: owner upload-independent login,
cross-account rejection, trusted provider status update, guest code read, expiry,
rotation, logout and account purge. The deployed login/provider integration and
ingress/APM configuration cannot be certified by repository tests alone.


## Event history and schema migration

Startup automatically migrates tracking schema 1 to 2 in one transaction. Each existing order becomes one `migration` event preserving its actual stored revision and timestamp; no earlier stages or times are invented. New and updated records insert an `operations` event through database triggers in the same transaction as the snapshot and security audit. Failure to append an event rolls back the update. Server recording time cannot move backward. These times represent ingestion by operations, not an independently verified physical delivery time. ETA is supplied by operations, never calculated from elapsed browser time.

Events cannot be edited, replaced, or deleted independently of their order. Retention cleanup and account purge delete the order and its event history atomically through foreign keys. Revoked/expired orders and their history immediately become inaccessible. As with all local SQLite data, privileged host administrators remain outside this application-level protection boundary.

Detail responses contain `events` and `hasEarlierEvents`; only the latest 100 events are returned, oldest first. The UI labels migrated snapshots and truncated histories, displays the recorded timestamps, and polls for actual updates. Demo orders display only their creation time and explicitly state that no vendor received them. The old 15-second status calculation has been removed.

Before release, back up the persistent tracking database together with its WAL while writers are stopped. Rollback requires restoring the matching version-1 backup and old application together; old code deliberately rejects version 2. Do not downgrade by changing user_version or dropping event tables. Verify migrations using a staging copy before rolling out to existing production data.
