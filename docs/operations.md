# Shared rate limits and operational health

## Rate limiting (#24)

All currently implemented account, profile, media and tracking API routes use the shared limiter. Production requires RATE_LIMIT_REDIS_URL and RATE_LIMIT_REDIS_TOKEN for a Redis REST endpoint with EVAL support. Increment and expiry occur atomically in one Lua invocation; different app processes consume the same backend counters. Never grant this credential broader Redis access than needed by the `ryde:limit:*` prefix. Use a separate Redis namespace/database per environment. Limit errors fail closed (503); exhausted quotas return 429 plus the remaining window as Retry-After. Redis errors, bearer tokens, raw IPs, phone numbers and account IDs are not logged.

Set RATE_LIMIT_KEY_SECRET to a random secret of at least 32 characters; ACCOUNT_RATE_SECRET is the backward-compatible fallback. RATE_LIMIT_TRUSTED_IP_HEADER is optional and must name a header that trusted ingress strips and overwrites. Unconfigured or invalid headers map to one conservative shared bucket; X-Forwarded-For is not automatically trusted. Configure ingress correctly before high-volume deployment. Existing SQLite quotas remain defense in depth and protect transactional OTP/upload invariants; they are not the distributed admission layer.

| Scope | Maximum |
|---|---:|
| Each profile/media/tracking service | 600 requests/minute |
| Trusted IP per service, or shared unknown-IP bucket | 300/minute |
| Authenticated owner per service | 120/minute |
| Photo uploads per owner | 20/hour |
| Phone-code sends per owner and per phone | 3/hour each |
| Tracking-code creation per owner | 5/minute |

Auth quotas are documented in account-auth.md. Development uses bounded in-memory counters with TTL eviction; production never falls back to them. Limiter cache keys include mode and Redis configuration so credential rotation/configuration changes cannot reuse an obsolete development adapter. Rotate HMAC secrets in a coordinated deployment: changing one resets bucket identity. The adapter does not make SQLite data stores multi-host safe. Persistent shared business storage is a separate deployment prerequisite.

## Health and metrics (#48)

- GET `/api/health/live`: process/application route is responding. Does not query dependencies.
- GET `/api/health/ready`: 200 `ready` only after startup configuration, supported database schema, a SQLite write reservation, and the atomic limiter path succeed; otherwise generic 503 `unavailable`. Probes are coalesced and cached for two seconds. It does not create absent databases. `pnpm start` now initializes configured schemas and audit triggers before listening; `pnpm data:init` supports a separate initialization step. Initialization must run on the persistent private volume before readiness-based traffic admission. Readiness also checks the audit schema.
- GET `/api/operations/metrics`: private Prometheus text endpoint. Requires `Authorization: Bearer <OPERATIONS_METRICS_TOKEN>` with a randomly generated 32–512 character token. Query credentials are rejected. The scrape also refreshes readiness. Do not embed this token in browser code, URLs or public dashboards.

Metrics include request counts and latency histograms, provider outcomes/duration, limiter outcomes, and committed payment transitions. Labels are fixed allowlists; request IDs, account IDs, IPs, paths, headers, payment payloads and PNRs cannot become labels. In-process aggregates reset on restart and should be scraped for each persistent Node process; use Prometheus rate/increase functions. A load balancer randomly routing scrapes among workers is not sufficient. The endpoint is designed for persistent Node deployments, not ephemeral serverless instances.

The queue metrics API accepts only notifications/fulfilment depth and oldest age. No queue metric is emitted until a real worker reports it: absence is NOT a healthy empty queue. Payment counters report committed internal transitions, not proof of a gateway charge. PNR/payment adapters and notification queues still need their separate integrations.

Load `ops/alerts.yml` into Prometheus under a `rydegrub` scrape job, store the bearer token in the monitoring system's protected secret configuration, and configure an Alertmanager receiver owned by the operator. Test receiver delivery with a controlled staging failure. No monitoring account, external receiver or pager has been configured by this code change. #48 stays open until live scrape/alert delivery and future provider/queue integrations are verified.

Prometheus format reference: https://prometheus.io/docs/instrumenting/exposition_formats/.

## Failure response and release handoff (#49)

1. Confirm `/api/health/live` and `/api/health/ready`, then inspect aggregate errors and X-Request-ID correlations. Do not copy credentials or passenger payloads into tickets.
2. For Redis failures, restore credentials/connectivity; do not bypass quota checks or switch production to memory. For SQLite lock/disk failures, check the private volume, free space and writer contention.
3. Before release, require CI verify and Secret Scan checks, a successful preview build, separate preview/production secrets, and a consistent backup of all configured SQLite stores. Configure branch protection in GitHub settings; repository code cannot enforce that administrative setting.
4. Roll back application code to the previous known-good deployment only if its supported schema version matches the database. Otherwise deploy a forward fix, or stop traffic and restore the matching backup together with the matching release. Never point older code at an unknown newer schema or delete tables to bypass startup failure.
5. After rollback, repeat readiness, login/logout, owner-isolation and catalog/cart checks on staging before production traffic. Payment/refund state reconciliation requires provider evidence; never replay financial mutations to repair a UI status.

The production HTTP smoke script tests the compiled app with no secrets: liveness remains available and protected APIs fail closed. It is not a substitute for authenticated ordering E2E or a payment sandbox test (#44).
