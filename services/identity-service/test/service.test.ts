import { describe, expect, it } from 'bun:test';
import { ReadinessRegistry, createLogger } from '@recoveryai/observability-ts';
import { createServiceApp } from '@recoveryai/service-runtime';
import { loadConfig } from '../src/config.ts';

const env = {
  PORT: '3002',
  DATABASE_URL: 'postgres://localhost:5432/recoveryai_identity',
  LOG_LEVEL: 'fatal',
  JWT_SECRET: 'service-test-secret-at-least-32-characters',
  INTERNAL_SERVICE_SECRET: 'service-test-internal-secret-20chars',
};

const logger = createLogger({
  service: 'identity-service',
  environment: 'test',
  level: 'fatal',
  pretty: false,
});

describe('identity-service', () => {
  it('loads its configuration with the service name and default port', () => {
    const config = loadConfig(env);
    expect(config.SERVICE_NAME).toBe('identity-service');
    expect(config.PORT).toBe(3002);
  });

  it('rejects an environment with no database', () => {
    expect(() => loadConfig({ PORT: '3002' })).toThrow();
  });

  it('serves liveness', async () => {
    const app = createServiceApp({
      config: loadConfig(env),
      logger,
      readiness: new ReadinessRegistry(),
    });
    const response = await app.handle(new Request('http://localhost/health/live'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok', service: 'identity-service' });
  });

  it('reports unready when Postgres is unreachable', async () => {
    const app = createServiceApp({
      config: loadConfig(env),
      logger,
      readiness: new ReadinessRegistry().register({
        name: 'postgres',
        run: async () => {
          throw new Error('connection refused');
        },
      }),
    });
    const response = await app.handle(new Request('http://localhost/health/ready'));
    expect(response.status).toBe(503);
  });
});
