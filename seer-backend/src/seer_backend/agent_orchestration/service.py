"""Transcript persistence and query orchestration for managed-agent runs."""

from __future__ import annotations

import asyncio
import hashlib
import re
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from seer_backend.actions.errors import (
    ActionDependencyUnavailableError,
    ActionError,
)
from seer_backend.actions.models import ActionKind, ActionRecord, ActionStatus
from seer_backend.agent_orchestration.errors import (
    AgentOrchestrationDependencyUnavailableError,
)
from seer_backend.agent_orchestration.models import (
    AgentExecutionActionSummary,
    AgentExecutionDetail,
    AgentExecutionEventSummary,
    AgentExecutionMessage,
    AgentExecutionMessagesPage,
    AgentExecutionSummary,
    AgentTranscriptMessage,
    AgentTranscriptMessageRecord,
    AgentTranscriptResumeState,
)
from seer_backend.agent_orchestration.repository import AgentTranscriptRepository
from seer_backend.history.errors import (
    HistoryDependencyUnavailableError,
    HistoryError,
)
from seer_backend.history.models import EventHistoryItem

_TOOL_CALL_ID_MAX_LENGTH = 120
_TERMINAL_ACTION_STATUSES = {
    ActionStatus.COMPLETED,
    ActionStatus.FAILED_TERMINAL,
    ActionStatus.DEAD_LETTER,
}


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
        action_uri: str,
        attempt_no: int,
        completion_messages: list[dict[str, Any] | AgentTranscriptMessage],
    ) -> list[AgentTranscriptMessageRecord]:
        await self._ensure_schema()
        normalized_action_uri = action_uri.strip()
        if not normalized_action_uri:
            raise ValueError("action_uri must not be blank")
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
                    action_uri=normalized_action_uri,
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


class AgentOrchestrationService:
    """Query surface for managed-agent execution list/detail/message views."""

    def __init__(
        self,
        *,
        actions_service: Any,
        history_service: Any,
        transcript_service: AgentTranscriptService,
    ) -> None:
        self._actions_service = actions_service
        self._history_service = history_service
        self._transcript_service = transcript_service

    async def list_executions(
        self,
        *,
        user_id: str | None,
        status: ActionStatus | None,
        action_uri: str | None,
        search: str | None,
        page: int,
        size: int,
        submitted_after: datetime | None,
        submitted_before: datetime | None,
    ) -> tuple[list[AgentExecutionSummary], int]:
        normalized_action_uri = _normalize_optional_text(action_uri)
        normalized_search = _normalize_optional_text(search)
        actions, total = await self._actions_service.list_actions(
            user_id=user_id,
            status=status,
            action_kind=ActionKind.AGENTIC_WORKFLOW,
            action_uri=normalized_action_uri,
            search=normalized_search,
            page=page,
            size=size,
            submitted_after=submitted_after,
            submitted_before=submitted_before,
        )
        summaries = [await self._build_execution_summary(action) for action in actions]
        return summaries, total

    async def get_execution_detail(self, execution_id: UUID) -> AgentExecutionDetail:
        action = await self._load_agentic_execution(execution_id)
        execution = await self._build_execution_summary(action)

        parent_execution = None
        if action.parent_execution_id is not None:
            parent_action = await self._actions_service.get_action(action.parent_execution_id)
            if parent_action is not None:
                parent_execution = _action_summary(parent_action)

        child_actions = await self._actions_service.list_child_actions(
            parent_execution_id=execution_id
        )
        child_summaries = [_action_summary(child_action) for child_action in child_actions]
        produced_event_execution_ids = [
            execution_id,
            *[child_action.action_id for child_action in child_actions],
        ]
        produced_events = await self._load_produced_events(produced_event_execution_ids)
        return AgentExecutionDetail(
            execution=execution,
            parent_execution=parent_execution,
            child_executions=child_summaries,
            produced_events=produced_events,
        )

    async def get_execution_messages(
        self,
        execution_id: UUID,
        *,
        after_ordinal: int = 0,
        limit: int = 200,
    ) -> AgentExecutionMessagesPage:
        action = await self._load_agentic_execution(execution_id)
        transcript_rows = await self._transcript_service.load_transcript_messages(
            execution_id=execution_id
        )
        action_uri = action.action_uri
        messages = _message_page_from_records(
            execution_id=execution_id,
            action_uri=action_uri,
            records=transcript_rows,
            after_ordinal=after_ordinal,
            limit=limit,
        )
        return messages

    async def get_execution_status(self, execution_id: UUID) -> AgentExecutionActionSummary:
        action = await self._load_agentic_execution(execution_id)
        return _action_summary(action)

    async def _build_execution_summary(self, action: ActionRecord) -> AgentExecutionSummary:
        transcript_rows = await self._transcript_service.load_transcript_messages(
            execution_id=action.action_id
        )
        last_persisted_at = transcript_rows[-1].persisted_at if transcript_rows else None
        return AgentExecutionSummary(
            action=_action_summary(action),
            transcript_message_count=len(transcript_rows),
            last_transcript_persisted_at=last_persisted_at,
        )

    async def _load_agentic_execution(self, execution_id: UUID) -> ActionRecord:
        try:
            action = await self._actions_service.get_action(execution_id)
        except ActionDependencyUnavailableError as exc:
            raise AgentOrchestrationDependencyUnavailableError(str(exc)) from exc
        except ActionError as exc:
            raise AgentOrchestrationDependencyUnavailableError(str(exc)) from exc
        if action is None or action.action_kind is not ActionKind.AGENTIC_WORKFLOW:
            raise ValueError(f"managed-agent execution '{execution_id}' was not found")
        return action

    async def _load_produced_events(
        self,
        execution_ids: list[UUID],
    ) -> list[AgentExecutionEventSummary]:
        unique_ids = list(dict.fromkeys(execution_ids))
        if not unique_ids:
            return []
        try:
            timeline = await self._history_service.produced_events(
                produced_by_execution_ids=unique_ids,
                limit=200,
            )
        except HistoryDependencyUnavailableError as exc:
            raise AgentOrchestrationDependencyUnavailableError(str(exc)) from exc
        except HistoryError as exc:
            raise AgentOrchestrationDependencyUnavailableError(str(exc)) from exc
        return [_event_summary(event) for event in timeline.items]


class UnavailableAgentOrchestrationService:
    """Fallback service when transcript/query dependencies cannot be built."""

    def __init__(self, reason: str) -> None:
        self.reason = reason

    async def list_executions(
        self,
        *,
        user_id: str | None,
        status: ActionStatus | None,
        action_uri: str | None,
        search: str | None,
        page: int,
        size: int,
        submitted_after: datetime | None,
        submitted_before: datetime | None,
    ) -> tuple[list[AgentExecutionSummary], int]:
        del user_id, status, action_uri, search, page, size, submitted_after, submitted_before
        raise AgentOrchestrationDependencyUnavailableError(self.reason)

    async def get_execution_detail(self, execution_id: UUID) -> AgentExecutionDetail:
        del execution_id
        raise AgentOrchestrationDependencyUnavailableError(self.reason)

    async def get_execution_messages(
        self,
        execution_id: UUID,
        *,
        after_ordinal: int = 0,
        limit: int = 200,
    ) -> AgentExecutionMessagesPage:
        del execution_id, after_ordinal, limit
        raise AgentOrchestrationDependencyUnavailableError(self.reason)

    async def get_execution_status(self, execution_id: UUID) -> AgentExecutionActionSummary:
        del execution_id
        raise AgentOrchestrationDependencyUnavailableError(self.reason)


def resume_state_from_records(
    *,
    execution_id: UUID,
    attempt_no: int,
    records: list[AgentTranscriptMessageRecord],
) -> AgentTranscriptResumeState:
    ordered = sorted(records, key=lambda record: (record.attempt_no, record.sequence_no))
    action_uri = ordered[-1].action_uri if ordered else None
    next_sequence_no = (ordered[-1].sequence_no + 1) if ordered else 1
    return AgentTranscriptResumeState(
        execution_id=execution_id,
        action_uri=action_uri,
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


def _normalize_optional_text(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip()
    return normalized if normalized else None


def _action_summary(action: ActionRecord) -> AgentExecutionActionSummary:
    return AgentExecutionActionSummary(
        action_id=action.action_id,
        user_id=action.user_id,
        action_uri=action.action_uri,
        action_kind=action.action_kind,
        status=action.status,
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


def _event_summary(event: EventHistoryItem) -> AgentExecutionEventSummary:
    return AgentExecutionEventSummary(
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


def _message_page_from_records(
    *,
    execution_id: UUID,
    action_uri: str,
    records: list[AgentTranscriptMessageRecord],
    after_ordinal: int,
    limit: int,
) -> AgentExecutionMessagesPage:
    ordered = sorted(records, key=lambda record: (record.attempt_no, record.sequence_no))
    if after_ordinal < 0:
        raise ValueError("after_ordinal must be >= 0")
    page_size = max(int(limit), 1)

    messages = [
        AgentExecutionMessage(
            ordinal=index,
            execution_id=execution_id,
            action_uri=record.action_uri,
            attempt_no=record.attempt_no,
            sequence_no=record.sequence_no,
            message_role=record.message_role,
            message_kind=record.message_kind,
            call_id=record.call_id,
            message_json=dict(record.message_json),
            persisted_at=record.persisted_at,
        )
        for index, record in enumerate(ordered, start=1)
        if index > after_ordinal
    ][:page_size]
    last_ordinal = len(ordered)
    effective_action_uri = ordered[-1].action_uri if ordered else action_uri
    return AgentExecutionMessagesPage(
        execution_id=execution_id,
        action_uri=effective_action_uri,
        total_messages=last_ordinal,
        returned_messages=len(messages),
        last_ordinal=last_ordinal,
        messages=messages,
    )


def is_terminal_status(status: ActionStatus) -> bool:
    return status in _TERMINAL_ACTION_STATUSES
