"""FastAPI application factory shared by the Python services.

Provides the cross-cutting behaviour of plan Section 4: a request ID, a server span
continuing any inbound `traceparent`, one structured access log per request, health
endpoints, and the canonical error envelope.
"""

import time
import uuid
from collections.abc import Callable

from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse
from opentelemetry import context as otel_context
from opentelemetry import propagate, trace
from opentelemetry.trace import SpanKind, Status, StatusCode

from recoveryai_common.observability import get_logger, get_tracer, init_tracing, traced_client
from recoveryai_common.runtime.errors import AppError, error_envelope
from recoveryai_common.runtime.health import ReadinessRegistry
from recoveryai_common.settings import BaseServiceSettings


def _is_health_route(path: str) -> bool:
    return path.startswith("/health/")


def create_service_app(
    *,
    settings: BaseServiceSettings,
    readiness: ReadinessRegistry,
    configure: Callable[[FastAPI], None] | None = None,
) -> FastAPI:
    logger = get_logger(settings.service_name)

    init_tracing(
        service=settings.service_name,
        environment=settings.environment,
        endpoint=settings.otel_exporter_otlp_endpoint,
        enabled=settings.otel_traces_enabled,
    )
    tracer = get_tracer(settings.service_name)

    app = FastAPI(
        title=settings.service_name,
        version="0.0.0",
        docs_url="/docs",
        openapi_url="/openapi.json",
    )

    @app.middleware("http")
    async def observability_middleware(request: Request, call_next):  # type: ignore[no-untyped-def]
        request_id = request.headers.get("x-request-id") or str(uuid.uuid4())
        parent = propagate.extract(dict(request.headers))
        token = otel_context.attach(parent)
        started = time.perf_counter()
        status_code = 500

        span = tracer.start_span(
            f"{request.method} {request.url.path}",
            kind=SpanKind.SERVER,
            attributes={
                "http.request.method": request.method,
                "url.path": request.url.path,
                "recoveryai.request_id": request_id,
            },
        )
        span_token = otel_context.attach(trace.set_span_in_context(span))
        try:
            request.state.request_id = request_id
            response = await call_next(request)
            status_code = response.status_code
            response.headers["x-request-id"] = request_id
            return response
        except Exception as exc:
            span.set_status(Status(StatusCode.ERROR, str(exc)))
            raise
        finally:
            duration_ms = round((time.perf_counter() - started) * 1000)
            span.set_attribute("http.response.status_code", status_code)
            if status_code >= 500:
                span.set_status(Status(StatusCode.ERROR))
            span.end()
            # Log before detaching so the line carries trace_id/span_id (Section 4.2).
            if not _is_health_route(request.url.path):
                logger.info(
                    "request completed",
                    request_id=request_id,
                    route=request.url.path,
                    method=request.method,
                    status_code=status_code,
                    duration_ms=duration_ms,
                )
            otel_context.detach(span_token)
            otel_context.detach(token)

    @app.exception_handler(AppError)
    async def handle_app_error(request: Request, exc: AppError) -> JSONResponse:
        request_id = getattr(request.state, "request_id", "unknown")
        return JSONResponse(
            status_code=exc.status,
            content=error_envelope(exc.code, exc.message, request_id, exc.details),
        )

    @app.exception_handler(Exception)
    async def handle_unexpected(request: Request, exc: Exception) -> JSONResponse:
        request_id = getattr(request.state, "request_id", "unknown")
        logger.error("unhandled error", request_id=request_id, err=str(exc))
        return JSONResponse(
            status_code=500,
            content=error_envelope("INTERNAL_ERROR", "Internal server error", request_id),
        )

    @app.get("/health/live")
    async def health_live() -> dict[str, str]:
        return {"status": "ok", "service": settings.service_name}

    @app.get("/health/ready")
    async def health_ready(response: Response) -> dict[str, object]:
        ready, checks = await readiness.run()
        if not ready:
            response.status_code = 503
        return {
            "status": "ok" if ready else "unavailable",
            "service": settings.service_name,
            "checks": checks,
        }

    if settings.enable_diagnostics_routes:

        @app.get("/v1/diagnostics/trace-demo")
        async def trace_demo(request: Request) -> dict[str, object]:
            request_id = getattr(request.state, "request_id", "unknown")
            with tracer.start_as_current_span("diagnostics.work") as span:
                span.set_attribute("recoveryai.request_id", request_id)
                logger.info("diagnostics span started", request_id=request_id)

                downstream: dict[str, object] | None = None
                if settings.diagnostics_downstream_url:
                    async with traced_client(timeout=10.0) as client:
                        result = await client.get(
                            settings.diagnostics_downstream_url,
                            headers={"x-request-id": request_id},
                        )
                        downstream = {
                            "url": settings.diagnostics_downstream_url,
                            "status": result.status_code,
                            "body": result.json() if result.is_success else None,
                        }
                return {
                    "service": settings.service_name,
                    "requestId": request_id,
                    "downstream": downstream,
                }

    if configure:
        configure(app)

    return app
