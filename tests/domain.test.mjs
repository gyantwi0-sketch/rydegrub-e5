import assert from "node:assert/strict";
import test from "node:test";
import {
  categories,
  orderStatus,
  products,
  statuses,
  totals,
} from "../lib/rydegrub.ts";

test("catalog identifiers are unique and categories are defined", () => {
  assert.equal(new Set(products.map((product) => product.id)).size, products.length);
  for (const product of products) {
    assert.ok(categories.includes(product.category), product.id);
    assert.ok(product.price > 0, product.id);
  }
});

test("an empty cart has no charge", () => {
  assert.deepEqual(totals({}), { subtotal: 0, delivery: 0, total: 0 });
});

test("delivery costs ₹20 below ₹399 and is free above it", () => {
  assert.deepEqual(totals({ samosa: 1 }), {
    subtotal: 59,
    delivery: 20,
    total: 79,
  });
  assert.deepEqual(totals({ thali: 1, paneer: 1 }), {
    subtotal: 408,
    delivery: 0,
    total: 408,
  });
});

test("unknown IDs do not contribute to a total", () => {
  assert.deepEqual(totals({ unknown: 10 }), {
    subtotal: 0,
    delivery: 0,
    total: 0,
  });
});

test("demo order status advances at fifteen-second boundaries", () => {
  const createdAt = 1_000_000;
  assert.equal(statuses.length, 5);
  assert.equal(orderStatus(createdAt, createdAt - 1), 0);
  assert.equal(orderStatus(createdAt, createdAt + 14_999), 0);
  assert.equal(orderStatus(createdAt, createdAt + 15_000), 1);
  assert.equal(orderStatus(createdAt, createdAt + 59_999), 3);
  assert.equal(orderStatus(createdAt, createdAt + 60_000), 4);
  assert.equal(orderStatus(createdAt, createdAt + 600_000), 4);
});
