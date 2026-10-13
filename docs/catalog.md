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
