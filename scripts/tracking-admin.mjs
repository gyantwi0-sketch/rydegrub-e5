import { openSync, fstatSync, readFileSync, closeSync } from 'node:fs';
import { applyTrackingEvent } from '../lib/server/tracking-admin.mjs';
import { TrackingStore } from '../lib/server/tracking-store.mjs';

let store;
let fd;
try {
  const [operation, inputPath, ...extra] = process.argv.slice(2);
  if (extra.length || (operation !== 'cleanup' && !inputPath) || (operation === 'cleanup' && inputPath)) throw new Error();
  let input = {};
  if (inputPath) {
    fd = openSync(inputPath, 'r');
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > 4096) throw new Error();
    input = JSON.parse(readFileSync(fd, 'utf8'));
  }
  store = new TrackingStore(process.env.TRACKING_DATA_DIR);
  const result = applyTrackingEvent(store, process.env.TRACKING_TOKEN_ISSUER, operation, input);
  console.log(JSON.stringify(result));
} catch {
  console.error('Tracking operation failed. Check configuration, input schema and expected version.');
  process.exitCode = 1;
} finally { if (fd !== undefined) closeSync(fd); store?.close(); }
