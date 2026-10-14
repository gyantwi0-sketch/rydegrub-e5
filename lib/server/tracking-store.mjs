import { installAudit } from './audit-schema.mjs';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { AccessError } from './scoped-auth.mjs';

export const ORDER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const STAGES = ['confirmed', 'preparing', 'packed', 'arriving', 'delivered', 'cancelled'];
export const TOKEN_LIFETIME = 15 * 60 * 1000;
export const RETENTION = 30 * 86400000;
const NOT_FOUND = () => new AccessError(404, 'Tracking is unavailable.');
const hash = value => createHash('sha256').update(value).digest('hex');
const ownerValid = owner => typeof owner === 'string' && /^[0-9a-f]{64}$/.test(owner);

function details(input, now) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).some(k => !['stage', 'station', 'eta'].includes(k)) ||
      !STAGES.includes(input.stage) || typeof input.station !== 'string' ||
      !/^[A-Za-z][A-Za-z .()-]{1,79}$/.test(input.station) ||
      !(input.eta === null || (Number.isSafeInteger(input.eta) && input.eta >= now - 86400000 && input.eta <= now + 7 * 86400000)))
    throw new AccessError(400, 'Invalid fulfilment snapshot.');
  return { stage: input.stage, station: input.station, eta: input.eta };
}

// Return this allowlist, including for owners. Never serialize database rows.
function view(row) {
  return { id: row.id, stage: row.stage, station: row.station, eta: row.eta, updatedAt: row.updated, version: row.version };
}

export class TrackingStore {
  constructor(root) {
    if (typeof root !== 'string' || !isAbsolute(root)) throw new AccessError(503, 'Private tracking directory is required.');
    mkdirSync(root, { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(join(root, 'tracking.sqlite'));
    if (![0, 1].includes(this.db.prepare('PRAGMA user_version').get().user_version)) {
      this.db.close(); throw new AccessError(503, 'Unsupported tracking database schema.');
    }
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS orders (
        id TEXT PRIMARY KEY, owner TEXT NOT NULL, stage TEXT NOT NULL, station TEXT NOT NULL,
        eta INTEGER, updated INTEGER NOT NULL, version INTEGER NOT NULL, expires INTEGER NOT NULL,
        revoked INTEGER NOT NULL DEFAULT 0);
      CREATE INDEX IF NOT EXISTS owner_orders ON orders(owner, updated);
      CREATE TABLE IF NOT EXISTS tokens (order_id TEXT PRIMARY KEY, digest TEXT UNIQUE NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS limits (bucket TEXT PRIMARY KEY, minute INTEGER NOT NULL, count INTEGER NOT NULL);
      PRAGMA user_version=1;`);
    try { installAudit(this.db, 'tracking'); } catch(error) { this.db.close(); throw error; }
  }
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  // Only the trusted fulfilment adapter calls these writes, never browser routes.
  create(owner, input, now = Date.now()) {
    if (!ownerValid(owner)) throw new AccessError(400, 'Invalid owner.');
    const d = details(input, now);
    if (d.stage !== 'confirmed') throw new AccessError(409, 'New orders must start confirmed.');
    const id = randomUUID();
    this.db.prepare('INSERT INTO orders VALUES (?,?,?,?,?,?,1,?,0)').run(id, owner, d.stage, d.station, d.eta, now, now + RETENTION);
    return this.readOwner(id, owner, now);
  }
  update(id, expectedVersion, input, now = Date.now()) {
    const d = details(input, now);
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) throw new AccessError(400, 'Expected version is required.');
    return this.transaction(() => {
      const row = this.active(id, now);
      if (!row) throw NOT_FOUND();
      if (row.version !== expectedVersion) throw new AccessError(409, 'Stale fulfilment update.');
      const before = STAGES.indexOf(row.stage);
      const after = STAGES.indexOf(d.stage);
      const terminal = ['delivered', 'cancelled'].includes(row.stage);
      if ((terminal && d.stage !== row.stage) || (!terminal && after < before))
        throw new AccessError(409, 'Invalid fulfilment transition.');
      this.db.prepare('UPDATE orders SET stage=?, station=?, eta=?, updated=?, version=version+1 WHERE id=?')
        .run(d.stage, d.station, d.eta, now, id);
      return view(this.active(id, now));
    });
  }
  active(id, now) {
    if (typeof id !== 'string' || !ORDER_ID.test(id)) return undefined;
    return this.db.prepare('SELECT * FROM orders WHERE id=? AND revoked=0 AND expires>?').get(id, now);
  }
  readOwner(id, owner, now = Date.now()) {
    const row = this.active(id, now);
    if (!row || !ownerValid(owner) || row.owner !== owner) throw NOT_FOUND();
    return view(row);
  }
  list(owner, now = Date.now()) {
    if (!ownerValid(owner)) throw NOT_FOUND();
    return this.db.prepare('SELECT * FROM orders WHERE owner=? AND revoked=0 AND expires>? ORDER BY updated DESC, id LIMIT 50')
      .all(owner, now).map(view);
  }
  issueToken(id, owner, now = Date.now()) {
    return this.transaction(() => {
      this.readOwner(id, owner, now);
      const token = randomBytes(32).toString('base64url');
      const expiresAt = Math.min(now + TOKEN_LIFETIME, this.active(id, now).expires);
      this.db.prepare('INSERT OR REPLACE INTO tokens VALUES (?,?,?)').run(id, hash(token), expiresAt);
      return { token, expiresAt };
    });
  }
  readToken(id, token, now = Date.now()) {
    // A code grants only one tracking view and is never an owner credential.
    if (typeof id !== 'string' || !ORDER_ID.test(id) || typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw NOT_FOUND();
    const row = this.db.prepare(`SELECT o.* FROM orders o JOIN tokens t ON t.order_id=o.id
      WHERE o.id=? AND t.digest=? AND t.expires>? AND o.expires>? AND o.revoked=0`).get(id, hash(token), now, now);
    if (!row) throw NOT_FOUND();
    return view(row);
  }
  revokeToken(id, owner, now = Date.now()) {
    return this.transaction(() => {
      this.readOwner(id, owner, now);
      this.db.prepare('DELETE FROM tokens WHERE order_id=?').run(id);
    });
  }
  revokeOrder(id) {
    return this.transaction(() => {
      if (typeof id !== 'string' || !ORDER_ID.test(id)) throw NOT_FOUND();
      this.db.prepare('UPDATE orders SET revoked=1 WHERE id=?').run(id);
      this.db.prepare('DELETE FROM tokens WHERE order_id=?').run(id);
    });
  }
  purgeOwner(owner) {
    if (!ownerValid(owner)) throw new AccessError(400, 'Invalid owner.');
    return this.transaction(() => {
      this.db.prepare('DELETE FROM tokens WHERE order_id IN (SELECT id FROM orders WHERE owner=?)').run(owner);
      return this.db.prepare('DELETE FROM orders WHERE owner=?').run(owner).changes;
    });
  }
  limit(bucket, maximum, now = Date.now()) {
    return this.transaction(() => {
      const minute = Math.floor(now / 60000);
      const row = this.db.prepare('SELECT * FROM limits WHERE bucket=?').get(bucket);
      const count = row?.minute === minute ? row.count : 0;
      if (count >= maximum) throw new AccessError(429, 'Too many tracking requests. Try again shortly.');
      this.db.prepare('INSERT OR REPLACE INTO limits VALUES (?,?,?)').run(bucket, minute, count + 1);
      this.db.prepare('DELETE FROM limits WHERE minute<?').run(Math.floor(now / 60000) - 1);
    });
  }
  cleanup(now = Date.now()) {
    return this.transaction(() => {
      this.db.prepare('DELETE FROM tokens WHERE expires<=? OR order_id IN (SELECT id FROM orders WHERE expires<=? OR revoked=1)').run(now, now);
      this.db.prepare('DELETE FROM limits WHERE minute<?').run(Math.floor(now / 60000) - 1);
      return this.db.prepare('DELETE FROM orders WHERE expires<=? OR revoked=1').run(now).changes;
    });
  }
  close() { this.db.close(); }
}

