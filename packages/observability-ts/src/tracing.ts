import { type Tracer, context, propagation, trace } from '@opentelemetry/api';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { BatchSpanProcessor, type SpanProcessor } from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';

let provider: NodeTracerProvider | undefined;

export interface TracingOptions {
  service: string;
  environment: string;
  endpoint?: string | undefined;
  enabled: boolean;
}

/**
 * Distributed tracing bootstrap (plan Section 4.3).
 *
 * W3C `traceparent` is the only propagator, so a trace started in a TypeScript
 * service continues into the Python services and back without translation.
 * Disabling tracing is supported and must never break the service.
 */
export function initTracing(options: TracingOptions): void {
  if (provider) return;
  if (!options.enabled) {
    propagation.setGlobalPropagator(new W3CTraceContextPropagator());
    return;
  }

  const spanProcessors: SpanProcessor[] = [];
  if (options.endpoint) {
    spanProcessors.push(
      new BatchSpanProcessor(
        new OTLPTraceExporter({ url: `${options.endpoint.replace(/\/$/, '')}/v1/traces` }),
      ),
    );
  }

  provider = new NodeTracerProvider({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: options.service,
      [ATTR_SERVICE_VERSION]: '0.0.0',
      'deployment.environment.name': options.environment,
    }),
    spanProcessors,
  });

  provider.register({ propagator: new W3CTraceContextPropagator() });
}

export async function shutdownTracing(): Promise<void> {
  if (!provider) return;
  await provider.shutdown();
  provider = undefined;
}

export function getTracer(name: string): Tracer {
  return trace.getTracer(name);
}

/**
 * `fetch` that injects the active trace context into outgoing headers, so an
 * internal service-to-service call joins the caller's trace (plan Section 4.3).
 */
export async function tracedFetch(input: string | URL | Request, init?: RequestInit) {
  const headers = new Headers(init?.headers ?? {});
  const carrier: Record<string, string> = {};
  propagation.inject(context.active(), carrier);
  for (const [key, value] of Object.entries(carrier)) headers.set(key, value);
  return fetch(input, { ...init, headers });
}
