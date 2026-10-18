import { guest } from '@/lib/server/guest-http.mjs';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = guest.read;
export const POST = guest.create;
export const PUT = guest.replace;
export const DELETE = guest.remove;
