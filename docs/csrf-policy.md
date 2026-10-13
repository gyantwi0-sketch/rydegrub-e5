# CSRF policy for cookie-authenticated APIs (#16)

The current Node routes require **exact configured HTTPS Origin** and, when present, `Sec-Fetch-Site: same-origin` for every unsafe request (POST, PATCH, DELETE). The check is performed **before** the protected operation and is shared by media, tracking and profile handlers via `lib/server/scoped-auth.mjs`. Requests with absent, mismatched or untrusted Origin are rejected with 403. No permissive CORS or request-supplied redirect/proxy origin is enabled. Anonymous tracking-code POSTs also enforce same-origin to avoid cross-site abuse.

Each cookie-authenticated API uses a distinct short-lived RS256-signed JWT and a fixed `__Host-` cookie with Secure, HttpOnly, SameSite=Strict, Path=/ and no Domain, issued only by the trusted login provider. The UI's current demo sign-in creates **no** valid authentication cookie. This CSRF design does not replace authentication, authorization, XSS protection, origin validation at an ingress proxy, nor provider-independent request limits. `GET` endpoints must remain read-only, without state-changing operations such as recording consent.

Active unsafe endpoints reviewed:
- Media upload and deletion: `POST /api/media`, `DELETE /api/media/{id}`.
- Profile edits and consent: `PATCH /api/profile`, `PATCH /api/profile/consent`.
- SMS phone change: `POST /api/profile/phone/start`, `POST /api/profile/phone/confirm`.
- Order tracking: `POST /api/orders/{id}/tracking-access` (issue code), `DELETE /api/orders/{id}/tracking-access` (revoke), and guest `POST /api/orders/{id}/tracking` (read by code).
- An admin catalog API, if installed, uses an independent explicit Authorization Bearer secret and **not a cookie**. It must never be converted into a cookie-based route without being added to this policy.

`tests/csrf-regression.test.mjs` verifies the origin decision and reviews every unsafe Next API route for a documented guarded binding. Existing `tests/media.test.mjs`, `tests/tracking.test.mjs` and `tests/profile.test.mjs` provide authenticated integration tests of same-origin enforcement and cross-origin denials. When introducing another endpoint, review its authentication type, classify it in the test, validate Origin/Fetch Metadata before mutation and add a negative integration test. Do not introduce optional origin checks to make clients convenient. Real authentication/logout deployments must set cookie attributes described above; CSRF tests cannot prove those external cookies exist.

No request body, JWT, password, PNR, payment credential, SMS code or passenger details should be written into logs or security telemetry. This policy does not itself implement registration, payment, PNR lookups, checkout or staff APIs; those future routes require independent security reviews.
