import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { MemoryLimiter, RedisLimiter, RateLimitError, configuredLimiter } from '../lib/server/rate-limit.mjs';
import { clientBucket, serviceLimits, serviceLimitConfig } from '../lib/server/service-limits.mjs';
import { mediaHandlers } from '../lib/server/media-http.mjs';
import { profileHandlers } from '../lib/server/profile-http.mjs';
import { trackingHandlers } from '../lib/server/tracking-http.mjs';
const secret = 'random-test-secret-with-at-least-32-characters';
const owner = 'a'.repeat(64);
test('distributed decisions share a backend across independent limiter clients', async () => {
  let counter = 0; const seen = [];
  const backend = async (_url, options) => {
    const command = JSON.parse(options.body); seen.push(command);
    assert.equal(command[0], 'EVAL'); assert.match(command[1], /INCR/); assert.match(command[1], /PEXPIRE/);
    return Response.json({result:[++counter,1500]});
  };
  const a = new RedisLimiter({url:'https://redis.example',token:'private',fetchImpl:backend,logger:()=>{}});
  const b = new RedisLimiter({url:'https://redis.example',token:'private',fetchImpl:backend,logger:()=>{}});
  await a.consume('shared:test',2,2000); await b.consume('shared:test',2,2000);
  await assert.rejects(a.consume('shared:test',2,2000), e=>e.status===429&&e.retryAfter===2);
  assert.equal(seen[0][3], seen[1][3]);
});
test('production refuses memory fallback even after development cache initialization and reloads rotated configuration', () => {
  assert.ok(configuredLimiter({NODE_ENV:'development'}) instanceof MemoryLimiter);
  assert.throws(()=>configuredLimiter({NODE_ENV:'production'}),{status:503});
  const a=configuredLimiter({NODE_ENV:'production',RATE_LIMIT_REDIS_URL:'https://redis.example',RATE_LIMIT_REDIS_TOKEN:'first'});
  const b=configuredLimiter({NODE_ENV:'production',RATE_LIMIT_REDIS_URL:'https://redis.example',RATE_LIMIT_REDIS_TOKEN:'second'});
  assert.notEqual(a,b);assert.equal(b.token,'second');
  assert.throws(()=>serviceLimitConfig({NODE_ENV:'production'}),{status:503});
});
test('untrusted forwarded headers cannot create new buckets; configured single-IP header uses HMAC', () => {
  const a=new Request('https://app.test',{headers:{'x-forwarded-for':'1.2.3.4'}});
  const b=new Request('https://app.test',{headers:{'x-forwarded-for':'5.6.7.8'}});
  assert.equal(clientBucket(a,{secret}),clientBucket(b,{secret}));
  const cfg={secret,ipHeader:'x-ingress-ip'};
  assert.notEqual(clientBucket(new Request('https://app.test',{headers:{'x-ingress-ip':'1.2.3.4'}}),cfg),clientBucket(new Request('https://app.test',{headers:{'x-ingress-ip':'5.6.7.8'}}),cfg));
  assert.equal(clientBucket(new Request('https://app.test',{headers:{'x-ingress-ip':'1.2.3.4, 5.6.7.8'}}),cfg),clientBucket(a,cfg));
});
test('service/action quotas expire and never put phone or owner identifiers into keys', async () => {
  let now=1000;const memory=new MemoryLimiter({now:()=>now}),keys=[];
  const limits=serviceLimits({config:()=>({secret}),limiter:()=>({consume:async(key,...args)=>{keys.push(key);return memory.consume(key,...args);}})});
  await limits.action('profile','phone','9876543210',1,1000);
  await assert.rejects(limits.action('profile','phone','9876543210',1,1000),{status:429});
  now=2000;await limits.action('profile','phone','9876543210',1,1000);await limits.owner('media',owner);
  assert.ok(keys.every(k=>!k.includes('9876543210')&&!k.includes(owner)));
});
test('all service wrappers reject limiter outage before touching stores and return exact Retry-After', async () => {
  for (const failure of [new RateLimitError(503), new RateLimitError(429,37)]) {
    const limits={before:async()=>{throw failure;}};
    const APIs=[mediaHandlers({limits,logger:()=>{}}).current,profileHandlers({limits,logger:()=>{}}).read,trackingHandlers({limits,logger:()=>{}}).list];
    for(const api of APIs){const r=await api(new Request('https://app.test'));assert.equal(r.status,failure.status);if(failure.status===429)assert.equal(r.headers.get('retry-after'),'37');assert.match(r.headers.get('cache-control'),/no-store/);}
  }
});
test('valid authenticated profile uses admission and owner quotas before data access', async () => {
  const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
  const config={origin:'https://app.test',issuer:'https://issuer.test',audience:'profile',key:publicKey};
  const now=Math.floor(Date.now()/1000),parts=[{alg:'RS256',typ:'JWT'},{iss:config.issuer,aud:config.audience,sub:'alice',scope:'profile:manage',iat:now,exp:now+300}].map(v=>Buffer.from(JSON.stringify(v)).toString('base64url'));
  const token=[...parts,sign('RSA-SHA256',Buffer.from(parts.join('.')),privateKey).toString('base64url')].join('.');
  const calls=[];
  const api=profileHandlers({config:()=>config,limits:{before:async()=>calls.push('admission'),owner:async()=>calls.push('owner')},store:()=>({limit:()=>{},read:()=>{calls.push('read');return {};}}),logger:()=>{}});
  const r=await api.read(new Request('https://app.test/api/profile',{headers:{cookie:`__Host-ryde-profile=${token}`}}));
  assert.equal(r.status,200);assert.deepEqual(calls,['admission','owner','read']);
});
