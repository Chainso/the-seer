"""Action orchestration API endpoints."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel, Field, field_validator

from seer_backend.actions.errors import (
    ActionConflictError,
    ActionDependencyUnavailableError,
    ActionError,
    ActionNotFoundError,
    ActionValidationError,
)
from seer_backend.actions.models import ActionRecord, InstanceStatus
from seer_backend.ontology.errors import OntologyDependencyUnavailableError, OntologyError
from seer_backend.ontology.models import assert_valid_iri

router = APIRouter(prefix="/actions", tags=["actions"])


class ActionSubmitRequest(BaseModel):
    user_id: str = Field(min_length=1, max_length=255)
    action_uri: str = Field(min_length=1, max_length=2048)
    payload: dict[str, Any] = Field(default_factory=dict)
    idempotency_key: str | None = Field(default=None, min_length=1, max_length=255)
    priority: int | None = None

    @field_validator("action_uri")
    @classmethod
    def validate_action_uri(cls, action_uri: str) -> str:
        return assert_valid_iri(action_uri.strip())

    @field_validator("idempotency_key")
    @classmethod
    def normalize_idempotency_key(cls, idempotency_key: str | None) -> str | None:
        if idempotency_key is None:
            return None
        normalized = idempotency_key.strip()
        return normalized if normalized else None


class ActionSubmitValidationIssue(BaseModel):
    code: str
    message: str
    field: str | None = None


class ActionSubmitValidationDetail(BaseModel):
    message: str
    issues: list[ActionSubmitValidationIssue] = Field(default_factory=list)


class ActionSubmitResponse(BaseModel):
    action_id: UUID
    status: Literal["queued"] = "queued"
    ontology_release_id: str
    dedupe_hit: bool


class ActionClaimRequest(BaseModel):
    user_id: str = Field(min_length=1, max_length=255)
    instance_id: str = Field(min_length=1, max_length=255)
    capacity: int = Field(ge=1, le=10_000)
    max_actions: int | None = Field(default=None, ge=1, le=10_000)


class ClaimedAction(BaseModel):
    action_id: UUID
    action_uri: str
    payload: dict[str, Any] = Field(default_factory=dict)
    ontology_release_id: str
    attempt_no: int
    lease_owner_instance_id: str
    lease_expires_at: datetime
    priority: int


class ActionClaimResponse(BaseModel):
    user_id: str
    instance_id: str
    lease_seconds: int
    claimed_count: int
    actions: list[ClaimedAction] = Field(default_factory=list)


class InstanceHeartbeatRequest(BaseModel):
    user_id: str = Field(min_length=1, max_length=255)
    instance_id: str = Field(min_length=1, max_length=255)
    status: Literal["active", "draining"] | None = None
    capacity: int | None = Field(default=None, ge=1, le=10_000)
    metadata: dict[str, Any] | None = None


class InstanceHeartbeatResponse(BaseModel):
    user_id: str
    instance_id: str
    status: Literal["active", "draining"]
    last_seen_at: datetime
    capacity: int | None
    metadata: dict[str, Any] | None = None


class ActionCompleteRequest(BaseModel):
    instance_id: str = Field(min_length=1, max_length=255)


class ActionFailRequest(BaseModel):
    instance_id: str = Field(min_length=1, max_length=255)
    error_code: str = Field(min_length=1, max_length=255)
    error_detail: str | None = Field(default=None, max_length=4096)

    @field_validator("error_code")
    @classmethod
    def normalize_error_code(cls, error_code: str) -> str:
        normalized = error_code.strip().lower()
        if not normalized:
            raise ValueError("error_code must not be blank")
        return normalized


class ActionLifecycleResponse(BaseModel):
    action_id: UUID
    status: Literal["completed", "retry_wait", "failed_terminal", "dead_letter"]
    attempt_count: int
    max_attempts: int
    next_visible_at: datetime
    lease_owner_instance_id: str | None = None
    lease_expires_at: datetime | None = None
    completed_at: datetime | None = None
    last_error_code: str | None = None
    last_error_detail: str | None = None


@router.post("/submit", response_model=ActionSubmitResponse)
async def submit_action(
    payload: ActionSubmitRequest,
    request: Request,
) -> ActionSubmitResponse:
    actions_service = request.app.state.actions_service
    ontology_service = request.app.state.ontology_service
    try:
        result = await actions_service.submit_action(
            ontology_service=ontology_service,
            user_id=payload.user_id,
            action_uri=payload.action_uri,
            payload=payload.payload,
            idempotency_key=payload.idempotency_key,
            priority=payload.priority,
        )
    except ActionValidationError as exc:
        raise _http_error(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            _validation_error_detail(exc),
        ) from exc
    except (ActionDependencyUnavailableError, OntologyDependencyUnavailableError) as exc:
        raise _http_error(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc
    except (ActionError, OntologyError) as exc:
        raise _http_error(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc

    return ActionSubmitResponse(
        action_id=result.action.action_id,
        status="queued",
        ontology_release_id=result.action.ontology_release_id,
        dedupe_hit=result.dedupe_hit,
    )


@router.post("/claim", response_model=ActionClaimResponse)
async def claim_actions(
    payload: ActionClaimRequest,
    request: Request,
) -> ActionClaimResponse:
    actions_service = request.app.state.actions_service
    settings = request.app.state.settings
    claim_size = (
        min(payload.capacity, payload.max_actions)
        if payload.max_actions is not None
        else payload.capacity
    )
    try:
        claimed = await actions_service.claim_actions(
            user_id=payload.user_id,
            instance_id=payload.instance_id,
            capacity=payload.capacity,
            max_actions=claim_size,
            lease_seconds=settings.actions_lease_seconds,
        )
    except ActionDependencyUnavailableError as exc:
        raise _http_error(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc
    except ActionError as exc:
        raise _http_error(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc

    actions = [
        ClaimedAction(
            action_id=row.action_id,
            action_uri=row.action_uri,
            payload=row.input_payload,
            ontology_release_id=row.ontology_release_id,
            attempt_no=row.attempt_count,
            lease_owner_instance_id=row.lease_owner_instance_id or payload.instance_id,
            lease_expires_at=row.lease_expires_at or row.updated_at,
            priority=row.priority,
        )
        for row in claimed
    ]
    return ActionClaimResponse(
        user_id=payload.user_id,
        instance_id=payload.instance_id,
        lease_seconds=settings.actions_lease_seconds,
        claimed_count=len(actions),
        actions=actions,
    )


@router.post("/{action_id}/complete", response_model=ActionLifecycleResponse)
async def complete_action(
    action_id: UUID,
    payload: ActionCompleteRequest,
    request: Request,
) -> ActionLifecycleResponse:
    actions_service = request.app.state.actions_service
    try:
        action = await actions_service.complete_action(
            action_id=action_id,
            instance_id=payload.instance_id,
        )
    except ActionNotFoundError as exc:
        raise _http_error(status.HTTP_404_NOT_FOUND, str(exc)) from exc
    except ActionConflictError as exc:
        raise _http_error(
            status.HTTP_409_CONFLICT,
            {"code": exc.code, "message": exc.message},
        ) from exc
    except ActionValidationError as exc:
        raise _http_error(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            _validation_error_detail(exc),
        ) from exc
    except ActionDependencyUnavailableError as exc:
        raise _http_error(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc
    except ActionError as exc:
        raise _http_error(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc
    return _lifecycle_response(action)


@router.post("/{action_id}/fail", response_model=ActionLifecycleResponse)
async def fail_action(
    action_id: UUID,
    payload: ActionFailRequest,
    request: Request,
) -> ActionLifecycleResponse:
    actions_service = request.app.state.actions_service
    try:
        action = await actions_service.fail_action(
            action_id=action_id,
            instance_id=payload.instance_id,
            error_code=payload.error_code,
            error_detail=payload.error_detail,
        )
    except ActionNotFoundError as exc:
        raise _http_error(status.HTTP_404_NOT_FOUND, str(exc)) from exc
    except ActionConflictError as exc:
        raise _http_error(
            status.HTTP_409_CONFLICT,
            {"code": exc.code, "message": exc.message},
        ) from exc
    except ActionValidationError as exc:
        raise _http_error(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            _validation_error_detail(exc),
        ) from exc
    except ActionDependencyUnavailableError as exc:
        raise _http_error(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc
    except ActionError as exc:
        raise _http_error(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc
    return _lifecycle_response(action)


@router.post("/instances/heartbeat", response_model=InstanceHeartbeatResponse)
async def heartbeat_instance(
    payload: InstanceHeartbeatRequest,
    request: Request,
) -> InstanceHeartbeatResponse:
    actions_service = request.app.state.actions_service
    heartbeat_status = (
        InstanceStatus(payload.status) if payload.status is not None else None
    )
    try:
        instance = await actions_service.heartbeat_instance(
            user_id=payload.user_id,
            instance_id=payload.instance_id,
            status=heartbeat_status,
            capacity=payload.capacity,
            metadata=payload.metadata,
        )
    except ActionDependencyUnavailableError as exc:
        raise _http_error(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc
    except ActionError as exc:
        raise _http_error(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc

    return InstanceHeartbeatResponse(
        user_id=instance.user_id,
        instance_id=instance.instance_id,
        status=instance.status.value,
        last_seen_at=instance.last_seen_at,
        capacity=instance.capacity,
        metadata=instance.metadata,
    )


def _validation_error_detail(exc: ActionValidationError) -> dict[str, Any]:
    return ActionSubmitValidationDetail(
        message=exc.message,
        issues=[
            ActionSubmitValidationIssue(
                code=issue.code,
                message=issue.message,
                field=issue.field,
            )
            for issue in exc.issues
        ],
    ).model_dump()


def _lifecycle_response(action: ActionRecord) -> ActionLifecycleResponse:
    return ActionLifecycleResponse(
        action_id=action.action_id,
        status=action.status.value,
        attempt_count=action.attempt_count,
        max_attempts=action.max_attempts,
        next_visible_at=action.next_visible_at,
        lease_owner_instance_id=action.lease_owner_instance_id,
        lease_expires_at=action.lease_expires_at,
        completed_at=action.completed_at,
        last_error_code=action.last_error_code,
        last_error_detail=action.last_error_detail,
    )


def _http_error(status_code: int, detail: Any) -> HTTPException:
    return HTTPException(status_code=status_code, detail=detail)
