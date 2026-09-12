import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import { createLogger } from '@recoveryai/observability-ts';
import { createServiceApp } from '@recoveryai/service-runtime';
import { loadConfig } from '../src/config.ts';
import { createDatabase } from '../src/db/client.ts';
import { sessions, users } from '../src/db/schema.ts';
import { adminRoutes } from '../src/routes/admin.routes.ts';
import { authRoutes } from '../src/routes/auth.routes.ts';

const env = {
  PORT: '3001',
  DATABASE_URL:
    process.env.TEST_DATABASE_URL ??
    'postgres://recoveryai:recoveryai@localhost:5432/recoveryai_auth',
  LOG_LEVEL: 'fatal',
  JWT_SECRET: 'integration-test-secret-at-least-32-characters',
  INTERNAL_SERVICE_SECRET: 'integration-test-internal-secret-20',
  RATE_LIMIT_MAX_ATTEMPTS: '1000',
};

const config = loadConfig(env);
const db = createDatabase(config.DATABASE_URL);
const logger = createLogger({
  service: 'auth-service',
  environment: 'test',
  level: 'fatal',
  pretty: false,
});

function buildApp() {
  return createServiceApp({
    config,
    logger,
    readiness: { run: async () => ({ ready: true, checks: [] }) } as never,
    plugins: [authRoutes({ db, config }), adminRoutes({ db, config })],
  });
}

function extractCookie(response: Response, name: string): string {
  const setCookies = response.headers.getSetCookie?.() ?? [];
  const match = setCookies.find((c) => c.startsWith(`${name}=`));
  if (!match) throw new Error(`cookie ${name} not set`);
  return match.split(';')[0]!;
}

async function signupVictim(app: ReturnType<typeof buildApp>, email: string) {
  const response = await app.handle(
    new Request('http://localhost/v1/auth/signup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, name: 'Test Victim', password: 'correct-horse-battery' }),
    }),
  );
  const body = (await response.json()) as { user: { id: string }; accessToken: string };
  const cookie = extractCookie(response, config.REFRESH_COOKIE_NAME);
  return { response, body, cookie };
}

async function makeAdmin(userId: string) {
  await db
    .update(users)
    .set({ role: 'admin' })
    .where((await import('drizzle-orm')).eq(users.id, userId));
}

beforeEach(async () => {
  await db.delete(sessions);
  await db.delete(users);
});

afterAll(async () => {
  await db.delete(sessions);
  await db.delete(users);
});

describe('auth-service integration', () => {
  it('signs up, returns the created user, and rejects a duplicate email', async () => {
    const app = buildApp();
    const { response, body } = await signupVictim(app, 'victim@example.com');
    expect(response.status).toBe(201);
    expect(body.user.id).toBeTruthy();

    const dup = await app.handle(
      new Request('http://localhost/v1/auth/signup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: 'Victim@Example.com',
          name: 'X',
          password: 'correct-horse-battery',
        }),
      }),
    );
    expect(dup.status).toBe(409);
    const dupBody = await dup.json();
    expect(dupBody).toMatchObject({ error: { code: 'EMAIL_TAKEN' } });
  });

  it('returns a validation error envelope for a malformed signup body', async () => {
    const app = buildApp();
    const response = await app.handle(
      new Request('http://localhost/v1/auth/signup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'not-an-email', name: '', password: 'short' }),
      }),
    );
    expect(response.status).toBe(422);
    const body = (await response.json()) as { error: { code: string; requestId: string } };
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(body.error.requestId).toBeTruthy();
  });

  it('logs in with correct credentials and rejects incorrect ones', async () => {
    const app = buildApp();
    await signupVictim(app, 'victim@example.com');

    const good = await app.handle(
      new Request('http://localhost/v1/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'victim@example.com', password: 'correct-horse-battery' }),
      }),
    );
    expect(good.status).toBe(200);

    const bad = await app.handle(
      new Request('http://localhost/v1/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'victim@example.com', password: 'wrong' }),
      }),
    );
    expect(bad.status).toBe(401);
  });

  it('requires authentication for /v1/auth/me', async () => {
    const app = buildApp();
    const response = await app.handle(new Request('http://localhost/v1/auth/me'));
    expect(response.status).toBe(401);
  });

  it('returns the caller matching the access token', async () => {
    const app = buildApp();
    const { body } = await signupVictim(app, 'victim@example.com');

    const response = await app.handle(
      new Request('http://localhost/v1/auth/me', {
        headers: { authorization: `Bearer ${body.accessToken}` },
      }),
    );
    expect(response.status).toBe(200);
    const me = (await response.json()) as { user: { id: string } };
    expect(me.user.id).toBe(body.user.id);
  });

  it('rotates the refresh token and revokes the whole family on reuse', async () => {
    const app = buildApp();
    const { cookie } = await signupVictim(app, 'victim@example.com');

    const first = await app.handle(
      new Request('http://localhost/v1/auth/refresh', { method: 'POST', headers: { cookie } }),
    );
    expect(first.status).toBe(200);
    const rotatedCookie = extractCookie(first, config.REFRESH_COOKIE_NAME);
    expect(rotatedCookie).not.toBe(cookie);

    // Replaying the original (now-rotated) token is reuse.
    const reuse = await app.handle(
      new Request('http://localhost/v1/auth/refresh', { method: 'POST', headers: { cookie } }),
    );
    expect(reuse.status).toBe(401);
    const reuseBody = (await reuse.json()) as { error: { code: string } };
    expect(reuseBody.error.code).toBe('REFRESH_TOKEN_REUSED');

    // The whole family — including the token just issued — is now revoked.
    const secondUse = await app.handle(
      new Request('http://localhost/v1/auth/refresh', {
        method: 'POST',
        headers: { cookie: rotatedCookie },
      }),
    );
    expect(secondUse.status).toBe(401);
  });

  it('logout revokes only the current session', async () => {
    const app = buildApp();
    const { cookie } = await signupVictim(app, 'victim@example.com');

    const logout = await app.handle(
      new Request('http://localhost/v1/auth/logout', { method: 'POST', headers: { cookie } }),
    );
    expect(logout.status).toBe(200);

    const refreshAfterLogout = await app.handle(
      new Request('http://localhost/v1/auth/refresh', { method: 'POST', headers: { cookie } }),
    );
    expect(refreshAfterLogout.status).toBe(401);
  });

  it('logout-all invalidates every session for the user', async () => {
    const app = buildApp();
    const { body, cookie } = await signupVictim(app, 'victim@example.com');

    const logoutAll = await app.handle(
      new Request('http://localhost/v1/auth/logout-all', {
        method: 'POST',
        headers: { authorization: `Bearer ${body.accessToken}` },
      }),
    );
    expect(logoutAll.status).toBe(200);

    const refreshAfter = await app.handle(
      new Request('http://localhost/v1/auth/refresh', { method: 'POST', headers: { cookie } }),
    );
    expect(refreshAfter.status).toBe(401);
  });

  it('rejects a victim calling an admin endpoint (role authorization)', async () => {
    const app = buildApp();
    const { body } = await signupVictim(app, 'victim@example.com');

    const response = await app.handle(
      new Request(`http://localhost/v1/admin/users/${body.user.id}/disable`, {
        method: 'POST',
        headers: { authorization: `Bearer ${body.accessToken}` },
      }),
    );
    expect(response.status).toBe(403);
  });

  it('admin can disable another user and that user is immediately logged out', async () => {
    const app = buildApp();
    const victim = await signupVictim(app, 'victim@example.com');
    const adminSignup = await signupVictim(app, 'admin@example.com');
    await makeAdmin(adminSignup.body.user.id);

    const adminLogin = await app.handle(
      new Request('http://localhost/v1/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'admin@example.com', password: 'correct-horse-battery' }),
      }),
    );
    const adminBody = (await adminLogin.json()) as { accessToken: string };

    const disable = await app.handle(
      new Request(`http://localhost/v1/admin/users/${victim.body.user.id}/disable`, {
        method: 'POST',
        headers: { authorization: `Bearer ${adminBody.accessToken}` },
      }),
    );
    expect(disable.status).toBe(200);

    const victimRefresh = await app.handle(
      new Request('http://localhost/v1/auth/refresh', {
        method: 'POST',
        headers: { cookie: victim.cookie },
      }),
    );
    expect(victimRefresh.status).toBe(401);

    const victimLogin = await app.handle(
      new Request('http://localhost/v1/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'victim@example.com', password: 'correct-horse-battery' }),
      }),
    );
    expect(victimLogin.status).toBe(401);
  });
});
