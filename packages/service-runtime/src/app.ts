import type { BaseServiceConfig } from '@recoveryai/config-ts';
import {
  AppError,
  type Logger,
  type ReadinessRegistry,
  errorEnvelope,
} from '@recoveryai/observability-ts';
import { Elysia, type AnyElysia } from 'elysia';

export interface ServiceAppOptions {
  config: BaseServiceConfig;
  logger: Logger;
  readiness: ReadinessRegistry;
  /**
   * Service-specific route plugins, mounted after the shared health and error
   * handling. Each is a standalone Elysia instance so route types compose without
   * the parent app's generics leaking into every service.
   */
  plugins?: AnyElysia[];
}

const requestIdOf = (request: Request): string => request.headers.get('x-request-id') ?? 'unknown';

/**
 * Builds the Elysia app shared by every TypeScript service: health endpoints
 * (Section 4.5) and the canonical error envelope (Section 4.1). Request IDs,
 * spans and access logs are applied by the server wrapper in `server.ts` so that
 * handlers run inside an active span.
 */
export function createServiceApp(options: ServiceAppOptions): AnyElysia {
  const { config, logger, readiness } = options;

  const app = new Elysia()
    .onError(({ error, request, set }) => {
      const requestId = requestIdOf(request);

      if (error instanceof AppError) {
        set.status = error.status;
        return errorEnvelope(error.code, error.message, requestId, error.details);
      }

      // Elysia's own validation / not-found errors carry a `code`.
      const elysiaCode = (error as { code?: string }).code;
      if (elysiaCode === 'NOT_FOUND') {
        set.status = 404;
        return errorEnvelope('NOT_FOUND', 'Resource not found', requestId);
      }
      if (elysiaCode === 'VALIDATION') {
        set.status = 422;
        return errorEnvelope('VALIDATION_FAILED', 'Request validation failed', requestId);
      }

      logger.error(
        { request_id: requestId, err: error instanceof Error ? error.message : String(error) },
        'Unhandled error',
      );
      set.status = 500;
      return errorEnvelope('INTERNAL_ERROR', 'Internal server error', requestId);
    })
    .get('/health/live', () => ({ status: 'ok', service: config.SERVICE_NAME }))
    .get('/health/ready', async ({ set }) => {
      const result = await readiness.run();
      if (!result.ready) set.status = 503;
      return {
        status: result.ready ? 'ok' : 'unavailable',
        service: config.SERVICE_NAME,
        checks: result.checks,
      };
    });

  let composed: AnyElysia = app;
  for (const plugin of options.plugins ?? []) composed = composed.use(plugin);
  return composed;
}
