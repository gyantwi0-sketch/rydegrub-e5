import { profile } from '@/lib/server/profile-http.mjs';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = profile.personalization;
export const PATCH = profile.savePersonalization;
export const DELETE = profile.resetPersonalization;
