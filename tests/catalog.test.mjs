import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CatalogStore, validateProduct } from '../lib/server/catalog-store.mjs';
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
  const oversized = request('POST', { ...sample, description: 'x'.repeat(17000) }, token);
  assert.equal((await catalogHandlers.create(oversized)).status, 400);
});

test('deleted catalog stays empty after restart, including legacy schema migration', t => {
  const root = mkdtempSync(join(tmpdir(), 'ryde-empty-'));
  let db = new CatalogStore(root);
  t.after(() => { db.db.close(); rmSync(root, {recursive:true,force:true}); });
  for (const p of db.list()) db.remove(p.id);
  db.db.close(); db = new CatalogStore(root);
  assert.deepEqual(db.list(), []);
});

test('indexed search filters station/category/diet, paginates stably, updates and removes index entries', t => {
  const root = mkdtempSync(join(tmpdir(), 'ryde-search-'));
  const db = new CatalogStore(root);
  t.after(() => { db.db.close(); rmSync(root, {recursive:true,force:true}); });
  for (const p of db.list()) db.remove(p.id);
  db.create({...sample,id:'meal-one',name:'Paneer Rice',ingredients:'paneer rice',stations:['NDLS'],price:100,veg:true,protein:25});
  db.create({...sample,id:'meal-two',name:'Chicken Rice',ingredients:'chicken rice',stations:['KOTA'],price:200,veg:false,protein:30});
  db.create({...sample,id:'meal-three',name:'Curd Rice',ingredients:'curd rice',stations:['NDLS'],price:150,veg:true,protein:10});
  assert.equal(db.search({q:'Rice'}).total,3);
  assert.equal(db.search({station:'NDLS',diet:'high-protein'}).total,1);
  assert.equal(db.search({diet:'vegetarian'}).total,2);
  assert.equal(db.search({category:'missing'}).total,0);
  assert.equal(db.search({sort:'price-desc',limit:1,page:2}).products[0].id,'meal-three');
  assert.equal(db.search({q:'Paneer'}).products[0].id,'meal-one');
  db.update({...sample,id:'meal-one',name:'Lentil Rice',ingredients:'lentils',stations:['NDLS']});
  assert.equal(db.search({q:'Paneer'}).total,0);
  db.remove('meal-two'); assert.equal(db.search({q:'Chicken'}).total,0);
  for(const input of [{limit:101},{page:-1},{sort:'price; DROP TABLE products'},{station:'../x'},{q:'*'},{secret:'x'}])assert.throws(()=>db.search(input),{status:400});
  assert.equal(db.search({q:'Rice OR chicken'}).total,0);
  assert.equal(db.search({station:'BCT'}).total,0);
});

test('legacy empty catalog migrates without demo repopulation; future schema fails closed', async t => {
  const { DatabaseSync } = await import('node:sqlite');
  const root = mkdtempSync(join(tmpdir(), 'ryde-legacy-'));
  t.after(() => rmSync(root, {recursive:true,force:true}));
  const legacy = new DatabaseSync(join(root,'catalog.sqlite'));
  legacy.exec('CREATE TABLE products(id TEXT PRIMARY KEY,document TEXT NOT NULL,updated INTEGER NOT NULL)'); legacy.close();
  const db = new CatalogStore(root); assert.deepEqual(db.list(),[]);
  db.db.exec('PRAGMA user_version=999'); db.db.close();
  assert.throws(()=>new CatalogStore(root),{status:503});
});

test('search HTTP validates repeated/unknown parameters and admin delete rejects extra fields', async t => {
  const root=mkdtempSync(join(tmpdir(),'ryde-search-http-'));
  const oldRoot=process.env.CATALOG_DATA_DIR,oldToken=process.env.CATALOG_ADMIN_TOKEN;
  process.env.CATALOG_DATA_DIR=root;process.env.CATALOG_ADMIN_TOKEN='test-only-catalog-admin-token-123456';
  t.after(()=>{if(oldRoot===undefined)delete process.env.CATALOG_DATA_DIR;else process.env.CATALOG_DATA_DIR=oldRoot;if(oldToken===undefined)delete process.env.CATALOG_ADMIN_TOKEN;else process.env.CATALOG_ADMIN_TOKEN=oldToken;rmSync(root,{recursive:true,force:true});});
  for(const query of ['q=a&q=b','limit=-1','page=1.5','__proto__=x','token=secret','sort=wrong']) {
    assert.equal((await catalogHandlers.search(new Request(`https://example.test/api/catalog/search?${query}`))).status,400);
  }
  const result=await catalogHandlers.search(new Request('https://example.test/api/catalog/search?limit=2&page=1&diet=vegetarian'));
  assert.equal(result.status,200); const data=await result.json(); assert.equal(data.products.length,2); assert.ok(data.products.every(p=>p.veg));
  const removed=await catalogHandlers.remove(new Request('https://example.test/api/admin/catalog',{method:'DELETE',headers:{'Content-Type':'application/json',Authorization:`Bearer ${process.env.CATALOG_ADMIN_TOKEN}`},body:JSON.stringify({id:seed[0].id,unexpected:true})}));
  assert.equal(removed.status,400);
});

test('unconfigured catalog is explicitly read-only demo and partial configuration never falls back', async t => {
  const previous = { root: process.env.CATALOG_DATA_DIR, token: process.env.CATALOG_ADMIN_TOKEN };
  delete process.env.CATALOG_DATA_DIR; delete process.env.CATALOG_ADMIN_TOKEN;
  t.after(() => {
    if (previous.root === undefined) delete process.env.CATALOG_DATA_DIR; else process.env.CATALOG_DATA_DIR = previous.root;
    if (previous.token === undefined) delete process.env.CATALOG_ADMIN_TOKEN; else process.env.CATALOG_ADMIN_TOKEN = previous.token;
  });
  const get = () => catalogHandlers.list(new Request('https://example.test/api/catalog'));
  const response = await get(); assert.equal(response.status,200);
  assert.equal((await response.json()).mode,'demo');
  const denied = await catalogHandlers.create(new Request('https://example.test/api/admin/catalog', {
    method:'POST', headers:{'Content-Type':'application/json',Authorization:'Bearer test-only-catalog-admin-token-123456'},body:JSON.stringify(sample),
  })); assert.equal(denied.status,503);
  assert.equal((await (await get()).json()).products.some(p=>p.id===sample.id),false);
  process.env.CATALOG_DATA_DIR = '/private/unused';
  assert.equal((await get()).status,503);
});

test('catalog changes produce private audit events and audit failure rolls back the product write', t => {
  const root = mkdtempSync(join(tmpdir(),'catalog-audit-')), db = new CatalogStore(root);
  t.after(()=>{db.db.close();rmSync(root,{recursive:true,force:true});});
  db.create(sample); db.update({...sample,price:321});
  const audit = db.db.prepare('SELECT event,subject FROM security_audit').all();
  assert.deepEqual(audit.map(e=>e.event),['catalog.created','catalog.changed']);
  assert.ok(audit.every(e=>e.subject===sample.id));
  db.db.exec("CREATE TRIGGER reject_audit BEFORE INSERT ON security_audit BEGIN SELECT RAISE(ABORT,'test'); END;");
  assert.throws(()=>db.update({...sample,price:654}));
  assert.equal(db.list().find(p=>p.id===sample.id).price,321);
});
