import { timingSafeEqual } from 'node:crypto';
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { checkEnvironment } from '../../scripts/check-env.mjs';
import { configuredLimiter } from './rate-limit.mjs';
import { metrics as productionMetrics } from './metrics.mjs';

const HEADERS = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
export async function dependencyReadiness(env = process.env) {
  checkEnvironment(env);
  const files = [['MEDIA_DATA_DIR','media.sqlite','media',1],['PROFILE_DATA_DIR','profile.sqlite','profiles',1],['TRACKING_DATA_DIR','tracking.sqlite','orders',2]];
  if (env.ACCOUNT_APP_ORIGIN) files.push(['ACCOUNT_DATA_DIR','accounts.sqlite','members',1]);
  if (env.DOMAIN_DATA_DIR) files.push(['DOMAIN_DATA_DIR','domain.sqlite','accounts',3]);
  if (env.CATALOG_DATA_DIR) files.push(['CATALOG_DATA_DIR','catalog.sqlite','products',1]);
  for (const [variable,filename,table,version] of files) {
    const path = join(env[variable], filename);
    if (!statSync(path).isFile()) throw new Error('Dependency unavailable.');
    const db = new DatabaseSync(path);
    try {
      if (db.prepare('PRAGMA user_version').get().user_version !== version ||
          !db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table)) throw new Error('Dependency unavailable.');
      if ((!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='security_audit_meta'").get() ||
          db.prepare('SELECT version FROM security_audit_meta WHERE singleton=1').get()?.version !== 1)) throw new Error('Dependency unavailable.');
      db.exec('PRAGMA busy_timeout=100; BEGIN IMMEDIATE; SELECT 1; ROLLBACK;');
    }
    finally { db.close(); }
  }
  // Uses a separate non-customer key and verifies the exact atomic limiter path.
  await configuredLimiter(env).consume('operations:readiness', 1000000, 60000);
  return true;
}
export function operationsHandlers({ env = () => process.env, check = dependencyReadiness, metrics = productionMetrics, now = Date.now } = {}) {
  let cached = null, expires = 0, pending;
  const response = (body,status=200) => Response.json(body,{status,headers:HEADERS});
  const invalid = req => req.method !== 'GET' || new URL(req.url).search;
  async function readiness() {
    if (cached !== null && now() < expires) return cached;
    if (!pending) pending = (async () => {
      try { cached = (await check(env())) === true; } catch { cached = false; }
      metrics.ready = cached ? 1 : 0; expires = now() + 2000;
      return cached;
    })().finally(() => { pending = undefined; });
    return pending;
  }
  return {
    live: async req => invalid(req) ? response({error:'Invalid request.'},400) : response({status:'alive'}),
    ready: async req => {
      if (invalid(req)) return response({error:'Invalid request.'},400);
      const healthy = await readiness();
      return response({status:healthy?'ready':'unavailable'},healthy?200:503);
    },
    metrics: async req => {
      if (invalid(req)) return response({error:'Invalid request.'},400);
      const token = env().OPERATIONS_METRICS_TOKEN;
      if (typeof token !== 'string' || token.length < 32 || token.length > 512) return response({error:'Metrics unavailable.'},503);
      const supplied = /^Bearer ([A-Za-z0-9._~-]{32,512})$/.exec(req.headers.get('authorization') ?? '')?.[1] ?? '';
      const a=Buffer.from(supplied),b=Buffer.from(token);
      if (a.length !== b.length || !timingSafeEqual(a,b)) return response({error:'Authorization required.'},401);
      await readiness();
      return new Response(metrics.render(),{headers:{...HEADERS,'Content-Type':'text/plain; version=0.0.4; charset=utf-8'}});
    },
  };
}
export const operations = operationsHandlers();
