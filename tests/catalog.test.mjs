import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CatalogStore, CatalogError, validateProduct } from '../lib/server/catalog-store.mjs';
import { catalogHandlers } from '../lib/server/catalog-http.mjs';
import { products as seed } from '../lib/server/catalog-seed.mjs';

const sample = { ...seed[0], id: 'catalog-test-meal', name: 'Catalog Test Meal' };
test('server catalog seed and product validation', () => {
  assert.equal(validateProduct(sample).id, sample.id);
  assert.throws(() => validateProduct({ ...sample, price: -1 }), { status: 400 });
  assert.throws(() => validateProduct({ ...sample, image: '/images/../../secret' }), { status: 400 });
  assert.throws(() => validateProduct({ ...sample, unexpected: true }), { status: 400 });
  assert.throws(() => validateProduct({ ...sample, allergens: '' }), { status: 400 });
});
test('SQLite catalog seeds once and supports create, update and delete', t => {
  const root = mkdtempSync(join(tmpdir(), 'ryde-catalog-test-'));
  const db = new CatalogStore(root);
  t.after(() => { db.db.close(); rmSync(root, { recursive: true, force: true }); });
  assert.equal(db.list().length, seed.length);
  db.create(sample);
  assert.equal(db.list().length, seed.length + 1);
  assert.throws(() => db.create(sample), { status: 409 });
  db.update({ ...sample, price: 123 });
  assert.equal(db.list().find(p => p.id === sample.id).price, 123);
  assert.deepEqual(db.remove(sample.id), { id: sample.id });
  assert.throws(() => db.update(sample), { status: 404 });
});
test('public catalog and admin API enforce configuration and authorization', async t => {
  const root = mkdtempSync(join(tmpdir(), 'ryde-catalog-http-'));
  const oldRoot = process.env.CATALOG_DATA_DIR, oldToken = process.env.CATALOG_ADMIN_TOKEN;
  process.env.CATALOG_DATA_DIR = root;
  process.env.CATALOG_ADMIN_TOKEN = 'test-only-catalog-admin-token-123456';
  t.after(() => {
    if (oldRoot === undefined) delete process.env.CATALOG_DATA_DIR; else process.env.CATALOG_DATA_DIR = oldRoot;
    if (oldToken === undefined) delete process.env.CATALOG_ADMIN_TOKEN; else process.env.CATALOG_ADMIN_TOKEN = oldToken;
    rmSync(root, { recursive: true, force: true });
  });
  const request = (method, body, token = '') => new Request('https://example.test/api/admin/catalog', {
    method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const list = await catalogHandlers.list(new Request('https://example.test/api/catalog'));
  assert.equal(list.status, 200);
  assert.equal((await list.json()).products.length, seed.length);
  assert.equal((await catalogHandlers.create(request('POST', sample))).status, 401);
  const token = process.env.CATALOG_ADMIN_TOKEN;
  assert.equal((await catalogHandlers.create(request('POST', sample, token))).status, 201);
  assert.equal((await catalogHandlers.update(request('PUT', { ...sample, price: 145 }, token))).status, 200);
  assert.equal((await catalogHandlers.remove(request('DELETE', { id: sample.id }, token))).status, 200);
  assert.equal((await catalogHandlers.list(new Request('https://example.test/api/catalog?token=secret'))).status, 400);
});
