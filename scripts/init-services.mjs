import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkEnvironment } from './check-env.mjs';
import { AccountStore } from '../lib/server/account-store.mjs';
import { DomainStore } from '../lib/server/domain-store.mjs';
import { MediaStore } from '../lib/server/media-store.mjs';
import { ProfileStore } from '../lib/server/profile-store.mjs';
import { TrackingStore } from '../lib/server/tracking-store.mjs';

export async function initializeServices(env = process.env) {
  checkEnvironment(env);
  const services = [[MediaStore, env.MEDIA_DATA_DIR], [ProfileStore, env.PROFILE_DATA_DIR], [TrackingStore, env.TRACKING_DATA_DIR]];
  if (env.ACCOUNT_APP_ORIGIN) services.push([AccountStore, env.ACCOUNT_DATA_DIR]);
  if (env.DOMAIN_DATA_DIR) services.push([DomainStore, env.DOMAIN_DATA_DIR]);
  // Catalog is delivered by the separate catalog branch. Only initialize it
  // when explicitly configured and its implementation is installed.
  if (env.CATALOG_DATA_DIR) {
    const { CatalogStore } = await import('../lib/server/catalog-store.mjs');
    services.push([CatalogStore, env.CATALOG_DATA_DIR]);
  }
  for (const [Store,dir] of services) { const store = new Store(dir); if (store.close) store.close(); else store.db.close(); }
  return services.length;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await initializeServices(); process.stdout.write('Configured service schemas initialized.\n'); }
  catch { process.stderr.write('Service initialization failed. Check private storage and schema compatibility.\n'); process.exitCode = 1; }
}
