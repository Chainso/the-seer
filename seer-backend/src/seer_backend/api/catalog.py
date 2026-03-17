"""Catalog read-model API endpoints."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request, status

from seer_backend.actions.errors import ActionDependencyUnavailableError, ActionError
from seer_backend.actions.models import ActionStatus
from seer_backend.catalog.models import (
    CatalogActionDetailResponse,
    CatalogActionListResponse,
    CatalogActionRunsResponse,
    CatalogEventDetailResponse,
    CatalogEventListResponse,
    CatalogEventOccurrencesResponse,
    CatalogObjectDetailResponse,
    CatalogObjectInstancesResponse,
    CatalogObjectListResponse,
    CatalogTriggerDetailResponse,
    CatalogTriggerFiringsResponse,
    CatalogTriggerListResponse,
)
from seer_backend.catalog.service import CatalogService
from seer_backend.history.errors import HistoryDependencyUnavailableError, HistoryError
from seer_backend.ontology.errors import (
    OntologyDependencyUnavailableError,
    OntologyError,
    OntologyNotReadyError,
)

router = APIRouter(prefix="/catalog", tags=["catalog"])


def get_catalog_service(request: Request) -> CatalogService:
    return CatalogService(
        ontology_service=request.app.state.ontology_service,
        history_service=request.app.state.history_service,
        actions_service=request.app.state.actions_service,
    )


@router.get("/objects", response_model=CatalogObjectListResponse)
async def list_catalog_objects(
    request: Request,
    search: str = Query(default="", max_length=120),
    limit: int = Query(default=200, ge=1, le=500),
) -> CatalogObjectListResponse:
    service = get_catalog_service(request)
    try:
        return await service.list_objects(search=search, limit=limit)
    except OntologyDependencyUnavailableError as exc:
        raise _http_error(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc
    except OntologyNotReadyError as exc:
        raise _http_error(status.HTTP_409_CONFLICT, str(exc)) from exc
    except OntologyError as exc:
        raise _http_error(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc


@router.get("/objects/{catalog_key}", response_model=CatalogObjectDetailResponse)
async def get_catalog_object_detail(
    catalog_key: str,
    request: Request,
) -> CatalogObjectDetailResponse:
    service = get_catalog_service(request)
    try:
        return await service.object_detail(catalog_key=catalog_key)
    except ValueError as exc:
        raise _http_error(status.HTTP_404_NOT_FOUND, str(exc)) from exc
    except OntologyDependencyUnavailableError as exc:
        raise _http_error(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc
    except OntologyNotReadyError as exc:
        raise _http_error(status.HTTP_409_CONFLICT, str(exc)) from exc
    except OntologyError as exc:
        raise _http_error(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc


@router.get("/objects/{catalog_key}/instances", response_model=CatalogObjectInstancesResponse)
async def get_catalog_object_instances(
    catalog_key: str,
    request: Request,
    page: int = Query(default=0, ge=0),
    size: int = Query(default=50, ge=1, le=200),
) -> CatalogObjectInstancesResponse:
    service = get_catalog_service(request)
    try:
        return await service.object_instances(catalog_key=catalog_key, page=page, size=size)
    except ValueError as exc:
        raise _http_error(status.HTTP_404_NOT_FOUND, str(exc)) from exc
    except (OntologyDependencyUnavailableError, HistoryDependencyUnavailableError) as exc:
        raise _http_error(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc
    except OntologyNotReadyError as exc:
        raise _http_error(status.HTTP_409_CONFLICT, str(exc)) from exc
    except (OntologyError, HistoryError) as exc:
        raise _http_error(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc


@router.get("/actions", response_model=CatalogActionListResponse)
async def list_catalog_actions(
    request: Request,
    search: str = Query(default="", max_length=120),
    limit: int = Query(default=200, ge=1, le=500),
) -> CatalogActionListResponse:
    service = get_catalog_service(request)
    try:
        return await service.list_actions(search=search, limit=limit)
    except OntologyDependencyUnavailableError as exc:
        raise _http_error(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc
    except OntologyNotReadyError as exc:
        raise _http_error(status.HTTP_409_CONFLICT, str(exc)) from exc
    except OntologyError as exc:
        raise _http_error(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc


@router.get("/actions/{catalog_key}", response_model=CatalogActionDetailResponse)
async def get_catalog_action_detail(
    catalog_key: str,
    request: Request,
) -> CatalogActionDetailResponse:
    service = get_catalog_service(request)
    try:
        return await service.action_detail(catalog_key=catalog_key)
    except ValueError as exc:
        raise _http_error(status.HTTP_404_NOT_FOUND, str(exc)) from exc
    except OntologyDependencyUnavailableError as exc:
        raise _http_error(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc
    except OntologyNotReadyError as exc:
        raise _http_error(status.HTTP_409_CONFLICT, str(exc)) from exc
    except OntologyError as exc:
        raise _http_error(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc


@router.get("/actions/{catalog_key}/runs", response_model=CatalogActionRunsResponse)
async def get_catalog_action_runs(
    catalog_key: str,
    request: Request,
    page: int = Query(default=1, ge=1),
    size: int = Query(default=20, ge=1, le=200),
    action_status: ActionStatus | None = Query(default=None, alias="status"),
) -> CatalogActionRunsResponse:
    service = get_catalog_service(request)
    try:
        return await service.action_runs(
            catalog_key=catalog_key,
            page=page,
            size=size,
            status=action_status,
        )
    except ValueError as exc:
        raise _http_error(status.HTTP_404_NOT_FOUND, str(exc)) from exc
    except (OntologyDependencyUnavailableError, ActionDependencyUnavailableError) as exc:
        raise _http_error(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc
    except OntologyNotReadyError as exc:
        raise _http_error(status.HTTP_409_CONFLICT, str(exc)) from exc
    except (OntologyError, ActionError) as exc:
        raise _http_error(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc


@router.get("/events", response_model=CatalogEventListResponse)
async def list_catalog_events(
    request: Request,
    search: str = Query(default="", max_length=120),
    limit: int = Query(default=200, ge=1, le=500),
) -> CatalogEventListResponse:
    service = get_catalog_service(request)
    try:
        return await service.list_events(search=search, limit=limit)
    except OntologyDependencyUnavailableError as exc:
        raise _http_error(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc
    except OntologyNotReadyError as exc:
        raise _http_error(status.HTTP_409_CONFLICT, str(exc)) from exc
    except OntologyError as exc:
        raise _http_error(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc


@router.get("/events/{catalog_key}", response_model=CatalogEventDetailResponse)
async def get_catalog_event_detail(
    catalog_key: str,
    request: Request,
) -> CatalogEventDetailResponse:
    service = get_catalog_service(request)
    try:
        return await service.event_detail(catalog_key=catalog_key)
    except ValueError as exc:
        raise _http_error(status.HTTP_404_NOT_FOUND, str(exc)) from exc
    except OntologyDependencyUnavailableError as exc:
        raise _http_error(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc
    except OntologyNotReadyError as exc:
        raise _http_error(status.HTTP_409_CONFLICT, str(exc)) from exc
    except OntologyError as exc:
        raise _http_error(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc


@router.get("/events/{catalog_key}/occurrences", response_model=CatalogEventOccurrencesResponse)
async def get_catalog_event_occurrences(
    catalog_key: str,
    request: Request,
    limit: int = Query(default=200, ge=1, le=1000),
) -> CatalogEventOccurrencesResponse:
    service = get_catalog_service(request)
    try:
        return await service.event_occurrences(catalog_key=catalog_key, limit=limit)
    except ValueError as exc:
        raise _http_error(status.HTTP_404_NOT_FOUND, str(exc)) from exc
    except (OntologyDependencyUnavailableError, HistoryDependencyUnavailableError) as exc:
        raise _http_error(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc
    except OntologyNotReadyError as exc:
        raise _http_error(status.HTTP_409_CONFLICT, str(exc)) from exc
    except (OntologyError, HistoryError) as exc:
        raise _http_error(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc


@router.get("/triggers", response_model=CatalogTriggerListResponse)
async def list_catalog_triggers(
    request: Request,
    search: str = Query(default="", max_length=120),
    limit: int = Query(default=200, ge=1, le=500),
) -> CatalogTriggerListResponse:
    service = get_catalog_service(request)
    try:
        return await service.list_triggers(search=search, limit=limit)
    except OntologyDependencyUnavailableError as exc:
        raise _http_error(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc
    except OntologyNotReadyError as exc:
        raise _http_error(status.HTTP_409_CONFLICT, str(exc)) from exc
    except OntologyError as exc:
        raise _http_error(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc


@router.get("/triggers/{catalog_key}", response_model=CatalogTriggerDetailResponse)
async def get_catalog_trigger_detail(
    catalog_key: str,
    request: Request,
) -> CatalogTriggerDetailResponse:
    service = get_catalog_service(request)
    try:
        return await service.trigger_detail(catalog_key=catalog_key)
    except ValueError as exc:
        raise _http_error(status.HTTP_404_NOT_FOUND, str(exc)) from exc
    except OntologyDependencyUnavailableError as exc:
        raise _http_error(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc
    except OntologyNotReadyError as exc:
        raise _http_error(status.HTTP_409_CONFLICT, str(exc)) from exc
    except OntologyError as exc:
        raise _http_error(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc


@router.get("/triggers/{catalog_key}/firings", response_model=CatalogTriggerFiringsResponse)
async def get_catalog_trigger_firings(
    catalog_key: str,
    request: Request,
    limit: int = Query(default=200, ge=1, le=1000),
) -> CatalogTriggerFiringsResponse:
    service = get_catalog_service(request)
    try:
        return await service.trigger_firings(catalog_key=catalog_key, limit=limit)
    except ValueError as exc:
        raise _http_error(status.HTTP_404_NOT_FOUND, str(exc)) from exc
    except (OntologyDependencyUnavailableError, HistoryDependencyUnavailableError) as exc:
        raise _http_error(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc
    except OntologyNotReadyError as exc:
        raise _http_error(status.HTTP_409_CONFLICT, str(exc)) from exc
    except (OntologyError, HistoryError) as exc:
        raise _http_error(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc


def _http_error(status_code: int, detail: str | dict[str, Any]) -> HTTPException:
    return HTTPException(status_code=status_code, detail=detail)
