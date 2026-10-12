import { media } from '@/lib/server/media-http.mjs';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: { params: Promise<{ id: string; variant: string }> }) {
  const { id, variant } = await context.params;
  return media.read(request, id, variant);
}

