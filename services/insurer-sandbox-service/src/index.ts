import {
  ReadinessRegistry,
  createLogger,
  postgresReadinessCheck,
} from '@recoveryai/observability-ts';
import { diagnosticsRoutes, startService } from '@recoveryai/service-runtime';
import { loadConfig } from './config.ts';

const config = loadConfig();

const logger = createLogger({
  service: config.SERVICE_NAME,
  environment: config.ENVIRONMENT,
  level: config.LOG_LEVEL,
  pretty: config.LOG_PRETTY,
});

const readiness = new ReadinessRegistry().register(postgresReadinessCheck(config.DATABASE_URL));

startService({
  config,
  logger,
  readiness,
  plugins: config.ENABLE_DIAGNOSTICS_ROUTES
    ? [
        diagnosticsRoutes({
          serviceName: config.SERVICE_NAME,
          logger,
          downstreamUrl: process.env.DIAGNOSTICS_DOWNSTREAM_URL,
        }),
      ]
    : [],
});
