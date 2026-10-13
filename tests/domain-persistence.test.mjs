import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DomainStore } from '../lib/server/domain-store.mjs';

const OWNER_A = 'a'.repeat(64);
const OWNER_B = 'b'.repeat(64);
const pnrDigest = createHmac('sha256', 'test-only-private-pepper')
  .update('fictional-demonstration-only').digest('hex');

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'ryde-domain-'));
  const db = new DomainStore(dir);
  t.after(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
  return { db, dir };
}
function seeded(db) {
  db.createAccount(OWNER_A, randomUUID());
  db.createAccount(OWNER_B, randomUUID());
  db.addStation({ code: 'NDLS', name: 'New Delhi' });
  db.addStation({ code: 'KOTA', name: 'Kota Junction' });
  const vendorId = db.addVendor({ stationCode: 'KOTA', name: 'Kitchen Vendor' });
  db.putProduct({ sku: 'veg-thali', vendorId, name: 'Veg Thali', pricePaise: 12900, active: true });
  const journeyId = db.addJourney(OWNER_A, {
    pnrDigest, trainNo: '12952', origin: 'NDLS', destination: 'KOTA',
  });
  return { vendorId, journeyId };
}

test('schema migrates transactionally with FK protection and persists across restart', t => {
  const { db, dir } = fixture(t);
  assert.equal(db.db.prepare('PRAGMA user_version').get().user_version, 3);
  assert.equal(db.db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
  const tables = db.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
  for (const table of ['accounts','stations','vendors','catalog','journeys','carts',
    'cart_lines','orders','order_lines','payment_attempts','fulfilment_events'])
    assert.ok(tables.includes(table), `missing ${table}`);
  const account = db.createAccount(OWNER_A, randomUUID());
  assert.equal(account.owner, OWNER_A);
  const other = new DomainStore(dir);
  assert.equal(other.db.prepare('SELECT owner FROM accounts WHERE owner=?').get(OWNER_A).owner, OWNER_A);
  other.close();
  assert.throws(() => db.addVendor({ stationCode: 'FAKE', name: 'Unknown Vendor' }));
});
test('owner-scoped cart, current authoritative price and optimistic version', t => {
  const { db } = fixture(t);
  const { vendorId, journeyId } = seeded(db);
  assert.deepEqual(db.readCart(OWNER_A), { version: 0, items: [] });
  const result = db.replaceCart(OWNER_A, 0, [{ sku: 'veg-thali', quantity: 2 }]);
  assert.equal(result.version, 1);
  assert.equal(result.items[0].unitPaise, 12900);
  assert.deepEqual(db.readCart(OWNER_B), { version: 0, items: [] });
  assert.throws(() => db.replaceCart(OWNER_A, 0, []), { status: 409 });
  for (const bad of [
    [{ sku: 'veg-thali', quantity: 2, pricePaise: 1 }],
    [{ sku: 'veg-thali', quantity: 0 }],
    [{ sku: 'missing', quantity: 1 }],
    [{ sku: 'veg-thali', quantity: 1 }, { sku: 'veg-thali', quantity: 1 }],
  ]) assert.throws(() => db.replaceCart(OWNER_A, 1, bad));
  assert.equal(db.readCart(OWNER_A).version, 1);
  const draft = db.createDraftOrder(OWNER_A, journeyId, 1, randomUUID());
  assert.equal(draft.subtotalPaise, 25800);
  assert.equal(draft.status, 'draft');
  const read = db.readDraft(OWNER_A, draft.id);
  assert.deepEqual(read.items.map(x => [x.sku,x.quantity,x.unitPaise]), [['veg-thali',2,12900]]);
  assert.throws(() => db.readDraft(OWNER_B, draft.id), { status: 404 });
  assert.throws(() => db.createDraftOrder(OWNER_B, journeyId, 1, randomUUID()), { status: 404 });
  db.putProduct({ sku: 'veg-thali', vendorId, name: 'Veg Thali', pricePaise: 15000, active: true });
  const second = db.createDraftOrder(OWNER_A, journeyId, 1, randomUUID());
  assert.equal(second.subtotalPaise, 30000);
  assert.equal(db.readDraft(OWNER_A, draft.id).subtotalPaise, 25800);
});
test('inactive products and changed availability fail closed before new drafts', t => {
  const { db } = fixture(t);
  const { vendorId, journeyId } = seeded(db);
  const { version } = db.replaceCart(OWNER_A, 0, [{ sku: 'veg-thali', quantity: 1 }]);
  db.putProduct({ sku: 'veg-thali', vendorId, name: 'Veg Thali', pricePaise: 19900, active: false });
  assert.throws(() => db.createDraftOrder(OWNER_A, journeyId, version), { status: 409 });
  assert.throws(() => db.replaceCart(OWNER_A, version, [{ sku: 'veg-thali', quantity: 1 }]), { status: 409 });
  assert.equal(db.readCart(OWNER_A).version, version);
});
test('strict schemas prohibit client-provided totals, owner spoofing and raw PNRs', t => {
  const { db } = fixture(t);
  seeded(db);
  assert.throws(() => db.replaceCart('fake-owner', 0, []), { status: 401 });
  assert.throws(() => db.addJourney(OWNER_A, {
    pnrDigest: '1234567890', trainNo: '12952', origin: 'NDLS', destination: 'KOTA',
  }), { status: 400 });
  assert.throws(() => db.addJourney(OWNER_A, {
    pnrDigest, trainNo: '12952', origin: 'NDLS', destination: 'KOTA', rawPnr: '1234567890',
  }), { status: 400 });
  assert.throws(() => db.putProduct({
    sku: 'meal', vendorId: randomUUID(), name: 'Test Meal',
    pricePaise: 1, active: true, browserTotal: 1,
  }), { status: 400 });
  const stored = db.db.prepare('SELECT * FROM journeys LIMIT 1').get();
  assert.equal(stored.pnr_digest, pnrDigest);
  assert.equal(Object.values(stored).includes('1234567890'), false);
});
test('unsupported database schema fails closed, never silently resets user data', t => {
  const { db, dir } = fixture(t);
  db.db.exec('PRAGMA user_version=99');
  assert.throws(() => new DomainStore(dir), { status: 503 });
});
