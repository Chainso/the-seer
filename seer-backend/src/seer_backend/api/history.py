"""Event ingestion and history query API endpoints."""

from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Any
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, Request, status

from seer_backend.config.settings import Settings
from seer_backend.history.errors import (
    DuplicateEventError,
    HistoryDependencyUnavailableError,
    HistoryError,
    ObjectTypeMismatchError,
)
from seer_backend.history.models import (
    EventIngestRequest,
    EventIngestResponse,
    EventObjectRelationsResponse,
    EventTimelineResponse,
    ObjectTimelineResponse,
)
from seer_backend.history.repository import ClickHouseHistoryRepository
from seer_backend.history.service import HistoryService, UnavailableHistoryService

router = APIRouter(prefix="/history", tags=["history"])


def build_history_service(settings: Settings) -> HistoryService | UnavailableHistoryService:
    try:
        backend_root = Path(__file__).resolve().parents[3]
        migrations_dir = Path(settings.clickhouse_migrations_dir)
        if not migrations_dir.is_absolute():
            migrations_dir = backend_root / migrations_dir

        repository = ClickHouseHistoryRepository(
            host=settings.clickhouse_host,
            port=settings.clickhouse_port,
            database=settings.clickhouse_database,
            user=settings.clickhouse_user,
            password=settings.clickhouse_password,
            timeout_seconds=settings.clickhouse_timeout_seconds,
            migrations_dir=migrations_dir,
        )
        return HistoryService(repository=repository)
    except Exception as exc:  # pragma: no cover - tested via fallback behavior
        return UnavailableHistoryService(f"history service initialization failed: {exc}")


def get_history_service(request: Request) -> HistoryService | UnavailableHistoryService:
    return request.app.state.history_service


@router.post("/events/ingest", response_model=EventIngestResponse)
async def ingest_event(payload: EventIngestRequest, request: Request) -> EventIngestResponse:
    service = get_history_service(request)
    try:
        return await service.ingest_event(payload)
    except DuplicateEventError as exc:
        raise _http_error(status.HTTP_409_CONFLICT, str(exc)) from exc
    except ObjectTypeMismatchError as exc:
        raise _http_error(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc
    except HistoryDependencyUnavailableError as exc:
        raise _http_error(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc
    except HistoryError as exc:
        raise _http_error(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc


@router.get("/events", response_model=EventTimelineResponse)
async def get_event_timeline(
    request: Request,
    start_at: datetime | None = Query(default=None),
    end_at: datetime | None = Query(default=None),
    event_type: str | None = Query(default=None, min_length=1, max_length=200),
    limit: int = Query(default=200, ge=1, le=1000),
) -> EventTimelineResponse:
    service = get_history_service(request)
    try:
        return await service.event_timeline(
            start_at=start_at,
            end_at=end_at,
            event_type=event_type,
            limit=limit,
        )
    except HistoryDependencyUnavailableError as exc:
        raise _http_error(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc
    except HistoryError as exc:
        raise _http_error(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc


@router.get("/objects/timeline", response_model=ObjectTimelineResponse)
async def get_object_timeline(
    request: Request,
    object_type: str = Query(..., min_length=1, max_length=160),
    object_ref_hash: int = Query(..., ge=0),
    start_at: datetime | None = Query(default=None),
    end_at: datetime | None = Query(default=None),
    limit: int = Query(default=200, ge=1, le=1000),
) -> ObjectTimelineResponse:
    service = get_history_service(request)
    try:
        return await service.object_timeline(
            object_type=object_type,
            object_ref_hash=object_ref_hash,
            start_at=start_at,
            end_at=end_at,
            limit=limit,
        )
    except HistoryDependencyUnavailableError as exc:
        raise _http_error(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc
    except HistoryError as exc:
        raise _http_error(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc


@router.get("/relations", response_model=EventObjectRelationsResponse)
async def get_relations(
    request: Request,
    event_id: UUID | None = Query(default=None),
    object_type: str | None = Query(default=None, min_length=1, max_length=160),
    object_ref_hash: int | None = Query(default=None, ge=0),
    limit: int = Query(default=200, ge=1, le=1000),
) -> EventObjectRelationsResponse:
    if event_id is None and (object_type is None or object_ref_hash is None):
        raise _http_error(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "relations query requires event_id or (object_type + object_ref_hash)",
        )

    service = get_history_service(request)
    try:
        return await service.relations(
            event_id=event_id,
            object_type=object_type,
            object_ref_hash=object_ref_hash,
            limit=limit,
        )
    except HistoryDependencyUnavailableError as exc:
        raise _http_error(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc
    except HistoryError as exc:
        raise _http_error(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc


def inject_history_service(app: Any, settings: Settings) -> None:
    app.state.history_service = build_history_service(settings)


def _http_error(status_code: int, detail: str) -> HTTPException:
    return HTTPException(status_code=status_code, detail=detail)
