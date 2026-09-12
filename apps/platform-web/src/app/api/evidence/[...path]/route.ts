import type { NextRequest } from 'next/server';
import { EVIDENCE_SERVICE_URL, proxyToBackend } from '@/lib/backend-proxy';

type RouteContext = { params: Promise<{ path: string[] }> };

async function handle(request: NextRequest, context: RouteContext) {
  const { path } = await context.params;
  return proxyToBackend(request, EVIDENCE_SERVICE_URL, path);
}

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
