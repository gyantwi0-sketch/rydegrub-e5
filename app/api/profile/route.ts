import { profile } from '@/lib/server/profile-http.mjs';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = profile.read;
export const PATCH = profile.update;
