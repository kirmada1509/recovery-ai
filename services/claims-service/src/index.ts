import {
  ReadinessRegistry,
  createLogger,
  postgresReadinessCheck,
} from '@recoveryai/observability-ts';
import { diagnosticsRoutes, startService } from '@recoveryai/service-runtime';
import { loadConfig } from './config.ts';
import { createDatabase } from './db/client.ts';
import { adminRoutes } from './routes/admin.routes.ts';
import { claimsRoutes } from './routes/claims.routes.ts';
import { internalRoutes } from './routes/internal.routes.ts';
import { policiesRoutes } from './routes/policies.routes.ts';
import { startVerificationDispatcher } from './workers/verification-dispatcher.ts';

const config = loadConfig();

const logger = createLogger({
  service: config.SERVICE_NAME,
  environment: config.ENVIRONMENT,
  level: config.LOG_LEVEL,
  pretty: config.LOG_PRETTY,
});

const db = createDatabase(config.DATABASE_URL);

const readiness = new ReadinessRegistry().register(postgresReadinessCheck(config.DATABASE_URL));

const stopDispatcher = startVerificationDispatcher(db, config, logger);
process.on('SIGINT', stopDispatcher);
process.on('SIGTERM', stopDispatcher);

startService({
  config,
  logger,
  readiness,
  plugins: [
    policiesRoutes({ db, config }),
    claimsRoutes({ db, config }),
    internalRoutes({ db, config }),
    adminRoutes({ db, config }),
    ...(config.ENABLE_DIAGNOSTICS_ROUTES
      ? [
          diagnosticsRoutes({
            serviceName: config.SERVICE_NAME,
            logger,
            downstreamUrl: process.env.DIAGNOSTICS_DOWNSTREAM_URL,
          }),
        ]
      : []),
  ],
});
