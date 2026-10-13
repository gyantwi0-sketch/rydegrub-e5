# Secure profile, phone verification and consent (#47)

The existing sign-in/sign-up pages are demos, **not account credentials**. The new profile API fails closed until a real identity provider sets a verified cookie. Do not treat browser input, sessionStorage, localStorage or any HTTP owner header as an authenticated account.

## Setup

Provide on a single Node 24 host with persistent private local storage (SQLite WAL; no serverless/ephemeral/NFS or separate independent app hosts):

- `PROFILE_APP_ORIGIN`: exact HTTPS origin, no trailing slash.
- `PROFILE_TOKEN_ISSUER`: trusted issuer; `PROFILE_TOKEN_AUDIENCE`: dedicated profile audience.
- `PROFILE_TOKEN_PUBLIC_KEY`: RSA SPKI PEM 2048+ bits, literal `\\n` supported.
- `PROFILE_DATA_DIR`: absolute private directory outside static/web roots, backed up securely.
- `PROFILE_OTP_PEPPER`: dedicated random server-only secret of at least 32 UTF-8 bytes.
- `PROFILE_SMS_URL`: exact HTTPS POST endpoint for a trusted SMS gateway accepting JSON `{to,message}` with `Authorization: Bearer <PROFILE_SMS_KEY>`; `PROFILE_SMS_KEY` is required alongside it. Do not configure untrusted endpoints. Gateway must disallow redirects and log neither the OTP nor message body. If SMS is unconfigured, phone changes fail with 503.

Real login must issue `__Host-ryde-profile` with Secure; HttpOnly; SameSite=Strict; Path=/; no Domain. JWT must be RS256 with expected issuer and audience; an opaque stable subject [A-Za-z0-9_-]{1,128}; iat/exp <= 15 min lifetime; scope `profile:manage`. Token audience and cookie are distinct from media/orders. Rotate public keys operationally. Revoke renewals on logout; until expiry, existing verified JWTs remain valid for up to 15 minutes. The UI's demo login does not issue these cookies; a production auth integration is still required.

## API

All responses are private/no-store, no-referrer and no-sniff. Same-origin checks apply to writes. All endpoints reject query strings, require verified profile JWTs and enforce persisted per-account and global rate limits. JSON bodies accept only the stated fields, max 2 KiB and a 3 second bounded stream read.

| Method | Path | Body | Result |
|---|---|---|---|
| GET | /api/profile | — | Verified owner's profile and consent state |
| PATCH | /api/profile | `{name,preferences}` | Update name/preferences, never unverified phone |
| PATCH | /api/profile/consent | `{purpose,granted}` | Set marketing or personalization consent |
| GET | /api/profile/consent/history | — | Up to 100 latest consent changes |
| POST | /api/profile/phone/start | `{phone}` | Send one time 8-digit code by configured SMS service |
| POST | /api/profile/phone/confirm | `{code}` | Commit pending phone only after valid code |

Consent defaults to false with a null timestamp; changed timestamp is milliseconds since epoch. Actual changes are appended to private owner-scoped history. Do not imply consent from checkout or app usage. Name may be blank, <=80 characters; preferences must be a unique subset of Vegetarian/High-protein/Mild spice. Verified Indian mobile numbers use ten digits starting 6-9. Challenges expire after ten minutes and are stored as keyed hashes, never plaintext; 5 guesses per challenge, max 3 SMS starts per hour/account and destination. Change requests do not overwrite the verified phone until challenge confirmation. Code is never returned via API, localStorage, analytics or logs.

## Operations and limitations

Provision external SMS gateway and trusted login before production use; no SMS simulator or development authentication bypass is implemented. Protect database directory (0700 or restrictive Windows ACL); maintain encrypted and expiring backups with consent/audit retention policies. The `ProfileStore.purge(ownerKey)` trusted-only method deletes an account's profile and consent history; connect it to real account deletion. Invoke `ProfileStore.cleanup()` from a trusted scheduled maintenance job to remove expired challenges and old SMS throttling data. Rotate OTP pepper carefully: existing challenges become invalid. Consent history is capped at 100 rows returned, not automatically removed; define legal retention with counsel. Limit SMS provider egress and enforce account and provider-side anti-abuse controls. Frontend demo profile still cannot be considered a signed-in persistent account until auth is integrated. Do not record raw PNRs, passenger data, payment data or secret credentials in application or gateway logs.

Run `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm build`. Deploy with two genuine test accounts to verify user isolation, negative consent defaults, history timestamps, phone OTP expiry and lockout, cross-site write rejection, SMS delivery, logout, deletion, backup/restore, and data retention.
