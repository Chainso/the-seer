"""Agent transcript request/response and persistence models."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from seer_backend.actions.models import ActionKind, ActionStatus

JsonObject = dict[str, Any]
MessageRole = Literal["system", "user", "assistant", "tool"]


class AgentTranscriptMessage(BaseModel):
    """Canonical persisted completion message for managed-agent runs."""

    model_config = ConfigDict(extra="allow")

    role: MessageRole
    content: Any = None
    tool_calls: list[dict[str, Any]] = Field(default_factory=list)
    tool_call_id: str | None = None
    name: str | None = None


@dataclass(slots=True)
class AgentTranscriptMessageRecord:
    execution_id: UUID
    action_uri: str
    attempt_no: int
    sequence_no: int
    message_role: MessageRole
    message_kind: str | None
    call_id: str | None
    message_json: JsonObject
    persisted_at: datetime


@dataclass(slots=True)
class AgentTranscriptResumeState:
    execution_id: UUID
    action_uri: str | None
    attempt_no: int
    next_sequence_no: int
    completion_messages: list[JsonObject]


@dataclass(slots=True)
class AgentExecutionMessage:
    ordinal: int
    execution_id: UUID
    action_uri: str
    attempt_no: int
    sequence_no: int
    message_role: MessageRole
    message_kind: str | None
    call_id: str | None
    message_json: JsonObject
    persisted_at: datetime


@dataclass(slots=True)
class AgentExecutionActionSummary:
    action_id: UUID
    user_id: str
    action_uri: str
    action_kind: ActionKind
    status: ActionStatus
    parent_execution_id: UUID | None
    attempt_count: int
    max_attempts: int
    submitted_at: datetime
    updated_at: datetime
    completed_at: datetime | None
    lease_owner_instance_id: str | None
    lease_expires_at: datetime | None
    last_error_code: str | None
    last_error_detail: str | None


@dataclass(slots=True)
class AgentExecutionEventSummary:
    event_id: UUID
    occurred_at: datetime
    event_type: str
    source: str
    payload: JsonObject
    trace_id: str | None
    attributes: JsonObject | None
    produced_by_execution_id: UUID | None
    ingested_at: datetime


@dataclass(slots=True)
class AgentExecutionSummary:
    action: AgentExecutionActionSummary
    transcript_message_count: int
    last_transcript_persisted_at: datetime | None


@dataclass(slots=True)
class AgentExecutionDetail:
    execution: AgentExecutionSummary
    parent_execution: AgentExecutionActionSummary | None
    child_executions: list[AgentExecutionActionSummary]
    produced_events: list[AgentExecutionEventSummary]


@dataclass(slots=True)
class AgentExecutionMessagesPage:
    execution_id: UUID
    action_uri: str
    total_messages: int
    returned_messages: int
    last_ordinal: int
    messages: list[AgentExecutionMessage]
