"""Distributed tracing for Python services (plan Section 4.3).

W3C `traceparent` is the only propagator, so a trace started in a TypeScript
service continues here and back without translation.
"""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import httpx
from opentelemetry import propagate, trace
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.trace.propagation.tracecontext import TraceContextTextMapPropagator

_provider: TracerProvider | None = None


def init_tracing(
    *,
    service: str,
    environment: str,
    endpoint: str | None,
    enabled: bool = True,
) -> None:
    """Install the tracer provider. Disabling tracing must never break the service."""
    global _provider
    if _provider is not None:
        return

    propagate.set_global_textmap(TraceContextTextMapPropagator())
    if not enabled:
        return

    _provider = TracerProvider(
        resource=Resource.create(
            {
                "service.name": service,
                "service.version": "0.0.0",
                "deployment.environment.name": environment,
            }
        )
    )
    if endpoint:
        _provider.add_span_processor(
            BatchSpanProcessor(OTLPSpanExporter(endpoint=f"{endpoint.rstrip('/')}/v1/traces"))
        )
    trace.set_tracer_provider(_provider)


def shutdown_tracing() -> None:
    global _provider
    if _provider is None:
        return
    _provider.shutdown()
    _provider = None


def get_tracer(name: str) -> trace.Tracer:
    return trace.get_tracer(name)


@asynccontextmanager
async def traced_client(**kwargs: object) -> AsyncIterator[httpx.AsyncClient]:
    """An httpx client that injects the active trace context into outgoing requests."""

    async def inject(request: httpx.Request) -> None:
        carrier: dict[str, str] = {}
        propagate.inject(carrier)
        for key, value in carrier.items():
            request.headers[key] = value

    async with httpx.AsyncClient(event_hooks={"request": [inject]}, **kwargs) as client:  # type: ignore[arg-type]
        yield client
