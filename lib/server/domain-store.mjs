import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// Trusted service adapter only: browser requests must never call this store
// with client-chosen owner identities, prices, order state or PNRs.
export class DomainError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const OWNER = /^[0-9a-f]{64}$/;
const PNR_DIGEST = /^[0-9a-f]{64}$/;
const CODE = /^[A-Z0-9]{2,10}$/;
const SKU = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const invalid = (status, message) => { throw new DomainError(status, message); };
const ownerKey = owner => {
  if (typeof owner !== 'string' || !OWNER.test(owner)) invalid(401, 'Verified account required.');
  return owner;
};
const uuid = id => typeof id === 'string' && UUID.test(id);
const text = (s, max = 120) => typeof s === 'string' && s.trim() === s &&
  s.length >= 2 && s.length <= max &&
  ![...s].some(ch => ch.codePointAt(0) < 32 || ch.codePointAt(0) === 127 || ch === '<' || ch === '>');
const integer = (n, min, max) => Number.isSafeInteger(n) && n >= min && n <= max;
function exact(input, keys) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).sort().join(',') !== [...keys].sort().join(',')) invalid(400, 'Invalid data.');
  return input;
}

const migrations = [
  `CREATE TABLE accounts (
    owner TEXT PRIMARY KEY, subject TEXT NOT NULL UNIQUE,
    email TEXT UNIQUE COLLATE NOCASE, password_hash TEXT, email_verified INTEGER NOT NULL DEFAULT 0
      CHECK(email_verified IN (0,1)), created_at INTEGER NOT NULL
  );
  CREATE TABLE stations (
    code TEXT PRIMARY KEY, name TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1))
  );
  CREATE TABLE vendors (
    id TEXT PRIMARY KEY, station_code TEXT NOT NULL REFERENCES stations(code),
    name TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1))
  );
  CREATE TABLE catalog (
    sku TEXT PRIMARY KEY, vendor_id TEXT NOT NULL REFERENCES vendors(id),
    name TEXT NOT NULL, price_paise INTEGER NOT NULL CHECK(price_paise BETWEEN 1 AND 1000000),
    active INTEGER NOT NULL CHECK(active IN (0,1)), updated_at INTEGER NOT NULL
  );
  CREATE INDEX catalog_by_vendor ON catalog(vendor_id,active);
  CREATE TABLE journeys (
    id TEXT PRIMARY KEY, owner TEXT NOT NULL REFERENCES accounts(owner) ON DELETE CASCADE,
    pnr_digest TEXT NOT NULL, train_no TEXT NOT NULL, origin TEXT NOT NULL REFERENCES stations(code),
    destination TEXT NOT NULL REFERENCES stations(code), created_at INTEGER NOT NULL,
    CHECK(origin <> destination)
  );
  CREATE INDEX journeys_by_owner ON journeys(owner,created_at);
  CREATE TABLE carts (
    owner TEXT PRIMARY KEY REFERENCES accounts(owner) ON DELETE CASCADE,
    version INTEGER NOT NULL CHECK(version > 0), updated_at INTEGER NOT NULL
  );
  CREATE TABLE cart_lines (
    owner TEXT NOT NULL REFERENCES carts(owner) ON DELETE CASCADE,
    sku TEXT NOT NULL REFERENCES catalog(sku),
    quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 99), PRIMARY KEY(owner,sku)
  );
  CREATE TABLE orders (
    id TEXT PRIMARY KEY, owner TEXT NOT NULL REFERENCES accounts(owner),
    journey_id TEXT NOT NULL REFERENCES journeys(id),
    status TEXT NOT NULL CHECK(status IN ('draft','pending_payment','confirmed','cancelled','delivered')),
    subtotal_paise INTEGER NOT NULL CHECK(subtotal_paise >= 0),
    currency TEXT NOT NULL CHECK(currency='INR'),
    version INTEGER NOT NULL CHECK(version >= 1), created_at INTEGER NOT NULL
  );
  CREATE INDEX orders_by_owner ON orders(owner,created_at);
  CREATE TABLE order_lines (
    order_id TEXT NOT NULL REFERENCES orders(id),
    sku TEXT NOT NULL, item_name TEXT NOT NULL,
    quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 99),
    unit_paise INTEGER NOT NULL CHECK(unit_paise > 0), PRIMARY KEY(order_id,sku)
  );
  CREATE TABLE payment_attempts (
    id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id),
    provider_ref_digest TEXT UNIQUE,
    status TEXT NOT NULL CHECK(status IN ('created','authorized','captured','failed','refunded')),
    amount_paise INTEGER NOT NULL CHECK(amount_paise >= 0), updated_at INTEGER NOT NULL
  );
  CREATE INDEX payments_by_order ON payment_attempts(order_id);
  CREATE TABLE fulfilment_events (
    id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id),
    stage TEXT NOT NULL CHECK(stage IN ('confirmed','preparing','packed','arriving','delivered','cancelled')),
    station_code TEXT REFERENCES stations(code), recorded_at INTEGER NOT NULL
  );
  CREATE INDEX fulfilment_by_order ON fulfilment_events(order_id,recorded_at);`
];

export class DomainStore {
  constructor(dir) {
    if (typeof dir !== 'string' || !isAbsolute(dir)) invalid(503, 'Private domain directory required.');
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(join(dir, 'domain.sqlite'));
    try {
      this.db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;');
      const version = this.db.prepare('PRAGMA user_version').get().user_version;
      if (!integer(version, 0, migrations.length)) invalid(503, 'Unsupported domain schema version.');
      for (let i = version; i < migrations.length; i++) this.transaction(() => {
        this.db.exec(migrations[i]);
        this.db.exec(`PRAGMA user_version=${i + 1}`);
      });
    } catch (error) { this.db.close(); throw error; }
  }
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  // Called only by a trusted identity adapter, never directly from HTTP input.
  createAccount(owner, subject, now = Date.now()) {
    ownerKey(owner);
    if (!uuid(subject)) invalid(400, 'Invalid identity subject.');
    try {
      this.db.prepare('INSERT INTO accounts(owner,subject,created_at) VALUES(?,?,?)')
        .run(owner, subject, now);
    } catch (error) {
      if (this.db.prepare('SELECT 1 FROM accounts WHERE owner=? OR subject=?').get(owner, subject))
        invalid(409, 'Account already exists.');
      throw error;
    }
    return { owner, subject };
  }
  addStation(input) {
    exact(input, ['code','name']);
    if (typeof input.code !== 'string' || !CODE.test(input.code) || !text(input.name, 80))
      invalid(400, 'Invalid station.');
    this.db.prepare(`INSERT INTO stations(code,name) VALUES(?,?)
      ON CONFLICT(code) DO UPDATE SET name=excluded.name`).run(input.code, input.name);
  }
  addVendor(input) {
    exact(input, ['stationCode','name']);
    if (typeof input.stationCode !== 'string' || !CODE.test(input.stationCode) || !text(input.name, 80))
      invalid(400, 'Invalid vendor.');
    const id = randomUUID();
    this.db.prepare('INSERT INTO vendors(id,station_code,name) VALUES(?,?,?)')
      .run(id, input.stationCode, input.name);
    return id;
  }
  putProduct(input, now = Date.now()) {
    exact(input, ['sku','vendorId','name','pricePaise','active']);
    if (typeof input.sku !== 'string' || !SKU.test(input.sku) || input.sku.length > 80 ||
        !uuid(input.vendorId) || !text(input.name) ||
        !integer(input.pricePaise, 1, 1_000_000) || typeof input.active !== 'boolean')
      invalid(400, 'Invalid product.');
    this.db.prepare(`INSERT INTO catalog(sku,vendor_id,name,price_paise,active,updated_at)
      VALUES(?,?,?,?,?,?) ON CONFLICT(sku) DO UPDATE SET vendor_id=excluded.vendor_id,
      name=excluded.name,price_paise=excluded.price_paise,active=excluded.active,
      updated_at=excluded.updated_at`)
      .run(input.sku, input.vendorId, input.name, input.pricePaise, Number(input.active), now);
  }
  // Accepts ONLY a keyed fingerprint produced by an approved provider adapter.
  // Never store raw passenger PNRs or place them in SQLite/logs/URLs.
  addJourney(owner, input, now = Date.now()) {
    ownerKey(owner);
    exact(input, ['pnrDigest','trainNo','origin','destination']);
    if (typeof input.pnrDigest !== 'string' || !PNR_DIGEST.test(input.pnrDigest) ||
        typeof input.trainNo !== 'string' || !/^[0-9]{5}$/.test(input.trainNo) ||
        typeof input.origin !== 'string' || typeof input.destination !== 'string' ||
        !CODE.test(input.origin) || !CODE.test(input.destination) || input.origin === input.destination)
      invalid(400, 'Invalid journey.');
    const id = randomUUID();
    this.db.prepare('INSERT INTO journeys VALUES(?,?,?,?,?,?,?)')
      .run(id, owner, input.pnrDigest, input.trainNo, input.origin, input.destination, now);
    return id;
  }
  readCart(owner) {
    ownerKey(owner);
    const version = this.db.prepare('SELECT version FROM carts WHERE owner=?').get(owner)?.version ?? 0;
    const lines = this.db.prepare(`SELECT l.sku,l.quantity,c.name,c.price_paise AS unitPaise
      FROM cart_lines l JOIN catalog c ON c.sku=l.sku WHERE l.owner=? ORDER BY l.sku`).all(owner);
    return { version, items: lines };
  }
  replaceCart(owner, expectedVersion, items, now = Date.now()) {
    ownerKey(owner);
    if (!integer(expectedVersion, 0, 1_000_000_000) || !Array.isArray(items) ||
        items.length > 30 || new Set(items.map(i => i?.sku)).size !== items.length)
      invalid(400, 'Invalid cart.');
    for (const line of items) {
      exact(line, ['sku','quantity']);
      if (typeof line.sku !== 'string' || !SKU.test(line.sku) || !integer(line.quantity, 1, 99))
        invalid(400, 'Invalid cart.');
    }
    return this.transaction(() => {
      if (!this.db.prepare('SELECT 1 FROM accounts WHERE owner=?').get(owner))
        invalid(404, 'Record not found.');
      const current = this.readCart(owner).version;
      if (current !== expectedVersion) invalid(409, 'Cart changed. Reload and retry.');
      let total = 0;
      for (const line of items) {
        const item = this.db.prepare(`SELECT c.price_paise FROM catalog c
          JOIN vendors v ON v.id=c.vendor_id JOIN stations s ON s.code=v.station_code
          WHERE c.sku=? AND c.active=1 AND v.enabled=1 AND s.active=1`).get(line.sku);
        if (!item) invalid(409, 'Cart product unavailable.');
        total += item.price_paise * line.quantity;
      }
      if (total > 2_000_000) invalid(400, 'Cart limit exceeded.');
      this.db.prepare(`INSERT INTO carts VALUES(?,?,?) ON CONFLICT(owner)
        DO UPDATE SET version=excluded.version,updated_at=excluded.updated_at`)
        .run(owner, current + 1, now);
      this.db.prepare('DELETE FROM cart_lines WHERE owner=?').run(owner);
      for (const line of items)
        this.db.prepare('INSERT INTO cart_lines VALUES(?,?,?)').run(owner, line.sku, line.quantity);
      return this.readCart(owner);
    });
  }
  // Trusted application backend only; drafts are NOT paid orders, reservations,
  // stock holds or fulfilment authorizations.
  createDraftOrder(owner, journeyId, cartVersion, now = Date.now()) {
    ownerKey(owner);
    if (!uuid(journeyId) || !integer(cartVersion, 1, 1_000_000_000))
      invalid(400, 'Invalid order input.');
    return this.transaction(() => {
      if (!this.db.prepare('SELECT 1 FROM journeys WHERE id=? AND owner=?').get(journeyId, owner))
        invalid(404, 'Record not found.');
      const cart = this.readCart(owner);
      if (cart.version !== cartVersion) invalid(409, 'Cart changed. Reload and retry.');
      if (cart.items.length < 1) invalid(409, 'Cart is empty.');
      const fresh = cart.items.map(line => {
        const p = this.db.prepare(`SELECT c.sku,c.name,c.price_paise AS pricePaise
          FROM catalog c JOIN vendors v ON v.id=c.vendor_id
          JOIN stations s ON s.code=v.station_code
          WHERE c.sku=? AND c.active=1 AND v.enabled=1 AND s.active=1`).get(line.sku);
        if (!p) invalid(409, 'Cart product unavailable.');
        return { ...p, quantity: line.quantity };
      });
      const total = fresh.reduce((sum, line) => sum + line.pricePaise * line.quantity, 0);
      if (total > 2_000_000) invalid(400, 'Cart limit exceeded.');
      const id = randomUUID();
      this.db.prepare(`INSERT INTO orders(id,owner,journey_id,status,subtotal_paise,currency,version,created_at)
        VALUES(?,?,?,'draft',?,'INR',1,?)`).run(id, owner, journeyId, total, now);
      for (const line of fresh) this.db.prepare('INSERT INTO order_lines VALUES(?,?,?,?,?)')
        .run(id, line.sku, line.name, line.quantity, line.pricePaise);
      return { id, status: 'draft', currency: 'INR', subtotalPaise: total, version: 1 };
    });
  }
  readDraft(owner, id) {
    ownerKey(owner);
    if (!uuid(id)) invalid(404, 'Record not found.');
    const row = this.db.prepare(`SELECT id,status,subtotal_paise AS subtotalPaise,currency,version
      FROM orders WHERE id=? AND owner=? AND status='draft'`).get(id, owner);
    if (!row) invalid(404, 'Record not found.');
    const items = this.db.prepare(`SELECT sku,item_name AS name,quantity,unit_paise AS unitPaise
      FROM order_lines WHERE order_id=? ORDER BY sku`).all(id);
    return { ...row, items };
  }
  close() { this.db.close(); }
}
