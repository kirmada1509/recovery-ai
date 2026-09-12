/**
 * Proves `/health/ready` reflects reality: it must pass against a live Postgres and
 * fail against a dead one. A readiness probe that cannot fail is worse than none.
 */
import {
  ReadinessRegistry,
  createLogger,
  postgresReadinessCheck,
} from '@recoveryai/observability-ts';
import { createServiceApp } from '@recoveryai/service-runtime';
import { baseServiceEnvSchema, loadServiceConfig } from '@recoveryai/config-ts';

const LIVE_URL =
  process.env.CI_DATABASE_URL ??
  'postgresql://recoveryai:recoveryai@localhost:5432/recoveryai_auth';
const DEAD_URL = 'postgresql://recoveryai:recoveryai@localhost:5432/does_not_exist';

const logger = createLogger({
  service: 'ci-readiness-check',
  environment: 'ci',
  level: 'fatal',
  pretty: false,
});

const appFor = (databaseUrl: string) =>
  createServiceApp({
    config: loadServiceConfig('ci-readiness-check', baseServiceEnvSchema, {
      SERVICE_NAME: 'ci-readiness-check',
      PORT: '3999',
      DATABASE_URL: databaseUrl,
      LOG_LEVEL: 'fatal',
    }),
    logger,
    readiness: new ReadinessRegistry().register(postgresReadinessCheck(databaseUrl)),
  });

const statusFor = async (databaseUrl: string) =>
  (await appFor(databaseUrl).handle(new Request('http://localhost/health/ready'))).status;

const live = await statusFor(LIVE_URL);
if (live !== 200) throw new Error(`expected 200 against a live database, got ${live}`);
process.stdout.write('ready against a live database: 200\n');

const dead = await statusFor(DEAD_URL);
if (dead !== 503) throw new Error(`expected 503 against a missing database, got ${dead}`);
process.stdout.write('unready against a missing database: 503\n');
