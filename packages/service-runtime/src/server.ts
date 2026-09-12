import { SpanKind, SpanStatusCode, context, propagation, trace } from '@opentelemetry/api';
import type { BaseServiceConfig } from '@recoveryai/config-ts';
import {
  type Logger,
  type ReadinessRegistry,
  getTracer,
  initTracing,
  shutdownTracing,
} from '@recoveryai/observability-ts';
import type { AnyElysia } from 'elysia';
import { createServiceApp } from './app.ts';

export interface StartedService {
  port: number;
  stop: () => Promise<void>;
}

export interface StartServiceOptions {
  config: BaseServiceConfig;
  logger: Logger;
  readiness: ReadinessRegistry;
  plugins?: AnyElysia[];
}

/** Health probes are noisy and carry no information once they pass. */
const isHealthRoute = (pathname: string) => pathname.startsWith('/health/');

/**
 * Starts an HTTP service with the cross-cutting behaviour every service must have
 * (plan Section 4): a request ID, a server span continuing any inbound
 * `traceparent`, and one structured access log per request carrying the fields in
 * Section 4.2.
 *
 * The span is opened around `app.handle` rather than inside an Elysia hook so that
 * handlers — and therefore their log lines — run inside the active span context.
 */
export function startService(options: StartServiceOptions): StartedService {
  const { config, logger, readiness } = options;

  initTracing({
    service: config.SERVICE_NAME,
    environment: config.ENVIRONMENT,
    endpoint: config.OTEL_EXPORTER_OTLP_ENDPOINT,
    enabled: config.OTEL_TRACES_ENABLED,
  });

  const app = createServiceApp({ config, logger, readiness, plugins: options.plugins });
  const tracer = getTracer(config.SERVICE_NAME);

  const server = Bun.serve({
    port: config.PORT,
    idleTimeout: 30,
    fetch: async (request) => {
      const url = new URL(request.url);
      const requestId = request.headers.get('x-request-id') ?? crypto.randomUUID();

      // Handlers read the request ID off the request; guarantee it is present.
      const headers = new Headers(request.headers);
      headers.set('x-request-id', requestId);
      const inboundRequest = new Request(request, { headers });

      const parentContext = propagation.extract(context.active(), {
        traceparent: request.headers.get('traceparent') ?? undefined,
        tracestate: request.headers.get('tracestate') ?? undefined,
      });

      const span = tracer.startSpan(
        `${request.method} ${url.pathname}`,
        {
          kind: SpanKind.SERVER,
          attributes: {
            'http.request.method': request.method,
            'url.path': url.pathname,
            'server.address': url.host,
            'recoveryai.request_id': requestId,
          },
        },
        parentContext,
      );

      const started = performance.now();
      const activeContext = trace.setSpan(parentContext, span);

      return context.with(activeContext, async () => {
        let status = 500;
        try {
          const response = await app.handle(inboundRequest);
          status = response.status;
          const withRequestId = new Response(response.body, response);
          withRequestId.headers.set('x-request-id', requestId);
          return withRequestId;
        } catch (error) {
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: error instanceof Error ? error.message : String(error),
          });
          logger.error(
            { request_id: requestId, route: url.pathname, err: String(error) },
            'Request failed before reaching a handler',
          );
          return new Response(
            JSON.stringify({
              error: {
                code: 'INTERNAL_ERROR',
                message: 'Internal server error',
                requestId,
                details: {},
              },
            }),
            { status: 500, headers: { 'content-type': 'application/json' } },
          );
        } finally {
          const durationMs = Math.round(performance.now() - started);
          span.setAttribute('http.response.status_code', status);
          if (status >= 500) span.setStatus({ code: SpanStatusCode.ERROR });
          span.end();

          if (!isHealthRoute(url.pathname)) {
            logger.info(
              {
                request_id: requestId,
                route: url.pathname,
                method: request.method,
                status_code: status,
                duration_ms: durationMs,
              },
              'request completed',
            );
          }
        }
      });
    },
  });

  logger.info({ port: server.port, service: config.SERVICE_NAME }, 'service listening');

  const stop = async () => {
    await server.stop(true);
    await shutdownTracing();
    logger.info({ service: config.SERVICE_NAME }, 'service stopped');
  };

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      void stop().then(() => process.exit(0));
    });
  }

  return { port: server.port ?? config.PORT, stop };
}
