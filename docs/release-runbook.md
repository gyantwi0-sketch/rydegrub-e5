# Release and rollback checklist

This is an operational runbook, not evidence that deployment has happened.

## Before release

- Require green CI and Secret Scan on the exact proposed commit. CI includes
  frozen dependencies, high-severity audit, SBOM, lint, tests, typecheck, build and
  compiled HTTP smoke checks. Configure repository protection to require these
  checks; a workflow file alone does not enable branch protection.
- Use distinct production/staging secrets, volumes, Redis namespaces/services and
  provider test/live modes. Never reuse production passenger records for tests.
- Provision a persistent Node 24.7+ host and private volumes for the configured
  SQLite stores; preview/serverless filesystems are not durable storage.
- Drain writes, take consistent backups of every configured SQLite database using
  SQLite's backup API (or stopped writers with complete WAL-aware backups), and
  record the matching application commit plus schema versions. Store backups
  encrypted with access restricted to operators. Test restoration in staging.
- Run `pnpm env:check` and `pnpm data:init` on the target release with its secrets.
  Check /api/health/live and /api/health/ready; readiness must return 200.
- Connect private metrics to a monitoring receiver and test actual alert delivery.
  Never publish OPERATIONS_METRICS_TOKEN or private metric endpoints publicly.

## Acceptance before admitting traffic

Run browser signup, email verification, signin/logout and password recovery with
owned test mailboxes. Verify cookie flags, cross-account isolation and restart
persistence. Exercise catalog admin updates with server-held credentials only.
For commerce, finish every blocker in commerce-api.md; a draft and green CI do not
prove live ordering. Test PNR/payment/SMS services only after their integrations
and sandbox credentials are configured. Live payment activation is separate.

## Rollback

1. Stop new writes and capture failure context without secrets or passenger data.
2. Restore the previously approved application release. If schemas changed,
   restore its matching database backups before accepting writes; older code must
   not open unsupported newer schemas. Coordinate all related stores.
3. Re-run environment/readiness checks and read-only smoke checks, then reopen
   traffic. Keep incident-era backups isolated for reconciliation.
4. Reconcile any external payment/provider effects separately. Database rollback
   cannot reverse a charge or unsend a message. Do not retry charges blindly.

Owner/operator actions still required: protection rules, hosting/volumes, backup
schedule and restore drill, email/Redis/provider configuration, alert receiver,
production browser acceptance and approval of a live release.
