import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Metrics } from '../lib/server/metrics.mjs';
import { operationsHandlers,dependencyReadiness } from '../lib/server/operations-http.mjs';
import { MediaStore } from '../lib/server/media-store.mjs';
import { ProfileStore } from '../lib/server/profile-store.mjs';
import { TrackingStore } from '../lib/server/tracking-store.mjs';

test('metric labels are bounded and never serialize unknown/user-supplied values',()=>{
  const m=new Metrics();m.request('profile','read',200,120);m.request('profile','read',503,500);
  m.request('profile','private@example.com',200,1);m.request('secret','read',200,1);m.provider('sms','POST','unavailable',100);
  m.provider('sms','POST','raw-pnr-1234567890',100);m.limit('limited');m.limit('Bearer secret');m.payment('captured');m.queue('notifications',4,150);
  const text=m.render();assert.match(text,/ryde_http_requests_total\{service="profile",operation="read",status="2xx"\} 1/);
  assert.match(text,/le="\+Inf"\} 1/);assert.match(text,/ryde_queue_depth\{queue="notifications"\} 4/);
  assert.ok(text.endsWith('\n'));assert.doesNotMatch(text,/private@|raw-pnr|Bearer|secret/);
});
test('liveness works during outage; readiness coalesces checks, expires, and never exposes errors',async()=>{
  let time=0,calls=0,healthy=false;const metrics=new Metrics();
  const api=operationsHandlers({env:()=>({}),metrics,now:()=>time,check:async()=>{calls++;await Promise.resolve();if(!healthy)throw new Error('password=hidden');return true;}});
  assert.equal((await api.live(new Request('https://app.test/api/health/live'))).status,200);
  const results=await Promise.all([api.ready(new Request('https://app.test/api/health/ready')),api.ready(new Request('https://app.test/api/health/ready'))]);
  assert.equal(calls,1);assert.equal(results[0].status,503);assert.equal(await results[0].text(),'{"status":"unavailable"}');
  healthy=true;time=2100;assert.equal((await api.ready(new Request('https://app.test/api/health/ready'))).status,200);assert.equal(metrics.ready,1);
});
test('metrics require private bearer token and reject query credentials',async()=>{
  const token='test-token-32-characters-minimum-value';const metrics=new Metrics();
  const api=operationsHandlers({env:()=>({OPERATIONS_METRICS_TOKEN:token}),check:async()=>true,metrics});
  assert.equal((await api.metrics(new Request('https://app.test/api/operations/metrics'))).status,401);
  assert.equal((await api.metrics(new Request(`https://app.test/api/operations/metrics?token=${token}`))).status,400);
  const r=await api.metrics(new Request('https://app.test/api/operations/metrics',{headers:{Authorization:`Bearer ${token}`}}));
  assert.equal(r.status,200);assert.match(r.headers.get('content-type'),/version=0.0.4/);assert.match(await r.text(),/ryde_ready 1/);
  assert.equal((await operationsHandlers({env:()=>({})}).metrics(new Request('https://app.test'))).status,503);
});
test('readiness checks real local schemas and fails on missing or unsupported databases',async t=>{
  const root=mkdtempSync(join(tmpdir(),'ryde-ready-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const {publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
  const env={NODE_ENV:'test',PROFILE_OTP_PEPPER:'a-secure-test-pepper-with-32-characters'};
  for(const prefix of ['MEDIA','PROFILE','TRACKING']) Object.assign(env,{[`${prefix}_APP_ORIGIN`]:'https://app.test',[`${prefix}_TOKEN_ISSUER`]:'https://issuer.test',[`${prefix}_TOKEN_AUDIENCE`]:prefix,[`${prefix}_TOKEN_PUBLIC_KEY`]:publicKey.export({type:'spki',format:'pem'}),[`${prefix}_DATA_DIR`]:join(root,prefix)});
  await assert.rejects(dependencyReadiness(env));
  const media=new MediaStore(env.MEDIA_DATA_DIR),profile=new ProfileStore(env.PROFILE_DATA_DIR),tracking=new TrackingStore(env.TRACKING_DATA_DIR);
  t.after(()=>{media.close();profile.close();tracking.close();});
  assert.equal(await dependencyReadiness(env),true);
  profile.db.exec('UPDATE security_audit_meta SET version=999');await assert.rejects(dependencyReadiness(env));
  profile.db.exec('UPDATE security_audit_meta SET version=1');
  profile.db.exec('PRAGMA user_version=999');await assert.rejects(dependencyReadiness(env));
});
