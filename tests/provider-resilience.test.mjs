import test from 'node:test';
import assert from 'node:assert/strict';
import { ProviderCircuit, providerRequest } from '../lib/server/provider-resilience.mjs';
import { sendPhoneCode } from '../lib/server/profile-http.mjs';

const service = { provider: 'sms', url: 'https://sms.example/api/send' };

test('read-only GET retries transient failures with bounded backoff', async () => {
  let calls = 0;
  const delays = [], entries = [];
  const result = await providerRequest({
    ...service, method: 'GET', circuit: new ProviderCircuit(),
    fetchImpl: async (_url, options) => {
      assert.equal(options.redirect, 'error');
      assert.ok(options.signal instanceof AbortSignal);
      calls++;
      return new Response(null, { status: calls < 3 ? 503 : 200 });
    },
    sleep: async ms => { delays.push(ms); },
    logger: entry => entries.push(JSON.parse(entry)),
  });
  assert.equal(result.status, 200);
  assert.equal(calls, 3);
  assert.deepEqual(delays, [100, 200]);
  assert.equal(entries[0].outcome, 'ok');
  assert.equal(entries[0].attempts, 3);
});
test('writes never retry and telemetry does not expose provider payload', async () => {
  let calls = 0;
  const entries = [];
  const marker = 'dummy-fixture-value';
  await assert.rejects(providerRequest({
    ...service, method: 'POST', body: JSON.stringify({ value: marker }),
    circuit: new ProviderCircuit(),
    fetchImpl: async () => { calls++; return new Response(marker, { status: 503 }); },
    logger: entry => entries.push(entry),
  }), { status: 503 });
  assert.equal(calls, 1);
  assert.equal(entries[0].includes(marker), false);
  assert.equal(JSON.parse(entries[0]).attempts, 1);
});
test('open circuit blocks calls and recovery probe resets it', async () => {
  const circuit = new ProviderCircuit({ threshold: 2, cooldownMs: 1000 });
  let clock = 1000, calls = 0, healthy = false;
  const opts = () => ({
    ...service, method: 'POST', circuit, now: () => clock, logger: () => {},
    fetchImpl: async () => { calls++; return new Response(null, { status: healthy ? 202 : 503 }); },
  });
  for (let i = 0; i < 2; i++) await assert.rejects(providerRequest(opts()), { status: 503 });
  assert.equal(circuit.state(clock), 'open');
  await assert.rejects(providerRequest(opts()), { status: 503 });
  assert.equal(calls, 2);
  clock = 2100;
  healthy = true;
  assert.equal((await providerRequest(opts())).status, 202);
  assert.equal(circuit.state(clock), 'closed');
});
test('untrusted outbound targets and unsafe requests fail before network', async () => {
  const invalid = [
    { ...service, provider: 'unknown' },
    { ...service, url: 'http://sms.example/api/send' },
    { ...service, url: 'https://sms.example/api/send?param=1' },
    { ...service, method: 'DELETE' },
    { ...service, body: 'disallowed-get-body' },
    { ...service, timeoutMs: 100_000 },
  ];
  for (const config of invalid) {
    await assert.rejects(providerRequest({
      ...config, fetchImpl: async () => { throw new Error('unexpected network'); }, logger: () => {},
    }), { status: 503 });
  }
});
test('SMS provider bridge is a single POST and maps failures safely', async () => {
  const config = { smsUrl: service.url, smsKey: 'dummy-test-key' };
  let forwarded;
  await sendPhoneCode(config, '9876543210', '12345678', async input => {
    forwarded = input;
    return new Response(null, { status: 202 });
  });
  assert.equal(forwarded.method, 'POST');
  assert.equal(forwarded.provider, 'sms');
  assert.equal(JSON.parse(forwarded.body).to, '+919876543210');
  await assert.rejects(sendPhoneCode(config, '9876543210', '12345678',
    async () => { throw new Error('upstream issue'); }), { status: 503 });
});
