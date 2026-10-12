import { tracking } from '@/lib/server/tracking-http.mjs';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };
export async function POST(request: Request, context: Context) {
  return tracking.issueCode(request, (await context.params).id);
}
export async function DELETE(request: Request, context: Context) {
  return tracking.revokeCode(request, (await context.params).id);
}
