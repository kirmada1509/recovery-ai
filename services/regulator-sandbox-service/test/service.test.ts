import { describe, expect, it } from 'bun:test';
import { ReadinessRegistry, createLogger } from '@recoveryai/observability-ts';
import { createServiceApp } from '@recoveryai/service-runtime';
import { loadConfig } from '../src/config.ts';

const env = {
  PORT: '3008',
  DATABASE_URL: 'postgres://localhost:5432/recoveryai_regulator_sandbox',
  LOG_LEVEL: 'fatal',
};

const logger = createLogger({
  service: 'regulator-sandbox-service',
  environment: 'test',
  level: 'fatal',
  pretty: false,
});

describe('regulator-sandbox-service', () => {
  it('loads its configuration with the service name and default port', () => {
    const config = loadConfig(env);
    expect(config.SERVICE_NAME).toBe('regulator-sandbox-service');
    expect(config.PORT).toBe(3008);
  });

  it('rejects an environment with no database', () => {
    expect(() => loadConfig({ PORT: '3008' })).toThrow();
  });

  it('serves liveness', async () => {
    const app = createServiceApp({
      config: loadConfig(env),
      logger,
      readiness: new ReadinessRegistry(),
    });
    const response = await app.handle(new Request('http://localhost/health/live'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok', service: 'regulator-sandbox-service' });
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
