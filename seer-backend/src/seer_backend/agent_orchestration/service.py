"""Transcript persistence and resume orchestration for agentic workflow runs."""

from __future__ import annotations

import asyncio
import hashlib
import re
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from seer_backend.agent_orchestration.models import (
    AgentTranscriptMessage,
    AgentTranscriptMessageRecord,
    AgentTranscriptResumeState,
)
from seer_backend.agent_orchestration.repository import AgentTranscriptRepository

_TOOL_CALL_ID_MAX_LENGTH = 120


class AgentTranscriptService:
    """Domain service for canonical append-only agent transcript persistence."""

    def __init__(self, repository: AgentTranscriptRepository) -> None:
        self._repository = repository
        self._schema_ready = False
        self._schema_lock = asyncio.Lock()

    async def append_completion_messages(
        self,
        *,
        execution_id: UUID,
        workflow_uri: str,
        attempt_no: int,
        completion_messages: list[dict[str, Any] | AgentTranscriptMessage],
    ) -> list[AgentTranscriptMessageRecord]:
        await self._ensure_schema()
        normalized_workflow_uri = workflow_uri.strip()
        if not normalized_workflow_uri:
            raise ValueError("workflow_uri must not be blank")
        if attempt_no < 1:
            raise ValueError("attempt_no must be >= 1")
        if not completion_messages:
            return []

        persisted_at = datetime.now(UTC)
        next_sequence_no = (
            await self._repository.fetch_max_sequence_no(
                execution_id=execution_id,
                attempt_no=attempt_no,
            )
        ) + 1
        records: list[AgentTranscriptMessageRecord] = []
        for offset, raw_message in enumerate(completion_messages):
            message_json = _normalize_completion_message(raw_message)
            message_role = message_json["role"]
            message_kind = _message_kind(message_json)
            call_id = _call_id(message_json)
            records.append(
                AgentTranscriptMessageRecord(
                    execution_id=execution_id,
                    workflow_uri=normalized_workflow_uri,
                    attempt_no=attempt_no,
                    sequence_no=next_sequence_no + offset,
                    message_role=message_role,
                    message_kind=message_kind,
                    call_id=call_id,
                    message_json=message_json,
                    persisted_at=persisted_at,
                )
            )
        await self._repository.insert_completion_messages(records)
        return records

    async def load_transcript_messages(
        self,
        *,
        execution_id: UUID,
        attempt_no: int | None = None,
    ) -> list[AgentTranscriptMessageRecord]:
        await self._ensure_schema()
        return await self._repository.fetch_completion_messages(
            execution_id=execution_id,
            attempt_no=attempt_no,
        )

    async def load_resume_state(
        self,
        *,
        execution_id: UUID,
        attempt_no: int,
    ) -> AgentTranscriptResumeState:
        await self._ensure_schema()
        if attempt_no < 1:
            raise ValueError("attempt_no must be >= 1")
        transcript_rows = await self._repository.fetch_completion_messages(
            execution_id=execution_id,
            attempt_no=attempt_no,
        )
        return resume_state_from_records(
            execution_id=execution_id,
            attempt_no=attempt_no,
            records=transcript_rows,
        )

    async def _ensure_schema(self) -> None:
        if self._schema_ready:
            return
        async with self._schema_lock:
            if self._schema_ready:
                return
            await self._repository.ensure_schema()
            self._schema_ready = True


def resume_state_from_records(
    *,
    execution_id: UUID,
    attempt_no: int,
    records: list[AgentTranscriptMessageRecord],
) -> AgentTranscriptResumeState:
    ordered = sorted(records, key=lambda record: (record.attempt_no, record.sequence_no))
    workflow_uri = ordered[-1].workflow_uri if ordered else None
    next_sequence_no = (ordered[-1].sequence_no + 1) if ordered else 1
    return AgentTranscriptResumeState(
        execution_id=execution_id,
        workflow_uri=workflow_uri,
        attempt_no=attempt_no,
        next_sequence_no=next_sequence_no,
        completion_messages=[dict(record.message_json) for record in ordered],
    )


def _normalize_completion_message(
    raw_message: dict[str, Any] | AgentTranscriptMessage,
) -> dict[str, Any]:
    message = (
        raw_message
        if isinstance(raw_message, AgentTranscriptMessage)
        else AgentTranscriptMessage.model_validate(raw_message)
    )
    data = message.model_dump(mode="json", exclude_none=True)
    tool_call_id = data.get("tool_call_id")
    if isinstance(tool_call_id, str) and tool_call_id.strip():
        data["tool_call_id"] = _normalize_tool_call_id(tool_call_id)
    tool_calls = data.get("tool_calls")
    if isinstance(tool_calls, list):
        data["tool_calls"] = _normalize_tool_calls(tool_calls)
    return data


def _normalize_tool_calls(tool_calls: list[Any]) -> list[dict[str, Any]]:
    normalized_calls: list[dict[str, Any]] = []
    for tool_call in tool_calls:
        if not isinstance(tool_call, dict):
            continue
        normalized_call = dict(tool_call)
        call_id = normalized_call.get("id")
        if isinstance(call_id, str) and call_id.strip():
            normalized_call["id"] = _normalize_tool_call_id(call_id)
        normalized_calls.append(normalized_call)
    return normalized_calls


def _normalize_tool_call_id(raw_call_id: str) -> str:
    normalized = raw_call_id.strip()
    if "__sig__" in normalized:
        normalized = normalized.split("__sig__", 1)[0]
    normalized = re.sub(r"[^A-Za-z0-9._:-]+", "_", normalized)
    normalized = normalized.strip("._:-_")
    if (
        normalized
        and len(normalized) <= _TOOL_CALL_ID_MAX_LENGTH
        and normalized.startswith("call")
    ):
        return normalized
    digest = hashlib.sha256(raw_call_id.encode("utf-8")).hexdigest()[:24]
    return f"call_{digest}"


def _message_kind(message_json: dict[str, Any]) -> str | None:
    role = message_json.get("role")
    if role == "tool":
        return "tool_result"
    tool_calls = message_json.get("tool_calls")
    if role == "assistant" and isinstance(tool_calls, list) and tool_calls:
        return "tool_call"
    if role == "assistant":
        return "assistant_message"
    if role == "user":
        return "user_message"
    if role == "system":
        return "system_message"
    return None


def _call_id(message_json: dict[str, Any]) -> str | None:
    tool_call_id = message_json.get("tool_call_id")
    if isinstance(tool_call_id, str) and tool_call_id.strip():
        return tool_call_id

    tool_calls = message_json.get("tool_calls")
    if not isinstance(tool_calls, list) or len(tool_calls) != 1:
        return None
    call_id = tool_calls[0].get("id")
    if not isinstance(call_id, str) or not call_id.strip():
        return None
    return call_id
