"""Structured JSON logging for Python services (plan Section 4.2).

Emits the same field set as the TypeScript services so one query in Dozzle finds a
request across both runtimes, and redacts secrets and PII wherever they appear.
"""

import logging
import sys
from collections.abc import MutableMapping
from typing import Any

import structlog
from opentelemetry import trace

REDACTED_KEYS = frozenset(
    {
        "password",
        "password_hash",
        "passwordhash",
        "token",
        "access_token",
        "accesstoken",
        "refresh_token",
        "refreshtoken",
        "authorization",
        "cookie",
        "api_key",
        "apikey",
        "secret",
        "signed_url",
        "signedurl",
        "download_url",
        "presigned_url",
        "aadhaar",
        "aadhaar_number",
        "policy_text",
        "kyc_payload",
    }
)

_REDACTION = "[REDACTED]"


def _redact(
    _logger: Any, _method: str, event_dict: MutableMapping[str, Any]
) -> MutableMapping[str, Any]:
    """Censor sensitive keys at any depth of the event payload."""

    def walk(value: Any) -> Any:
        if isinstance(value, dict):
            return {
                key: (_REDACTION if key.lower() in REDACTED_KEYS else walk(inner))
                for key, inner in value.items()
            }
        if isinstance(value, list):
            return [walk(item) for item in value]
        return value

    return walk(dict(event_dict))  # type: ignore[no-any-return]


def _add_trace_context(
    _logger: Any, _method: str, event_dict: MutableMapping[str, Any]
) -> MutableMapping[str, Any]:
    """Attach the active trace and span IDs so logs join their trace."""
    span = trace.get_current_span()
    context = span.get_span_context()
    if context.is_valid:
        event_dict["trace_id"] = format(context.trace_id, "032x")
        event_dict["span_id"] = format(context.span_id, "016x")
    return event_dict


def configure_logging(*, service: str, environment: str, level: str, pretty: bool = False) -> None:
    """Configure structlog once at startup."""
    logging.basicConfig(format="%(message)s", stream=sys.stdout, level=level)

    renderer: Any = (
        structlog.dev.ConsoleRenderer() if pretty else structlog.processors.JSONRenderer()
    )

    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso", utc=True),
            _add_trace_context,
            _redact,
            structlog.processors.StackInfoRenderer(),
            structlog.processors.format_exc_info,
            renderer,
        ],
        wrapper_class=structlog.make_filtering_bound_logger(logging.getLevelNamesMapping()[level]),
        logger_factory=structlog.PrintLoggerFactory(),
        cache_logger_on_first_use=True,
    )

    structlog.contextvars.bind_contextvars(service=service, environment=environment)


def get_logger(name: str | None = None) -> Any:
    return structlog.get_logger(name)
