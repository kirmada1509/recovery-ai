import { NextResponse, type NextRequest } from 'next/server';

/**
 * Forwards a request to a backend service unchanged, including cookies in
 * both directions. This is the only thing that talks to auth-service /
 * identity-service directly — the browser only ever calls same-origin
 * `/api/...` routes, so there is no cross-origin cookie or CORS story to get
 * wrong (plan Section 14.1).
 */
export async function proxyToBackend(
  request: NextRequest,
  backendBaseUrl: string,
  pathSegments: string[],
): Promise<NextResponse> {
  const targetUrl = new URL(`/v1/${pathSegments.join('/')}`, backendBaseUrl);
  targetUrl.search = request.nextUrl.search;

  const forwardedHeaders = new Headers();
  const authorization = request.headers.get('authorization');
  if (authorization) forwardedHeaders.set('authorization', authorization);
  const cookie = request.headers.get('cookie');
  if (cookie) forwardedHeaders.set('cookie', cookie);
  const contentType = request.headers.get('content-type');
  if (contentType) forwardedHeaders.set('content-type', contentType);
  forwardedHeaders.set('x-request-id', crypto.randomUUID());

  const hasBody = !['GET', 'HEAD'].includes(request.method);
  const backendResponse = await fetch(targetUrl, {
    method: request.method,
    headers: forwardedHeaders,
    body: hasBody ? await request.text() : undefined,
    redirect: 'manual',
  });

  const responseHeaders = new Headers();
  const responseContentType = backendResponse.headers.get('content-type');
  if (responseContentType) responseHeaders.set('content-type', responseContentType);
  // `getSetCookie` preserves multiple Set-Cookie headers, which `get` would
  // collapse into one — the refresh cookie must survive this hop untouched.
  // Its `Path` is scoped to auth-service's own route space (e.g. `/v1/auth`),
  // which means nothing on this origin — rewrite it to the matching `/api/...`
  // prefix the browser will actually re-request, or the cookie is set once
  // and never sent back.
  for (const setCookie of backendResponse.headers.getSetCookie()) {
    responseHeaders.append('set-cookie', setCookie.replace(/Path=\/v1\//i, 'Path=/api/'));
  }

  const body = await backendResponse.text();
  return new NextResponse(body, { status: backendResponse.status, headers: responseHeaders });
}

export const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL ?? 'http://localhost:3001';
export const IDENTITY_SERVICE_URL = process.env.IDENTITY_SERVICE_URL ?? 'http://localhost:3002';
