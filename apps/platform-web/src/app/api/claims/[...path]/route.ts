import type { NextRequest } from 'next/server';
import { CLAIMS_SERVICE_URL, proxyToBackend } from '@/lib/backend-proxy';

type RouteContext = { params: Promise<{ path: string[] }> };

async function handle(request: NextRequest, context: RouteContext) {
  const { path } = await context.params;
  return proxyToBackend(request, CLAIMS_SERVICE_URL, path);
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const DELETE = handle;
