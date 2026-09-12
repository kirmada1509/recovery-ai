import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import { INTERNAL_SERVICE_HEADERS, signInternalServiceRequest } from '@recoveryai/internal-auth-ts';
import { createLogger } from '@recoveryai/observability-ts';
import { createServiceApp } from '@recoveryai/service-runtime';
import { SignJWT } from 'jose';
import { loadConfig } from '../src/config.ts';
import { createDatabase } from '../src/db/client.ts';
import { kycCases, profiles } from '../src/db/schema.ts';
import { kycRoutes } from '../src/routes/kyc.routes.ts';
import { profileRoutes } from '../src/routes/profile.routes.ts';

const env = {
  PORT: '3002',
  DATABASE_URL:
    process.env.TEST_DATABASE_URL ??
    'postgres://recoveryai:recoveryai@localhost:5432/recoveryai_identity',
  LOG_LEVEL: 'fatal',
  JWT_SECRET: 'integration-test-secret-at-least-32-characters',
  INTERNAL_SERVICE_SECRET: 'integration-test-internal-secret-20',
  INTERNAL_ALLOWED_CALLERS: 'kyc-provider-mock',
};

const config = loadConfig(env);
const db = createDatabase(config.DATABASE_URL);
const logger = createLogger({
  service: 'identity-service',
  environment: 'test',
  level: 'fatal',
  pretty: false,
});

function buildApp() {
  return createServiceApp({
    config,
    logger,
    readiness: { run: async () => ({ ready: true, checks: [] }) } as never,
    plugins: [profileRoutes({ db, config }), kycRoutes({ db, config })],
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

function internalHeaders(service: string): Record<string, string> {
  const token = signInternalServiceRequest(config.INTERNAL_SERVICE_SECRET, service);
  return {
    [INTERNAL_SERVICE_HEADERS.service]: token.service,
    [INTERNAL_SERVICE_HEADERS.timestamp]: token.timestamp,
    [INTERNAL_SERVICE_HEADERS.signature]: token.signature,
  };
}

beforeEach(async () => {
  await db.delete(kycCases);
  await db.delete(profiles);
});

afterAll(async () => {
  await db.delete(kycCases);
  await db.delete(profiles);
});

describe('identity-service profile', () => {
  it('requires authentication', async () => {
    const app = buildApp();
    const response = await app.handle(new Request('http://localhost/v1/profile'));
    expect(response.status).toBe(401);
  });

  it('returns null before a profile is created, then round-trips a write', async () => {
    const app = buildApp();
    const token = await accessTokenFor('11111111-1111-1111-1111-111111111111');

    const before = await app.handle(
      new Request('http://localhost/v1/profile', { headers: { authorization: `Bearer ${token}` } }),
    );
    const beforeBody = (await before.json()) as { profile: unknown };
    expect(beforeBody.profile).toBeNull();

    const put = await app.handle(
      new Request('http://localhost/v1/profile', {
        method: 'PUT',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ city: 'Chennai', country: 'IN' }),
      }),
    );
    expect(put.status).toBe(200);

    const after = await app.handle(
      new Request('http://localhost/v1/profile', { headers: { authorization: `Bearer ${token}` } }),
    );
    const afterBody = (await after.json()) as { profile: { city: string } };
    expect(afterBody.profile.city).toBe('Chennai');
  });

  it('never returns another user’s profile — a user only ever sees their own', async () => {
    const app = buildApp();
    const tokenA = await accessTokenFor('11111111-1111-1111-1111-111111111111');
    const tokenB = await accessTokenFor('22222222-2222-2222-2222-222222222222');

    await app.handle(
      new Request('http://localhost/v1/profile', {
        method: 'PUT',
        headers: { authorization: `Bearer ${tokenA}`, 'content-type': 'application/json' },
        body: JSON.stringify({ city: 'OwnedByA' }),
      }),
    );

    const asB = await app.handle(
      new Request('http://localhost/v1/profile', {
        headers: { authorization: `Bearer ${tokenB}` },
      }),
    );
    const asBBody = (await asB.json()) as { profile: unknown };
    expect(asBBody.profile).toBeNull();
  });
});

describe('identity-service KYC', () => {
  it('reports UNVERIFIED when no case exists', async () => {
    const app = buildApp();
    const token = await accessTokenFor('11111111-1111-1111-1111-111111111111');
    const response = await app.handle(
      new Request('http://localhost/v1/kyc/cases/latest', {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    const body = await response.json();
    expect(body).toEqual({ case: null, kycStatus: 'UNVERIFIED' });
  });

  it('creates a pending case, then deterministically verifies it', async () => {
    const app = buildApp();
    const token = await accessTokenFor('11111111-1111-1111-1111-111111111111');

    const created = await app.handle(
      new Request('http://localhost/v1/kyc/cases', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ fullName: 'Test Victim', identifierLast4: '1234' }),
      }),
    );
    expect(created.status).toBe(201);
    const createdBody = (await created.json()) as { case: { id: string; status: string } };
    expect(createdBody.case.status).toBe('pending');

    const completed = await app.handle(
      new Request(`http://localhost/v1/kyc/mock/${createdBody.case.id}/complete`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    expect(completed.status).toBe(200);
    const completedBody = (await completed.json()) as { case: { status: string } };
    expect(completedBody.case.status).toBe('verified');
  });

  it('deterministically fails the reserved 0000 seed', async () => {
    const app = buildApp();
    const token = await accessTokenFor('11111111-1111-1111-1111-111111111111');

    const created = await app.handle(
      new Request('http://localhost/v1/kyc/cases', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ fullName: 'Failing User', identifierLast4: '0000' }),
      }),
    );
    const createdBody = (await created.json()) as { case: { id: string } };

    const completed = await app.handle(
      new Request(`http://localhost/v1/kyc/mock/${createdBody.case.id}/complete`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    const completedBody = (await completed.json()) as {
      case: { status: string; failureReason: string };
    };
    expect(completedBody.case.status).toBe('failed');
    expect(completedBody.case.failureReason).toBe('MOCK_PROVIDER_SEED_FAILURE');
  });

  it('rejects completing a case that is not pending', async () => {
    const app = buildApp();
    const token = await accessTokenFor('11111111-1111-1111-1111-111111111111');
    const created = await app.handle(
      new Request('http://localhost/v1/kyc/cases', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ fullName: 'Test Victim', identifierLast4: '1234' }),
      }),
    );
    const createdBody = (await created.json()) as { case: { id: string } };

    await app.handle(
      new Request(`http://localhost/v1/kyc/mock/${createdBody.case.id}/complete`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    const second = await app.handle(
      new Request(`http://localhost/v1/kyc/mock/${createdBody.case.id}/complete`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    expect(second.status).toBe(409);
  });

  it('IDOR: a different user cannot complete someone else’s KYC case', async () => {
    const app = buildApp();
    const tokenA = await accessTokenFor('11111111-1111-1111-1111-111111111111');
    const tokenB = await accessTokenFor('22222222-2222-2222-2222-222222222222');

    const created = await app.handle(
      new Request('http://localhost/v1/kyc/cases', {
        method: 'POST',
        headers: { authorization: `Bearer ${tokenA}`, 'content-type': 'application/json' },
        body: JSON.stringify({ fullName: 'Test Victim', identifierLast4: '1234' }),
      }),
    );
    const createdBody = (await created.json()) as { case: { id: string } };

    const asB = await app.handle(
      new Request(`http://localhost/v1/kyc/mock/${createdBody.case.id}/complete`, {
        method: 'POST',
        headers: { authorization: `Bearer ${tokenB}` },
      }),
    );
    expect(asB.status).toBe(404);
  });

  it('rejects the mock completion endpoint when mock controls are disabled', async () => {
    const disabledConfig = { ...config, ENABLE_KYC_MOCK_CONTROLS: false };
    const app = createServiceApp({
      config: disabledConfig,
      logger,
      readiness: { run: async () => ({ ready: true, checks: [] }) } as never,
      plugins: [kycRoutes({ db, config: disabledConfig })],
    });
    const token = await accessTokenFor('11111111-1111-1111-1111-111111111111');
    const response = await app.handle(
      new Request('http://localhost/v1/kyc/mock/00000000-0000-0000-0000-000000000000/complete', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    expect(response.status).toBe(404);
  });

  it('rejects the provider webhook without a valid internal-service signature', async () => {
    const app = buildApp();
    const response = await app.handle(
      new Request('http://localhost/v1/kyc/provider/webhook', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ caseId: '00000000-0000-0000-0000-000000000000', outcome: 'failed' }),
      }),
    );
    expect(response.status).toBe(403);
  });

  it('applies the provider webhook outcome when internal-service auth is valid', async () => {
    const app = buildApp();
    const token = await accessTokenFor('11111111-1111-1111-1111-111111111111');
    const created = await app.handle(
      new Request('http://localhost/v1/kyc/cases', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ fullName: 'Webhook User', identifierLast4: '5555' }),
      }),
    );
    const createdBody = (await created.json()) as { case: { id: string } };

    const webhook = await app.handle(
      new Request('http://localhost/v1/kyc/provider/webhook', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...internalHeaders('kyc-provider-mock') },
        body: JSON.stringify({
          caseId: createdBody.case.id,
          outcome: 'failed',
          failureReason: 'PROVIDER_DECLINED',
        }),
      }),
    );
    expect(webhook.status).toBe(200);
    const webhookBody = (await webhook.json()) as {
      case: { status: string; failureReason: string };
    };
    expect(webhookBody.case.status).toBe('failed');
    expect(webhookBody.case.failureReason).toBe('PROVIDER_DECLINED');
  });

  it('rejects a webhook call from a service not on the allowlist', async () => {
    const app = buildApp();
    const response = await app.handle(
      new Request('http://localhost/v1/kyc/provider/webhook', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...internalHeaders('some-other-service') },
        body: JSON.stringify({ caseId: '00000000-0000-0000-0000-000000000000', outcome: 'failed' }),
      }),
    );
    expect(response.status).toBe(403);
  });
});
