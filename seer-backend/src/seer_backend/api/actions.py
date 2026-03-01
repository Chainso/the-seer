"""Action orchestration API endpoints."""

from __future__ import annotations

from typing import Any, Literal
from uuid import UUID

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel, Field, field_validator

from seer_backend.actions.errors import (
    ActionDependencyUnavailableError,
    ActionError,
    ActionValidationError,
)
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
            ActionSubmitValidationDetail(
                message=exc.message,
                issues=[
                    ActionSubmitValidationIssue(
                        code=issue.code,
                        message=issue.message,
                        field=issue.field,
                    )
                    for issue in exc.issues
                ],
            ).model_dump(),
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


def _http_error(status_code: int, detail: Any) -> HTTPException:
    return HTTPException(status_code=status_code, detail=detail)
