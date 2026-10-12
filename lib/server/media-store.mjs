import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { MediaError } from './media-auth.mjs';
import { VARIANTS } from './media-image.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export class MediaStore {
  constructor(root) {
    if (!isAbsolute(root)) throw new MediaError(503, 'Media directory must be absolute.');
    this.root = root;
    mkdirSync(root, { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(join(root, 'media.sqlite'));
    if (![0, 1].includes(this.db.prepare('PRAGMA user_version').get().user_version)) {
      this.db.close();
      throw new MediaError(503, 'Unsupported media database schema.');
    }
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS media (
        id TEXT PRIMARY KEY, owner TEXT NOT NULL, state TEXT NOT NULL,
        created INTEGER NOT NULL, expires INTEGER NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS active_owner ON media(owner) WHERE state='ready';
      CREATE UNIQUE INDEX IF NOT EXISTS pending_owner ON media(owner) WHERE state='pending';
      CREATE TABLE IF NOT EXISTS attempts (owner TEXT PRIMARY KEY, hour INTEGER, count INTEGER);
      PRAGMA user_version=1;`);
  }
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const value = fn(); this.db.exec('COMMIT'); return value; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  reserve(owner, now = Date.now()) {
    return this.transaction(() => {
      const hour = Math.floor(now / 3600000);
      const usage = this.db.prepare('SELECT * FROM attempts WHERE owner=?').get(owner);
      const count = usage?.hour === hour ? usage.count : 0;
      if (count >= 20) throw new MediaError(429, 'Photo upload limit reached. Try next hour.');
      if (this.db.prepare("SELECT id FROM media WHERE owner=? AND state='pending'").get(owner) ||
          this.db.prepare("SELECT count(*) AS n FROM media WHERE state='pending'").get().n >= 4)
        throw new MediaError(429, 'Photo processing is busy. Try again shortly.');
      this.db.prepare('INSERT OR REPLACE INTO attempts VALUES (?,?,?)').run(owner, hour, count + 1);
      const id = randomUUID();
      this.db.prepare('INSERT INTO media VALUES (?,?,?,?,?)').run(id, owner, 'pending', now, now + 15 * 60000);
      return id;
    });
  }
  publish(id, owner, variants, now = Date.now()) {
    return this.transaction(() => {
      const row = this.db.prepare("SELECT * FROM media WHERE id=? AND owner=? AND state='pending'").get(id, owner);
      if (!row || row.expires <= now) throw new MediaError(409, 'Upload expired. Try again.');
      const dir = join(this.root, id);
      mkdirSync(dir, { mode: 0o700 });
      for (const name of Object.keys(VARIANTS))
        writeFileSync(join(dir, `${name}.webp`), variants[name], { flag: 'wx', mode: 0o600 });
      this.db.prepare("UPDATE media SET state='deleted' WHERE owner=? AND state='ready'").run(owner);
      this.db.prepare("UPDATE media SET state='ready', expires=? WHERE id=?").run(now + 30 * 86400000, id);
      return this.describe(id);
    });
  }
  describe(id) { return { id, thumbnail: `/api/media/${id}/thumbnail`, display: `/api/media/${id}/display` }; }
  current(owner, now = Date.now()) {
    const row = this.db.prepare("SELECT id FROM media WHERE owner=? AND state='ready' AND expires>?").get(owner, now);
    return row ? this.describe(row.id) : null;
  }
  read(id, variant, owner, now = Date.now()) {
    if (!UUID.test(id) || !Object.hasOwn(VARIANTS, variant)) throw new MediaError(404, 'Photo not found.');
    if (!this.db.prepare("SELECT id FROM media WHERE id=? AND owner=? AND state='ready' AND expires>?").get(id, owner, now))
      throw new MediaError(404, 'Photo not found.');
    try { return readFileSync(join(this.root, id, `${variant}.webp`)); }
    catch { throw new MediaError(404, 'Photo not found.'); }
  }
  remove(id, owner) {
    if (!UUID.test(id)) throw new MediaError(404, 'Photo not found.');
    const result = this.db.prepare("UPDATE media SET state='deleted' WHERE id=? AND owner=? AND state='ready'").run(id, owner);
    if (!result.changes) throw new MediaError(404, 'Photo not found.');
  }
  abandon(id, owner) {
    this.db.prepare("UPDATE media SET state='deleted' WHERE id=? AND owner=? AND state='pending'").run(id, owner);
  }
  cleanup(now = Date.now()) {
    this.db.prepare("UPDATE media SET state='deleted' WHERE expires<=?").run(now);
    const rows = this.db.prepare("SELECT id FROM media WHERE state='deleted'").all();
    let removed = 0;
    for (const { id } of rows) {
      if (!UUID.test(id)) continue;
      rmSync(join(this.root, id), { recursive: true, force: true });
      this.db.prepare("DELETE FROM media WHERE id=? AND state='deleted'").run(id);
      removed++;
    }
    this.db.prepare('DELETE FROM attempts WHERE hour<?').run(Math.floor(now / 3600000) - 1);
    return removed;
  }
  close() { this.db.close(); }
}

