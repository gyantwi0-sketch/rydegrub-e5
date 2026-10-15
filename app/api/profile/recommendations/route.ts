import { profileHandlers } from '@/lib/server/profile-http.mjs';
import { readCatalog } from '@/lib/server/catalog-http.mjs';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = profileHandlers({ catalog: () => readCatalog().list() }).recommendations;
