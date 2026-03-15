from __future__ import annotations

import asyncio
from uuid import uuid4

from seer_backend.agent_orchestration.repository import InMemoryAgentTranscriptRepository
from seer_backend.agent_orchestration.service import AgentTranscriptService


def _run_async(coro: object) -> object:
    return asyncio.run(coro)


def test_agent_transcript_service_ensure_schema_runs_once() -> None:
    repository = InMemoryAgentTranscriptRepository()
    service = AgentTranscriptService(repository=repository)
    execution_id = uuid4()

    _run_async(
        service.append_completion_messages(
            execution_id=execution_id,
            action_uri="urn:seer:test:action.invoice.follow-up",
            attempt_no=1,
            completion_messages=[{"role": "user", "content": "Investigate overdue invoice"}],
        )
    )
    _run_async(
        service.load_resume_state(
            execution_id=execution_id,
            attempt_no=1,
        )
    )

    assert repository.ensure_schema_calls == 1


def test_append_completion_messages_assigns_order_and_resume_state_from_persisted_rows() -> None:
    repository = InMemoryAgentTranscriptRepository()
    service = AgentTranscriptService(repository=repository)
    execution_id = uuid4()

    first_batch = _run_async(
        service.append_completion_messages(
            execution_id=execution_id,
            action_uri="urn:seer:test:action.invoice.follow-up",
            attempt_no=1,
            completion_messages=[
                {"role": "user", "content": "Find overdue invoices"},
                {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [
                        {
                            "id": "call_overdue-invoices__sig__abc123",
                            "type": "function",
                            "function": {"name": "load_action", "arguments": "{}"},
                        }
                    ],
                },
                {
                    "role": "tool",
                    "tool_call_id": "call_overdue-invoices__sig__abc123",
                    "name": "load_action",
                    "content": '{"status":"loaded"}',
                },
            ],
        )
    )
    second_batch = _run_async(
        service.append_completion_messages(
            execution_id=execution_id,
            action_uri="urn:seer:test:action.invoice.follow-up",
            attempt_no=1,
            completion_messages=[
                {"role": "assistant", "content": "Loaded the action and ready to proceed."}
            ],
        )
    )
    transcript_rows = _run_async(service.load_transcript_messages(execution_id=execution_id))
    resume_state = _run_async(
        service.load_resume_state(
            execution_id=execution_id,
            attempt_no=1,
        )
    )

    assert [row.sequence_no for row in first_batch] == [1, 2, 3]
    assert [row.sequence_no for row in second_batch] == [4]
    assert [row.sequence_no for row in transcript_rows] == [1, 2, 3, 4]
    assert transcript_rows[1].message_kind == "tool_call"
    assert transcript_rows[1].call_id == "call_overdue-invoices"
    assert transcript_rows[2].message_kind == "tool_result"
    assert transcript_rows[2].call_id == "call_overdue-invoices"
    assert resume_state.action_uri == "urn:seer:test:action.invoice.follow-up"
    assert resume_state.next_sequence_no == 5
    assert [message["role"] for message in resume_state.completion_messages] == [
        "user",
        "assistant",
        "tool",
        "assistant",
    ]


def test_resume_state_scopes_to_attempt_but_transcript_queries_can_read_all_attempts() -> None:
    repository = InMemoryAgentTranscriptRepository()
    service = AgentTranscriptService(repository=repository)
    execution_id = uuid4()

    _run_async(
        service.append_completion_messages(
            execution_id=execution_id,
            action_uri="urn:seer:test:action.invoice.follow-up",
            attempt_no=1,
            completion_messages=[{"role": "user", "content": "Attempt one"}],
        )
    )
    _run_async(
        service.append_completion_messages(
            execution_id=execution_id,
            action_uri="urn:seer:test:action.invoice.follow-up",
            attempt_no=2,
            completion_messages=[
                {"role": "user", "content": "Attempt two"},
                {"role": "assistant", "content": "Recovered from persisted transcript."},
            ],
        )
    )

    all_rows = _run_async(service.load_transcript_messages(execution_id=execution_id))
    second_attempt_resume = _run_async(
        service.load_resume_state(
            execution_id=execution_id,
            attempt_no=2,
        )
    )

    assert [(row.attempt_no, row.sequence_no) for row in all_rows] == [
        (1, 1),
        (2, 1),
        (2, 2),
    ]
    assert second_attempt_resume.attempt_no == 2
    assert second_attempt_resume.next_sequence_no == 3
    assert [message["content"] for message in second_attempt_resume.completion_messages] == [
        "Attempt two",
        "Recovered from persisted transcript.",
    ]
