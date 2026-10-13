# Admin-managed catalog
The browser fetches the menu from `GET /api/catalog`; the server owns the SQLite catalog. `lib/server/catalog-seed.mjs` is only used to initialize a fresh database.

## Configuration
Set server-only `CATALOG_DATA_DIR` to an absolute, private, persistent writable directory and `CATALOG_ADMIN_TOKEN` to a random secret of at least 32 characters. Never expose the token as a `NEXT_PUBLIC_*` variable. The Node.js runtime must support `node:sqlite`; use persistent storage and back up `catalog.sqlite`.

## Admin API
All writes require `Authorization: Bearer <CATALOG_ADMIN_TOKEN>` and a JSON body:
- `POST /api/admin/catalog`: create a product.
- `PUT /api/admin/catalog`: replace an existing product.
- `DELETE /api/admin/catalog`: remove using `{"id":"product-id"}`.
Server validation covers IDs, prices, rating, nutrition, tags and image paths. Missing configuration fails closed. Payloads are bounded; query credentials are rejected. No request bodies or credentials are logged. Run `pnpm test`, `pnpm typecheck`, `pnpm lint`, and `pnpm build`.

## Indexed server search (#34)

`GET /api/catalog/search` accepts `q` (up to 100 characters; indexed name/ingredients prefix tokens), `category`, `station` (uppercase station code), `diet` (`vegetarian` or `high-protein`, >=20g listed protein), `sort` (`name`, `price-asc`, `price-desc`), `page` (1–1000), `limit` (1–100, default 24). Response: `{products,total,page,limit,pages}`. Repeated/unknown parameters and invalid values return 400. SQL parameters and quoted token construction prevent query injection. Sorting has an ID tie-breaker. Public products contain only validated catalog fields, never vendor costs or credentials.

Optional admin product field `stations` is an array of station codes. Items without explicit assignments do not match a station filter. These assignments are catalog metadata, not proof that a delivery stop is eligible on a live train journey; #5/#26/#30 remain open. Nutrition seed values remain labeled as sample data pending vendor verification.

The menu uses debounced, cancellable server search and page controls. The catalog schema uses FTS5 plus category/diet indexes; triggers update/remove search records with product changes. Initialization is transactional and versioned. A deliberately emptied catalog stays empty after restart, including migration of legacy catalogs. Future schema versions fail closed. Admin JSON reads are size- and time-bounded, with strict deletion fields. Failed catalog loading does not overwrite the customer's saved cart.

Before production merge/rollout, configure persistent catalog storage and the private admin token on the actual runtime. A Vercel build succeeding does not provision persistent SQLite storage; an ephemeral filesystem is unsuitable. Test restart persistence, admin update visibility and menu browsing on the target host. Do not expose the admin credential to the browser. The current UI cart/checkout remains a demo flow and does not authorize real payment amounts.
