# Protected configuration and secrets (#19)

## Deploy and preflight
Use Node 24 on a persistent, single-host Node server. Copy `.env.example` **only as a guide**; never commit local `.env` or `.env.*` files. Put actual production secrets in the deployment platform's encrypted environment secret manager; restrict access to operators, audit reads and changes, and separate development/preview/production accounts, data paths, issuers and SMS credentials.

`pnpm start` now runs `scripts/check-env.mjs` before launching the Next.js server. `pnpm env:check` performs the same check independently. It fails with a generic error rather than printing secrets if any MEDIA, TRACKING or PROFILE JWT settings are missing or insecure, if the data paths are not absolute and private, if trusted application origins disagree, or if an apparently sensitive setting is exposed via `NEXT_PUBLIC_*`. Public verification keys are not signing keys; the RSA private signing key stays only with the identity issuer. OTP pepper must be random with at least 32 bytes. Catalog configuration is validated if the service is enabled. The preflight cannot verify filesystem ACLs, real network connectivity or provider permissions; production deployment automation must test these.

Development `pnpm dev` remains a **demo only** without valid login/provider integrations. A successful preflight does not authenticate users or create working payment/PNR services. Sign-in/signup and checkout remain demo until separate issues implement them.

## Authentication and cookie/security boundaries
Use a trusted issuer with a distinct scoped audience and Secure, HttpOnly, SameSite=Strict, Path=/ cookies for each API service. Never set an app signing secret, gateway private key or customer record in a `NEXT_PUBLIC_*` variable. All server endpoints must enforce authorization and origin checks themselves. Retain profile/PNR/payment redaction in application logs, analytics and upstream reverse proxies; no raw request/response bodies or secrets in CI artifacts.

## Secret scanning
The `Secret Scan` workflow executes Gitleaks v3 on pushes, pull requests, manually and weekly, checking full Git history. Current owner is a personal GitHub account, so this action does not require an organization license. Never expose a leaked secret or its value in a public issue or PR comment; disable artifact upload/comments for scans. GitHub maintainers should also enable native secret scanning and push protection in Settings where available and require the `scan` job as a protected branch status. If scanning fails, investigate privately, revoke exposed credentials immediately, scrub sensitive copied data, and only then re-run checks. The absence of findings is not proof that no secret leaked.

## Rotation and incident response
Rotate OTP peppers, issuer signing keys and SMS keys under controlled change windows; revoke sessions as appropriate. Verification public keys and JWT audiences must roll in coordination with the issuer, since an old key may still be needed for outstanding 15-minute sessions. An OTP pepper rotation intentionally invalidates outstanding phone challenges. Backup the SQLite databases with least-privilege ACLs; avoid sharing snapshot files in development. For a compromised credential, disable it first, issue and deploy a replacement, invalidate old tokens/sessions, check audit trails without copying credentials, then document the incident safely.

Run `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm build`, and `pnpm env:check` in a production-like environment with secure dummy data for test staging. Do not put real secrets into GitHub workflow logs, screenshots or issue comments.
