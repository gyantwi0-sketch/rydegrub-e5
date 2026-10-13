# Durable idempotent order creation (#23)

`DomainStore.createDraftOrder(owner, journeyId, expectedCartVersion, idempotencyKey)` now **requires** an unpredictable UUID v4 key and atomically persists the input fingerprint and an allowlisted response when it creates a draft order. It prevents accidental duplicate draft-order creation from retries, duplicated form submissions, timeouts and two Node workers using the same SQLite WAL database. No bank, vendor or external provider verification is required for the domain implementation.

## Exact semantics

- The verified session **owner** is established server-side, not from a submitted JSON owner field. Different account owners can safely use the same key because it is scoped to that verified owner and `order-draft` operation.
- The supplied idempotency key must be a random UUID v4 generated once for one logical order attempt; never place it in a URL, analytics or logs. Database stores only SHA-256 of `[operation,owner,key]`, **not** the original key.
- A canonical SHA-256 fingerprint of `[journeyId,expectedCartVersion]` is stored with the generated safe JSON result. The operation reads this record **before** checking mutable carts/prices, so exactly repeated requests replay the same originally returned order ID, subtotal, currency and revision even if prices later change.
- Reusing the same key with a different request, or after expiry, results in HTTP-style status **409** without writing another order. Missing/malformed keys fail with 400. A distinct valid key represents a distinct intentional order attempt.
- The idempotency result and generated draft order are committed in **one SQLite BEGIN IMMEDIATE transaction**. Across processes sharing the same persistent SQLite database, only one first write succeeds. No client-controlled totals, prices, PNRs, payment credentials or passenger fields enter idempotency storage.
- Records have a 30-day validity window and are not silently reused when expired. Plan retention and cleanup together with the corresponding order lifecycle; old keys must never be discarded and immediately accepted again while a charge or checkout retry remains possible.
- Replays return the **original creation response** by design, not an updated order status. Clients should fetch actual status from an authorized order endpoint. They must not infer payment confirmation from a draft result.

## Integration boundaries

A future authenticated checkout API must enforce `Idempotency-Key` with the above schema for every order-creation attempt, bind the verified owner, and handle expected cart versions/CSRF/rate limits. No such real checkout endpoint exists today; the browser checkout is a demo. Payment collection, webhook deduplication and refunds require their **own** provider idempotency contracts (#35/#36/#38). Never use this key as a gateway capture idempotency key without defining that provider-specific contract.

This is server-side code, not a proof of real end-to-end bank ordering. It can be tested without provider accounts. Run `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm build`; focused tests cover replay after restart/across database handles, mismatched reuse, owner isolation, expired keys, fresh-key current repricing and missing keys. Keep private databases encrypted/backed up and do not expose raw request bodies in logs.
