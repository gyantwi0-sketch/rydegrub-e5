# External-provider resilience (#28)

The server uses a trusted outbound adapter in `lib/server/provider-resilience.mjs` for external SMS, PNR and payment **provider client calls**. The only connected call today is the profile OTP/SMS `sendPhoneCode` adapter. PNR lookup and payment are NOT integrated yet and still need approved provider contracts and credentials. This change needs no human provider verification to test; unit tests supply a controlled local transport implementation.

## Security and reliability contract

- Outbound URLs must be **server configured**, HTTPS, without URL credentials, query strings, fragments or non-default ports. Never forward arbitrary client-supplied URLs into this module.
- Each request has a bounded AbortSignal timeout (default five seconds, maximum ten seconds) and forbids HTTP redirects. Errors are converted to a generic 503; response bodies, access tokens, payment details, codes, PNRs and stack traces are never logged or returned.
- GET and HEAD are retried up to three times **only** on network failure or 429/500/502/503/504. Backoff is bounded at 100ms and 200ms for the default three attempts. No retries occur for nontransient responses.
- POST is made **once only**, including SMS sends. Payment collection, checkout, inventory holds and status-changing requests must not be retried without provider idempotency contracts; do not use the GET retry behavior for mutations.
- Independent provider-name circuit breakers open after three consecutive failed logical calls, reject requests without contacting an upstream while open (30-second cooldown), then allow a recovery probe. A successful recovery resets the breaker. A blocked request is a generic 503, not an authorization bypass.
- Structured telemetry includes only fixed provider name (`sms`, `pnr`, `payment`), HTTP method, outcome enum, attempt count and bounded request duration. Do not add per-account, request URL, phone number, IP, headers, OTPs, raw PNRs or gateway response details. Hosting/telemetry instrumentation must independently suppress sensitive HTTP bodies and headers.

## Deployment and operations

The circuit breaker is in-memory per Node process: it reduces pressure during a provider outage but is not a distributed quota or a substitute for rate limiting. When scaling to multiple processes/hosts, use a shared protected failure store if a globally coordinated circuit is necessary. Provider token/URL configuration stays on the server in protected deployment environment variables. The existing profile service rejects SMS operations with 503 until a real approved provider URL and key are configured.

Add dashboards for aggregate error rate, request duration and open-circuit counts without user data. Operational alerting is tracked separately in #48 and requires the environment owner's alert destination and privileges. A provider's POST errors may be ambiguous; never automatically repeat a mutation to recover from them.

Run `pnpm test`, `pnpm lint`, `pnpm typecheck`, and `pnpm build`. Before any real payment or PNR integration, validate the provider's webhook/idempotency/security contract, rate limits, transport and outages using sandbox credentials managed outside GitHub.

#28 remains open until the real PNR and payment providers also adopt and verify this adapter. This is a safe, mergeable piece of its implementation.
