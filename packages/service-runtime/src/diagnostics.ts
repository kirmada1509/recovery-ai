import { SpanStatusCode } from '@opentelemetry/api';
import { getTracer, tracedFetch } from '@recoveryai/observability-ts';
import type { Logger } from '@recoveryai/observability-ts';
import { Elysia, type AnyElysia } from 'elysia';

export interface DiagnosticsOptions {
  serviceName: string;
  logger: Logger;
  /** Optional downstream URL called to prove cross-service trace propagation. */
  downstreamUrl?: string | undefined;
}

/**
 * Diagnostics routes, enabled only when ENABLE_DIAGNOSTICS_ROUTES=true.
 *
 * `/v1/diagnostics/trace-demo` produces a nested span and, when a downstream is
 * configured, calls it so a single trace spans both runtimes — the evidence for
 * the Phase 0 tracing gate. Not mounted in production.
 */
export function diagnosticsRoutes(options: DiagnosticsOptions): AnyElysia {
  return new Elysia({ name: 'diagnostics' }).get(
    '/v1/diagnostics/trace-demo',
    async ({ request }) => {
      const tracer = getTracer(options.serviceName);
      const requestId = request.headers.get('x-request-id') ?? 'unknown';

      return tracer.startActiveSpan('diagnostics.work', async (span) => {
        try {
          span.setAttribute('recoveryai.request_id', requestId);
          options.logger.info({ request_id: requestId }, 'diagnostics span started');

          let downstream: unknown = null;
          if (options.downstreamUrl) {
            const response = await tracedFetch(options.downstreamUrl, {
              headers: { 'x-request-id': requestId },
            });
            downstream = {
              url: options.downstreamUrl,
              status: response.status,
              body: response.ok ? await response.json() : null,
            };
          }

          span.setStatus({ code: SpanStatusCode.OK });
          return { service: options.serviceName, requestId, downstream };
        } catch (error) {
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: error instanceof Error ? error.message : String(error),
          });
          throw error;
        } finally {
          span.end();
        }
      });
    },
  );
}
