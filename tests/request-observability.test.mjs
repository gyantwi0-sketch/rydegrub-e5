import assert from 'node:assert/strict';
import test from 'node:test';
import { AccessError } from '../lib/server/scoped-auth.mjs';
import { completeRequest, requestTrace, safeError } from '../lib/server/request-observability.mjs';
import { mediaHandlers } from '../lib/server/media-http.mjs';
import { trackingHandlers } from '../lib/server/tracking-http.mjs';
import { profileHandlers } from '../lib/server/profile-http.mjs';

test('request identifiers are server-generated and unique with safe structured fields', () => {
  const first = requestTrace('media', 'upload', 1000);
  const second = requestTrace('media', 'upload', 1000);
  assert.match(first.requestId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.notEqual(first.requestId, second.requestId);
  assert.throws(() => requestTrace('media', 'pnr=1234567890'));
  assert.throws(() => requestTrace('secret-service', 'upload'));

  const logs = [];
  const response = completeRequest(new Response('ok', { status: 200 }), first, value => logs.push(value), 1034);
  assert.equal(response.headers.get('X-Request-ID'), first.requestId);
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  assert.equal(response.headers.get('Referrer-Policy'), 'no-referrer');
  assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.deepEqual(JSON.parse(logs[0]), {
    event: 'http_request', requestId: first.requestId, service: 'media',
    operation: 'upload', status: 200, durationMs: 34,
  });
  assert.equal(completeRequest(new Response(null, { status: 204 }), second, () => { throw new Error('logging down'); }).status, 204);
});
test('safe error envelope preserves approved errors and hides unknown internal failure', () => {
  assert.deepEqual(safeError(new AccessError(404, 'Tracking is unavailable.'), AccessError, 'Unavailable'), {
    status: 404, body: { error: 'Tracking is unavailable.' },
  });
  assert.deepEqual(safeError(new Error('PRIVATE KEY=should-not-leak'), AccessError, 'Service unavailable.'), {
    status: 503, body: { error: 'Service unavailable.' },
  });
  assert.equal(safeError(new AccessError(200, 'wrong'), AccessError, 'Unavailable').status, 503);
});
test('media, tracking, and profile APIs correlate safely without reflecting attacker-supplied data', async () => {
  const secret = 'raw-pnr-1234567890-cookie-token-secret';
  const responseLog = [];
  const logger = data => responseLog.push(JSON.parse(data));
  const request = new Request('https://app.test/api/media?pnr=1234567890', {
    headers: { cookie: secret, 'x-request-id': secret, authorization: secret },
  });
  const api = [
    mediaHandlers({ getConfig: () => { throw new Error(secret); }, logger }).current,
    trackingHandlers({ config: () => { throw new Error(secret); }, logger }).list,
    profileHandlers({ config: () => { throw new Error(secret); }, logger }).read,
  ];
  const responses = await Promise.all(api.map(fn => fn(request)));
  assert.equal(responseLog.length, 3);
  const ids = new Set();
  for (let i = 0; i < responses.length; i++) {
    const result = responses[i];
    assert.equal(result.status, 503);
    assert.equal(result.headers.get('Cache-Control'), 'private, no-store');
    assert.notEqual(result.headers.get('x-request-id'), secret);
    assert.match(result.headers.get('x-request-id'), /^[0-9a-f-]{36}$/);
    ids.add(result.headers.get('x-request-id'));
    assert.equal(JSON.stringify(await result.json()).includes(secret), false);
    assert.equal(responseLog[i].status, 503);
  }
  assert.equal(ids.size, 3);
  assert.equal(JSON.stringify(responseLog).includes(secret), false);
  for (const record of responseLog) {
    assert.deepEqual(Object.keys(record).sort(), ['durationMs', 'event', 'operation', 'requestId', 'service', 'status']);
  }
});
