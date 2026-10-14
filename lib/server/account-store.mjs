import { installAudit, failedSignInAudit } from './audit-schema.mjs';
import { argon2, createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdirSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export class AccountError extends Error { constructor(status, message) { super(message); this.status = status; } }
const fail = (status, message) => { throw new AccountError(status, message); };
const digest = v => createHash('sha256').update(v).digest('hex');
const derive = promisify(argon2);
const PARAMETERS = { parallelism: 1, tagLength: 32, memory: 65536, passes: 3 };
export function emailAddress(value) {
  if (typeof value !== 'string' || value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)) fail(400, 'Enter a valid email address.');
  return value.toLowerCase();
}
export async function passwordPolicy(password, checkBreached) {
  if (typeof password !== 'string' || [...password].length < 15 || [...password].length > 128 || Buffer.byteLength(password) > 512)
    fail(400, 'Use a password between 15 and 128 characters.');
  if (!checkBreached) fail(503, 'Password screening unavailable.');
  if (await checkBreached(password)) fail(400, 'Choose a password that has not appeared in a data breach.');
}
export async function hashPassword(password) {
  const nonce = randomBytes(16);
  const hash = await derive('argon2id', { ...PARAMETERS, message: password, nonce });
  return `argon2id:${nonce.toString('hex')}:${hash.toString('hex')}`;
}
async function matches(password, encoded) {
  const [, salt, expected] = encoded.split(':');
  const hash = await derive('argon2id', { ...PARAMETERS, message: password, nonce: Buffer.from(salt, 'hex') });
  return timingSafeEqual(hash, Buffer.from(expected, 'hex'));
}
let dummy;
export class AccountStore {
  constructor(dir) {
    if (!isAbsolute(dir)) fail(503, 'Account service unavailable.');
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(join(dir, 'accounts.sqlite'));
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    const version = this.db.prepare('PRAGMA user_version').get().user_version;
    if (version > 1) { this.db.close(); fail(503, 'Unsupported account schema.'); }
    this.db.exec(`CREATE TABLE IF NOT EXISTS members(id TEXT PRIMARY KEY, owner TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL, name TEXT NOT NULL, password TEXT NOT NULL, verified INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions(digest TEXT PRIMARY KEY, member TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      expires INTEGER NOT NULL, created INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS tokens(digest TEXT PRIMARY KEY, member TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      purpose TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS sessions_member ON sessions(member);
      PRAGMA user_version=1;`);
    try { installAudit(this.db, 'account'); } catch(error) { this.db.close(); throw error; }
  }
  transaction(fn) { this.db.exec('BEGIN IMMEDIATE'); try { const r = fn(); this.db.exec('COMMIT'); return r; } catch (e) { this.db.exec('ROLLBACK'); throw e; } }
  async register({ email, name, password }, checkBreached, now = Date.now()) {
    email = emailAddress(email);
    if (typeof name !== 'string' || name.trim() !== name || name.length < 2 || name.length > 80 || [...name].some(ch => ch.codePointAt(0) < 32 || ch.codePointAt(0) === 127 || ch === '<' || ch === '>')) fail(400, 'Enter a valid name.');
    await passwordPolicy(password, checkBreached);
    const hashed = await hashPassword(password);
    const id = randomUUID(), owner = digest(`ryde-account:${id}`);
    try { this.db.prepare('INSERT INTO members VALUES(?,?,?,?,?,0,?)').run(id, owner, email, name, hashed, now); }
    catch (e) { if (this.db.prepare('SELECT 1 FROM members WHERE email=?').get(email)) return null; throw e; }
    return { id, owner, email, name };
  }
  async signIn(email, password, prior, now = Date.now()) {
    email = emailAddress(email);
    if (typeof password !== 'string' || Buffer.byteLength(password) > 512) fail(401, 'Invalid email or password.');
    const member = this.db.prepare('SELECT * FROM members WHERE email=?').get(email);
    dummy ??= hashPassword('dummy non-account password for timing');
    const valid = await matches(password, member?.password ?? await dummy);
    if (!member || !valid) { failedSignInAudit(this.db); fail(401, 'Invalid email or password.'); }
    const token = randomBytes(32).toString('base64url');
    this.transaction(() => {
      if (prior) this.db.prepare('DELETE FROM sessions WHERE digest=?').run(digest(prior));
      this.db.prepare('DELETE FROM sessions WHERE expires<=?').run(now);
      this.db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(digest(token), member.id, now + 8 * 3600000, now);
    });
    return { token, account: this.publicMember(member) };
  }
  publicMember(m) { return { id: m.id, owner: m.owner, name: m.name, email: m.email, verified: Boolean(m.verified) }; }
  session(token, now = Date.now()) {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) fail(401, 'Sign in required.');
    const row = this.db.prepare('SELECT m.* FROM members m JOIN sessions s ON s.member=m.id WHERE s.digest=? AND s.expires>?').get(digest(token), now);
    if (!row) fail(401, 'Sign in required.');
    return this.publicMember(row);
  }
  logout(token) { if (typeof token === 'string') this.db.prepare('DELETE FROM sessions WHERE digest=?').run(digest(token)); }
  issueToken(email, purpose, now = Date.now()) {
    if (!['verify','reset'].includes(purpose)) fail(400, 'Invalid token purpose.');
    const member = this.db.prepare('SELECT * FROM members WHERE email=?').get(emailAddress(email));
    if (!member || (purpose === 'verify' && member.verified)) return null;
    const token = randomBytes(32).toString('base64url');
    this.transaction(() => {
      this.db.prepare('DELETE FROM tokens WHERE member=? AND purpose=?').run(member.id, purpose);
      this.db.prepare('INSERT INTO tokens VALUES(?,?,?,?)').run(digest(token), member.id, purpose, now + 15 * 60000);
    });
    return { token, email: member.email };
  }
  async redeem(token, purpose, password, checkBreached, now = Date.now()) {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) fail(400, 'Invalid or expired code.');
    const hashed = purpose === 'reset' ? (await passwordPolicy(password, checkBreached), await hashPassword(password)) : null;
    return this.transaction(() => {
      const row = this.db.prepare('SELECT member FROM tokens WHERE digest=? AND purpose=? AND expires>?').get(digest(token), purpose, now);
      if (!row) fail(400, 'Invalid or expired code.');
      if (purpose === 'verify') this.db.prepare('UPDATE members SET verified=1 WHERE id=?').run(row.member);
      else if (purpose === 'reset') {
        this.db.prepare('UPDATE members SET password=? WHERE id=?').run(hashed, row.member);
        this.db.prepare('DELETE FROM sessions WHERE member=?').run(row.member);
      } else fail(400, 'Invalid token purpose.');
      this.db.prepare('DELETE FROM tokens WHERE member=? AND purpose=?').run(row.member, purpose);
    });
  }
  close() { this.db.close(); }
}
