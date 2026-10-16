import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { TrackingStore, RETENTION } from '../lib/server/tracking-store.mjs';
const owner = 'a'.repeat(64);
const snapshot = { stage: 'confirmed', station: 'Kota Junction', eta: null };
let currentDb = null;
function setup(t) {
  const root = mkdtempSync(join(tmpdir(), 'tracking-events-'));
  t.after(() => {
    try { currentDb?.close(); } catch {}
    currentDb = null;
    rmSync(root, { recursive: true, force: true });
  });
  return root;
}

test('elapsed time cannot advance status; actual events survive restart with exact timestamps', t => {
  const root = setup(t), now = 1700000000000;
  let db = new TrackingStore(root);
  const order = db.create(owner, snapshot, now);
  assert.deepEqual(db.readOwner(order.id, owner, now + 600000), order);
  db.update(order.id, 1, { ...snapshot, stage: 'preparing', eta: now + 3600000 }, now + 1000);
  db.close(); db = new TrackingStore(root);
  const result = db.readOwner(order.id, owner, now + 600000);
  assert.deepEqual(result.events.map(e => [e.stage, e.recordedAt, e.source]), [
    ['confirmed', now, 'operations'], ['preparing', now + 1000, 'operations'],
  ]);
  assert.equal(result.eta, now + 3600000);
  assert.throws(() => db.readOwner(order.id, 'b'.repeat(64), now + 600000), { status: 404 });
  db.close();
});

test('event writes are atomic, cannot be replaced or deleted independently, and follow order retention', t => {
  const db = new TrackingStore(setup(t));
  currentDb = db;
  const now = Date.now(), order = db.create(owner, snapshot, now);
  db.db.exec(`CREATE TRIGGER reject_event BEFORE INSERT ON tracking_events BEGIN SELECT RAISE(ABORT,'test'); END;`);
  assert.throws(() => db.update(order.id, 1, { ...snapshot, stage: 'preparing' }, now + 1));
  assert.equal(db.readOwner(order.id, owner, now + 1).version, 1);
  db.db.exec('DROP TRIGGER reject_event');
  assert.throws(() => db.db.exec("UPDATE tracking_events SET stage='delivered'"));
  assert.throws(() => db.db.exec('DELETE FROM tracking_events'));
  assert.throws(() => db.db.exec('INSERT OR REPLACE INTO tracking_events SELECT * FROM tracking_events'));
  assert.equal(db.cleanup(now + RETENTION), 1);
  assert.equal(db.db.prepare('SELECT COUNT(*) AS n FROM tracking_events').get().n, 0);
});

test('v1 migration records only the existing snapshot and is idempotent', t => {
  const root = setup(t), now = Date.now(), id = randomUUID();
  const legacy = new DatabaseSync(join(root, 'tracking.sqlite'));
  legacy.exec(`CREATE TABLE orders(id TEXT PRIMARY KEY, owner TEXT NOT NULL, stage TEXT NOT NULL, station TEXT NOT NULL,
    eta INTEGER, updated INTEGER NOT NULL, version INTEGER NOT NULL, expires INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0);
    PRAGMA user_version=1;`);
  legacy.prepare('INSERT INTO orders VALUES(?,?,?,?,?,?,?, ?,0)').run(id, owner, 'packed', snapshot.station, null, now, 7, now + RETENTION);
  legacy.close();
  for (let i = 0; i < 2; i++) {
    const db = new TrackingStore(root);
    const result = db.readOwner(id, owner, now);
    assert.equal(result.events.length, 1);
    assert.equal(result.events[0].version, 7);
    assert.equal(result.events[0].source, 'migration');
    assert.equal(db.db.prepare('PRAGMA user_version').get().user_version, 2);
    db.close();
  }
});

test('stale versions, backward times, skipped stages and terminal edits create no history', t => {
  const db = new TrackingStore(setup(t));
  currentDb = db;
  const now = Date.now(), order = db.create(owner, snapshot, now);
  assert.throws(() => db.update(order.id, 1, { ...snapshot, stage: 'delivered' }, now + 1), { status: 409 });
  assert.throws(() => db.update(order.id, 1, { ...snapshot, stage: 'preparing' }, now - 1), { status: 409 });
  db.update(order.id, 1, { ...snapshot, stage: 'cancelled' }, now + 1);
  assert.throws(() => db.update(order.id, 1, snapshot, now + 2), { status: 409 });
  assert.throws(() => db.update(order.id, 2, { ...snapshot, stage: 'cancelled' }, now + 2), { status: 409 });
  assert.equal(db.readOwner(order.id, owner, now + 3).events.length, 2);
});

test('history projection is bounded, chronological, and purge removes its retained rows', t => {
  const db = new TrackingStore(setup(t));
  currentDb = db;
  const now = Date.now(), order = db.create(owner, snapshot, now);
  for (let i = 1; i <= 105; i++) db.update(order.id, i, snapshot, now + i);
  const result = db.readOwner(order.id, owner, now + 106);
  assert.equal(result.hasEarlierEvents, true);
  assert.equal(result.events.length, 100);
  assert.equal(result.events[0].version, 7);
  assert.equal(result.events.at(-1).version, 106);
  assert.equal(db.purgeOwner(owner), 1);
  assert.equal(db.db.prepare('SELECT COUNT(*) AS n FROM tracking_events').get().n, 0);
});
