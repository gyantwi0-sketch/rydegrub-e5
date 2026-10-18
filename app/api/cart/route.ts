import { commerce } from '@/lib/server/commerce-http.mjs';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = commerce.readCart;
export const PUT = commerce.replaceCart;
