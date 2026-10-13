import { tracking } from '@/lib/server/tracking-http.mjs';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  return tracking.read(request, (await context.params).id);
}
export async function POST(request: Request, context: Context) {
  return tracking.readWithCode(request, (await context.params).id);
}
