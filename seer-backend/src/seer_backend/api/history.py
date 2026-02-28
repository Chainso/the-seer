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
    LatestObjectsResponse,
    LatestObjectsSearchRequest,
    ObjectEventsResponse,
    ObjectPropertyFilter,
    ObjectPropertyFilterRequest,
    ObjectTimelineResponse,
)
from seer_backend.history.repository import ClickHouseHistoryRepository
from seer_backend.history.service import HistoryService, UnavailableHistoryService

router = APIRouter(prefix="/history", tags=["history"])
_PROPERTY_FILTER_OPERATORS = {"eq", "contains", "gt", "gte", "lt", "lte"}


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


@router.get("/objects/latest", response_model=LatestObjectsResponse)
async def get_latest_objects(
    request: Request,
    object_type: str | None = Query(default=None, min_length=1, max_length=160),
    page: int = Query(default=0, ge=0),
    size: int = Query(default=50, ge=1, le=200),
    property_filter: list[str] = Query(default=[]),
) -> LatestObjectsResponse:
    service = get_history_service(request)
    try:
        parsed_filters = _parse_property_filters(property_filter)
        return await service.latest_objects(
            object_type=object_type,
            property_filters=parsed_filters,
            page=page,
            size=size,
        )
    except ValueError as exc:
        raise _http_error(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc
    except HistoryDependencyUnavailableError as exc:
        raise _http_error(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc
    except HistoryError as exc:
        raise _http_error(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc


@router.post("/objects/latest/search", response_model=LatestObjectsResponse)
async def search_latest_objects(
    payload: LatestObjectsSearchRequest,
    request: Request,
) -> LatestObjectsResponse:
    service = get_history_service(request)
    try:
        parsed_filters = _coerce_property_filters(payload.property_filters)
        return await service.latest_objects(
            object_type=payload.object_type,
            property_filters=parsed_filters,
            page=payload.page,
            size=payload.size,
        )
    except ValueError as exc:
        raise _http_error(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc
    except HistoryDependencyUnavailableError as exc:
        raise _http_error(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc
    except HistoryError as exc:
        raise _http_error(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc


@router.get("/objects/events", response_model=ObjectEventsResponse)
async def get_object_events(
    request: Request,
    object_type: str = Query(..., min_length=1, max_length=160),
    object_ref_hash: int | None = Query(default=None, ge=0),
    object_ref_canonical: str | None = Query(default=None, min_length=2, max_length=2048),
    page: int = Query(default=0, ge=0),
    size: int = Query(default=50, ge=1, le=200),
) -> ObjectEventsResponse:
    if object_ref_hash is None and object_ref_canonical is None:
        raise _http_error(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "object events query requires object_ref_hash or object_ref_canonical",
        )
    service = get_history_service(request)
    try:
        return await service.object_events(
            object_type=object_type,
            object_ref_hash=object_ref_hash,
            object_ref_canonical=object_ref_canonical,
            page=page,
            size=size,
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


def _parse_property_filters(raw_filters: list[str]) -> list[ObjectPropertyFilter]:
    output: list[ObjectPropertyFilter] = []
    for raw in raw_filters:
        expression = raw.strip()
        if not expression:
            continue
        key, op, value = _parse_property_filter_expression(expression)
        if op not in _PROPERTY_FILTER_OPERATORS:
            raise ValueError(
                f"Unsupported property filter operator '{op}'. "
                "Use one of: eq, contains, gt, gte, lt, lte."
            )
        if op in {"gt", "gte", "lt", "lte"}:
            try:
                float(value)
            except ValueError as exc:
                raise ValueError(
                    f"Property filter '{expression}' requires a numeric value for '{op}'."
                ) from exc
        output.append(ObjectPropertyFilter(key=key, op=op, value=value))
    return output


def _coerce_property_filters(
    raw_filters: list[ObjectPropertyFilterRequest],
) -> list[ObjectPropertyFilter]:
    output: list[ObjectPropertyFilter] = []
    for raw in raw_filters:
        key = raw.key.strip()
        value = raw.value.strip()
        op = raw.op
        if not key:
            raise ValueError("Property filter key cannot be empty.")
        if not value:
            raise ValueError("Property filter value cannot be empty.")
        if op in {"gt", "gte", "lt", "lte"}:
            try:
                float(value)
            except ValueError as exc:
                raise ValueError(
                    f"Property filter '{key}:{op}:{value}' requires a numeric value for '{op}'."
                ) from exc
        output.append(ObjectPropertyFilter(key=key, op=op, value=value))
    return output


def _parse_property_filter_expression(expression: str) -> tuple[str, str, str]:
    parts = expression.split(":", 2)
    if len(parts) != 3:
        raise ValueError(
            "Property filters must use 'key:op:value' format, for example 'status:eq:active'."
        )
    key = parts[0].strip()
    op = parts[1].strip().lower()
    value = parts[2].strip()
    if not key:
        raise ValueError("Property filter key cannot be empty.")
    if not value:
        raise ValueError("Property filter value cannot be empty.")
    return key, op, value
