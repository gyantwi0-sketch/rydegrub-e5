import assert from 'node:assert/strict';
import test from 'node:test';
import { AccessError } from '../lib/server/scoped-auth.mjs';
import { boundedJsonObject, exactObjectFields, rejectQuery } from '../lib/server/request-validation.mjs';

const base = 'https://app.example/api/profile';
const request = (body, headers = {}) => new Request(base, {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...headers },
  ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
});
const read = (req, extra = {}) => boundedJsonObject(req, {
  ErrorType: AccessError,
  maxBytes: 128,
  allowedFields: ['name'],
  ...extra,
});
test('query and object guards reject unexpected data and prevent prototype-pollution fields', () => {
  assert.equal(rejectQuery(new Request(base), AccessError), undefined);
  for (const url of [base + '?token=secret', base + '?x=', base + '?pnr=1234567890']) {
    assert.throws(() => rejectQuery(new Request(url), AccessError), { status: 400 });
  }
  assert.deepEqual(exactObjectFields({ name: 'Alice' }, ['name'], AccessError), { name: 'Alice' });
  for (const input of [null, [], {}, { name: 'Alice', owner: 'spoofed' },
    JSON.parse('{"name":"Alice","__proto__":{"role":"admin"}}')]) {
    assert.throws(() => exactObjectFields(input, ['name'], AccessError), { status: 400 });
  }
});
test('bounded JSON rejects missing, incorrect content types, malformed and unexpected fields', async () => {
  for (const req of [
    request(undefined), request(''), request('not-json'),
    request('[]'), request('null'), request({ name: 'Alice', admin: true }),
    request({ name: 'Alice' }, { 'content-type': 'text/plain' }),
    request({ name: 'Alice' }, { 'content-length': '999' }),
    request({ name: 'Alice' }, { 'content-length': '1' }),
  ]) await assert.rejects(read(req), { status: 400 });
  assert.deepEqual(await read(request({ name: 'Alice' })), { name: 'Alice' });
});
test('stream limits actual received bytes with missing or fraudulent Content-Length', async () => {
  let canceled = false;
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(128));
      controller.enqueue(new Uint8Array(1));
    },
    cancel() { canceled = true; },
  });
  const req = new Request(base, {
    method: 'POST', body: stream, duplex: 'half',
    headers: { 'content-type': 'application/json' },
  });
  await assert.rejects(read(req), { status: 400 });
  assert.equal(canceled, true);
});
test('slow streaming requests are bounded by timeout, not just declared length', async () => {
  let cancelCount = 0;
  const stream = new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode('{"name":')); },
    cancel() { cancelCount++; },
  });
  const req = new Request(base, {
    method: 'POST', duplex: 'half', body: stream,
    headers: { 'content-type': 'application/json' },
  });
  await assert.rejects(read(req, { timeoutMs: 30 }), { status: 400 });
  assert.equal(cancelCount, 1);
});
test('reject invalid server body limit config before consuming client request', async () => {
  await assert.rejects(read(request({ name: 'Alice' }), { maxBytes: -1 }), /Invalid server body-limit/);
});
