import type { NextRequest } from 'next/server';
import { AUTH_SERVICE_URL, proxyToBackend } from '@/lib/backend-proxy';

type RouteContext = { params: Promise<{ path: string[] }> };

async function handle(request: NextRequest, context: RouteContext) {
  const { path } = await context.params;
  return proxyToBackend(request, AUTH_SERVICE_URL, ['auth', ...path]);
}

export const GET = handle;
export const POST = handle;
