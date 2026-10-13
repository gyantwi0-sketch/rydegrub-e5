import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { AccessError } from './scoped-auth.mjs';

const OWNER = /^[0-9a-f]{64}$/;
export const PREFERENCES = ['Vegetarian', 'High-protein', 'Mild spice'];
export const PURPOSES = ['marketing', 'personalization'];
export const CODE_TTL = 10 * 60_000;
const PHONE = /^[6-9][0-9]{9}$/;
const reject = () => new AccessError(400, 'Phone verification failed or expired.');

function verifyOwner(owner) {
  if (typeof owner !== 'string' || !OWNER.test(owner)) throw new AccessError(401, 'A verified account is required.');
}
function validName(name) {
  return typeof name === 'string' && name === name.trim() &&
    name.length <= 80 && (name === '' || (name.length >= 2 && !/[\\x00-\\x1f\\x7f<>]/.test(name)));
}
export function validateProfile(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).sort().join(',') !== 'name,preferences' ||
      !validName(input.name) || !Array.isArray(input.preferences) ||
      input.preferences.length > PREFERENCES.length ||
      new Set(input.preferences).size !== input.preferences.length ||
      !input.preferences.every(p => PREFERENCES.includes(p))) {
    throw new AccessError(400, 'Invalid profile details.');
  }
  return { name: input.name, preferences: input.preferences };
}
export function validatePhone(phone) {
  if (typeof phone !== 'string' || !PHONE.test(phone)) throw new AccessError(400, 'Enter a valid 10-digit Indian mobile number.');
  return phone;
}
function hmac(pepper, ...pieces) {
  return createHmac('sha256', pepper).update(JSON.stringify(pieces)).digest();
}
const defaultConsent = () => Object.fromEntries(PURPOSES.map(p => [p, { granted: false, updatedAt: null }]));

export class ProfileStore {
  constructor(dir) {
    if (typeof dir !== 'string' || !isAbsolute(dir)) throw new AccessError(503, 'Private profile directory required.');
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(join(dir, 'profile.sqlite'));
    const version = this.db.prepare('PRAGMA user_version').get().user_version;
    if (version !== 0 && version !== 1) {
      this.db.close();
      throw new AccessError(503, 'Unsupported profile schema.');
    }
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS profiles (
        owner TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '',
        preferences TEXT NOT NULL DEFAULT '[]', updated INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS consent (
        owner TEXT NOT NULL, purpose TEXT NOT NULL, granted INTEGER NOT NULL,
        changed INTEGER NOT NULL, PRIMARY KEY(owner,purpose)
      );
      CREATE TABLE IF NOT EXISTS consent_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT, owner TEXT NOT NULL, purpose TEXT NOT NULL,
        granted INTEGER NOT NULL, changed INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS consent_events_owner ON consent_events(owner, id);
      CREATE TABLE IF NOT EXISTS challenges (
        owner TEXT PRIMARY KEY, phone TEXT NOT NULL, nonce TEXT NOT NULL,
        digest BLOB NOT NULL, expires INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS counters (
        bucket TEXT PRIMARY KEY, window INTEGER NOT NULL, count INTEGER NOT NULL
      );
      PRAGMA user_version=1;`);
  }
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  limit(bucket, maximum, windowMs = 60_000, now = Date.now()) {
    return this.transaction(() => {
      const window = Math.floor(now / windowMs);
      const prior = this.db.prepare('SELECT window,count FROM counters WHERE bucket=?').get(bucket);
      const count = prior?.window === window ? prior.count : 0;
      if (count >= maximum) throw new AccessError(429, 'Too many requests. Try again later.');
      this.db.prepare('INSERT OR REPLACE INTO counters VALUES (?,?,?)').run(bucket, window, count + 1);
    });
  }
  read(owner) {
    verifyOwner(owner);
    const row = this.db.prepare('SELECT name,phone,preferences,updated FROM profiles WHERE owner=?').get(owner);
    const consents = defaultConsent();
    for (const c of this.db.prepare('SELECT purpose,granted,changed FROM consent WHERE owner=?').all(owner)) {
      if (PURPOSES.includes(c.purpose)) consents[c.purpose] = { granted: c.granted === 1, updatedAt: c.changed };
    }
    return { name: row?.name ?? '', phone: row?.phone ?? '',
      preferences: row ? JSON.parse(row.preferences) : [], updatedAt: row?.updated ?? null, consents };
  }
  update(owner, payload, now = Date.now()) {
    verifyOwner(owner);
    const { name, preferences } = validateProfile(payload);
    this.db.prepare(`INSERT INTO profiles(owner,name,phone,preferences,updated) VALUES (?,?,?,?,?)
      ON CONFLICT(owner) DO UPDATE SET name=excluded.name, preferences=excluded.preferences, updated=excluded.updated`)
      .run(owner, name, '', JSON.stringify(preferences), now);
    return this.read(owner);
  }
  consent(owner, payload, now = Date.now()) {
    verifyOwner(owner);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) ||
        Object.keys(payload).sort().join(',') !== 'granted,purpose' ||
        !PURPOSES.includes(payload.purpose) || typeof payload.granted !== 'boolean') {
      throw new AccessError(400, 'Invalid consent update.');
    }
    this.transaction(() => {
      const current = this.db.prepare('SELECT granted FROM consent WHERE owner=? AND purpose=?')
        .get(owner, payload.purpose);
      if (current?.granted === Number(payload.granted)) return;
      this.db.prepare('INSERT INTO consent_events(owner,purpose,granted,changed) VALUES (?,?,?,?)')
        .run(owner, payload.purpose, Number(payload.granted), now);
      this.db.prepare(`INSERT INTO consent(owner,purpose,granted,changed) VALUES(?,?,?,?)
        ON CONFLICT(owner,purpose) DO UPDATE SET granted=excluded.granted, changed=excluded.changed`)
        .run(owner, payload.purpose, Number(payload.granted), now);
    });
    return this.read(owner).consents;
  }
  consentHistory(owner) {
    verifyOwner(owner);
    return this.db.prepare('SELECT purpose,granted,changed FROM consent_events WHERE owner=? ORDER BY id DESC LIMIT 100')
      .all(owner).map(row => ({ purpose: row.purpose, granted: row.granted === 1, updatedAt: row.changed }));
  }
  beginPhone(owner, phone, pepper, now = Date.now()) {
    verifyOwner(owner);
    validatePhone(phone);
    // Quotas are persisted across Node workers and enforced before issuing another challenge.
    this.limit(`sms-owner:${owner}`, 3, 3_600_000, now);
    this.limit(`sms-number:${hmac(pepper, phone).toString('hex')}`, 3, 3_600_000, now);
    const code = String(randomInt(0, 100_000_000)).padStart(8, '0');
    const nonce = randomBytes(16).toString('hex');
    const digest = hmac(pepper, owner, phone, nonce, code);
    this.db.prepare('INSERT OR REPLACE INTO challenges VALUES(?,?,?,?,?,0)')
      .run(owner, phone, nonce, digest, now + CODE_TTL);
    return { code, nonce };
  }
  abortPhone(owner, nonce) {
    verifyOwner(owner);
    this.db.prepare('DELETE FROM challenges WHERE owner=? AND nonce=?').run(owner, nonce);
  }
  finishPhone(owner, code, pepper, now = Date.now()) {
    verifyOwner(owner);
    if (typeof code !== 'string' || !/^[0-9]{8}$/.test(code)) throw reject();
    return this.transaction(() => {
      const challenge = this.db.prepare('SELECT * FROM challenges WHERE owner=?').get(owner);
      if (!challenge || challenge.expires <= now || challenge.attempts >= 5) {
        this.db.prepare('DELETE FROM challenges WHERE owner=?').run(owner);
        throw reject();
      }
      const digest = hmac(pepper, owner, challenge.phone, challenge.nonce, code);
      if (!timingSafeEqual(Buffer.from(challenge.digest), digest)) {
        if (challenge.attempts === 4) this.db.prepare('DELETE FROM challenges WHERE owner=?').run(owner);
        else this.db.prepare('UPDATE challenges SET attempts=attempts+1 WHERE owner=?').run(owner);
        // Failure must be committed so bad guesses consume attempts.
        return null;
      }
      this.db.prepare(`INSERT INTO profiles(owner,name,phone,preferences,updated) VALUES (?,'',?,'[]',?)
        ON CONFLICT(owner) DO UPDATE SET phone=excluded.phone, updated=excluded.updated`)
        .run(owner, challenge.phone, now);
      this.db.prepare('DELETE FROM challenges WHERE owner=?').run(owner);
      return this.read(owner);
    }) ?? (() => { throw reject(); })();
  }
  purge(owner) {
    verifyOwner(owner);
    return this.transaction(() => {
      this.db.prepare('DELETE FROM challenges WHERE owner=?').run(owner);
      this.db.prepare('DELETE FROM consent_events WHERE owner=?').run(owner);
      this.db.prepare('DELETE FROM consent WHERE owner=?').run(owner);
      this.db.prepare('DELETE FROM counters WHERE bucket=? OR bucket=?').run(`profile-owner:${owner}`, `sms-owner:${owner}`);
      return this.db.prepare('DELETE FROM profiles WHERE owner=?').run(owner).changes;
    });
  }
  cleanup(now = Date.now()) {
    return this.transaction(() => {
      this.db.prepare('DELETE FROM challenges WHERE expires<=?').run(now);
      return this.db.prepare('DELETE FROM counters WHERE window<? AND bucket LIKE ?')
        .run(Math.floor(now / 3_600_000) - 2, 'sms-%').changes;
    });
  }
  close() { this.db.close(); }
}
