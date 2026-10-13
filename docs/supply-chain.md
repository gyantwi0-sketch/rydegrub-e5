# Dependency and supply-chain controls (#20)

## Automated quality gate

The GitHub Actions `CI` workflow runs on pushes and pull requests with **Node 24** and the version of pnpm declared in `package.json`. It uses `pnpm install --frozen-lockfile` to reject drift, `pnpm audit --audit-level high` to block high/critical known vulnerabilities, and the existing lint, Node tests, typecheck and production build checks. The repository's weekly Dependabot configuration proposes package and GitHub Actions updates.

After a successful install the workflow runs `pnpm sbom --sbom-format cyclonedx --lockfile-only --out sbom.cdx.json` and validates that the resulting CycloneDX document contains well-formed dependency components. A private `dependency-sbom` workflow artifact is retained for 14 days. The artifact represents package-manager dependency resolution at a particular commit, **not** operating system libraries, images, runtime services, deployed infrastructure, or cryptographic attestations. Generate a new SBOM for each release. CI must never output credentials or passenger/PNR/payment data, and SBOM files must not include registry credentials.

To inspect locally:

```sh
pnpm install --frozen-lockfile
pnpm audit --audit-level high
pnpm sbom --sbom-format cyclonedx --lockfile-only --out sbom.cdx.json
node scripts/verify-sbom.mjs sbom.cdx.json
pnpm test
pnpm lint
pnpm typecheck
pnpm build
```

The dependency SBOM and CI checks are necessary, not sufficient, for securing auth, payments and vendor integrations. Do not ship known vulnerable dependencies because only a front-end flow works.

## Vulnerability triage and remediation

1. New high/critical advisory or failed audit: block the release; review affected dependency versions, exploitability, runtime reachability, exposure and available fixed versions. Confirm with maintainers/lockfile audit rather than suppressing an advisory automatically.
2. Critical or actively exploited issue: escalate immediately; patch or disable the affected feature and redeploy as soon as validated. High: target a patch within two working days. Medium/low: log the advisory and its rationale in a tracked GitHub issue with a scheduled remediation date.
3. For every vulnerability include advisory ID, affected dependency, fixed version, owner, evidence and tests. Avoid copying auth tokens, customer profiles, passwords, PNRs or payment material into issues, logs or artifacts.
4. Open/update a PR for the smallest safe patch and rerun the full CI gate. For transitive dependencies prefer updating the direct dependency and its lockfile; overrides require explicit documentation and removal plan.
5. If an exception is unavoidable, document who approved it, concrete mitigation, time-bound expiry and monitored follow-up; **do not** weaken the blocking CI audit to make a PR green. Roll back releases that regress security.
6. Rotate exposed credentials and invalidate sessions as needed for a real compromise. Coordinate incident and disclosure handling privately; do not create public issues containing sensitive exploit details.

## GitHub repository configuration (owner setup)

Repository administrators must require the CI `verify` status check before merging into `main`, require reviews and prevent bypasses; enforce deployment secrets only in locked GitHub environment scopes and set up protected environments and deployment rollback plans. App/API permissions alone do not configure branch rules or secret management. Audit repository access and third-party integrations regularly. For stronger supply-chain assurance pin GitHub Actions by audited immutable SHAs as part of #49 release hardening, configure artifact attestations if supported, and publish approved release SBOMs to a restricted security archive.

This document contains **no credentials** and applies to the repository as checked on 2026-10-13.
