# Private profile photo uploads

Related issue: #31. The audited `main` revision has static food images, browser-only
profile details and demo auth forms; it contains no upload handler or file picker.
This change adds a real profile-photo picker and server API. Demo sign-in is never
accepted as authentication. Static product images remain repository assets. There
is no general URL-fetch, URL-import, product-media mutation or video-upload API.

## Deployment configuration

Run on Node.js 24 with Next's Node runtime, on **one host with durable local disk**.
SQLite WAL supports multiple workers on that host; do not share the database over
NFS or run this backend on ephemeral/serverless disks or multiple hosts. Deploy
behind HTTPS. Install with `pnpm install --frozen-lockfile` (Sharp 0.35.5 is pinned).

Set server-only environment variables:

| Variable | Meaning |
| --- | --- |
| `MEDIA_APP_ORIGIN` | Exact HTTPS origin, e.g. `https://app.example.com`, no trailing slash |
| `MEDIA_TOKEN_ISSUER` | Exact trusted auth service issuer |
| `MEDIA_TOKEN_AUDIENCE` | Dedicated audience, e.g. `rydegrub-profile-media` |
| `MEDIA_TOKEN_PUBLIC_KEY` | PEM RSA public key (SPKI), at least 2048 bits; literal `\n` is supported |
| `MEDIA_DATA_DIR` | Absolute private directory outside `public/` and the web root |

No private signing key belongs in this application. Missing or invalid config
returns 503, with the picker disabled. The application has no development auth
bypass and does not create an account or token from the demo sign-in form.

## Authentication service integration

The existing trusted authentication service must verify the account and issue a
short-lived RS256 JWT into `__Host-ryde-media`, using `Secure; HttpOnly;
SameSite=Strict; Path=/`, **without Domain**. Do not expose it to JavaScript or
localStorage. The provider must use an opaque stable account ID matching
`[A-Za-z0-9_-]{1,128}` as `sub`, not an email, phone or PNR.

Token contract: header `alg=RS256`, `typ=JWT`; payload exact `iss`, string `aud`,
`sub`, integer `iat` and `exp`, lifetime at most 900 seconds, and a space-separated
`scope` containing `media:profile`. Optional integer `nbf` is enforced. Algorithm
confusion, missing/expired/future tokens and critical extensions are rejected.
The server verifies the signature with its configured public key and never reads
JWT-provided key URLs. Grant this dedicated scope only to accounts permitted to
manage their own profile photo. Revoke by clearing the cookie and stopping token
renewal; already-issued tokens live for at most 15 minutes. Account deletion must
also purge its media via the application's authenticated deletion flow before
revocation, or an operator retention process. Immediate provider-side token
revocation is not implemented.

Configure the auth gateway to set/refresh/clear this cookie after real login and
logout. Real account login/provider integration is a separate dependency, not
implemented by this upload change. Until configured, demo guests cannot upload.
Rotate the public key through deployment; only one active verification key is
supported. Use synchronized clocks; no time leeway is accepted.

## API and enforced rules

- `GET /api/media`: current owner's photo metadata or `null`.
- `POST /api/media`: raw binary JPEG, PNG or WebP body with its exact MIME as
  Content-Type. No multipart fields, owner IDs, filenames, URLs or purpose are
  accepted. Success 201 returns a generated UUID and private variant paths.
- `GET /api/media/{id}/{thumbnail|display}`: authenticated owner-only WebP.
- `DELETE /api/media/{id}`: authenticated owner-only deletion, success 204.

All methods require a verified token and scope. Writes also require the exact
configured Origin and, when present, Sec-Fetch-Site=same-origin. No CORS is enabled.
Invalid/missing tokens yield 401, missing scope/origin violations 403, unknown or
other-owner IDs 404, MIME violations 415, body overflow 413, decode/dimension/frame
violations 422, admission limits 429. Internal failures return a generic 503.

The streamed body is bounded at 5 MiB even when Content-Length is absent or false;
body reading has a 10-second timeout. MIME must agree with the decoded format.
Only still images are accepted: 64–4096 pixels per side, at most 16 megapixels.
Each image is fully decoded and re-encoded with auto orientation, sRGB and metadata
stripped into 96x96 and 512x512 WebP crops. Original bytes are never persisted or
served. Each encoding has a five-second processing timeout. Four concurrent
uploads per host, one per account and 20 admitted attempts per account per UTC
hour are enforced by SQLite transactions. Validation failures consume attempts.
Enforce an ingress connection/request-rate limit too, especially for anonymous
traffic; application admission is not a network denial-of-service defense.

Owner keys are SHA-256 of the configured issuer and opaque subject. Client owners
are never trusted. Publishing atomically retires the previous photo and activates
the new one; failed replacements leave the old photo available. Only ready,
unexpired objects can be read. Private responses use no-store, Vary: Cookie and
nosniff; image responses also use same-origin resource policy. Never configure a
CDN to override these headers, and never expose the storage directory as static
files. Next image optimization is disabled; there is no arbitrary URL proxy.

## Lifecycle and operations

Photo metadata and generated files persist across application restarts. Media
expires after 30 days. Pending uploads expire after 15 minutes. Delete/replacement
immediately denies API access; physical removal happens during cleanup. Rows are
retained until their directory is successfully removed so failures can be retried.
Crash remnants from an incomplete publish remain associated with a pending row.

Schedule `pnpm media:cleanup` every 5 minutes on the storage host with the same
`MEDIA_DATA_DIR` and service account. It removes deleted/expired/pending objects
and old rate counters; output is only a removed-object count. Alert on nonzero
exit status and disk space. Without cleanup, stale pending reservations may block
uploads and retired files remain on disk. Pending operations never publish after
their lease expires. SQLite owns quota/activation decisions, including across
multiple workers. Do not delete files or modify rows manually while writers run.

Restrict directory and database permissions to the service account (POSIX 0700
directories/0600 variants; configure Windows ACLs explicitly). New databases use
schema version 1. Stop writers before backup/restore, and snapshot both SQLite
and variant directories together. Keep backup retention consistent with the
30-day policy and deletion obligations. Monitor aggregate failures/latency/disk
usage; do not log request cookies, authorization, token payloads, filenames,
image bytes, secrets, payment credentials, raw PNRs or passenger contact data.
The media code emits no request or decoder logs. Ensure proxy/APM body and cookie
capture is disabled; existing infrastructure logging is outside this change.

## Validation and limits

Run `pnpm test`, `pnpm typecheck`, `pnpm build`. Media tests exercise actual RSA
verification, Sharp decoding/re-encoding, SQLite transactions, raw streaming and
the same HTTP handlers used by the routes. They cover spoofing, malformed and
animated input, limits, owner isolation, replacement/delete, expiry/restart and
failure cleanup. Test signing keys are generated in memory and never persisted.
Before deployment, verify the real auth gateway cookie and upload/read/delete in
an HTTPS staging environment, plus scheduled cleanup and disk-backup recovery.

Scope is private profile photos. Publishing shared/vendor product images, video
transcoding, moderation, malware scanning, immediate auth revocation, account
deletion integration and distributed object storage require separate work. The
application's checkout/PNR/demo account business logic is unchanged.

