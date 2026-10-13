import { catalogHandlers } from '@/lib/server/catalog-http.mjs';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const GET=catalogHandlers.list;
