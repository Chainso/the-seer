"""Agent transcript request/response and persistence models."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

JsonObject = dict[str, Any]
MessageRole = Literal["system", "user", "assistant", "tool"]


class AgentTranscriptMessage(BaseModel):
    """Canonical persisted completion message for agentic workflow runs."""

    model_config = ConfigDict(extra="allow")

    role: MessageRole
    content: Any = None
    tool_calls: list[dict[str, Any]] = Field(default_factory=list)
    tool_call_id: str | None = None
    name: str | None = None


@dataclass(slots=True)
class AgentTranscriptMessageRecord:
    execution_id: UUID
    workflow_uri: str
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
    workflow_uri: str | None
    attempt_no: int
    next_sequence_no: int
    completion_messages: list[JsonObject]
