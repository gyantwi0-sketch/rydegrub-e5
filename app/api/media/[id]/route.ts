import { media } from '@/lib/server/media-http.mjs';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  return media.remove(request, (await context.params).id);
}

