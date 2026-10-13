# Native account authentication

Implements server-backed registration, sign-in/logout, email verification, password recovery, password policy, and account endpoint throttling (#7–10, #13, #21). This is application code; delivery credentials and a production smoke test are still required before rollout. Existing demo cart/payment flows are not converted into a production checkout by this change.

## Deployment

Use Node 24.7+ (Node 24 current patch recommended) on a persistent single-host volume. Set ACCOUNT_APP_ORIGIN to the exact HTTPS app origin, ACCOUNT_DATA_DIR to a private absolute directory outside the web root, and ACCOUNT_RATE_SECRET to a randomly generated secret of at least 32 characters. Back up accounts.sqlite with a consistent SQLite backup procedure, encrypt volume/backups, and restrict filesystem access. Independent multi-host SQLite files or ephemeral serverless storage are not supported.

Set RATE_LIMIT_REDIS_URL and RATE_LIMIT_REDIS_TOKEN for a Redis REST service accepting JSON Redis commands. Each counter increment and expiry is a single EVAL operation. Redis failure rejects requests with 503; quota exhaustion returns 429 and Retry-After. Development uses a bounded in-memory adapter. No account/email/IP/password/Redis credentials are included in rate-limit logs. Production never falls back to in-memory counters.

ACCOUNT_TRUSTED_IP_HEADER is optional. Configure it ONLY if the ingress overwrites and strips user-supplied copies, and supplies one validated IP (not a forwarded chain). Otherwise requests share a conservative global admission bucket. Email buckets are HMAC fingerprints. All auth routes have an IP quota; registration/sign-in/code requests also have account quotas; code redemption has token-fingerprint quotas. A distributed bucket limits global auth load across workers. Review quotas against deployment traffic before launch.

ACCOUNT_EMAIL_URL is a trusted HTTPS adapter endpoint. ACCOUNT_EMAIL_KEY authenticates POSTs using Bearer auth. Adapter contract: `{to, template: "verify-email" | "reset-password", code, expiresMinutes: 15}`. The adapter must send the code as a transactional email, not log it, and return 2xx on accepted delivery. The customer pastes the code into the sign-in screen's verification/recovery controls. No code is placed in URLs, browser persistence, logs or API responses. Verify delivery and sender-domain configuration manually. There is no email provider account provisioned by this change.

Passwords use Argon2id with a unique 16-byte salt, 64 MiB memory, 3 passes and a 32-byte tag. Accept 15–128 Unicode code points (maximum 512 UTF-8 bytes). Registration and reset check the Pwned Passwords range API, transmitting only the first five SHA-1 hex characters with Add-Padding. SHA-1 is never the stored password hash. Screening failure prevents registration/reset; no plaintext password is logged. API reference: https://haveibeenpwned.com/API/v3#SearchingPwnedPasswordsByRange.

## API contract v1

All bodies are strict JSON objects. Unexpected fields, query strings, oversized/slow bodies and cross-origin mutations are rejected. Responses are private/no-store and carry a fresh X-Request-ID. Errors use `{error: string}` with 400/401/403/429/503; 429 includes Retry-After.

| Method and path | Body | Result |
|---|---|---|
| POST /api/v1/auth/register | name, email, password | 202 generic delivery message |
| POST /api/v1/auth/signin | email, password | account projection; session cookie |
| GET /api/v1/auth/session | none | current account; 401 if invalid/expired |
| POST /api/v1/auth/logout | {} | revoke current session and clear cookie |
| POST /api/v1/auth/verification/request | email | 202 generic delivery message |
| POST /api/v1/auth/verification/confirm | token | verify email; reject expired/used tokens |
| POST /api/v1/auth/password/request | email | 202 generic delivery message |
| POST /api/v1/auth/password/reset | token, password | replace password and revoke all sessions |

Session tokens have 256 bits of random entropy and are stored only as SHA-256 digests. Cookies use __Host-, Path=/, HttpOnly, Secure, SameSite=Lax, eight-hour expiry. Sign-in rotates the supplied prior session; logout revokes it. Verification/reset tokens expire in 15 minutes, are stored hashed, are replaced on resend, and are consumed transactionally. Password reset revokes all account sessions. Incorrect and unknown-account sign-ins use a password KDF and the same generic error.

Verified native sessions can access the existing profile/media/tracking APIs. Unverified sessions cannot. Native mode applies when ACCOUNT_APP_ORIGIN is set and a service's legacy TOKEN_PUBLIC_KEY is absent; keep its DATA_DIR and PROFILE_OTP_PEPPER. Existing trusted external JWT integrations remain available with their previous configuration. Native identities are new opaque IDs: do not automatically assign old external accounts' records to the same email. Identity/data reconciliation needs an explicit trusted migration.

## Validation and remaining work

`node --test`, lint, typecheck and build are required. Tests cover password boundaries, duplicate registration, wrong credentials, Argon2 storage, session rotation/expiry/logout, verification replay/expiry, reset revocation, CSRF/field validation, safe cookies, rate limiting, Redis failure and privacy-preserving breach lookup.

Use test mailboxes to smoke-test email delivery, browser login/verification/logout/reset, Secure-cookie handling through the real HTTPS proxy, shared Redis quotas and persistent-volume restart. Do not mark deployment/integration issues complete from mocked provider tests. The account deletion/export workflow, migration to a shared distributed database, and the other domain API contracts remain separate work.
