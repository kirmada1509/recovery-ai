import { describe, expect, it } from 'bun:test';
import { baseServiceEnvSchema, loadServiceConfig } from '@recoveryai/config-ts';
import { AppError, ReadinessRegistry, createLogger } from '@recoveryai/observability-ts';
import { Elysia } from 'elysia';
import { createServiceApp } from '../src/app.ts';

const config = loadServiceConfig('test-service', baseServiceEnvSchema, {
  SERVICE_NAME: 'test-service',
  PORT: '3999',
  DATABASE_URL: 'postgres://localhost:5432/none',
  LOG_LEVEL: 'fatal',
});

const logger = createLogger({
  service: 'test-service',
  environment: 'test',
  level: 'fatal',
  pretty: false,
});

const buildApp = (readiness: ReadinessRegistry) =>
  createServiceApp({
    config,
    logger,
    readiness,
    plugins: [
      new Elysia()
        .get('/boom', () => {
          throw new AppError('CLAIM_NOT_FOUND', 'Claim not found', 404, { claimId: 'abc' });
        })
        .get('/explode', () => {
          throw new Error('unexpected');
        }),
    ],
  });

describe('service app', () => {
  it('reports liveness without touching dependencies', async () => {
    const app = buildApp(new ReadinessRegistry());
    const response = await app.handle(new Request('http://localhost/health/live'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok', service: 'test-service' });
  });

  it('is ready when every required check passes', async () => {
    const readiness = new ReadinessRegistry().register({
      name: 'stub',
      run: async () => {},
    });
    const response = await buildApp(readiness).handle(new Request('http://localhost/health/ready'));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { status: string; checks: { ok: boolean }[] };
    expect(body.status).toBe('ok');
    expect(body.checks[0]?.ok).toBe(true);
  });

  it('returns 503 when a required dependency is down', async () => {
    const readiness = new ReadinessRegistry().register({
      name: 'postgres',
      run: async () => {
        throw new Error('connection refused');
      },
    });
    const response = await buildApp(readiness).handle(new Request('http://localhost/health/ready'));
    expect(response.status).toBe(503);
    const body = (await response.json()) as { status: string; checks: { detail?: string }[] };
    expect(body.status).toBe('unavailable');
    expect(body.checks[0]?.detail).toContain('connection refused');
  });

  it('stays ready when only an optional dependency is down', async () => {
    const readiness = new ReadinessRegistry()
      .register({ name: 'postgres', run: async () => {} })
      .register({
        name: 'optional-provider',
        optional: true,
        run: async () => {
          throw new Error('provider disabled');
        },
      });
    const response = await buildApp(readiness).handle(new Request('http://localhost/health/ready'));
    expect(response.status).toBe(200);
  });

  it('renders AppError as the canonical error envelope', async () => {
    const response = await buildApp(new ReadinessRegistry()).handle(
      new Request('http://localhost/boom', { headers: { 'x-request-id': 'req-123' } }),
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: {
        code: 'CLAIM_NOT_FOUND',
        message: 'Claim not found',
        requestId: 'req-123',
        details: { claimId: 'abc' },
      },
    });
  });

  it('never leaks an unexpected error message to the client', async () => {
    const response = await buildApp(new ReadinessRegistry()).handle(
      new Request('http://localhost/explode', { headers: { 'x-request-id': 'req-456' } }),
    );
    expect(response.status).toBe(500);
    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.error.message).toBe('Internal server error');
    expect(JSON.stringify(body)).not.toContain('unexpected');
  });

  it('uses the error envelope for unknown routes', async () => {
    const response = await buildApp(new ReadinessRegistry()).handle(
      new Request('http://localhost/nope'),
    );
    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe('NOT_FOUND');
  });
});
