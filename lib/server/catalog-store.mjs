import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { products as seed } from "./catalog-seed.mjs";
export class CatalogError extends Error {
	constructor(status, message) {
		super(message);
		this.status = status;
	}
}
const idPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export function validateProduct(p) {
	const str = (v, n) =>
		typeof v === "string" && v.trim().length > 0 && v.length <= n;
	if (
		!p ||
		typeof p !== "object" ||
		Array.isArray(p) ||
		Object.keys(p).some(
			(k) =>
				![
					"id",
					"name",
					"price",
					"category",
					"description",
					"image",
					"veg",
					"rating",
					"ingredients",
					"allergens",
					"calories",
					"protein",
					"tags",
					"age",
					"packaged",
					"stations",
				].includes(k),
		) ||
		!str(p.id, 80) ||
		!idPattern.test(p.id) ||
		!str(p.name, 120) ||
		!Number.isSafeInteger(p.price) ||
		p.price < 1 ||
		p.price > 100000 ||
		!str(p.category, 60) ||
		!str(p.description, 500) ||
		typeof p.image !== "string" ||
		p.image.length > 500 ||
		!/^\/images\/[a-zA-Z0-9_-]+\.(?:png|jpe?g|webp|avif)$/.test(p.image) ||
		typeof p.veg !== "boolean" ||
		typeof p.rating !== "string" ||
		!/^(?:[0-4](?:\.\d)?|5(?:\.0)?)$/.test(p.rating) ||
		!str(p.ingredients, 500) ||
		!str(p.allergens, 300) ||
		!Number.isSafeInteger(p.calories) ||
		p.calories < 0 ||
		p.calories > 10000 ||
		!Number.isSafeInteger(p.protein) ||
		p.protein < 0 ||
		p.protein > 1000 ||
		!Array.isArray(p.tags) ||
		p.tags.length > 20 ||
		!p.tags.every((t) => str(t, 40)) ||
		(p.stations !== undefined &&
			(!Array.isArray(p.stations) ||
				p.stations.length > 100 ||
				!p.stations.every(
					(v) => typeof v === "string" && /^[A-Z0-9]{2,10}$/.test(v),
				))) ||
		(p.age !== undefined && !str(p.age, 40)) ||
		(p.packaged !== undefined && typeof p.packaged !== "boolean")
	)
		throw new CatalogError(400, "Invalid catalog product.");
	return {
		stations: [...new Set(p.stations ?? [])],
		id: p.id,
		name: p.name.trim(),
		price: p.price,
		category: p.category.trim(),
		description: p.description.trim(),
		image: p.image,
		veg: p.veg,
		rating: p.rating,
		ingredients: p.ingredients.trim(),
		allergens: p.allergens.trim(),
		calories: p.calories,
		protein: p.protein,
		tags: [...new Set(p.tags.map((t) => t.trim()))],
		...(p.age === undefined ? {} : { age: p.age.trim() }),
		...(p.packaged === undefined ? {} : { packaged: p.packaged }),
	};
}
export class CatalogStore {
	constructor(root) {
		if (typeof root !== "string" || !isAbsolute(root))
			throw new CatalogError(
				503,
				"Catalog data directory must be an absolute path.",
			);
		mkdirSync(root, { recursive: true, mode: 0o700 });
		this.db = new DatabaseSync(join(root, "catalog.sqlite"));
		try {
			this.db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;");
			this.db.exec("BEGIN IMMEDIATE");
			const version = this.db.prepare("PRAGMA user_version").get().user_version;
			if (version > 1)
				throw new CatalogError(503, "Unsupported catalog schema.");
			if (version === 0) {
				const existed = !!this.db
					.prepare(
						"SELECT name FROM sqlite_master WHERE type='table' AND name='products'",
					)
					.get();
				this.db.exec(`CREATE TABLE IF NOT EXISTS products(id TEXT PRIMARY KEY,document TEXT NOT NULL,updated INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS products_category ON products(json_extract(document,'$.category'));
      CREATE INDEX IF NOT EXISTS products_veg ON products(json_extract(document,'$.veg'));
      CREATE VIRTUAL TABLE product_search USING fts5(id UNINDEXED,name,ingredients);
      INSERT INTO product_search(id,name,ingredients) SELECT id,json_extract(document,'$.name'),json_extract(document,'$.ingredients') FROM products;
      CREATE TRIGGER product_insert AFTER INSERT ON products BEGIN
        INSERT INTO product_search(id,name,ingredients) VALUES(new.id,json_extract(new.document,'$.name'),json_extract(new.document,'$.ingredients')); END;
      CREATE TRIGGER product_update AFTER UPDATE ON products BEGIN
        DELETE FROM product_search WHERE id=old.id;
        INSERT INTO product_search(id,name,ingredients) VALUES(new.id,json_extract(new.document,'$.name'),json_extract(new.document,'$.ingredients')); END;
      CREATE TRIGGER product_delete AFTER DELETE ON products BEGIN DELETE FROM product_search WHERE id=old.id; END;`);
				// Seed only a newly created schema; an intentionally empty catalog stays empty.
				if (!existed) {
					const ins = this.db.prepare("INSERT INTO products VALUES(?,?,?)");
					for (const item of seed) {
						const p = validateProduct(item);
						ins.run(p.id, JSON.stringify(p), Date.now());
					}
				}
				this.db.exec("PRAGMA user_version=1");
			}
			this.db.exec("COMMIT");
		} catch (error) {
			try {
				this.db.exec("ROLLBACK");
			} catch {}
			this.db.close();
			throw error;
		}
	}
	list() {
		return this.db
			.prepare("SELECT document FROM products ORDER BY rowid")
			.all()
			.map((r) => JSON.parse(r.document));
	}
	search(input = {}) {
		const allowed = [
			"q",
			"category",
			"station",
			"diet",
			"sort",
			"page",
			"limit",
		];
		if (
			!input ||
			typeof input !== "object" ||
			Array.isArray(input) ||
			Object.keys(input).some((k) => !allowed.includes(k))
		)
			throw new CatalogError(400, "Invalid search.");
		const {
			q = "",
			category = "",
			station = "",
			diet = "",
			sort = "name",
			page = 1,
			limit = 24,
		} = input;
		if (
			typeof q !== "string" ||
			q.length > 100 ||
			typeof category !== "string" ||
			category.length > 60 ||
			typeof station !== "string" ||
			(station && !/^[A-Z0-9]{2,10}$/.test(station)) ||
			!["", "vegetarian", "high-protein"].includes(diet) ||
			!["name", "price-asc", "price-desc"].includes(sort) ||
			!Number.isSafeInteger(page) ||
			page < 1 ||
			page > 1000 ||
			!Number.isSafeInteger(limit) ||
			limit < 1 ||
			limit > 100
		)
			throw new CatalogError(400, "Invalid search.");
		const where = [],
			args = [];
		if (q.trim()) {
			const terms = q.match(/[\p{L}\p{N}]+/gu);
			if (!terms?.length) throw new CatalogError(400, "Invalid search text.");
			where.push(
				"p.id IN (SELECT id FROM product_search WHERE product_search MATCH ?)",
			);
			args.push(terms.map((t) => `"${t}"*`).join(" AND "));
		}
		if (category) {
			where.push("json_extract(p.document,'$.category')=?");
			args.push(category);
		}
		if (station) {
			where.push(
				"EXISTS (SELECT 1 FROM json_each(p.document,'$.stations') s WHERE s.value=?)",
			);
			args.push(station);
		}
		if (diet === "vegetarian") where.push("json_extract(p.document,'$.veg')=1");
		if (diet === "high-protein")
			where.push("json_extract(p.document,'$.protein')>=20");
		const filter = where.length ? " WHERE " + where.join(" AND ") : "";
		const order = {
			name: "json_extract(p.document,'$.name') COLLATE NOCASE",
			"price-asc": "json_extract(p.document,'$.price') ASC",
			"price-desc": "json_extract(p.document,'$.price') DESC",
		}[sort];
		const total = this.db
			.prepare("SELECT COUNT(*) AS total FROM products p" + filter)
			.get(...args).total;
		const products = this.db
			.prepare(
				"SELECT p.document FROM products p" +
					filter +
					" ORDER BY " +
					order +
					",p.id LIMIT ? OFFSET ?",
			)
			.all(...args, limit, (page - 1) * limit)
			.map((r) => JSON.parse(r.document));
		return { products, total, page, limit, pages: Math.ceil(total / limit) };
	}

	create(input) {
		const p = validateProduct(input);
		try {
			this.db
				.prepare("INSERT INTO products VALUES(?,?,?)")
				.run(p.id, JSON.stringify(p), Date.now());
		} catch (e) {
			if (this.db.prepare("SELECT id FROM products WHERE id=?").get(p.id))
				throw new CatalogError(409, "Product ID already exists.");
			throw e;
		}
		return p;
	}
	update(input) {
		const p = validateProduct(input);
		const r = this.db
			.prepare("UPDATE products SET document=?,updated=? WHERE id=?")
			.run(JSON.stringify(p), Date.now(), p.id);
		if (!r.changes) throw new CatalogError(404, "Product not found.");
		return p;
	}
	remove(id) {
		if (typeof id !== "string" || !idPattern.test(id))
			throw new CatalogError(400, "Invalid product ID.");
		if (!this.db.prepare("DELETE FROM products WHERE id=?").run(id).changes)
			throw new CatalogError(404, "Product not found.");
		return { id };
	}
}
