import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DomainStore } from '../lib/server/domain-store.mjs';

const A = 'a'.repeat(64), B = 'b'.repeat(64);
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'ryde-idempotency-'));
  const db = new DomainStore(dir);
  t.after(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
  db.createAccount(A, randomUUID());
  db.createAccount(B, randomUUID());
  db.addStation({ code: 'NDLS', name: 'New Delhi' });
  db.addStation({ code: 'KOTA', name: 'Kota Junction' });
  const vendorId = db.addVendor({ stationCode: 'KOTA', name: 'Kitchen Vendor' });
  db.putProduct({ sku: 'meal', vendorId, name: 'Veg Meal', pricePaise: 12900, active: true });
  const make = owner => {
    const journeyId = db.addJourney(owner, {
      pnrDigest: 'd'.repeat(64), trainNo: '12952', origin: 'NDLS', destination: 'KOTA',
    });
    db.replaceCart(owner, 0, [{ sku: 'meal', quantity: 2 }]);
    return journeyId;
  };
  return { db, dir, vendorId, aJourney: make(A), bJourney: make(B) };
}
const countOrders = db => db.db.prepare('SELECT COUNT(*) AS n FROM orders').get().n;

test('same idempotency key replays identical result across requests and SQLite connections', t => {
  const { db, dir, aJourney } = fixture(t);
  const key = randomUUID(), now = Date.now();
  const first = db.createDraftOrder(A, aJourney, 1, key, now);
  assert.equal(countOrders(db), 1);
  assert.deepEqual(db.createDraftOrder(A, aJourney, 1, key, now + 1000), first);
  const db2 = new DomainStore(dir);
  try {
    assert.deepEqual(db2.createDraftOrder(A, aJourney, 1, key, now + 2000), first);
  } finally { db2.close(); }
  assert.equal(countOrders(db), 1);
  const record = db.db.prepare('SELECT key_digest,request_digest,result_json FROM request_idempotency').get();
  assert.equal(record.key_digest.length, 64);
  assert.equal(record.key_digest.includes(key), false);
  assert.deepEqual(JSON.parse(record.result_json), first);
});
test('mismatched reuse conflicts and expired keys never silently create duplicate orders', t => {
  const { db, aJourney } = fixture(t);
  const key = randomUUID(), now = Date.now();
  db.createDraftOrder(A, aJourney, 1, key, now);
  assert.throws(() => db.createDraftOrder(A, aJourney, 2, key, now + 1000), { status: 409 });
  assert.throws(() => db.createDraftOrder(A, randomUUID(), 1, key, now + 1000), { status: 409 });
  assert.throws(() => db.createDraftOrder(A, aJourney, 1, key, now + 31 * 86400000), { status: 409 });
  assert.equal(countOrders(db), 1);
});
test('a fresh key creates a new independently priced order while old replay is stable', t => {
  const { db, vendorId, aJourney } = fixture(t);
  const firstKey = randomUUID(), secondKey = randomUUID();
  const first = db.createDraftOrder(A, aJourney, 1, firstKey);
  db.putProduct({ sku: 'meal', vendorId, name: 'Veg Meal', pricePaise: 15000, active: true });
  const second = db.createDraftOrder(A, aJourney, 1, secondKey);
  assert.equal(first.subtotalPaise, 25800);
  assert.equal(second.subtotalPaise, 30000);
  assert.notEqual(first.id, second.id);
  assert.deepEqual(db.createDraftOrder(A, aJourney, 1, firstKey), first);
  assert.equal(countOrders(db), 2);
});
test('keys are owner-scoped and missing, malformed or client price fields are rejected', t => {
  const { db, aJourney, bJourney } = fixture(t);
  const key = randomUUID();
  const one = db.createDraftOrder(A, aJourney, 1, key);
  const two = db.createDraftOrder(B, bJourney, 1, key);
  assert.notEqual(one.id, two.id);
  assert.equal(countOrders(db), 2);
  for (const bad of [undefined, '', 'same-key', '1234567890', 'x'.repeat(100)]) {
    assert.throws(() => db.createDraftOrder(A, aJourney, 1, bad), { status: 400 });
  }
  assert.throws(() => db.createDraftOrder(B, aJourney, 1, randomUUID()), { status: 404 });
});
