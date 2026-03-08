"""Agentic workflow execution list/detail/message API endpoints."""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator
from datetime import datetime
from pathlib import Path
from typing import Any, Literal
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, Request, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from seer_backend.actions.models import ActionStatus
from seer_backend.agent_orchestration import ClickHouseAgentTranscriptRepository
from seer_backend.agent_orchestration.errors import (
    AgentOrchestrationDependencyUnavailableError,
    AgentOrchestrationError,
)
from seer_backend.agent_orchestration.models import (
    AgentExecutionActionSummary,
    AgentExecutionEventSummary,
    AgentExecutionMessage,
    AgentExecutionMessagesPage,
    AgentExecutionSummary,
)
from seer_backend.agent_orchestration.service import (
    AgentOrchestrationService,
    AgentTranscriptService,
    UnavailableAgentOrchestrationService,
    is_terminal_status,
)
from seer_backend.config.settings import Settings

router = APIRouter(prefix="/agentic-workflows", tags=["agentic-workflows"])


class AgenticWorkflowActionSummaryResponse(BaseModel):
    action_id: UUID
    user_id: str
    action_uri: str
    action_kind: Literal["process", "workflow", "agentic_workflow"]
    status: Literal[
        "queued",
        "running",
        "completed",
        "retry_wait",
        "failed_terminal",
        "dead_letter",
    ]
    parent_execution_id: UUID | None = None
    attempt_count: int
    max_attempts: int
    submitted_at: datetime
    updated_at: datetime
    completed_at: datetime | None = None
    lease_owner_instance_id: str | None = None
    lease_expires_at: datetime | None = None
    last_error_code: str | None = None
    last_error_detail: str | None = None


class AgenticWorkflowExecutionSummaryResponse(BaseModel):
    action: AgenticWorkflowActionSummaryResponse
    transcript_message_count: int
    last_transcript_persisted_at: datetime | None = None


class AgenticWorkflowExecutionListResponse(BaseModel):
    user_id: str
    status: str | None = None
    workflow_uri: str | None = None
    search: str | None = None
    page: int
    size: int
    total: int
    executions: list[AgenticWorkflowExecutionSummaryResponse] = Field(default_factory=list)


class AgenticWorkflowEventSummaryResponse(BaseModel):
    event_id: UUID
    occurred_at: datetime
    event_type: str
    source: str
    payload: dict[str, Any]
    trace_id: str | None = None
    attributes: dict[str, Any] | None = None
    produced_by_execution_id: UUID | None = None
    ingested_at: datetime


class AgenticWorkflowExecutionDetailResponse(BaseModel):
    execution: AgenticWorkflowExecutionSummaryResponse
    parent_execution: AgenticWorkflowActionSummaryResponse | None = None
    child_executions: list[AgenticWorkflowActionSummaryResponse] = Field(default_factory=list)
    produced_events: list[AgenticWorkflowEventSummaryResponse] = Field(default_factory=list)


class AgenticWorkflowTranscriptMessageResponse(BaseModel):
    ordinal: int
    execution_id: UUID
    workflow_uri: str
    attempt_no: int
    sequence_no: int
    role: Literal["system", "user", "assistant", "tool"]
    message_kind: str | None = None
    call_id: str | None = None
    message: dict[str, Any]
    persisted_at: datetime


class AgenticWorkflowMessagesResponse(BaseModel):
    execution_id: UUID
    workflow_uri: str
    total_messages: int
    returned_messages: int
    last_ordinal: int
    messages: list[AgenticWorkflowTranscriptMessageResponse] = Field(default_factory=list)


class AgenticWorkflowTranscriptSnapshotResponse(BaseModel):
    execution_id: UUID
    workflow_uri: str
    status: Literal[
        "queued",
        "running",
        "completed",
        "retry_wait",
        "failed_terminal",
        "dead_letter",
    ]
    attempt_count: int
    last_ordinal: int
    updated_at: datetime
    terminal: bool


def build_agent_orchestration_service(
    app: Any,
    settings: Settings,
) -> AgentOrchestrationService | UnavailableAgentOrchestrationService:
    try:
        backend_root = Path(__file__).resolve().parents[3]
        migrations_dir = Path(settings.clickhouse_migrations_dir)
        if not migrations_dir.is_absolute():
            migrations_dir = backend_root / migrations_dir

        transcript_repository = ClickHouseAgentTranscriptRepository(
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
        transcript_service = AgentTranscriptService(repository=transcript_repository)
        return AgentOrchestrationService(
            actions_service=app.state.actions_service,
            history_service=app.state.history_service,
            transcript_service=transcript_service,
        )
    except Exception as exc:  # pragma: no cover - exercised via fallback behavior
        return UnavailableAgentOrchestrationService(
            f"agent orchestration service initialization failed: {exc}"
        )


def inject_agent_orchestration_service(app: Any, settings: Settings) -> None:
    app.state.agent_orchestration_service = build_agent_orchestration_service(app, settings)


def get_agent_orchestration_service(
    request: Request,
) -> AgentOrchestrationService | UnavailableAgentOrchestrationService:
    return request.app.state.agent_orchestration_service


@router.get("/executions", response_model=AgenticWorkflowExecutionListResponse)
async def list_agentic_workflow_executions(
    request: Request,
    user_id: str = Query(min_length=1, max_length=255),
    execution_status: ActionStatus | None = Query(default=None, alias="status"),
    workflow_uri: str | None = Query(default=None, min_length=1, max_length=2048),
    search: str | None = Query(default=None, min_length=1, max_length=255),
    page: int = Query(default=1, ge=1, le=10_000),
    size: int = Query(default=20, ge=1, le=200),
    submitted_after: datetime | None = None,
    submitted_before: datetime | None = None,
) -> AgenticWorkflowExecutionListResponse:
    if (
        submitted_after is not None
        and submitted_before is not None
        and submitted_after > submitted_before
    ):
        raise _http_error(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            {
                "code": "invalid_time_window",
                "message": "submitted_after must be earlier than or equal to submitted_before.",
            },
        )

    service = get_agent_orchestration_service(request)
    try:
        executions, total = await service.list_executions(
            user_id=user_id,
            status=execution_status,
            workflow_uri=workflow_uri,
            search=search,
            page=page,
            size=size,
            submitted_after=submitted_after,
            submitted_before=submitted_before,
        )
    except AgentOrchestrationDependencyUnavailableError as exc:
        raise _http_error(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc
    except AgentOrchestrationError as exc:
        raise _http_error(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc

    return AgenticWorkflowExecutionListResponse(
        user_id=user_id,
        status=execution_status.value if execution_status is not None else None,
        workflow_uri=workflow_uri,
        search=search,
        page=page,
        size=size,
        total=total,
        executions=[_execution_summary_response(item) for item in executions],
    )


@router.get(
    "/executions/{execution_id}",
    response_model=AgenticWorkflowExecutionDetailResponse,
)
async def get_agentic_workflow_execution_detail(
    execution_id: UUID,
    request: Request,
) -> AgenticWorkflowExecutionDetailResponse:
    service = get_agent_orchestration_service(request)
    try:
        detail = await service.get_execution_detail(execution_id)
    except ValueError as exc:
        raise _http_error(status.HTTP_404_NOT_FOUND, str(exc)) from exc
    except AgentOrchestrationDependencyUnavailableError as exc:
        raise _http_error(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc
    except AgentOrchestrationError as exc:
        raise _http_error(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc

    return AgenticWorkflowExecutionDetailResponse(
        execution=_execution_summary_response(detail.execution),
        parent_execution=_action_summary_response(detail.parent_execution)
        if detail.parent_execution
        else None,
        child_executions=[
            _action_summary_response(child_execution)
            for child_execution in detail.child_executions
        ],
        produced_events=[
            _event_summary_response(produced_event)
            for produced_event in detail.produced_events
        ],
    )


@router.get(
    "/executions/{execution_id}/messages",
    response_model=AgenticWorkflowMessagesResponse,
)
async def get_agentic_workflow_execution_messages(
    execution_id: UUID,
    request: Request,
    after_ordinal: int = Query(default=0, ge=0),
    limit: int = Query(default=200, ge=1, le=1000),
) -> AgenticWorkflowMessagesResponse:
    service = get_agent_orchestration_service(request)
    try:
        messages_page = await service.get_execution_messages(
            execution_id,
            after_ordinal=after_ordinal,
            limit=limit,
        )
    except ValueError as exc:
        raise _http_error(status.HTTP_404_NOT_FOUND, str(exc)) from exc
    except AgentOrchestrationDependencyUnavailableError as exc:
        raise _http_error(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc
    except AgentOrchestrationError as exc:
        raise _http_error(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc

    return _messages_response(messages_page)


@router.get("/executions/{execution_id}/messages/stream")
async def stream_agentic_workflow_execution_messages(
    execution_id: UUID,
    request: Request,
    after_ordinal: int = Query(default=0, ge=0),
    limit: int = Query(default=200, ge=1, le=1000),
    poll_interval_ms: int = Query(default=500, ge=50, le=10_000),
) -> StreamingResponse:
    service = get_agent_orchestration_service(request)
    try:
        initial_status = await service.get_execution_status(execution_id)
        initial_messages = await service.get_execution_messages(
            execution_id,
            after_ordinal=after_ordinal,
            limit=limit,
        )
    except ValueError as exc:
        raise _http_error(status.HTTP_404_NOT_FOUND, str(exc)) from exc
    except AgentOrchestrationDependencyUnavailableError as exc:
        raise _http_error(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc
    except AgentOrchestrationError as exc:
        raise _http_error(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc

    interval_seconds = poll_interval_ms / 1000.0

    async def event_stream() -> AsyncIterator[str]:
        last_ordinal = initial_messages.last_ordinal
        yield _sse_event(
            "snapshot",
            _snapshot_payload(
                execution_id=execution_id,
                workflow_uri=initial_messages.workflow_uri,
                status_summary=initial_status,
                last_ordinal=last_ordinal,
            ),
        )
        if is_terminal_status(initial_status.status):
            yield _sse_event(
                "terminal",
                _snapshot_payload(
                    execution_id=execution_id,
                    workflow_uri=initial_messages.workflow_uri,
                    status_summary=initial_status,
                    last_ordinal=last_ordinal,
                ),
            )
            return

        while True:
            if await request.is_disconnected():
                return
            await asyncio.sleep(interval_seconds)
            try:
                page = await service.get_execution_messages(
                    execution_id,
                    after_ordinal=last_ordinal,
                    limit=limit,
                )
                for message in page.messages:
                    yield _sse_event("message", _message_response(message).model_dump(mode="json"))
                last_ordinal = page.last_ordinal
                current_status = await service.get_execution_status(execution_id)
            except ValueError as exc:
                yield _sse_event(
                    "error",
                    {
                        "status_code": status.HTTP_404_NOT_FOUND,
                        "code": "not_found",
                        "message": str(exc),
                    },
                )
                return
            except AgentOrchestrationDependencyUnavailableError as exc:
                yield _sse_event(
                    "error",
                    {
                        "status_code": status.HTTP_503_SERVICE_UNAVAILABLE,
                        "code": "dependency_unavailable",
                        "message": str(exc),
                    },
                )
                return
            except AgentOrchestrationError as exc:
                yield _sse_event(
                    "error",
                    {
                        "status_code": status.HTTP_502_BAD_GATEWAY,
                        "code": "agent_orchestration_error",
                        "message": str(exc),
                    },
                )
                return

            if is_terminal_status(current_status.status):
                yield _sse_event(
                    "terminal",
                    _snapshot_payload(
                        execution_id=execution_id,
                        workflow_uri=page.workflow_uri,
                        status_summary=current_status,
                        last_ordinal=last_ordinal,
                    ),
                )
                return

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


def _action_summary_response(
    action: AgentExecutionActionSummary,
) -> AgenticWorkflowActionSummaryResponse:
    return AgenticWorkflowActionSummaryResponse(
        action_id=action.action_id,
        user_id=action.user_id,
        action_uri=action.action_uri,
        action_kind=action.action_kind.value,
        status=action.status.value,
        parent_execution_id=action.parent_execution_id,
        attempt_count=action.attempt_count,
        max_attempts=action.max_attempts,
        submitted_at=action.submitted_at,
        updated_at=action.updated_at,
        completed_at=action.completed_at,
        lease_owner_instance_id=action.lease_owner_instance_id,
        lease_expires_at=action.lease_expires_at,
        last_error_code=action.last_error_code,
        last_error_detail=action.last_error_detail,
    )


def _execution_summary_response(
    execution: AgentExecutionSummary,
) -> AgenticWorkflowExecutionSummaryResponse:
    return AgenticWorkflowExecutionSummaryResponse(
        action=_action_summary_response(execution.action),
        transcript_message_count=execution.transcript_message_count,
        last_transcript_persisted_at=execution.last_transcript_persisted_at,
    )


def _event_summary_response(
    event: AgentExecutionEventSummary,
) -> AgenticWorkflowEventSummaryResponse:
    return AgenticWorkflowEventSummaryResponse(
        event_id=event.event_id,
        occurred_at=event.occurred_at,
        event_type=event.event_type,
        source=event.source,
        payload=event.payload,
        trace_id=event.trace_id,
        attributes=event.attributes,
        produced_by_execution_id=event.produced_by_execution_id,
        ingested_at=event.ingested_at,
    )


def _message_response(
    message: AgentExecutionMessage,
) -> AgenticWorkflowTranscriptMessageResponse:
    return AgenticWorkflowTranscriptMessageResponse(
        ordinal=message.ordinal,
        execution_id=message.execution_id,
        workflow_uri=message.workflow_uri,
        attempt_no=message.attempt_no,
        sequence_no=message.sequence_no,
        role=message.message_role,
        message_kind=message.message_kind,
        call_id=message.call_id,
        message=message.message_json,
        persisted_at=message.persisted_at,
    )


def _messages_response(page: AgentExecutionMessagesPage) -> AgenticWorkflowMessagesResponse:
    return AgenticWorkflowMessagesResponse(
        execution_id=page.execution_id,
        workflow_uri=page.workflow_uri,
        total_messages=page.total_messages,
        returned_messages=page.returned_messages,
        last_ordinal=page.last_ordinal,
        messages=[_message_response(message) for message in page.messages],
    )


def _snapshot_payload(
    *,
    execution_id: UUID,
    workflow_uri: str,
    status_summary: AgentExecutionActionSummary,
    last_ordinal: int,
) -> dict[str, Any]:
    return AgenticWorkflowTranscriptSnapshotResponse(
        execution_id=execution_id,
        workflow_uri=workflow_uri,
        status=status_summary.status.value,
        attempt_count=status_summary.attempt_count,
        last_ordinal=last_ordinal,
        updated_at=status_summary.updated_at,
        terminal=is_terminal_status(status_summary.status),
    ).model_dump(mode="json")


def _sse_event(event: str, payload: dict[str, Any]) -> str:
    serialized = json.dumps(payload, separators=(",", ":"))
    lines = [f"event: {event}"]
    for line in serialized.splitlines() or [""]:
        lines.append(f"data: {line}")
    lines.append("")
    return "\n".join(lines) + "\n"


def _http_error(status_code: int, detail: Any) -> HTTPException:
    return HTTPException(status_code=status_code, detail=detail)
