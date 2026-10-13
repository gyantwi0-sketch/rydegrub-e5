import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DomainStore } from '../lib/server/domain-store.mjs';
import { transitionOrder, transitionPayment, transitionFulfilment } from '../lib/server/state-machines.mjs';

const owner = 'a'.repeat(64);
const pnrDigest = createHmac('sha256', 'test-only-fixture-pepper')
  .update('synthetic-demo-pnr').digest('hex');

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'ryde-state-'));
  const db = new DomainStore(root);
  t.after(() => { db.close(); rmSync(root, { recursive: true, force: true }); });
  db.createAccount(owner, randomUUID());
  db.addStation({ code: 'NDLS', name: 'New Delhi' });
  db.addStation({ code: 'KOTA', name: 'Kota Junction' });
  const vendorId = db.addVendor({ stationCode: 'KOTA', name: 'Kitchen Vendor' });
  db.putProduct({ sku: 'meal', vendorId, name: 'Meal Bowl', pricePaise: 12000, active: true });
  const journeyId = db.addJourney(owner, {
    pnrDigest, trainNo: '12952', origin: 'NDLS', destination: 'KOTA',
  });
  db.replaceCart(owner, 0, [{ sku: 'meal', quantity: 2 }]);
  const draft = db.createDraftOrder(owner, journeyId, 1);
  return { db, draft };
}
const paymentEvent = (paymentId, expectedVersion, nextState, providerRefDigest = 'c'.repeat(64)) =>
  ({ paymentId, expectedVersion, nextState, providerRefDigest });

test('role guards, prerequisites, monotonic versions and terminal states are enforced', () => {
  const start = { state: 'draft', version: 1, updatedAt: 1000 };
  assert.deepEqual(transitionOrder(start, 'pending_payment', 'checkout', {}, 1001),
    { state: 'pending_payment', version: 2, updatedAt: 1001 });
  assert.throws(() => transitionOrder(start, 'confirmed', 'account', {}, 1001), { status: 409 });
  assert.throws(() => transitionOrder(start, 'pending_payment', 'account', {}, 1001), { status: 409 });
  assert.throws(() => transitionOrder(start, 'pending_payment', 'checkout', {}, 999), { status: 409 });
  const pending = { state: 'pending_payment', version: 2, updatedAt: 1001 };
  assert.throws(() => transitionOrder(pending, 'confirmed', 'gateway', { paymentState: 'authorized' }, 1002), { status: 409 });
  assert.deepEqual(transitionOrder(pending, 'confirmed', 'gateway', { paymentState: 'captured' }, 1002),
    { state: 'confirmed', version: 3, updatedAt: 1002 });
  assert.throws(() => transitionOrder({ state: 'delivered', version: 4, updatedAt: 1003 },
    'confirmed', 'gateway', {}, 1004), { status: 409 });
  assert.throws(() => transitionOrder({ state: 'confirmed', version: 3, updatedAt: 1002 },
    'cancelled', 'operations', { paymentState: 'captured' }, 1003), { status: 409 });
  assert.throws(() => transitionPayment({ state: 'created', version: 1, updatedAt: 10 },
    'captured', 'gateway', 11), { status: 409 });
  assert.throws(() => transitionPayment({ state: 'authorized', version: 2, updatedAt: 10 },
    'captured', 'account', 11), { status: 409 });
  assert.throws(() => transitionFulfilment({ state: 'confirmed', version: 1, updatedAt: 10 },
    'delivered', 'account', { orderState: 'confirmed', paymentState: 'captured' }, 11), { status: 409 });
});
test('trusted checkout creates an uncharged attempt from server subtotal only', t => {
  const { db, draft } = fixture(t);
  assert.equal(draft.subtotalPaise, 24000);
  const prepared = db.startPayment(owner, draft.id, 1);
  assert.equal(prepared.amountPaise, 24000);
  assert.equal(prepared.orderState, 'pending_payment');
  assert.equal(prepared.orderVersion, 2);
  assert.throws(() => db.startPayment(owner, draft.id, 1), { status: 409 });
  assert.throws(() => db.startPayment('b'.repeat(64), draft.id, 2), { status: 404 });
  const count = db.db.prepare('SELECT COUNT(*) AS n FROM payment_attempts').get().n;
  assert.equal(count, 1);
  assert.equal(db.db.prepare('SELECT status FROM orders WHERE id=?').get(draft.id).status, 'pending_payment');
  assert.equal(db.db.prepare('SELECT status FROM payment_attempts WHERE id=?').get(prepared.paymentId).status, 'created');
});
test('verified provider flow authorizes/captures and fulfilment can only deliver confirmed payments', t => {
  const { db, draft } = fixture(t);
  const p = db.startPayment(owner, draft.id, 1);
  assert.throws(() => db.applyGatewayEvent(paymentEvent(p.paymentId, 1, 'captured')), { status: 409 });
  assert.throws(() => db.recordFulfilment({
    orderId: draft.id, expectedVersion: 2, stage: 'preparing', stationCode: 'KOTA',
  }), { status: 409 });
  assert.equal(db.applyGatewayEvent(paymentEvent(p.paymentId, 1, 'authorized')).state, 'authorized');
  assert.equal(db.applyGatewayEvent(paymentEvent(p.paymentId, 2, 'captured')).state, 'captured');
  assert.equal(db.db.prepare('SELECT status FROM orders WHERE id=?').get(draft.id).status, 'confirmed');
  for (const stage of ['preparing', 'packed', 'arriving', 'delivered']) {
    assert.equal(db.recordFulfilment({
      orderId: draft.id, expectedVersion: 3, stage, stationCode: 'KOTA',
    }).stage, stage);
    if (stage === 'delivered') break;
  }
  assert.equal(db.db.prepare('SELECT status FROM orders WHERE id=?').get(draft.id).status, 'delivered');
  assert.equal(db.db.prepare('SELECT COUNT(*) AS n FROM order_state_events WHERE order_id=?')
    .get(draft.id).n, 3);
  assert.equal(db.db.prepare('SELECT COUNT(*) AS n FROM fulfilment_events WHERE order_id=?')
    .get(draft.id).n, 4);
  assert.throws(() => db.cancelOrder(owner, draft.id, 4), { status: 409 });
});
test('cancel pending orders without taking payment; refuse cancelling authorized holds', t => {
  const { db, draft } = fixture(t);
  const p = db.startPayment(owner, draft.id, 1);
  const cancelled = db.cancelOrder(owner, draft.id, 2);
  assert.equal(cancelled.status, 'cancelled');
  assert.throws(() => db.cancelOrder(owner, draft.id, 3), { status: 409 });
  const nextFixture = fixture(t);
  const p2 = nextFixture.db.startPayment(owner, nextFixture.draft.id, 1);
  nextFixture.db.applyGatewayEvent(paymentEvent(p2.paymentId, 1, 'authorized'));
  assert.throws(() => nextFixture.db.cancelOrder(owner, nextFixture.draft.id, 2), { status: 409 });
  assert.equal(nextFixture.db.db.prepare('SELECT status FROM orders WHERE id=?')
    .get(nextFixture.draft.id).status, 'pending_payment');
  assert.equal(db.db.prepare('SELECT status FROM payment_attempts WHERE id=?').get(p.paymentId).status, 'created');
});
test('a paid cancellation requires a provider-verified refund, not just a browser cancellation', t => {
  const { db, draft } = fixture(t);
  const p = db.startPayment(owner, draft.id, 1);
  db.applyGatewayEvent(paymentEvent(p.paymentId, 1, 'authorized'));
  db.applyGatewayEvent(paymentEvent(p.paymentId, 2, 'captured'));
  assert.throws(() => db.cancelOrder(owner, draft.id, 3), { status: 409 });
  assert.throws(() => db.cancelRefundedOrder(draft.id, 3), { status: 409 });
  assert.throws(() => db.applyGatewayEvent(paymentEvent(p.paymentId, 3, 'refunded', 'd'.repeat(64))), { status: 409 });
  db.applyGatewayEvent(paymentEvent(p.paymentId, 3, 'refunded'));
  assert.equal(db.cancelRefundedOrder(draft.id, 3).status, 'cancelled');
  assert.equal(db.db.prepare('SELECT status FROM orders WHERE id=?').get(draft.id).status, 'cancelled');
  assert.equal(db.db.prepare('SELECT COUNT(*) AS n FROM payment_state_events WHERE payment_id=?')
    .get(p.paymentId).n, 3);
});
