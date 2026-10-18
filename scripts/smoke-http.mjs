import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';

// Test the actual compiled routes without live credentials or customer data.
const probe = createServer();
await new Promise((resolve,reject) => probe.once('error',reject).listen(0,'127.0.0.1',resolve));
const port = probe.address().port;
await new Promise(resolve => probe.close(resolve));
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(ACCOUNT_|PROFILE_|MEDIA_|TRACKING_|CATALOG_|DOMAIN_|RATE_LIMIT_|OPERATIONS_)/.test(key)));
const child = spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',String(port)],{env:{...env,NODE_ENV:'production',NEXT_TELEMETRY_DISABLED:'1'},stdio:'ignore'});
let exit = false; child.on('exit',()=>{exit=true;}); child.on('error',()=>{exit=true;});
const base = `http://127.0.0.1:${port}`;
const get = (path,options={}) => fetch(base+path,{...options,signal:AbortSignal.timeout(3000)});
try {
  let ready = false;
  for(let i=0;i<150&&!exit;i++) {
    try { if((await get('/api/health/live')).status===200){ready=true;break;} } catch { /* starting */ }
    await new Promise(resolve=>setTimeout(resolve,200));
  }
  assert.ok(ready,'Compiled server did not start.');
  const live=await get('/api/health/live'); assert.deepEqual(await live.json(),{status:'alive'});
  assert.match(live.headers.get('cache-control'),/no-store/);
  const readiness=await get('/api/health/ready');assert.equal(readiness.status,503);assert.deepEqual(await readiness.json(),{status:'unavailable'});
  for(const path of ['/api/cart','/api/cart/quote','/api/orders/drafts/not-an-id','/api/profile','/api/profile/personalization','/api/profile/recommendations','/api/media','/api/orders/tracking','/api/operations/metrics','/api/v1/auth/session']){
    const response=await get(path);assert.equal(response.status,503,`${path} must fail closed without configuration`);
    assert.match(response.headers.get('cache-control'),/no-store/);
  }
  const catalog=await get('/api/catalog'); assert.equal(catalog.status,200); assert.equal((await catalog.json()).mode,'demo');
  const search=await get('/api/catalog/search?q=rice&limit=2'); assert.equal(search.status,200); assert.ok((await search.json()).products.length<=2);
  const admin=await get('/api/admin/catalog',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}); assert.equal(admin.status,503);
  const signup=await get('/api/v1/auth/register',{method:'POST',headers:{'Content-Type':'application/json',Origin:base},body:JSON.stringify({email:'fixture@example.test',name:'Test User',password:'not-a-real-password-fixture'})});
  assert.equal(signup.status,503);
  process.stdout.write('Compiled HTTP smoke checks passed: liveness, readiness and fail-closed private routes.\n');
} finally {
  if(!exit){const ended=once(child,'exit');child.kill('SIGTERM');const timer=setTimeout(()=>child.kill('SIGKILL'),5000);await ended;clearTimeout(timer);}
}

