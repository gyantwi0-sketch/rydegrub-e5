# Separated order, payment and fulfilment state machines (#37)

The server-only `lib/server/state-machines.mjs` defines explicit allowed transitions, actor roles, version increments and monotonic timestamps. `DomainStore` now upgrades the SQLite schema from version 1 to 2 transactionally, adds `orders.updated_at`, `payment_attempts.version`, `order_state_events` and `payment_state_events`, and writes state changes together with history events in a single SQLite transaction. Existing order/payment rows are preserved during migration. The earlier fulfilment-events table stores each station/stage timestamp independently.

## Rules

| Domain | Transition | Trusted actor | Additional check |
| --- | --- | --- | --- |
| Order | draft → pending_payment | checkout backend | Order belongs to verified owner; payment attempt created from **server** subtotal |
| Order | pending_payment → confirmed | verified gateway adapter | Matching payment captured; never from browser |
| Order | draft or pending_payment → cancelled | verified account/operations | Pending payment not authorized or captured |
| Order | confirmed → cancelled | operations only | Provider refund already verified |
| Order | confirmed → delivered | fulfilment adapter only | Verified captured payment and recorded delivered stage |
| Payment | created → authorized/failed | verified gateway adapter | Strict attempt version; provider reference fingerprint |
| Payment | authorized → captured/failed | verified gateway adapter | Strict version and immutable reference fingerprint |
| Payment | captured → refunded | verified gateway adapter | Verified refund; no implicit order transition to delivered |
| Fulfilment | confirmed → preparing → packed → arriving → delivered | fulfilment adapter | Forward-only; no downgrade; order must be confirmed and payment captured |
| Fulfilment | any nonterminal → cancelled | fulfilment adapter | Order must already be cancelled |
| Terminal | delivered, cancelled, failed or refunded | — | No further unauthorized/duplicate transitions |

The `startPayment` method only creates a **local pending attempt**, not a charge. `applyGatewayEvent` **must** be called only by a future backend that authenticates and verifies gateway webhooks (#36), enforces provider-specific idempotency keys (#23), hashes validated provider references, and resolves out-of-order events. Do not call it with an unverified browser payload. `recordFulfilment` must be called only by the approved fulfilment adapter after staff/partner authorization; no browser route exposes it. Account cancellation is restricted to unpaid pending/draft orders. Paid cancellations require verified refunds before an operations adapter can set the order to cancelled.

The public application still has demo checkout, payment and tracking UIs. This foundation intentionally **does not** activate real payment or fulfilment, send SMS, process PNRs or authorize providers. Additional provider verification, inventory/station eligibility (#32/#30), tax/fee rules (#39), actual account authentication (#8/#9), stock holds, charge reconciliation and cancellation/refund workflows (#38) are needed before live transactions. The current state machine cannot replace a gateway or produce receipt evidence.

## Privacy and operations

Database transitions are owner-scoped where exposed to a verified account; internal gateway/operations/fulfilment methods must never be bound to public routes without independent signature/role checks. Events record only state enums, generated identifiers, trusted actor name and timestamps—**not** raw PNRs, passenger details, payment tokens, gateway bodies or secrets. Provider references are stored as nonreversible keyed digests; compute them in the trusted adapter, not from unverified HTTP input. Configure encryption at rest, protected SQLite WAL storage, reliable backups and retention rules.

Run `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm build`. Tests exercise versioned migration, owner isolation, stale updates, role restrictions, pre-payment and post-payment cancellation, duplicate/reversed states, refund prerequisites and fulfilled delivery history.

This change implements and server-tests explicit state transitions without needing bank/KYC/provider manual verification. Live payment integration is tracked separately in #35/#36 and remains intentionally disabled.
