import { profileHandlers } from '@/lib/server/profile-http.mjs';
import { products } from '@/lib/rydegrub';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = profileHandlers({ catalog: () => products }).recommendations;
