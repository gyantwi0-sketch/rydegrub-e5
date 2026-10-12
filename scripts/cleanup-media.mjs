import { MediaStore } from '../lib/server/media-store.mjs';
let store;
try {
  store = new MediaStore(process.env.MEDIA_DATA_DIR);
  console.log(JSON.stringify({ removed: store.cleanup() }));
} catch {
  console.error('Media cleanup failed. Check storage configuration and permissions.');
  process.exitCode = 1;
} finally { store?.close(); }

