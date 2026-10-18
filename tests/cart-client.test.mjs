import test from 'node:test';
import assert from 'node:assert/strict';
import { CartClient } from '../lib/client/cart-client.mjs';
const cart = (quantity = 1, version = 1) => ({ version, items: [{ sku: 'thali', name: 'Thali', unitPaise: 10000, quantity }] });
const ok = data => Response.json(data);
function fixture(overrides = {}) {
  const calls = [];
  const client = new CartClient({ fetcher: async (path, options) => {
    calls.push({ path, options });
    if (overrides[path]) return overrides[path](options);
    if (path === '/api/commerce/catalog') return ok({ mode: 'server', items: [{ sku: 'thali', unitPaise: 10000 }] });
    if (path === '/api/v1/auth/session') return ok({ account: { verified: true } });
    if (path === '/api/guest/cart') return Response.json({ error: 'No guest cart' }, { status: 401 });
    if (path === '/api/cart') return ok({ cart: cart(), context: 'account-bound-context' });
    throw new Error('Unexpected fixture route');
  } });
  return { client, calls };
}
test('account load never imports browser data and sends revision/account context on mutation', async () => {
  const { client, calls } = fixture(); await client.load();
  assert.equal(client.state.mode, 'account'); assert.deepEqual(client.state.cart, { thali: 1 });
  await client.replace({ thali: 2 });
  const write = calls.find(c => c.options.method === 'PUT');
  assert.equal(write.options.headers['X-Ryde-Cart-Context'], 'account-bound-context');
  assert.deepEqual(JSON.parse(write.options.body), { expectedVersion: 1, items: [{ sku: 'thali', quantity: 2 }] });
});
test('guest initialization is an explicit POST and existing guest carts are not overwritten', async () => {
  let created = false;
  const { client } = fixture({ '/api/v1/auth/session': () => Response.json({}, { status: 401 }),
    '/api/guest/cart': options => { if (options.method === 'POST') { created = true; return ok({ cart: cart(3) }); } return Response.json({}, { status: 401 }); } });
  await client.load(); assert.equal(created, true); assert.equal(client.state.mode, 'guest'); assert.equal(client.state.cart.thali, 3);
});
test('account switch clears old state and ignores late responses from the earlier account', async () => {
  let resolveOld;
  const delayed = new Promise(resolve => { resolveOld = resolve; });
  let reads = 0;
  const { client } = fixture({ '/api/cart': () => ++reads === 1 ? delayed : ok({ cart: cart(7), context: 'new-account' }) });
  const oldLoad = client.load();
  while (!reads) await new Promise(resolve => setImmediate(resolve));
  await client.load(); assert.equal(client.state.cart.thali, 7);
  resolveOld(ok({ cart: cart(1), context: 'old-account' })); await oldLoad;
  assert.equal(client.state.cart.thali, 7); assert.equal(client.state.context, 'new-account');
});
test('server failure never silently downgrades an account to a local demo cart', async () => {
  const { client } = fixture({ '/api/cart': () => Response.json({ error: 'Unavailable' }, { status: 503 }) });
  await client.load(); assert.equal(client.state.mode, 'unavailable'); assert.deepEqual(client.state.cart, {});
});
test('stale version reloads authoritative cart without automatically retrying the write', async () => {
  let writes = 0;
  const { client } = fixture({ '/api/cart': options => {
    if (options.method === 'PUT') { writes++; return Response.json({ error: 'Cart changed' }, { status: 409 }); }
    return ok({ cart: cart(writes ? 5 : 1), context: 'same-account' });
  } });
  await client.load(); await assert.rejects(() => client.replace({ thali: 2 }));
  assert.equal(writes, 1); assert.equal(client.state.cart.thali, 5);
});
