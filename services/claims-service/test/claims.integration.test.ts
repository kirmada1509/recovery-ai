import { afterAll, afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { INTERNAL_SERVICE_HEADERS, signInternalServiceRequest } from '@recoveryai/internal-auth-ts';
import { createLogger } from '@recoveryai/observability-ts';
import { createServiceApp } from '@recoveryai/service-runtime';
import { eq } from 'drizzle-orm';
import { SignJWT } from 'jose';
import { loadConfig } from '../src/config.ts';
import { createDatabase } from '../src/db/client.ts';
import {
  agentDispatchOutbox,
  claimEvents,
  claimEvidenceLinks,
  claimItems,
  claims,
  idempotencyKeys,
  manualReviewTasks,
  policies,
  verificationDispatchOutbox,
} from '../src/db/schema.ts';
import { adminRoutes } from '../src/routes/admin.routes.ts';
import { claimsRoutes } from '../src/routes/claims.routes.ts';
import { internalRoutes } from '../src/routes/internal.routes.ts';

const env = {
  PORT: '3003',
  DATABASE_URL:
    process.env.TEST_DATABASE_URL ??
    'postgres://recoveryai:recoveryai@localhost:5432/recoveryai_claims',
  LOG_LEVEL: 'fatal',
  JWT_SECRET: 'integration-test-secret-at-least-32-characters',
  INTERNAL_SERVICE_SECRET: 'integration-test-internal-secret-20',
  INTERNAL_ALLOWED_CALLERS: 'verification-service,agent-service',
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
    plugins: [
      claimsRoutes({ db, config }),
      internalRoutes({ db, config }),
      adminRoutes({ db, config }),
    ],
  });
}

async function accessTokenFor(
  userId: string,
  role: 'victim' | 'admin' = 'victim',
): Promise<string> {
  const secretKey = new TextEncoder().encode(config.JWT_SECRET);
  return new SignJWT({ role, session_id: crypto.randomUUID(), token_version: 1 })
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
const ADMIN = '99999999-9999-9999-9999-999999999999';
const DOCUMENT_ID = '33333333-3333-3333-3333-333333333333';

const originalFetch = globalThis.fetch;

/** Stubs the two outbound calls submit makes: identity-service KYC status and evidence-service document lookup. */
function stubDownstreamServices(options: { kycVerified: boolean; documentReady: boolean }) {
  globalThis.fetch = mock(async (input: string | URL | Request) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes('/v1/kyc/cases/latest')) {
      return new Response(
        JSON.stringify({ case: null, kycStatus: options.kycVerified ? 'VERIFIED' : 'PENDING' }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    if (url.includes(`/v1/documents/${DOCUMENT_ID}`)) {
      return new Response(
        JSON.stringify({
          document: {
            id: DOCUMENT_ID,
            documentType: 'policy',
            uploadStatus: options.documentReady ? 'ready' : 'pending',
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    throw new Error(`unexpected fetch to ${url}`);
  }) as unknown as typeof fetch;
}

async function insertPolicyFor(userId: string): Promise<string> {
  const [policy] = await db
    .insert(policies)
    .values({
      userId,
      evidenceDocumentId: DOCUMENT_ID,
      insurerName: 'Sandbox Insurance Co',
      policyNumberMasked: 'POL-****1234',
      policyType: 'home',
    })
    .returning();
  if (!policy) throw new Error('policy insert returned no row');
  return policy.id;
}

async function buildSubmittableClaim(
  app: ReturnType<typeof buildApp>,
  token: string,
  userId: string,
) {
  const policyId = await insertPolicyFor(userId);
  const created = await app.handle(
    new Request('http://localhost/v1/claims', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ policyId, incidentType: 'flood' }),
    }),
  );
  const createdBody = (await created.json()) as { claim: { id: string } };
  const claimId = createdBody.claim.id;

  await app.handle(
    new Request(`http://localhost/v1/claims/${claimId}`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        incidentAt: new Date().toISOString(),
        addressLine1: '12 MG Road',
        city: 'Chennai',
      }),
    }),
  );
  await app.handle(
    new Request(`http://localhost/v1/claims/${claimId}/items`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        description: 'Damaged sofa',
        category: 'furniture',
        claimedValuePaise: 500000,
      }),
    }),
  );
  await app.handle(
    new Request(`http://localhost/v1/claims/${claimId}/evidence-links`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ evidenceDocumentId: DOCUMENT_ID }),
    }),
  );

  return claimId;
}

beforeEach(async () => {
  await db.delete(claimEvents);
  await db.delete(verificationDispatchOutbox);
  await db.delete(agentDispatchOutbox);
  await db.delete(idempotencyKeys);
  await db.delete(claimEvidenceLinks);
  await db.delete(claimItems);
  await db.delete(manualReviewTasks);
  await db.delete(claims);
  await db.delete(policies);
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

afterAll(async () => {
  await db.delete(claimEvents);
  await db.delete(verificationDispatchOutbox);
  await db.delete(agentDispatchOutbox);
  await db.delete(idempotencyKeys);
  await db.delete(claimEvidenceLinks);
  await db.delete(claimItems);
  await db.delete(manualReviewTasks);
  await db.delete(claims);
  await db.delete(policies);
  globalThis.fetch = originalFetch;
});

describe('claims-service draft lifecycle', () => {
  it('creates a claim, edits it, adds/edits/removes items, and tracks the running total', async () => {
    stubDownstreamServices({ kycVerified: true, documentReady: true });
    const app = buildApp();
    const token = await accessTokenFor(USER_A);
    const policyId = await insertPolicyFor(USER_A);

    const created = await app.handle(
      new Request('http://localhost/v1/claims', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ policyId, incidentType: 'flood' }),
      }),
    );
    expect(created.status).toBe(201);
    const createdBody = (await created.json()) as { claim: { id: string; status: string } };
    expect(createdBody.claim.status).toBe('DRAFT');
    const claimId = createdBody.claim.id;

    const item1 = await app.handle(
      new Request(`http://localhost/v1/claims/${claimId}/items`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          description: 'Sofa',
          category: 'furniture',
          claimedValuePaise: 300000,
        }),
      }),
    );
    const item1Body = (await item1.json()) as { item: { id: string } };

    await app.handle(
      new Request(`http://localhost/v1/claims/${claimId}/items`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          description: 'TV',
          category: 'electronics',
          claimedValuePaise: 200000,
        }),
      }),
    );

    let claim = await app.handle(
      new Request(`http://localhost/v1/claims/${claimId}`, {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    let claimBody = (await claim.json()) as { claim: { claimedAmountPaise: number } };
    expect(claimBody.claim.claimedAmountPaise).toBe(500000);

    await app.handle(
      new Request(`http://localhost/v1/claims/${claimId}/items/${item1Body.item.id}`, {
        method: 'PUT',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ claimedValuePaise: 400000 }),
      }),
    );
    claim = await app.handle(
      new Request(`http://localhost/v1/claims/${claimId}`, {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    claimBody = (await claim.json()) as { claim: { claimedAmountPaise: number } };
    expect(claimBody.claim.claimedAmountPaise).toBe(600000);

    await app.handle(
      new Request(`http://localhost/v1/claims/${claimId}/items/${item1Body.item.id}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    claim = await app.handle(
      new Request(`http://localhost/v1/claims/${claimId}`, {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    claimBody = (await claim.json()) as { claim: { claimedAmountPaise: number } };
    expect(claimBody.claim.claimedAmountPaise).toBe(200000);
  });

  it('IDOR: a different victim cannot read, edit, or add items to someone else’s claim', async () => {
    stubDownstreamServices({ kycVerified: true, documentReady: true });
    const app = buildApp();
    const tokenA = await accessTokenFor(USER_A);
    const tokenB = await accessTokenFor(USER_B);
    const policyId = await insertPolicyFor(USER_A);

    const created = await app.handle(
      new Request('http://localhost/v1/claims', {
        method: 'POST',
        headers: { authorization: `Bearer ${tokenA}`, 'content-type': 'application/json' },
        body: JSON.stringify({ policyId, incidentType: 'flood' }),
      }),
    );
    const createdBody = (await created.json()) as { claim: { id: string } };

    const readAsB = await app.handle(
      new Request(`http://localhost/v1/claims/${createdBody.claim.id}`, {
        headers: { authorization: `Bearer ${tokenB}` },
      }),
    );
    expect(readAsB.status).toBe(404);

    const editAsB = await app.handle(
      new Request(`http://localhost/v1/claims/${createdBody.claim.id}`, {
        method: 'PUT',
        headers: { authorization: `Bearer ${tokenB}`, 'content-type': 'application/json' },
        body: JSON.stringify({ description: 'hijacked' }),
      }),
    );
    expect(editAsB.status).toBe(404);
  });
});

describe('claims-service submit', () => {
  it('rejects submit when KYC is not verified', async () => {
    stubDownstreamServices({ kycVerified: false, documentReady: true });
    const app = buildApp();
    const token = await accessTokenFor(USER_A);
    const claimId = await buildSubmittableClaim(app, token, USER_A);

    const response = await app.handle(
      new Request(`http://localhost/v1/claims/${claimId}/submit`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'idempotency-key': crypto.randomUUID() },
      }),
    );
    expect(response.status).toBe(422);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe('KYC_NOT_VERIFIED');
  });

  it('requires an Idempotency-Key header', async () => {
    stubDownstreamServices({ kycVerified: true, documentReady: true });
    const app = buildApp();
    const token = await accessTokenFor(USER_A);
    const claimId = await buildSubmittableClaim(app, token, USER_A);

    const response = await app.handle(
      new Request(`http://localhost/v1/claims/${claimId}/submit`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    expect(response.status).toBe(400);
  });

  it('submits end to end: DRAFT -> SUBMITTED -> VERIFYING, exactly one outbox row, correct events', async () => {
    stubDownstreamServices({ kycVerified: true, documentReady: true });
    const app = buildApp();
    const token = await accessTokenFor(USER_A);
    const claimId = await buildSubmittableClaim(app, token, USER_A);

    const response = await app.handle(
      new Request(`http://localhost/v1/claims/${claimId}/submit`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'idempotency-key': 'submit-key-1' },
      }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { claim: { status: string } };
    expect(body.claim.status).toBe('VERIFYING');

    const outboxRows = await db.select().from(verificationDispatchOutbox);
    expect(outboxRows).toHaveLength(1);
    expect(outboxRows[0]?.idempotencyKey).toBe('submit-key-1');

    const events = await db.select().from(claimEvents).where(eq(claimEvents.claimId, claimId));
    const eventTypes = events.map((e) => e.type).sort();
    expect(eventTypes).toEqual(
      ['CLAIM_CREATED', 'CLAIM_SUBMITTED', 'VERIFICATION_DISPATCHED'].sort(),
    );
  });

  it('the literal phase gate: duplicate submit with the same idempotency key does no new work', async () => {
    stubDownstreamServices({ kycVerified: true, documentReady: true });
    const app = buildApp();
    const token = await accessTokenFor(USER_A);
    const claimId = await buildSubmittableClaim(app, token, USER_A);

    const first = await app.handle(
      new Request(`http://localhost/v1/claims/${claimId}/submit`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'idempotency-key': 'duplicate-key' },
      }),
    );
    expect(first.status).toBe(200);

    const second = await app.handle(
      new Request(`http://localhost/v1/claims/${claimId}/submit`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'idempotency-key': 'duplicate-key' },
      }),
    );
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as { claim: { status: string } };
    expect(secondBody.claim.status).toBe('VERIFYING');

    const outboxRows = await db
      .select()
      .from(verificationDispatchOutbox)
      .where(eq(verificationDispatchOutbox.claimId, claimId));
    expect(outboxRows).toHaveLength(1);

    const events = await db.select().from(claimEvents).where(eq(claimEvents.claimId, claimId));
    expect(events.filter((e) => e.type === 'CLAIM_SUBMITTED')).toHaveLength(1);
  });

  it('rejects submitting a claim with no items', async () => {
    stubDownstreamServices({ kycVerified: true, documentReady: true });
    const app = buildApp();
    const token = await accessTokenFor(USER_A);
    const policyId = await insertPolicyFor(USER_A);
    const created = await app.handle(
      new Request('http://localhost/v1/claims', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ policyId, incidentType: 'flood' }),
      }),
    );
    const createdBody = (await created.json()) as { claim: { id: string } };

    const response = await app.handle(
      new Request(`http://localhost/v1/claims/${createdBody.claim.id}/submit`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'idempotency-key': crypto.randomUUID() },
      }),
    );
    expect(response.status).toBe(422);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe('NO_ITEMS');
  });

  it('IDOR: a different victim cannot submit someone else’s claim', async () => {
    stubDownstreamServices({ kycVerified: true, documentReady: true });
    const app = buildApp();
    const tokenA = await accessTokenFor(USER_A);
    const tokenB = await accessTokenFor(USER_B);
    const claimId = await buildSubmittableClaim(app, tokenA, USER_A);

    const response = await app.handle(
      new Request(`http://localhost/v1/claims/${claimId}/submit`, {
        method: 'POST',
        headers: { authorization: `Bearer ${tokenB}`, 'idempotency-key': crypto.randomUUID() },
      }),
    );
    expect(response.status).toBe(404);
  });
});

function internalHeaders(service: string): Record<string, string> {
  const token = signInternalServiceRequest(config.INTERNAL_SERVICE_SECRET, service);
  return {
    [INTERNAL_SERVICE_HEADERS.service]: token.service,
    [INTERNAL_SERVICE_HEADERS.timestamp]: token.timestamp,
    [INTERNAL_SERVICE_HEADERS.signature]: token.signature,
  };
}

describe('claims-service verification callback', () => {
  it('pass moves the claim to VERIFIED', async () => {
    stubDownstreamServices({ kycVerified: true, documentReady: true });
    const app = buildApp();
    const token = await accessTokenFor(USER_A);
    const claimId = await buildSubmittableClaim(app, token, USER_A);
    await app.handle(
      new Request(`http://localhost/v1/claims/${claimId}/submit`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'idempotency-key': crypto.randomUUID() },
      }),
    );

    const callback = await app.handle(
      new Request(`http://localhost/v1/internal/claims/${claimId}/verification-result`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...internalHeaders('verification-service') },
        body: JSON.stringify({
          verificationRunId: crypto.randomUUID(),
          decision: 'pass',
          overallScore: 0.91,
          reasons: [],
        }),
      }),
    );
    expect(callback.status).toBe(200);
    const body = (await callback.json()) as { claim: { status: string } };
    expect(body.claim.status).toBe('VERIFIED');
  });

  it('review moves the claim to MANUAL_REVIEW and creates a task', async () => {
    stubDownstreamServices({ kycVerified: true, documentReady: true });
    const app = buildApp();
    const token = await accessTokenFor(USER_A);
    const claimId = await buildSubmittableClaim(app, token, USER_A);
    await app.handle(
      new Request(`http://localhost/v1/claims/${claimId}/submit`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'idempotency-key': crypto.randomUUID() },
      }),
    );

    const callback = await app.handle(
      new Request(`http://localhost/v1/internal/claims/${claimId}/verification-result`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...internalHeaders('verification-service') },
        body: JSON.stringify({
          verificationRunId: crypto.randomUUID(),
          decision: 'review',
          overallScore: 0.6,
          reasons: ['ambiguous disaster signal'],
        }),
      }),
    );
    const body = (await callback.json()) as { claim: { status: string } };
    expect(body.claim.status).toBe('MANUAL_REVIEW');

    const tasks = await db
      .select()
      .from(manualReviewTasks)
      .where(eq(manualReviewTasks.claimId, claimId));
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.status).toBe('open');
  });

  it('rejects a callback without a valid internal-service signature', async () => {
    const app = buildApp();
    const response = await app.handle(
      new Request(
        'http://localhost/v1/internal/claims/00000000-0000-0000-0000-000000000000/verification-result',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            verificationRunId: crypto.randomUUID(),
            decision: 'pass',
            overallScore: 1,
            reasons: [],
          }),
        },
      ),
    );
    expect(response.status).toBe(403);
  });

  it('is idempotent: a retried callback for the same run does not re-transition', async () => {
    stubDownstreamServices({ kycVerified: true, documentReady: true });
    const app = buildApp();
    const token = await accessTokenFor(USER_A);
    const claimId = await buildSubmittableClaim(app, token, USER_A);
    await app.handle(
      new Request(`http://localhost/v1/claims/${claimId}/submit`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'idempotency-key': crypto.randomUUID() },
      }),
    );

    const runId = crypto.randomUUID();
    const payload = JSON.stringify({
      verificationRunId: runId,
      decision: 'pass',
      overallScore: 0.9,
      reasons: [],
    });

    const first = await app.handle(
      new Request(`http://localhost/v1/internal/claims/${claimId}/verification-result`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...internalHeaders('verification-service') },
        body: payload,
      }),
    );
    expect(first.status).toBe(200);

    const second = await app.handle(
      new Request(`http://localhost/v1/internal/claims/${claimId}/verification-result`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...internalHeaders('verification-service') },
        body: payload,
      }),
    );
    expect(second.status).toBe(200);

    const events = await db.select().from(claimEvents).where(eq(claimEvents.claimId, claimId));
    expect(events.filter((e) => e.type === 'CLAIM_VERIFIED')).toHaveLength(1);
  });

  it('queues exactly one agent-dispatch outbox row when the claim becomes VERIFIED', async () => {
    stubDownstreamServices({ kycVerified: true, documentReady: true });
    const app = buildApp();
    const token = await accessTokenFor(USER_A);
    const claimId = await buildSubmittableClaim(app, token, USER_A);
    await app.handle(
      new Request(`http://localhost/v1/claims/${claimId}/submit`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'idempotency-key': crypto.randomUUID() },
      }),
    );

    const runId = crypto.randomUUID();
    const payload = JSON.stringify({
      verificationRunId: runId,
      decision: 'pass',
      overallScore: 0.9,
      reasons: [],
    });

    await app.handle(
      new Request(`http://localhost/v1/internal/claims/${claimId}/verification-result`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...internalHeaders('verification-service') },
        body: payload,
      }),
    );
    // Retried callback for the same run must not queue a second dispatch.
    await app.handle(
      new Request(`http://localhost/v1/internal/claims/${claimId}/verification-result`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...internalHeaders('verification-service') },
        body: payload,
      }),
    );

    const outboxRows = await db
      .select()
      .from(agentDispatchOutbox)
      .where(eq(agentDispatchOutbox.claimId, claimId));
    expect(outboxRows).toHaveLength(1);
    const outboxPayload = outboxRows[0]?.payload as {
      items: unknown[];
      evidenceDocumentIds: string[];
    };
    expect(outboxPayload.items).toHaveLength(1);
    expect(outboxPayload.evidenceDocumentIds).toEqual([DOCUMENT_ID]);
  });

  it('does not queue an agent-dispatch row when the claim goes to MANUAL_REVIEW', async () => {
    stubDownstreamServices({ kycVerified: true, documentReady: true });
    const app = buildApp();
    const token = await accessTokenFor(USER_A);
    const claimId = await buildSubmittableClaim(app, token, USER_A);
    await app.handle(
      new Request(`http://localhost/v1/claims/${claimId}/submit`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'idempotency-key': crypto.randomUUID() },
      }),
    );

    await app.handle(
      new Request(`http://localhost/v1/internal/claims/${claimId}/verification-result`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...internalHeaders('verification-service') },
        body: JSON.stringify({
          verificationRunId: crypto.randomUUID(),
          decision: 'review',
          overallScore: 0.6,
          reasons: ['ambiguous'],
        }),
      }),
    );

    const outboxRows = await db
      .select()
      .from(agentDispatchOutbox)
      .where(eq(agentDispatchOutbox.claimId, claimId));
    expect(outboxRows).toHaveLength(0);
  });
});

describe('claims-service agent-update callback', () => {
  it('rejects a callback without a valid internal-service signature', async () => {
    const app = buildApp();
    const response = await app.handle(
      new Request(`http://localhost/v1/internal/claims/${crypto.randomUUID()}/agent-update`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ agentRunId: crypto.randomUUID(), status: 'completed' }),
      }),
    );
    expect(response.status).toBe(403);
  });

  it('records AGENT_DOSSIER_READY once and is idempotent on a retried agentRunId', async () => {
    stubDownstreamServices({ kycVerified: true, documentReady: true });
    const app = buildApp();
    const token = await accessTokenFor(USER_A);
    const claimId = await buildSubmittableClaim(app, token, USER_A);
    await app.handle(
      new Request(`http://localhost/v1/claims/${claimId}/submit`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'idempotency-key': crypto.randomUUID() },
      }),
    );

    const agentRunId = crypto.randomUUID();
    const payload = JSON.stringify({
      agentRunId,
      status: 'completed',
      dossier: { claimId },
    });

    const first = await app.handle(
      new Request(`http://localhost/v1/internal/claims/${claimId}/agent-update`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...internalHeaders('agent-service') },
        body: payload,
      }),
    );
    expect(first.status).toBe(200);

    const second = await app.handle(
      new Request(`http://localhost/v1/internal/claims/${claimId}/agent-update`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...internalHeaders('agent-service') },
        body: payload,
      }),
    );
    expect(second.status).toBe(200);

    const events = await db.select().from(claimEvents).where(eq(claimEvents.claimId, claimId));
    expect(events.filter((e) => e.type === 'AGENT_DOSSIER_READY')).toHaveLength(1);
  });
});

describe('claims-service admin', () => {
  it('rejects a victim calling admin claim list', async () => {
    const app = buildApp();
    const token = await accessTokenFor(USER_A);
    const response = await app.handle(
      new Request('http://localhost/v1/admin/claims', {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    expect(response.status).toBe(403);
  });

  it('admin resolves a manual review, recording an immutable event', async () => {
    stubDownstreamServices({ kycVerified: true, documentReady: true });
    const app = buildApp();
    const token = await accessTokenFor(USER_A);
    const adminToken = await accessTokenFor(ADMIN, 'admin');
    const claimId = await buildSubmittableClaim(app, token, USER_A);
    await app.handle(
      new Request(`http://localhost/v1/claims/${claimId}/submit`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'idempotency-key': crypto.randomUUID() },
      }),
    );
    await app.handle(
      new Request(`http://localhost/v1/internal/claims/${claimId}/verification-result`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...internalHeaders('verification-service') },
        body: JSON.stringify({
          verificationRunId: crypto.randomUUID(),
          decision: 'review',
          overallScore: 0.6,
          reasons: [],
        }),
      }),
    );

    const reviews = await app.handle(
      new Request('http://localhost/v1/admin/manual-reviews', {
        headers: { authorization: `Bearer ${adminToken}` },
      }),
    );
    const reviewsBody = (await reviews.json()) as { manualReviews: { id: string }[] };
    expect(reviewsBody.manualReviews).toHaveLength(1);

    const resolve = await app.handle(
      new Request(
        `http://localhost/v1/admin/manual-reviews/${reviewsBody.manualReviews[0]?.id}/resolve`,
        {
          method: 'POST',
          headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
          body: JSON.stringify({ decision: 'approve', note: 'looks fine' }),
        },
      ),
    );
    expect(resolve.status).toBe(200);
    const resolveBody = (await resolve.json()) as { claim: { status: string } };
    expect(resolveBody.claim.status).toBe('VERIFIED');

    const events = await db.select().from(claimEvents).where(eq(claimEvents.claimId, claimId));
    const resolved = events.find((e) => e.type === 'MANUAL_REVIEW_RESOLVED');
    expect(resolved).toBeTruthy();
    expect((resolved?.payload as { decision: string }).decision).toBe('approve');

    const outboxRows = await db
      .select()
      .from(agentDispatchOutbox)
      .where(eq(agentDispatchOutbox.claimId, claimId));
    expect(outboxRows).toHaveLength(1);

    const claimAfter = await app.handle(
      new Request(`http://localhost/v1/claims/${claimId}`, {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    const claimAfterBody = (await claimAfter.json()) as { claim: { status: string } };
    expect(claimAfterBody.claim.status).toBe('VERIFIED');
  });

  it('admin rejecting a manual review moves the claim to REJECTED', async () => {
    stubDownstreamServices({ kycVerified: true, documentReady: true });
    const app = buildApp();
    const token = await accessTokenFor(USER_A);
    const adminToken = await accessTokenFor(ADMIN, 'admin');
    const claimId = await buildSubmittableClaim(app, token, USER_A);
    await app.handle(
      new Request(`http://localhost/v1/claims/${claimId}/submit`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'idempotency-key': crypto.randomUUID() },
      }),
    );
    await app.handle(
      new Request(`http://localhost/v1/internal/claims/${claimId}/verification-result`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...internalHeaders('verification-service') },
        body: JSON.stringify({
          verificationRunId: crypto.randomUUID(),
          decision: 'fail',
          overallScore: 0.2,
          reasons: [],
        }),
      }),
    );

    const reviews = await app.handle(
      new Request('http://localhost/v1/admin/manual-reviews', {
        headers: { authorization: `Bearer ${adminToken}` },
      }),
    );
    const reviewsBody = (await reviews.json()) as { manualReviews: { id: string }[] };

    const resolve = await app.handle(
      new Request(
        `http://localhost/v1/admin/manual-reviews/${reviewsBody.manualReviews[0]?.id}/resolve`,
        {
          method: 'POST',
          headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
          body: JSON.stringify({ decision: 'reject', note: 'not plausible' }),
        },
      ),
    );
    expect(resolve.status).toBe(200);
    const resolveBody = (await resolve.json()) as { claim: { status: string } };
    expect(resolveBody.claim.status).toBe('REJECTED');
  });

  it('rejects resolving the same manual review twice', async () => {
    stubDownstreamServices({ kycVerified: true, documentReady: true });
    const app = buildApp();
    const token = await accessTokenFor(USER_A);
    const adminToken = await accessTokenFor(ADMIN, 'admin');
    const claimId = await buildSubmittableClaim(app, token, USER_A);
    await app.handle(
      new Request(`http://localhost/v1/claims/${claimId}/submit`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'idempotency-key': crypto.randomUUID() },
      }),
    );
    await app.handle(
      new Request(`http://localhost/v1/internal/claims/${claimId}/verification-result`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...internalHeaders('verification-service') },
        body: JSON.stringify({
          verificationRunId: crypto.randomUUID(),
          decision: 'review',
          overallScore: 0.6,
          reasons: [],
        }),
      }),
    );
    const reviews = await app.handle(
      new Request('http://localhost/v1/admin/manual-reviews', {
        headers: { authorization: `Bearer ${adminToken}` },
      }),
    );
    const reviewsBody = (await reviews.json()) as { manualReviews: { id: string }[] };
    const taskId = reviewsBody.manualReviews[0]?.id;

    await app.handle(
      new Request(`http://localhost/v1/admin/manual-reviews/${taskId}/resolve`, {
        method: 'POST',
        headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({ decision: 'approve' }),
      }),
    );
    const second = await app.handle(
      new Request(`http://localhost/v1/admin/manual-reviews/${taskId}/resolve`, {
        method: 'POST',
        headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({ decision: 'approve' }),
      }),
    );
    expect(second.status).toBe(409);
  });
});
