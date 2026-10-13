import { timingSafeEqual } from "node:crypto";
import { isAbsolute } from "node:path";
import { CatalogError, CatalogStore } from "./catalog-store.mjs";
import { boundedJsonObject, exactObjectFields } from "./request-validation.mjs";
const stores = new Map();
function config() {
	const token = process.env.CATALOG_ADMIN_TOKEN,
		root = process.env.CATALOG_DATA_DIR;
	if (
		typeof token !== "string" ||
		token.length < 32 ||
		typeof root !== "string" ||
		!isAbsolute(root)
	)
		throw new CatalogError(503, "Catalog service is not configured.");
	return { token, root };
}
function db(c) {
	if (!stores.has(c.root)) stores.set(c.root, new CatalogStore(c.root));
	return stores.get(c.root);
}
function out(data, status = 200) {
	return Response.json(data, {
		status,
		headers: {
			"Cache-Control": "no-store",
			"X-Content-Type-Options": "nosniff",
			"Referrer-Policy": "no-referrer",
		},
	});
}
function auth(req, c) {
	const m = /^Bearer ([A-Za-z0-9._~-]{32,512})$/.exec(
		req.headers.get("authorization") || "",
	);
	if (!m) throw new CatalogError(401, "Admin authorization required.");
	const a = Buffer.from(m[1]),
		b = Buffer.from(c.token);
	if (a.length !== b.length || !timingSafeEqual(a, b))
		throw new CatalogError(403, "Admin authorization failed.");
}
async function json(req) {
	if (Number(req.headers.get("content-length")) > 16384)
		throw new CatalogError(413, "Request too large.");
	return boundedJsonObject(req, {
		ErrorType: CatalogError,
		maxBytes: 16384,
		timeoutMs: 3000,
	});
}
function run(req, method, fn, admin = false, search = false) {
	return (async () => {
		try {
			if (req.method !== method)
				throw new CatalogError(405, "Method not allowed.");
			const c = config();
			if (!search && new URL(req.url).search)
				throw new CatalogError(400, "Query parameters are not accepted.");
			if (admin) auth(req, c);
			return await fn(db(c));
		} catch (e) {
			return out(
				{
					error:
						e instanceof CatalogError
							? e.message
							: "Catalog service unavailable.",
				},
				e instanceof CatalogError ? e.status : 503,
			);
		}
	})();
}
export const catalogHandlers = {
	list: (req) =>
		run(req, "GET", (s) => {
			const products = s.list();
			return out({
				products,
				categories: ["All", ...new Set(products.map((p) => p.category))],
			});
		}),
	search: (req) =>
		run(
			req,
			"GET",
			(s) => {
				const params = new URL(req.url).searchParams,
					input = Object.create(null);
				for (const [key, value] of params) {
					if (params.getAll(key).length !== 1)
						throw new CatalogError(400, "Repeated search parameter.");
					input[key] = ["page", "limit"].includes(key)
						? /^\d+$/.test(value)
							? Number(value)
							: NaN
						: value;
				}
				return out(s.search(input));
			},
			false,
			true,
		),
	create: (req) =>
		run(
			req,
			"POST",
			async (s) => out({ product: s.create(await json(req)) }, 201),
			true,
		),
	update: (req) =>
		run(
			req,
			"PUT",
			async (s) => out({ product: s.update(await json(req)) }),
			true,
		),
	remove: (req) =>
		run(
			req,
			"DELETE",
			async (s) =>
				out({
					removed: s.remove(
						exactObjectFields(await json(req), ["id"], CatalogError).id,
					),
				}),
			true,
		),
};
