"""FastAPI application entrypoint."""

from __future__ import annotations

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from seer_backend.actions.service import (
    UnavailableActionsService,
    inject_actions_service,
)
from seer_backend.api.ai import inject_ai_gateway_service
from seer_backend.api.ai import router as ai_router
from seer_backend.api.health import router as health_router
from seer_backend.api.history import inject_history_service
from seer_backend.api.history import router as history_router
from seer_backend.api.ontology import inject_ontology_services
from seer_backend.api.ontology import router as ontology_router
from seer_backend.api.process import inject_process_service
from seer_backend.api.process import router as process_router
from seer_backend.api.root_cause import inject_root_cause_service
from seer_backend.api.root_cause import router as root_cause_router
from seer_backend.config.settings import Settings
from seer_backend.logging import configure_logging


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings()
    configure_logging(settings.log_level)

    app = FastAPI(
        title=settings.app_name,
        version="0.1.0",
        docs_url=f"{settings.api_prefix}/docs",
        redoc_url=f"{settings.api_prefix}/redoc",
        openapi_url=f"{settings.api_prefix}/openapi.json",
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(health_router, prefix=settings.api_prefix)
    app.include_router(ontology_router, prefix=settings.api_prefix)
    app.include_router(history_router, prefix=settings.api_prefix)
    app.include_router(process_router, prefix=settings.api_prefix)
    app.include_router(root_cause_router, prefix=settings.api_prefix)
    app.include_router(ai_router, prefix=settings.api_prefix)
    inject_ontology_services(app, settings)
    inject_history_service(app, settings)
    inject_process_service(app, settings)
    inject_root_cause_service(app, settings)
    inject_ai_gateway_service(app)
    inject_actions_service(app, settings)

    logger = logging.getLogger(__name__)

    @app.on_event("startup")
    async def on_startup() -> None:
        logger.info(
            "backend_startup",
            extra={
                "environment": settings.app_env,
                "api_prefix": settings.api_prefix,
            },
        )
        if settings.actions_schema_bootstrap_on_startup:
            try:
                await app.state.actions_service.ensure_schema()
            except Exception as exc:  # pragma: no cover - exercised in integration/runtime
                reason = f"actions schema bootstrap failed: {exc}"
                app.state.actions_service = UnavailableActionsService(reason)
                logger.warning("actions_schema_bootstrap_failed", extra={"reason": reason})

    return app


app = create_app()
