import { catalogHandlers } from '@/lib/server/catalog-http.mjs';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const POST=catalogHandlers.create;
export const PUT=catalogHandlers.update;
export const DELETE=catalogHandlers.remove;
