import { afterAll, afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { createLogger } from '@recoveryai/observability-ts';
import { createServiceApp } from '@recoveryai/service-runtime';
import { SignJWT } from 'jose';
import { loadConfig } from '../src/config.ts';
import { createDatabase } from '../src/db/client.ts';
import { policies } from '../src/db/schema.ts';
import { policiesRoutes } from '../src/routes/policies.routes.ts';

const env = {
  PORT: '3003',
  DATABASE_URL:
    process.env.TEST_DATABASE_URL ??
    'postgres://recoveryai:recoveryai@localhost:5432/recoveryai_claims',
  LOG_LEVEL: 'fatal',
  JWT_SECRET: 'integration-test-secret-at-least-32-characters',
  INTERNAL_SERVICE_SECRET: 'integration-test-internal-secret-20',
};

const config = loadConfig(env);
const db = createDatabase(config.DATABASE_URL);
const logger = createLogger({
  service: 'claims-service',
  environment: 'test',
  level: 'fatal',
  pretty: false,
});

function buildApp() {
  return createServiceApp({
    config,
    logger,
    readiness: { run: async () => ({ ready: true, checks: [] }) } as never,
    plugins: [policiesRoutes({ db, config })],
  });
}

async function accessTokenFor(userId: string): Promise<string> {
  const secretKey = new TextEncoder().encode(config.JWT_SECRET);
  return new SignJWT({ role: 'victim', session_id: crypto.randomUUID(), token_version: 1 })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setIssuer(config.JWT_ISSUER)
    .setAudience(config.JWT_AUDIENCE)
    .setExpirationTime('15m')
    .sign(secretKey);
}

const USER_A = '11111111-1111-1111-1111-111111111111';
const USER_B = '22222222-2222-2222-2222-222222222222';
const DOCUMENT_ID = '33333333-3333-3333-3333-333333333333';

/**
 * The evidence-document-ownership check is a real HTTP call to
 * evidence-service (CLAUDE.md invariant 2 — no cross-service DB reads). This
 * test stubs `fetch` at the boundary rather than standing up a second
 * service, which is the standard way to test an HTTP client without
 * reimplementing the callee; the real end-to-end wiring is verified manually
 * against the live stack (see IMPLEMENTATION_STATUS.md).
 */
const originalFetch = globalThis.fetch;

function stubEvidenceService(behavior: 'owned-ready' | 'not-found' | 'not-ready') {
  globalThis.fetch = mock(async (input: string | URL | Request) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (!url.includes(`/v1/documents/${DOCUMENT_ID}`)) {
      throw new Error(`unexpected fetch to ${url}`);
    }
    if (behavior === 'not-found') return new Response(null, { status: 404 });
    return new Response(
      JSON.stringify({
        document: {
          id: DOCUMENT_ID,
          documentType: 'policy',
          uploadStatus: behavior === 'owned-ready' ? 'ready' : 'pending',
        },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }) as unknown as typeof fetch;
}

beforeEach(async () => {
  await db.delete(policies);
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

afterAll(async () => {
  await db.delete(policies);
  globalThis.fetch = originalFetch;
});

describe('claims-service policies', () => {
  it('creates a policy once the referenced document is confirmed owned and ready', async () => {
    stubEvidenceService('owned-ready');
    const app = buildApp();
    const token = await accessTokenFor(USER_A);

    const response = await app.handle(
      new Request('http://localhost/v1/policies', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          evidenceDocumentId: DOCUMENT_ID,
          insurerName: 'Sandbox Insurance Co',
          policyNumberMasked: 'POL-****1234',
          policyType: 'home',
        }),
      }),
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as { policy: { id: string } };
    expect(body.policy.id).toBeTruthy();
  });

  it('rejects a policy pointing at a document that does not exist', async () => {
    stubEvidenceService('not-found');
    const app = buildApp();
    const token = await accessTokenFor(USER_A);

    const response = await app.handle(
      new Request('http://localhost/v1/policies', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          evidenceDocumentId: DOCUMENT_ID,
          insurerName: 'Sandbox Insurance Co',
          policyNumberMasked: 'POL-****1234',
          policyType: 'home',
        }),
      }),
    );
    expect(response.status).toBe(422);
  });

  it('rejects a policy pointing at a document that has not finished uploading', async () => {
    stubEvidenceService('not-ready');
    const app = buildApp();
    const token = await accessTokenFor(USER_A);

    const response = await app.handle(
      new Request('http://localhost/v1/policies', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          evidenceDocumentId: DOCUMENT_ID,
          insurerName: 'Sandbox Insurance Co',
          policyNumberMasked: 'POL-****1234',
          policyType: 'home',
        }),
      }),
    );
    expect(response.status).toBe(422);
  });

  it('IDOR: a different victim cannot read or list someone else’s policy', async () => {
    stubEvidenceService('owned-ready');
    const app = buildApp();
    const tokenA = await accessTokenFor(USER_A);
    const tokenB = await accessTokenFor(USER_B);

    const created = await app.handle(
      new Request('http://localhost/v1/policies', {
        method: 'POST',
        headers: { authorization: `Bearer ${tokenA}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          evidenceDocumentId: DOCUMENT_ID,
          insurerName: 'Sandbox Insurance Co',
          policyNumberMasked: 'POL-****1234',
          policyType: 'home',
        }),
      }),
    );
    const createdBody = (await created.json()) as { policy: { id: string } };

    const readAsB = await app.handle(
      new Request(`http://localhost/v1/policies/${createdBody.policy.id}`, {
        headers: { authorization: `Bearer ${tokenB}` },
      }),
    );
    expect(readAsB.status).toBe(404);

    const listAsB = await app.handle(
      new Request('http://localhost/v1/policies', {
        headers: { authorization: `Bearer ${tokenB}` },
      }),
    );
    const listBody = (await listAsB.json()) as { policies: unknown[] };
    expect(listBody.policies).toHaveLength(0);
  });

  it('requires authentication', async () => {
    const app = buildApp();
    const response = await app.handle(new Request('http://localhost/v1/policies'));
    expect(response.status).toBe(401);
  });
});
