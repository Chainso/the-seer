"""Root-cause analysis API endpoints."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request, status

from seer_backend.analytics.errors import (
    RootCauseDependencyUnavailableError,
    RootCauseError,
    RootCauseLimitExceededError,
    RootCauseNoDataError,
    RootCauseTraceHandleError,
    RootCauseValidationError,
)
from seer_backend.analytics.rca_models import (
    RootCauseAssistInterpretRequest,
    RootCauseAssistInterpretResponse,
    RootCauseAssistSetupRequest,
    RootCauseAssistSetupResponse,
    RootCauseEvidenceResponse,
    RootCauseRequest,
    RootCauseRunResponse,
)
from seer_backend.analytics.rca_repository import ClickHouseRootCauseRepository
from seer_backend.analytics.rca_service import (
    RootCauseService,
    UnavailableRootCauseService,
    validate_rca_guardrails,
)
from seer_backend.config.settings import Settings

router = APIRouter(prefix="/root-cause", tags=["root-cause"])


def build_root_cause_service(
    settings: Settings,
) -> RootCauseService | UnavailableRootCauseService:
    try:
        validate_rca_guardrails(
            max_events=settings.root_cause_max_events,
            max_relations=settings.root_cause_max_relations,
            max_traces_per_insight=settings.root_cause_max_traces_per_insight,
        )

        backend_root = Path(__file__).resolve().parents[3]
        migrations_dir = Path(settings.clickhouse_migrations_dir)
        if not migrations_dir.is_absolute():
            migrations_dir = backend_root / migrations_dir

        repository = ClickHouseRootCauseRepository(
            host=settings.clickhouse_host,
            port=settings.clickhouse_port,
            database=settings.clickhouse_database,
            user=settings.clickhouse_user,
            password=settings.clickhouse_password,
            timeout_seconds=settings.clickhouse_timeout_seconds,
            migrations_dir=migrations_dir,
        )
        return RootCauseService(
            repository=repository,
            max_events_default=settings.root_cause_max_events,
            max_relations_default=settings.root_cause_max_relations,
            max_traces_per_insight_default=settings.root_cause_max_traces_per_insight,
        )
    except Exception as exc:  # pragma: no cover - verified via fallback behavior tests
        return UnavailableRootCauseService(
            f"root-cause service initialization failed: {exc}"
        )


def get_root_cause_service(request: Request) -> RootCauseService | UnavailableRootCauseService:
    return request.app.state.root_cause_service


@router.post("/run", response_model=RootCauseRunResponse)
async def run_root_cause(
    payload: RootCauseRequest,
    request: Request,
) -> RootCauseRunResponse:
    service = get_root_cause_service(request)
    try:
        return await service.run(payload)
    except RootCauseValidationError as exc:
        raise _http_error(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc
    except RootCauseLimitExceededError as exc:
        raise _http_error(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, str(exc)) from exc
    except RootCauseNoDataError as exc:
        raise _http_error(status.HTTP_404_NOT_FOUND, str(exc)) from exc
    except RootCauseDependencyUnavailableError as exc:
        raise _http_error(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc
    except RootCauseError as exc:
        raise _http_error(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc


@router.get("/evidence", response_model=RootCauseEvidenceResponse)
async def get_root_cause_evidence(
    request: Request,
    handle: str = Query(..., min_length=12),
    limit: int = Query(default=10, ge=1, le=200),
) -> RootCauseEvidenceResponse:
    service = get_root_cause_service(request)
    try:
        return await service.evidence(handle=handle, limit=limit)
    except RootCauseTraceHandleError as exc:
        raise _http_error(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc
    except RootCauseNoDataError as exc:
        raise _http_error(status.HTTP_404_NOT_FOUND, str(exc)) from exc
    except RootCauseDependencyUnavailableError as exc:
        raise _http_error(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc
    except RootCauseError as exc:
        raise _http_error(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc


@router.post("/assist/setup", response_model=RootCauseAssistSetupResponse)
async def assist_root_cause_setup(
    payload: RootCauseAssistSetupRequest,
    request: Request,
) -> RootCauseAssistSetupResponse:
    service = get_root_cause_service(request)
    try:
        return await service.assist_setup(payload)
    except RootCauseValidationError as exc:
        raise _http_error(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc
    except RootCauseDependencyUnavailableError as exc:
        raise _http_error(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc
    except RootCauseError as exc:
        raise _http_error(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc


@router.post("/assist/interpret", response_model=RootCauseAssistInterpretResponse)
async def assist_root_cause_interpret(
    payload: RootCauseAssistInterpretRequest,
    request: Request,
) -> RootCauseAssistInterpretResponse:
    service = get_root_cause_service(request)
    try:
        return await service.assist_interpret(payload)
    except RootCauseValidationError as exc:
        raise _http_error(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc
    except RootCauseDependencyUnavailableError as exc:
        raise _http_error(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc
    except RootCauseError as exc:
        raise _http_error(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc


def inject_root_cause_service(app: Any, settings: Settings) -> None:
    app.state.root_cause_service = build_root_cause_service(settings)


def _http_error(status_code: int, detail: str) -> HTTPException:
    return HTTPException(status_code=status_code, detail=detail)
