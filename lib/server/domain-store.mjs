import { installAudit } from './audit-schema.mjs';
import { metrics } from './metrics.mjs';
import { transitionOrder, transitionPayment, transitionFulfilment } from './state-machines.mjs';
import { createHash, randomUUID, randomBytes } from 'node:crypto';
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
  CREATE INDEX fulfilment_by_order ON fulfilment_events(order_id,recorded_at);`,
  `ALTER TABLE orders ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;
  UPDATE orders SET updated_at=created_at WHERE updated_at=0;
  ALTER TABLE payment_attempts ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
  CREATE TABLE order_state_events (
    id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id),
    from_state TEXT NOT NULL, to_state TEXT NOT NULL, actor TEXT NOT NULL,
    recorded_at INTEGER NOT NULL
  );
  CREATE INDEX order_states_by_order ON order_state_events(order_id,recorded_at);
  CREATE TABLE payment_state_events (
    id TEXT PRIMARY KEY, payment_id TEXT NOT NULL REFERENCES payment_attempts(id),
    from_state TEXT NOT NULL, to_state TEXT NOT NULL,
    recorded_at INTEGER NOT NULL
  );
  CREATE INDEX payment_states_by_payment ON payment_state_events(payment_id,recorded_at);`,
  `CREATE TABLE request_idempotency (
    owner TEXT NOT NULL REFERENCES accounts(owner) ON DELETE CASCADE,
    operation TEXT NOT NULL,
    key_digest TEXT NOT NULL,
    request_digest TEXT NOT NULL,
    result_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    PRIMARY KEY(owner,operation,key_digest)
  );
  CREATE INDEX idempotency_expiration ON request_idempotency(expires_at);`,
  `CREATE TABLE guest_carts (
    token_digest TEXT PRIMARY KEY, version INTEGER NOT NULL CHECK(version>=0),
    items_json TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
  );
  CREATE INDEX guest_expiration ON guest_carts(expires_at);`
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
      installAudit(this.db, 'domain');
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
  ensureAccount(owner, subject, now = Date.now()) {
    ownerKey(owner);
    if (!uuid(subject)) invalid(400, 'Invalid identity subject.');
    const byOwner = this.db.prepare('SELECT owner, subject FROM accounts WHERE owner=?').get(owner);
    const bySubject = this.db.prepare('SELECT owner, subject FROM accounts WHERE subject=?').get(subject);
    if (byOwner || bySubject) {
      if (byOwner?.owner === owner && byOwner?.subject === subject &&
          bySubject?.owner === owner && bySubject?.subject === subject) {
        return { owner, subject };
      }
      invalid(409, 'Account identity mismatch.');
    }
    try {
      this.db.prepare('INSERT INTO accounts(owner,subject,created_at) VALUES(?,?,?)')
        .run(owner, subject, now);
    } catch (error) {
      const recheck = this.db.prepare('SELECT owner, subject FROM accounts WHERE owner=? OR subject=?').get(owner, subject);
      if (recheck?.owner === owner && recheck?.subject === subject) return { owner, subject };
      if (recheck) invalid(409, 'Account identity mismatch.');
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
  validateCartItems(items) {
    if (!Array.isArray(items) || items.length > 30 ||
        new Set(items.map(i => i?.sku)).size !== items.length) invalid(400, 'Invalid cart.');
    let total = 0;
    const result = [];
    for (const line of items) {
      exact(line, ['sku','quantity']);
      if (typeof line.sku !== 'string' || !SKU.test(line.sku) || line.sku.length > 80 ||
          !integer(line.quantity, 1, 99)) invalid(400, 'Invalid cart.');
      const item = this.db.prepare(`SELECT c.sku,c.name,c.price_paise AS unitPaise
        FROM catalog c JOIN vendors v ON v.id=c.vendor_id JOIN stations s ON s.code=v.station_code
        WHERE c.sku=? AND c.active=1 AND v.enabled=1 AND s.active=1`).get(line.sku);
      if (!item) invalid(409, 'Cart product unavailable.');
      total += item.unitPaise * line.quantity;
      result.push({ ...item, quantity: line.quantity });
    }
    if (total > 2_000_000) invalid(400, 'Cart limit exceeded.');
    return result;
  }
  // Internal transaction helper. All callers must hold a write transaction.
  writeCart(owner, expectedVersion, items, now) {
    ownerKey(owner);
    if (!integer(expectedVersion, 0, 1_000_000_000)) invalid(400, 'Invalid cart version.');
    if (!this.db.prepare('SELECT 1 FROM accounts WHERE owner=?').get(owner)) invalid(404, 'Record not found.');
    const current = this.readCart(owner).version;
    if (current !== expectedVersion) invalid(409, 'Cart changed. Reload and retry.');
    this.validateCartItems(items);
    this.db.prepare(`INSERT INTO carts VALUES(?,?,?) ON CONFLICT(owner)
      DO UPDATE SET version=excluded.version,updated_at=excluded.updated_at`).run(owner, current + 1, now);
    this.db.prepare('DELETE FROM cart_lines WHERE owner=?').run(owner);
    for (const line of items) this.db.prepare('INSERT INTO cart_lines VALUES(?,?,?)').run(owner, line.sku, line.quantity);
    return this.readCart(owner);
  }
  replaceCart(owner, expectedVersion, items, now = Date.now()) {
    return this.transaction(() => this.writeCart(owner, expectedVersion, items, now));
  }
  guestDigest(token) {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) invalid(401, 'Guest cart expired. Start a new cart.');
    return createHash('sha256').update(token).digest('hex');
  }
  createGuestCart(now = Date.now()) {
    return this.transaction(() => {
      this.db.prepare('DELETE FROM guest_carts WHERE expires_at<=?').run(now);
      const token = randomBytes(32).toString('base64url');
      this.db.prepare('INSERT INTO guest_carts VALUES(?,0,?,?,?)')
        .run(this.guestDigest(token), '[]', now, now + 86400000);
      return { token, cart: { version: 0, items: [], expiresAt: now + 86400000 } };
    });
  }
  guestRecord(token, now) {
    const row = this.db.prepare('SELECT * FROM guest_carts WHERE token_digest=? AND expires_at>?')
      .get(this.guestDigest(token), now);
    if (!row) invalid(401, 'Guest cart expired. Start a new cart.');
    return row;
  }
  readGuestCart(token, now = Date.now()) {
    const row = this.guestRecord(token, now);
    // Keep unavailable lines visible so the customer can remove them.
    const items = JSON.parse(row.items_json).map(line => {
      const p = this.db.prepare('SELECT name,price_paise AS unitPaise FROM catalog WHERE sku=?').get(line.sku);
      return { ...line, name: p?.name ?? line.sku, unitPaise: p?.unitPaise ?? 0 };
    });
    return { version: row.version, items, expiresAt: row.expires_at };
  }
  replaceGuestCart(token, expectedVersion, items, now = Date.now()) {
    return this.transaction(() => {
      const row = this.guestRecord(token, now);
      if (!integer(expectedVersion, 0, 1_000_000_000)) invalid(400, 'Invalid cart version.');
      if (row.version !== expectedVersion) invalid(409, 'Guest cart changed. Reload and retry.');
      this.validateCartItems(items);
      this.db.prepare('UPDATE guest_carts SET items_json=?,version=version+1 WHERE token_digest=?')
        .run(JSON.stringify(items), row.token_digest);
      return this.readGuestCart(token, now);
    });
  }
  removeGuestCart(token) {
    this.db.prepare('DELETE FROM guest_carts WHERE token_digest=?').run(this.guestDigest(token));
  }
  mergeGuestCart(owner, token, expectedVersion, guestVersion, mode, now = Date.now()) {
    if (!['combine','replace'].includes(mode) || !integer(guestVersion, 0, 1_000_000_000)) invalid(400, 'Invalid merge.');
    return this.transaction(() => {
      const guest = this.guestRecord(token, now);
      if (guest.version !== guestVersion) invalid(409, 'Guest cart changed. Review again.');
      const combined = new Map();
      if (mode === 'combine') for (const line of this.readCart(owner).items) combined.set(line.sku, line.quantity);
      for (const line of JSON.parse(guest.items_json)) combined.set(line.sku, (combined.get(line.sku) ?? 0) + line.quantity);
      const items = [...combined].map(([sku, quantity]) => ({ sku, quantity }));
      const cart = this.writeCart(owner, expectedVersion, items, now);
      this.db.prepare('DELETE FROM guest_carts WHERE token_digest=?').run(guest.token_digest);
      return cart;
    });
  }
  commerceCatalog() {
    return this.db.prepare(`SELECT c.sku,c.name,c.price_paise AS unitPaise,v.station_code AS stationCode
      FROM catalog c JOIN vendors v ON v.id=c.vendor_id JOIN stations s ON s.code=v.station_code
      WHERE c.active=1 AND v.enabled=1 AND s.active=1 ORDER BY c.sku LIMIT 1000`).all();
  }
  // A quote is a price/availability snapshot, never a payment authorization.
  quoteCart(owner) {
    ownerKey(owner);
    const cart = this.readCart(owner);
    if (!cart.items.length) invalid(409, 'Cart is empty.');
    const items = cart.items.map(line => {
      const product = this.db.prepare(`SELECT c.sku,c.name,c.price_paise AS unitPaise,
        c.vendor_id AS vendorId,v.station_code AS stationCode
        FROM catalog c JOIN vendors v ON v.id=c.vendor_id
        JOIN stations s ON s.code=v.station_code
        WHERE c.sku=? AND c.active=1 AND v.enabled=1 AND s.active=1`).get(line.sku);
      if (!product) invalid(409, 'Cart product unavailable.');
      return { ...product, quantity: line.quantity };
    });
    const subtotalPaise = items.reduce((sum, line) => sum + line.unitPaise * line.quantity, 0);
    if (subtotalPaise > 2_000_000) invalid(400, 'Cart limit exceeded.');
    const quoteHash = createHash('sha256').update(JSON.stringify([owner, cart.version, items])).digest('hex');
    return { cartVersion: cart.version, currency: 'INR', subtotalPaise, quoteHash, items,
      payable: false };
  }
  // Trusted application backend only; drafts are NOT paid orders, reservations,
  // stock holds or fulfilment authorizations.
  createDraftOrder(owner, journeyId, cartVersion, idempotencyKey, now = Date.now(), expectedQuote) {
    ownerKey(owner);
    if (!uuid(journeyId) || !integer(cartVersion, 1, 1_000_000_000) ||
        !uuid(idempotencyKey)) invalid(400, 'Valid idempotency key is required.');
    if (expectedQuote !== undefined && (typeof expectedQuote !== 'string' || !OWNER.test(expectedQuote)))
      invalid(400, 'Invalid quote.');
    const keyDigest = createHash('sha256')
      .update(JSON.stringify(['order-draft', owner, idempotencyKey])).digest('hex');
    const requestDigest = createHash('sha256')
      .update(JSON.stringify(expectedQuote === undefined ? [journeyId, cartVersion] : [journeyId, cartVersion, expectedQuote])).digest('hex');
    return this.transaction(() => {
      const saved = this.db.prepare(`SELECT request_digest,result_json,expires_at
        FROM request_idempotency WHERE owner=? AND operation='order-draft' AND key_digest=?`)
        .get(owner, keyDigest);
      if (saved) {
        if (saved.expires_at <= now || saved.request_digest !== requestDigest)
          invalid(409, 'Idempotency key is expired or was used for another request.');
        return JSON.parse(saved.result_json);
      }
      if (!this.db.prepare('SELECT 1 FROM journeys WHERE id=? AND owner=?').get(journeyId, owner))
        invalid(404, 'Record not found.');
      const cart = this.readCart(owner);
      if (cart.version !== cartVersion) invalid(409, 'Cart changed. Reload and retry.');
      if (cart.items.length < 1) invalid(409, 'Cart is empty.');
      if (expectedQuote !== undefined && this.quoteCart(owner).quoteHash !== expectedQuote)
        invalid(409, 'Menu or prices changed. Review a fresh quote.');
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
      this.db.prepare(`INSERT INTO orders(id,owner,journey_id,status,subtotal_paise,currency,version,created_at,updated_at)
        VALUES(?,?,?,'draft',?,'INR',1,?,?)`).run(id, owner, journeyId, total, now, now);
      for (const line of fresh) this.db.prepare('INSERT INTO order_lines VALUES(?,?,?,?,?)')
        .run(id, line.sku, line.name, line.quantity, line.pricePaise);
      const result = { id, status: 'draft', currency: 'INR', subtotalPaise: total, version: 1 };
      this.db.prepare(`INSERT INTO request_idempotency
        (owner,operation,key_digest,request_digest,result_json,created_at,expires_at)
        VALUES (?,'order-draft',?,?,?,?,?)`)
        .run(owner, keyDigest, requestDigest, JSON.stringify(result), now, now + 30 * 86400000);
      return result;
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

  // Prepares a trusted payment attempt; never calls a gateway or charges money.
  startPayment(owner, orderId, expectedVersion, now = Date.now()) {
    ownerKey(owner);
    if (!uuid(orderId) || !integer(expectedVersion, 1, 1_000_000_000))
      invalid(400, 'Invalid payment request.');
    return this.transaction(() => {
      const row = this.db.prepare('SELECT * FROM orders WHERE id=? AND owner=?').get(orderId, owner);
      if (!row) invalid(404, 'Record not found.');
      if (row.version !== expectedVersion) invalid(409, 'Stale order revision.');
      const next = transitionOrder({
        state: row.status, version: row.version, updatedAt: row.updated_at,
      }, 'pending_payment', 'checkout', {}, now);
      this.db.prepare('UPDATE orders SET status=?,version=?,updated_at=? WHERE id=?')
        .run(next.state, next.version, next.updatedAt, orderId);
      const paymentId = randomUUID();
      this.db.prepare(`INSERT INTO payment_attempts
        (id,order_id,provider_ref_digest,status,amount_paise,updated_at,version)
        VALUES (?, ?, NULL, 'created', ?, ?, 1)`).run(paymentId, orderId, row.subtotal_paise, now);
      this.db.prepare('INSERT INTO order_state_events VALUES(?,?,?,?,?,?)')
        .run(randomUUID(), orderId, row.status, next.state, 'checkout', now);
      return { paymentId, orderId, amountPaise: row.subtotal_paise, paymentState: 'created',
        orderState: 'pending_payment', orderVersion: next.version };
    });
  }
  // Called ONLY AFTER a gateway signature and reference are independently verified.
  // The raw gateway reference and request payload must never be forwarded here.
  applyGatewayEvent(input, now = Date.now()) {
    exact(input, ['paymentId','expectedVersion','nextState','providerRefDigest']);
    if (!uuid(input.paymentId) || !integer(input.expectedVersion, 1, 1_000_000_000) ||
        typeof input.nextState !== 'string' ||
        !(input.providerRefDigest === null ||
          (typeof input.providerRefDigest === 'string' && PNR_DIGEST.test(input.providerRefDigest))))
      invalid(400, 'Invalid provider event.');
    if (input.nextState !== 'failed' && input.providerRefDigest === null)
      invalid(400, 'Verified provider reference required.');
    const result = this.transaction(() => {
      const row = this.db.prepare(`SELECT p.id,p.order_id AS orderId,p.status AS paymentState,
        p.version AS paymentVersion,p.updated_at AS paymentUpdated,
        p.amount_paise AS amountPaise,p.provider_ref_digest AS existingDigest,
        o.status AS orderState,o.version AS orderVersion,o.updated_at AS orderUpdated,
        o.subtotal_paise AS subtotalPaise
        FROM payment_attempts p JOIN orders o ON o.id=p.order_id WHERE p.id=?`)
        .get(input.paymentId);
      if (!row) invalid(404, 'Record not found.');
      if (row.paymentVersion !== input.expectedVersion) invalid(409, 'Stale payment revision.');
      if (row.existingDigest && input.providerRefDigest !== row.existingDigest)
        invalid(409, 'Provider reference mismatch.');
      const next = transitionPayment({
        state: row.paymentState, version: row.paymentVersion, updatedAt: row.paymentUpdated,
      }, input.nextState, 'gateway', now);
      this.db.prepare(`UPDATE payment_attempts SET status=?,version=?,updated_at=?,
        provider_ref_digest=COALESCE(provider_ref_digest,?) WHERE id=?`)
        .run(next.state, next.version, next.updatedAt, input.providerRefDigest, input.paymentId);
      this.db.prepare('INSERT INTO payment_state_events VALUES(?,?,?,?,?)')
        .run(randomUUID(), input.paymentId, row.paymentState, next.state, now);
      if (next.state === 'captured') {
        if (row.amountPaise !== row.subtotalPaise)
          invalid(409, 'Payment amount does not match order.');
        const orderNext = transitionOrder({
          state: row.orderState, version: row.orderVersion, updatedAt: row.orderUpdated,
        }, 'confirmed', 'gateway', { paymentState: 'captured' }, now);
        this.db.prepare('UPDATE orders SET status=?,version=?,updated_at=? WHERE id=?')
          .run(orderNext.state, orderNext.version, now, row.orderId);
        this.db.prepare('INSERT INTO order_state_events VALUES(?,?,?,?,?,?)')
          .run(randomUUID(), row.orderId, row.orderState, orderNext.state, 'gateway', now);
      }
      return { paymentId: input.paymentId, state: next.state, version: next.version };
    });
    metrics.payment(result.state);
    return result;
  }
  // Account cancellation cannot silently cancel a captured or authorized payment.
  cancelOrder(owner, orderId, expectedVersion, now = Date.now()) {
    ownerKey(owner);
    if (!uuid(orderId) || !integer(expectedVersion, 1, 1_000_000_000))
      invalid(400, 'Invalid cancellation.');
    return this.transaction(() => {
      const row = this.db.prepare('SELECT * FROM orders WHERE id=? AND owner=?').get(orderId, owner);
      if (!row) invalid(404, 'Record not found.');
      if (row.version !== expectedVersion) invalid(409, 'Stale order revision.');
      const payment = this.db.prepare(`SELECT status FROM payment_attempts
        WHERE order_id=? ORDER BY updated_at DESC LIMIT 1`).get(orderId);
      const next = transitionOrder({
        state: row.status, version: row.version, updatedAt: row.updated_at,
      }, 'cancelled', 'account', { paymentState: payment?.status }, now);
      this.db.prepare('UPDATE orders SET status=?,version=?,updated_at=? WHERE id=?')
        .run(next.state, next.version, now, orderId);
      this.db.prepare('INSERT INTO order_state_events VALUES(?,?,?,?,?,?)')
        .run(randomUUID(), orderId, row.status, next.state, 'account', now);
      return { orderId, status: next.state, version: next.version };
    });
  }
  // Operations may cancel a paid order only after the verified refund completes.
  cancelRefundedOrder(orderId, expectedVersion, now = Date.now()) {
    if (!uuid(orderId) || !integer(expectedVersion, 1, 1_000_000_000))
      invalid(400, 'Invalid cancellation.');
    return this.transaction(() => {
      const row = this.db.prepare('SELECT * FROM orders WHERE id=?').get(orderId);
      if (!row) invalid(404, 'Record not found.');
      if (row.version !== expectedVersion) invalid(409, 'Stale order revision.');
      const p = this.db.prepare(`SELECT status FROM payment_attempts
        WHERE order_id=? ORDER BY updated_at DESC LIMIT 1`).get(orderId);
      const next = transitionOrder({
        state: row.status, version: row.version, updatedAt: row.updated_at,
      }, 'cancelled', 'operations', { paymentState: p?.status }, now);
      this.db.prepare('UPDATE orders SET status=?,version=?,updated_at=? WHERE id=?')
        .run(next.state, next.version, now, orderId);
      this.db.prepare('INSERT INTO order_state_events VALUES(?,?,?,?,?,?)')
        .run(randomUUID(), orderId, row.status, next.state, 'operations', now);
      return { orderId, status: next.state, version: next.version };
    });
  }
  // Trusted fulfilment adapter only; never expose a browser-selected stage.
  recordFulfilment(input, now = Date.now()) {
    exact(input, ['orderId','expectedVersion','stage','stationCode']);
    if (!uuid(input.orderId) || !integer(input.expectedVersion, 1, 1_000_000_000) ||
        typeof input.stage !== 'string' ||
        typeof input.stationCode !== 'string' || !CODE.test(input.stationCode))
      invalid(400, 'Invalid fulfilment event.');
    return this.transaction(() => {
      const order = this.db.prepare('SELECT * FROM orders WHERE id=?').get(input.orderId);
      if (!order) invalid(404, 'Record not found.');
      if (order.version !== input.expectedVersion) invalid(409, 'Stale order revision.');
      const prior = this.db.prepare(`SELECT stage,recorded_at
        FROM fulfilment_events WHERE order_id=? ORDER BY rowid DESC LIMIT 1`).get(input.orderId);
      const count = this.db.prepare('SELECT COUNT(*) AS n FROM fulfilment_events WHERE order_id=?')
        .get(input.orderId).n;
      const payment = this.db.prepare(`SELECT status FROM payment_attempts
        WHERE order_id=? ORDER BY updated_at DESC LIMIT 1`).get(input.orderId);
      const next = transitionFulfilment({
        state: prior?.stage ?? 'confirmed', version: count + 1,
        updatedAt: prior?.recorded_at ?? order.updated_at,
      }, input.stage, 'fulfilment', {
        orderState: order.status, paymentState: payment?.status,
      }, now);
      this.db.prepare('INSERT INTO fulfilment_events VALUES(?,?,?,?,?)')
        .run(randomUUID(), input.orderId, next.state, input.stationCode, now);
      if (next.state === 'delivered') {
        const changed = transitionOrder({
          state: order.status, version: order.version, updatedAt: order.updated_at,
        }, 'delivered', 'fulfilment', { fulfilmentState: 'delivered' }, now);
        this.db.prepare('UPDATE orders SET status=?,version=?,updated_at=? WHERE id=?')
          .run(changed.state, changed.version, now, input.orderId);
        this.db.prepare('INSERT INTO order_state_events VALUES(?,?,?,?,?,?)')
          .run(randomUUID(), input.orderId, order.status, changed.state, 'fulfilment', now);
      }
      return { orderId: input.orderId, stage: next.state, at: now };
    });
  }

  close() { this.db.close(); }
}


