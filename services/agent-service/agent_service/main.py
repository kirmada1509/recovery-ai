"""LangGraph claim workflow, policy RAG and the negotiation engine — application entrypoint."""

from fastapi import FastAPI
from recoveryai_common.observability import configure_logging
from recoveryai_common.runtime import (
    ReadinessRegistry,
    create_service_app,
    postgres_readiness_check,
)

from agent_service.settings import load_settings


def build_app() -> FastAPI:
    settings = load_settings()
    configure_logging(
        service=settings.service_name,
        environment=settings.environment,
        level=settings.python_log_level,
        pretty=settings.log_pretty,
    )
    readiness = ReadinessRegistry().register(postgres_readiness_check(str(settings.database_url)))
    return create_service_app(settings=settings, readiness=readiness)


app = build_app()
