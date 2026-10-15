import assert from "node:assert/strict";
import test from "node:test";
import { prepareReorder, totals } from "../lib/rydegrub.ts";
import { categories, products } from "../lib/server/catalog-seed.mjs";

test("catalog identifiers are unique and categories are defined", () => {
  assert.equal(new Set(products.map((product) => product.id)).size, products.length);
  for (const product of products) {
    assert.ok(categories.includes(product.category), product.id);
    assert.ok(product.price > 0, product.id);
  }
});

test("an empty cart has no charge", () => {
  assert.deepEqual(totals({}, products), { subtotal: 0, delivery: 0, total: 0 });
});

test("delivery costs ₹20 below ₹399 and is free above it", () => {
  assert.deepEqual(totals({ samosa: 1 }, products), {
    subtotal: 59,
    delivery: 20,
    total: 79,
  });
  assert.deepEqual(totals({ thali: 1, paneer: 1 }, products), {
    subtotal: 408,
    delivery: 0,
    total: 408,
  });
});

test("unknown IDs do not contribute to a total", () => {
  assert.deepEqual(totals({ unknown: 10 }, products), {
    subtotal: 0,
    delivery: 0,
    total: 0,
  });
});


test("reorder uses current prices and flags changed allergen information", () => {
  const previous = { ...products[0], price: 99, allergens: "None known" };
  const result = prepareReorder([{ product: previous, quantity: 2 }], products);
  assert.deepEqual(result.cart, { thali: 2 });
  assert.equal(result.subtotal, 378);
  assert.ok(result.lines[0].changes.some((change) => change.startsWith("Price:")));
  assert.ok(result.lines[0].changes.some((change) => change.startsWith("Allergens:")));
});

test("reorder excludes removed products without silently replacing them", () => {
  const previous = { ...products[0], id: "discontinued", name: "Old meal" };
  const result = prepareReorder([{ product: previous, quantity: 1 }], products);
  assert.deepEqual(result.cart, {});
  assert.equal(result.subtotal, 0);
  assert.deepEqual(result.lines[0].changes, ["No longer available"]);
});

test("reorder rejects invalid quantities and caps duplicate IDs", () => {
  const product = products[0];
  const result = prepareReorder([
    { product, quantity: -1 },
    { product, quantity: 60 },
    { product, quantity: 50 },
  ], products);
  assert.deepEqual(result.cart, { thali: 60 });
  assert.equal(result.subtotal, 60 * product.price);
  assert.ok(result.lines[0].changes.includes("Invalid quantity"));
  assert.ok(result.lines[2].changes.includes("Quantity exceeds the per-item limit"));
});

