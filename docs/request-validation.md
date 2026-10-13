# Server request validation and limits (#17)

The deployed media, tracking and profile APIs never trust client-side checks. Shared helpers in `lib/server/request-validation.mjs` enforce no unexpected query parameters, strict JSON object fields, exact `application/json` content type, declared and **actual** body length limits, a three-second read deadline, and safe 400 failure responses. Route-specific domain validation remains server-owned in dedicated stores and handlers.

| Endpoint | Method(s) | Input limits |
| --- | --- | --- |
| `/api/media` | GET, POST | No query params. Upload allows exact JPEG/PNG/WebP only, <=5 MiB actual bytes; 10s read timeout, dimensions 64..4096 pixels, <=16 MP, single-frame; decoded metadata stripped, only safe WebP variants emitted. |
| `/api/media/{uuid}` | DELETE | UUID v4 path segment, verified owner and same-origin write; no query params. |
| `/api/media/{uuid}/{variant}` | GET | UUID v4, allowlisted `thumbnail` or `display` only; owner-scoped reads, no query params. |
| `/api/orders/tracking` | GET | No query params, verified owner list only. |
| `/api/orders/{uuid}/tracking` | GET, POST | UUID v4, no query params. POST requires exactly `{ "token": string }` JSON, <=512 actual bytes in 3s; token compared only as a SHA-256 digest. |
| `/api/orders/{uuid}/tracking-access` | POST, DELETE | UUID v4, owner + scope required, no query params; token issue/revocation is server controlled. |
| `/api/profile` | GET, PATCH | No query params. PATCH requires exactly `{ "name": string, "preferences": string[] }` JSON, <=2048 actual bytes in 3s. Name <=80 characters, trim-normalized by client but server insists on canonical trimmed value. Preferences allowlisted. |
| `/api/profile/consent` | PATCH | Same 2048 byte JSON cap; exactly `{ "purpose", "granted" }` with enum purpose and Boolean consent. |
| `/api/profile/phone/start`, `/api/profile/phone/confirm` | POST | Same 2048 byte cap; exactly `{ "phone" }` or `{ "code" }`, 10-digit Indian phone or 8-digit OTP with server-side expiry and attempts. |
| `/api/profile/consent/history` | GET | Verified-owner history; no query params. |

All checks execute before business-data writes. No API accepts client-provided owner IDs, PNR or checkout pricing as authority. Unknown JSON fields, nested unapproved values and arbitrary URL upload sources cannot trigger privileged operations. Media and fulfilment UUID/enum validation is enforced by stores with safe 404 errors; misleading client names or forwarded request IDs cannot bypass auth.

Run `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm build`. Tests cover oversized/chunked/dishonest Content-Length, malformed JSON, wrong MIME, unknown object keys, expired/invalid tokens, cross-origin requests, wrong owners, dimensions and query manipulation. Privacy-safe request IDs and uniform error controls come from #25.

This documents **currently implemented** endpoints. The pending catalog/admin PR, plus future real registration, PNR lookup, checkout and payments APIs, must adopt the same helpers and add endpoint-specific schemas/size limits before production. A passing test on today's demo routes cannot validate unimplemented providers or checkout business rules. Never capture request content, customer details, tokens or raw PNRs in logs.
