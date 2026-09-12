"""Explainable claim verification signals and scoring — application entrypoint."""

from fastapi import FastAPI
from recoveryai_common.observability import configure_logging
from recoveryai_common.runtime import (
    ReadinessRegistry,
    create_service_app,
    postgres_readiness_check,
)

from verification_service.db.session import create_session_factory
from verification_service.routes.verifications import register_verification_routes
from verification_service.settings import load_settings


def build_app() -> FastAPI:
    settings = load_settings()
    configure_logging(
        service=settings.service_name,
        environment=settings.environment,
        level=settings.python_log_level,
        pretty=settings.log_pretty,
    )
    readiness = ReadinessRegistry().register(postgres_readiness_check(str(settings.database_url)))
    session_factory = create_session_factory(str(settings.database_url))

    def configure(app: FastAPI) -> None:
        register_verification_routes(app, settings, session_factory)

    return create_service_app(settings=settings, readiness=readiness, configure=configure)


app = build_app()
