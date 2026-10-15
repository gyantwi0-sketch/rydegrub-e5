# Admin-managed catalog
The browser fetches the menu from `GET /api/catalog`; the server owns the SQLite catalog. `lib/server/catalog-seed.mjs` initializes fresh databases and the read-only sample catalog; product records are no longer bundled in the client module.

## Configuration
Set server-only `CATALOG_DATA_DIR` to an absolute, private, persistent writable directory and `CATALOG_ADMIN_TOKEN` to a random secret of at least 32 characters. Never expose the token as a `NEXT_PUBLIC_*` variable. The Node.js runtime must support `node:sqlite`; use persistent storage and back up `catalog.sqlite`.

## Admin API
All writes require `Authorization: Bearer <CATALOG_ADMIN_TOKEN>` and a JSON body:
- `POST /api/admin/catalog`: create a product.
- `PUT /api/admin/catalog`: replace an existing product.
- `DELETE /api/admin/catalog`: remove using `{"id":"product-id"}`.
Server validation covers IDs, prices, rating, nutrition, tags and image paths. Missing configuration fails closed. Payloads are bounded; query credentials are rejected. No request bodies or credentials are logged. Run `pnpm test`, `pnpm typecheck`, `pnpm lint`, and `pnpm build`.

## Indexed server search (#34)

`GET /api/catalog/search` accepts `q` (up to 100 characters; indexed name/ingredients prefix tokens), `category`, `station` (uppercase station code), `diet` (`vegetarian` or `high-protein`, >=20g listed protein), `sort` (`name`, `price-asc`, `price-desc`), `page` (1–1000), `limit` (1–100, default 24). Response: `{products,total,page,limit,pages,mode}`. Repeated/unknown parameters and invalid values return 400. SQL parameters and quoted token construction prevent query injection. Sorting has an ID tie-breaker. Public products contain only validated catalog fields, never vendor costs or credentials.

Optional admin product field `stations` is an array of station codes. Items without explicit assignments do not match a station filter. These assignments are catalog metadata, not proof that a delivery stop is eligible on a live train journey; #5/#26/#30 remain open. Nutrition seed values remain labeled as sample data pending vendor verification.

The menu uses debounced, cancellable server search and page controls. The catalog schema uses FTS5 plus category/diet indexes; triggers update/remove search records with product changes. Initialization is transactional and versioned. A deliberately emptied catalog stays empty after restart, including migration of legacy catalogs. Future schema versions fail closed. Admin JSON reads are size- and time-bounded, with strict deletion fields. Failed catalog loading does not overwrite the customer's saved cart.

## Sample and managed modes

When both catalog settings are absent, GET routes serve an in-memory, read-only sample catalog and return `mode: "demo"`. The page displays a persistent sample-menu notice. All admin writes return 503. This mode uses a bounded per-process read limiter; it has no customer state and cannot authorize checkout. It preserves menu browsing on preview/serverless hosts without pretending SQLite there is durable.

If either setting is present, both must be valid. Partial or invalid configuration returns 503 and never silently falls back to samples. Managed mode uses private persistent SQLite, the production shared Redis limiter and append-only security audit triggers for each catalog mutation. Audit write failure rolls back the catalog change. Logs contain route/outcome metadata only, never search text, bodies, tokens or private paths. Readiness checks the catalog schema and audit schema when managed storage is configured.

For live managed operation, configure persistent storage and the private admin token on the actual runtime. A Vercel build does not provision persistent SQLite storage; an ephemeral filesystem is unsuitable. Verify restart persistence, admin update visibility and browsing on the target host. The current cart/checkout remains a demo flow and does not authorize payment amounts. Live vendor review and order integration remain separate issues.

Main's recorded tracking events and consent-based recommendations are preserved. Recommendations now read this catalog on the server; they cannot recommend a deleted item from an obsolete bundled seed. Sample fallback recommendations in the browser use the menu response, never their own copy of the dataset.
