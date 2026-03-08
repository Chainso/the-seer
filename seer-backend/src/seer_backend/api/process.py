"""Process mining API endpoints."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request, status

from seer_backend.analytics.errors import (
    ProcessMiningDependencyUnavailableError,
    ProcessMiningError,
    ProcessMiningLimitExceededError,
    ProcessMiningNoDataError,
    ProcessMiningTraceHandleError,
    ProcessMiningValidationError,
)
from seer_backend.analytics.models import (
    OcdfgMiningRequest,
    OcdfgMiningResponse,
    ProcessMiningRequest,
    ProcessMiningResponse,
    ProcessTraceDrilldownResponse,
)
from seer_backend.analytics.repository import ClickHouseProcessMiningRepository
from seer_backend.analytics.service import (
    OcpnMiningWrapper,
    ProcessMiningService,
    UnavailableProcessMiningService,
    validate_guardrails,
)
from seer_backend.api.status_codes import (
    HTTP_413_CONTENT_TOO_LARGE,
    HTTP_422_UNPROCESSABLE_CONTENT,
)
from seer_backend.config.settings import Settings

router = APIRouter(prefix="/process", tags=["process"])


def build_process_service(
    settings: Settings,
) -> ProcessMiningService | UnavailableProcessMiningService:
    try:
        validate_guardrails(
            max_events=settings.process_mining_max_events,
            max_relations=settings.process_mining_max_relations,
        )

        backend_root = Path(__file__).resolve().parents[3]
        migrations_dir = Path(settings.clickhouse_migrations_dir)
        if not migrations_dir.is_absolute():
            migrations_dir = backend_root / migrations_dir

        repository = ClickHouseProcessMiningRepository(
            host=settings.clickhouse_host,
            port=settings.clickhouse_port,
            database=settings.clickhouse_database,
            user=settings.clickhouse_user,
            password=settings.clickhouse_password,
            timeout_seconds=settings.clickhouse_timeout_seconds,
            connect_timeout_seconds=settings.clickhouse_connect_timeout_seconds,
            send_receive_timeout_seconds=settings.clickhouse_send_receive_timeout_seconds,
            compression=settings.clickhouse_compression,
            query_limit=settings.clickhouse_query_limit,
            migrations_dir=migrations_dir,
        )
        return ProcessMiningService(
            repository=repository,
            miner=OcpnMiningWrapper(),
            max_events_default=settings.process_mining_max_events,
            max_relations_default=settings.process_mining_max_relations,
            max_traces_per_handle_default=settings.process_mining_max_traces_per_handle,
        )
    except Exception as exc:  # pragma: no cover - tested via fallback behavior
        return UnavailableProcessMiningService(
            f"process mining service initialization failed: {exc}"
        )


def get_process_service(request: Request) -> ProcessMiningService | UnavailableProcessMiningService:
    return request.app.state.process_service


@router.post("/mine", response_model=ProcessMiningResponse)
async def mine_process(
    payload: ProcessMiningRequest,
    request: Request,
) -> ProcessMiningResponse:
    service = get_process_service(request)
    try:
        return await service.mine(payload)
    except ProcessMiningValidationError as exc:
        raise _http_error(HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from exc
    except ProcessMiningLimitExceededError as exc:
        raise _http_error(HTTP_413_CONTENT_TOO_LARGE, str(exc)) from exc
    except ProcessMiningNoDataError as exc:
        raise _http_error(status.HTTP_404_NOT_FOUND, str(exc)) from exc
    except ProcessMiningDependencyUnavailableError as exc:
        raise _http_error(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc
    except ProcessMiningError as exc:
        raise _http_error(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc


@router.post("/ocdfg/mine", response_model=OcdfgMiningResponse)
async def mine_ocdfg_process(
    payload: OcdfgMiningRequest,
    request: Request,
) -> OcdfgMiningResponse:
    service = get_process_service(request)
    try:
        return await service.mine_ocdfg(payload)
    except ProcessMiningValidationError as exc:
        raise _http_error(HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from exc
    except ProcessMiningLimitExceededError as exc:
        raise _http_error(HTTP_413_CONTENT_TOO_LARGE, str(exc)) from exc
    except ProcessMiningNoDataError as exc:
        raise _http_error(status.HTTP_404_NOT_FOUND, str(exc)) from exc
    except ProcessMiningDependencyUnavailableError as exc:
        raise _http_error(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc
    except ProcessMiningError as exc:
        raise _http_error(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc


@router.get("/traces", response_model=ProcessTraceDrilldownResponse)
async def get_trace_drilldown(
    request: Request,
    handle: str = Query(..., min_length=8),
    limit: int = Query(default=25, ge=1, le=500),
) -> ProcessTraceDrilldownResponse:
    service = get_process_service(request)
    try:
        return await service.trace_drilldown(handle=handle, limit=limit)
    except ProcessMiningTraceHandleError as exc:
        raise _http_error(HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from exc
    except ProcessMiningNoDataError as exc:
        raise _http_error(status.HTTP_404_NOT_FOUND, str(exc)) from exc
    except ProcessMiningDependencyUnavailableError as exc:
        raise _http_error(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc
    except ProcessMiningError as exc:
        raise _http_error(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc


def inject_process_service(app: Any, settings: Settings) -> None:
    app.state.process_service = build_process_service(settings)


def _http_error(status_code: int, detail: str) -> HTTPException:
    return HTTPException(status_code=status_code, detail=detail)
