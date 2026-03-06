from __future__ import annotations

import json
import logging
import re
from collections.abc import AsyncIterator
from pathlib import Path

from fastapi.testclient import TestClient

from seer_backend.ai.gateway import GuidedInvestigationRequest
from seer_backend.ai.ontology_copilot import (
    CopilotAnswerFinalEvent,
    CopilotAnswerStreamEvent,
    CopilotAssistantDeltaEvent,
    CopilotToolStatusEvent,
)
from seer_backend.analytics.rca_repository import InMemoryRootCauseRepository
from seer_backend.analytics.rca_service import RootCauseService
from seer_backend.analytics.repository import InMemoryProcessMiningRepository
from seer_backend.analytics.service import OcpnMiningWrapper, ProcessMiningService
from seer_backend.history.repository import InMemoryHistoryRepository
from seer_backend.history.service import HistoryService
from seer_backend.main import create_app
from seer_backend.ontology.errors import OntologyNotReadyError
from seer_backend.ontology.models import (
    CopilotChatResponse,
    CopilotConversationMessage,
    CopilotEvidence,
    CopilotToolCall,
    CopilotToolResult,
)

FIXTURE_PATH = Path(__file__).parent / "fixtures" / "rca_phase4_orders.json"
_ORDER_URI = "urn:seer:test:order"


def _to_uri_identifier(value: str) -> str:
    cleaned = value.strip()
    if "://" in cleaned or cleaned.startswith("urn:"):
        return cleaned
    token = re.sub(r"[^a-zA-Z0-9]+", "_", cleaned).strip("_").lower()
    return f"urn:seer:test:{token}" if token else "urn:seer:test:unknown"


def _normalize_event_payload(payload: dict[str, object]) -> dict[str, object]:
    normalized = dict(payload)
    event_type = normalized.get("event_type")
    if isinstance(event_type, str):
        normalized["event_type"] = _to_uri_identifier(event_type)

    updated_objects = normalized.get("updated_objects")
    if not isinstance(updated_objects, list):
        return normalized

    normalized_objects: list[dict[str, object]] = []
    for item in updated_objects:
        if not isinstance(item, dict):
            continue
        updated = dict(item)
        object_type = updated.get("object_type")
        if isinstance(object_type, str):
            uri = _to_uri_identifier(object_type)
            updated["object_type"] = uri
            payload_object = updated.get("object")
            if isinstance(payload_object, dict):
                payload_object_copy = dict(payload_object)
                payload_object_copy["object_type"] = uri
                updated["object"] = payload_object_copy
        normalized_objects.append(updated)
    normalized["updated_objects"] = normalized_objects
    return normalized


class StubOntologyCopilotService:
    async def answer(
        self,
        question: str,
        conversation: list[CopilotConversationMessage] | None = None,
        completion_conversation: list[dict[str, object]] | None = None,
    ) -> CopilotChatResponse:
        del conversation, completion_conversation
        return CopilotChatResponse(
            mode="direct_answer",
            answer=f"Ontology context for: {question}",
            evidence=[
                CopilotEvidence(
                    concept_iri="urn:seer:test:Order",
                    query="tool:list_concepts",
                )
            ],
            current_release_id="phase5-test-release",
            tool_call=None,
            tool_result=None,
            completion_messages_delta=[
                {
                    "role": "assistant",
                    "content": f"Ontology context for: {question}",
                }
            ],
        )

    async def answer_stream(
        self,
        question: str,
        conversation: list[CopilotConversationMessage] | None = None,
        completion_conversation: list[dict[str, object]] | None = None,
    ) -> AsyncIterator[CopilotAnswerStreamEvent]:
        response = await self.answer(
            question,
            conversation=conversation,
            completion_conversation=completion_conversation,
        )
        yield CopilotAssistantDeltaEvent(text=response.answer)
        yield CopilotAnswerFinalEvent(response=response)


class StubOntologyCopilotWithPolicyBlock:
    async def answer(
        self,
        question: str,
        conversation: list[CopilotConversationMessage] | None = None,
        completion_conversation: list[dict[str, object]] | None = None,
    ) -> CopilotChatResponse:
        del question, conversation, completion_conversation
        return CopilotChatResponse(
            mode="direct_answer",
            answer="Blocked a mutating SPARQL attempt and continued with safe guidance.",
            evidence=[],
            current_release_id="phase5-test-release",
            tool_call=CopilotToolCall(
                tool="sparql_read_only_query",
                query="INSERT DATA { <urn:test:s> <urn:test:p> \"x\" . }",
                call_id="call_1",
            ),
            tool_result=CopilotToolResult(
                tool="sparql_read_only_query",
                query="INSERT DATA { <urn:test:s> <urn:test:p> \"x\" . }",
                error="SPARQL update operations are not allowed",
            ),
            completion_messages_delta=[
                {
                    "role": "assistant",
                    "content": (
                        "Blocked a mutating SPARQL attempt and continued with safe "
                        "guidance."
                    ),
                }
            ],
        )

    async def answer_stream(
        self,
        question: str,
        conversation: list[CopilotConversationMessage] | None = None,
        completion_conversation: list[dict[str, object]] | None = None,
    ) -> AsyncIterator[CopilotAnswerStreamEvent]:
        response = await self.answer(
            question,
            conversation=conversation,
            completion_conversation=completion_conversation,
        )
        if response.tool_call is not None:
            call_id = response.tool_call.call_id or "call_1"
            yield CopilotToolStatusEvent(
                status="started",
                tool=response.tool_call.tool,
                call_id=call_id,
                summary="Running read-only SPARQL query.",
                query_preview=response.tool_call.query,
            )
            yield CopilotToolStatusEvent(
                status="failed",
                tool=response.tool_call.tool,
                call_id=call_id,
                summary="Read-only SPARQL query failed: SPARQL update operations are not allowed",
                query_preview=response.tool_call.query,
                error=response.tool_result.error if response.tool_result else None,
            )
        yield CopilotAssistantDeltaEvent(text=response.answer)
        yield CopilotAnswerFinalEvent(response=response)


class StubOntologyCopilotNotReady:
    async def answer(
        self,
        question: str,
        conversation: list[CopilotConversationMessage] | None = None,
        completion_conversation: list[dict[str, object]] | None = None,
    ) -> CopilotChatResponse:
        del question, conversation, completion_conversation
        raise OntologyNotReadyError("Ontology release is still initializing")

    async def answer_stream(
        self,
        question: str,
        conversation: list[CopilotConversationMessage] | None = None,
        completion_conversation: list[dict[str, object]] | None = None,
    ) -> AsyncIterator[CopilotAnswerStreamEvent]:
        del question, conversation, completion_conversation
        raise OntologyNotReadyError("Ontology release is still initializing")
        yield CopilotAssistantDeltaEvent(text="")


def _parse_sse_events(raw_stream: str) -> list[tuple[str, dict[str, object]]]:
    events: list[tuple[str, dict[str, object]]] = []
    event_name: str | None = None
    data_lines: list[str] = []

    for line in raw_stream.splitlines():
        if not line:
            if event_name is not None:
                payload_text = "\n".join(data_lines)
                payload = json.loads(payload_text) if payload_text else {}
                events.append((event_name, payload))
            event_name = None
            data_lines = []
            continue

        if line.startswith("event:"):
            event_name = line.partition(":")[2].strip()
            continue
        if line.startswith("data:"):
            data_lines.append(line.partition(":")[2].lstrip())

    return events


def build_client() -> TestClient:
    app = create_app()

    history_repo = InMemoryHistoryRepository()
    app.state.history_service = HistoryService(repository=history_repo)
    app.state.process_service = ProcessMiningService(
        repository=InMemoryProcessMiningRepository.from_phase2_history_repository(history_repo),
        miner=OcpnMiningWrapper(),
        max_events_default=10_000,
        max_relations_default=120_000,
        max_traces_per_handle_default=200,
    )
    app.state.root_cause_service = RootCauseService(
        repository=InMemoryRootCauseRepository.from_phase2_history_repository(history_repo),
        max_events_default=20_000,
        max_relations_default=120_000,
        max_traces_per_insight_default=50,
    )
    app.state.ontology_copilot_service = StubOntologyCopilotService()

    from seer_backend.api.ai import inject_ai_gateway_service

    inject_ai_gateway_service(app)
    return TestClient(app)


def build_client_with_copilot(copilot_service: object) -> TestClient:
    app = create_app()

    history_repo = InMemoryHistoryRepository()
    app.state.history_service = HistoryService(repository=history_repo)
    app.state.process_service = ProcessMiningService(
        repository=InMemoryProcessMiningRepository.from_phase2_history_repository(history_repo),
        miner=OcpnMiningWrapper(),
        max_events_default=10_000,
        max_relations_default=120_000,
        max_traces_per_handle_default=200,
    )
    app.state.root_cause_service = RootCauseService(
        repository=InMemoryRootCauseRepository.from_phase2_history_repository(history_repo),
        max_events_default=20_000,
        max_relations_default=120_000,
        max_traces_per_insight_default=50,
    )
    app.state.ontology_copilot_service = copilot_service

    from seer_backend.api.ai import inject_ai_gateway_service

    inject_ai_gateway_service(app)
    return TestClient(app)


def seed_fixture_dataset(client: TestClient) -> None:
    payloads = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
    for payload in payloads:
        response = client.post(
            "/api/v1/history/events/ingest",
            json=_normalize_event_payload(payload),
        )
        assert response.status_code == 200, response.text


def test_ai_gateway_ontology_question_uses_informational_policy() -> None:
    client = build_client()

    response = client.post(
        "/api/v1/ai/ontology/question",
        json={
            "question": "What does the Order concept represent?",
            "conversation": [],
        },
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["module"] == "ontology"
    assert body["task"] == "question"
    assert body["response_policy"] == "informational"
    assert "ontology.query(read_only)" in body["tool_permissions"]
    assert body["evidence"]
    assert body["copilot"]["answer"].startswith("Ontology context")


def test_ai_gateway_process_interpretation_returns_analytical_caveats() -> None:
    client = build_client()
    seed_fixture_dataset(client)

    run = client.post(
        "/api/v1/process/mine",
        json={
            "anchor_object_type": _ORDER_URI,
            "start_at": "2026-02-22T07:00:00Z",
            "end_at": "2026-02-22T11:00:00Z",
        },
    )
    assert run.status_code == 200, run.text

    response = client.post(
        "/api/v1/ai/process/interpret",
        json={"run": run.json()},
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["module"] == "process"
    assert body["response_policy"] == "analytical"
    assert body["evidence"]
    assert body["caveats"]
    assert "process.mine" in body["tool_permissions"]


def test_guided_investigation_runs_ontology_to_process_to_root_cause() -> None:
    client = build_client()
    seed_fixture_dataset(client)

    payload = GuidedInvestigationRequest(
        question="Investigate why Orders become delayed in this window.",
        anchor_object_type=_ORDER_URI,
        start_at="2026-02-22T07:00:00Z",
        end_at="2026-02-22T11:00:00Z",
        depth=2,
    ).model_dump(mode="json")

    response = client.post("/api/v1/ai/guided-investigation", json=payload)

    assert response.status_code == 200, response.text
    body = response.json()

    assert body["ontology"]["response_policy"] == "informational"
    assert body["process_ai"]["response_policy"] == "analytical"
    assert body["root_cause_ai"]["response_policy"] == "analytical"
    assert body["process_run"]["run_id"]
    assert body["root_cause_run"]["run_id"]
    assert body["root_cause_run"]["insights"]


def test_ai_assistant_chat_returns_generic_envelope_and_thread_id() -> None:
    client = build_client()

    response = client.post(
        "/api/v1/ai/assistant/chat",
        json={
            "completion_messages": [
                {"role": "user", "content": "Summarize what this module does."},
            ],
            "context": {
                "route": "/inspector/insights",
                "module": "insights",
                "anchor_object_type": _ORDER_URI,
            },
            "thread_id": "thread-seeded-1",
        },
    )

    assert response.status_code == 200, response.text
    assert response.headers["content-type"].startswith("text/event-stream")
    events = _parse_sse_events(response.text)
    event_types = [event for event, _ in events]
    assert event_types[0] == "meta"
    assert "assistant_delta" in event_types
    assert event_types[-2] == "final"
    assert event_types[-1] == "done"

    meta = events[0][1]
    assert meta["module"] == "assistant"
    assert meta["task"] == "chat"
    assert meta["response_policy"] == "informational"
    assert meta["thread_id"] == "thread-seeded-1"
    assert "ontology.query(read_only)" in meta["tool_permissions"]

    deltas = [
        payload["text"]
        for event, payload in events
        if event == "assistant_delta"
    ]
    final = events[-2][1]
    assert "".join(deltas) == final["answer"]
    assert final["evidence"]
    assert len(final["completion_messages"]) >= 2
    assert final["completion_messages"][-1]["role"] == "assistant"
    assert "error" not in event_types


def test_ai_assistant_chat_logs_turn_lifecycle(caplog) -> None:
    client = build_client()

    with caplog.at_level(logging.INFO, logger="seer_backend.ai.assistant_turn"):
        response = client.post(
            "/api/v1/ai/assistant/chat",
            json={
                "completion_messages": [
                    {"role": "user", "content": "Summarize what this module does."},
                ],
                "context": {
                    "route": "/assistant",
                    "module": "assistant",
                    "anchor_object_type": _ORDER_URI,
                },
                "thread_id": "thread-logs-1",
            },
        )

    assert response.status_code == 200, response.text
    records = [
        record
        for record in caplog.records
        if record.name == "seer_backend.ai.assistant_turn"
    ]
    messages = [record.message for record in records]
    assert "assistant_turn_started" in messages
    assert "assistant_turn_response_started" in messages
    assert "assistant_turn_completed" in messages

    started = next(record for record in records if record.message == "assistant_turn_started")
    completed = next(record for record in records if record.message == "assistant_turn_completed")

    assert started.thread_id == "thread-logs-1"
    assert started.route == "/assistant"
    assert started.module_context == "assistant"
    assert started.prompt_preview == "Summarize what this module does."
    assert isinstance(started.turn_id, str) and started.turn_id

    assert completed.thread_id == "thread-logs-1"
    assert completed.turn_id == started.turn_id
    assert completed.answer_chars > 0
    assert completed.completion_message_count >= 2


def test_ai_assistant_chat_logs_tool_status_events(caplog) -> None:
    client = build_client_with_copilot(StubOntologyCopilotWithPolicyBlock())

    with caplog.at_level(logging.INFO, logger="seer_backend.ai.assistant_turn"):
        response = client.post(
            "/api/v1/ai/assistant/chat",
            json={
                "completion_messages": [
                    {"role": "user", "content": "Please run an ontology mutation query."},
                ],
                "thread_id": "thread-tools-1",
            },
        )

    assert response.status_code == 200, response.text
    tool_records = [
        record
        for record in caplog.records
        if record.name == "seer_backend.ai.assistant_turn"
        and record.message == "assistant_turn_tool_status"
    ]
    assert [record.status for record in tool_records] == ["started", "failed"]
    assert all(record.thread_id == "thread-tools-1" for record in tool_records)
    assert tool_records[0].tool == "sparql_read_only_query"
    assert tool_records[0].call_id == "call_1"


def test_ai_assistant_chat_logs_failure(caplog) -> None:
    client = build_client_with_copilot(StubOntologyCopilotNotReady())

    with caplog.at_level(logging.INFO, logger="seer_backend.ai.assistant_turn"):
        response = client.post(
            "/api/v1/ai/assistant/chat",
            json={
                "completion_messages": [
                    {"role": "user", "content": "What is the latest ontology release?"},
                ],
                "thread_id": "thread-failure-1",
            },
        )

    assert response.status_code == 200, response.text
    failed = next(
        record
        for record in caplog.records
        if record.name == "seer_backend.ai.assistant_turn"
        and record.message == "assistant_turn_failed"
    )
    assert failed.thread_id == "thread-failure-1"
    assert failed.error_type == "OntologyNotReadyError"
    assert "initializing" in failed.error_message.lower()


def test_ai_assistant_chat_rejects_legacy_messages_only_payload() -> None:
    client = build_client()

    response = client.post(
        "/api/v1/ai/assistant/chat",
        json={
            "messages": [
                {"role": "user", "content": "Summarize what this module does."},
            ]
        },
    )

    assert response.status_code == 422, response.text
    detail = response.json()["detail"]
    loc_entries = [
        entry.get("loc", ())
        for entry in detail
        if isinstance(entry, dict)
    ]
    assert any("completion_messages" in loc for loc in loc_entries)


def test_ai_assistant_chat_accepts_completions_format_messages() -> None:
    client = build_client()

    response = client.post(
        "/api/v1/ai/assistant/chat",
        json={
            "completion_messages": [
                {"role": "user", "content": "First question"},
                {"role": "assistant", "content": "First answer"},
                {"role": "tool", "tool_call_id": "call_1", "content": "{\"row_count\":1}"},
                {"role": "user", "content": "Second question"},
            ],
            "thread_id": "thread-completion-1",
        },
    )

    assert response.status_code == 200, response.text
    assert response.headers["content-type"].startswith("text/event-stream")
    events = _parse_sse_events(response.text)
    assert [event for event, _ in events][:2] == ["meta", "assistant_delta"]

    final_event = next(payload for event, payload in events if event == "final")
    assert final_event["thread_id"] == "thread-completion-1"
    assert final_event["answer"].startswith("Ontology context")
    assert len(final_event["completion_messages"]) >= 5
    assert final_event["completion_messages"][0]["role"] == "user"
    assert final_event["completion_messages"][-1]["role"] == "assistant"
    assert events[-1][0] == "done"


def test_ai_assistant_chat_sanitizes_tool_call_ids_but_keeps_tool_history() -> None:
    class CapturingCopilot:
        def __init__(self) -> None:
            self.captured_completion_conversation: list[dict[str, object]] | None = None

        async def answer(
            self,
            question: str,
            conversation: list[CopilotConversationMessage] | None = None,
            completion_conversation: list[dict[str, object]] | None = None,
        ) -> CopilotChatResponse:
            del question, conversation
            self.captured_completion_conversation = completion_conversation
            return CopilotChatResponse(
                mode="direct_answer",
                answer="Sanitized tool call id context.",
                evidence=[],
                current_release_id="phase5-test-release",
                tool_call=None,
                tool_result=None,
                completion_messages_delta=[
                    {"role": "assistant", "content": "Sanitized tool call id context."}
                ],
            )

        async def answer_stream(
            self,
            question: str,
            conversation: list[CopilotConversationMessage] | None = None,
            completion_conversation: list[dict[str, object]] | None = None,
        ) -> AsyncIterator[CopilotAnswerStreamEvent]:
            response = await self.answer(
                question,
                conversation=conversation,
                completion_conversation=completion_conversation,
            )
            yield CopilotAssistantDeltaEvent(text=response.answer)
            yield CopilotAnswerFinalEvent(response=response)

    copilot = CapturingCopilot()
    client = build_client_with_copilot(copilot)

    long_id = "call_preserve_me__sig__" + ("x" * 512)
    response = client.post(
        "/api/v1/ai/assistant/chat",
        json={
            "completion_messages": [
                {"role": "user", "content": "First question"},
                {
                    "role": "assistant",
                    "content": "Tool run",
                    "tool_calls": [
                        {
                            "id": long_id,
                            "type": "function",
                            "function": {
                                "name": "sparql_read_only_query",
                                "arguments": "{\"query\":\"ASK WHERE { ?s ?p ?o }\"}",
                            },
                        }
                    ],
                },
                {"role": "tool", "tool_call_id": long_id, "content": "{\"row_count\":1}"},
                {"role": "user", "content": "Follow-up question"},
            ],
            "thread_id": "thread-sanitize-ids-1",
        },
    )

    assert response.status_code == 200, response.text
    events = _parse_sse_events(response.text)
    final_event = next(payload for event, payload in events if event == "final")

    captured = copilot.captured_completion_conversation
    assert captured is not None
    assert [item["role"] for item in captured] == ["user", "assistant", "tool"]
    assistant_tool_calls = captured[1].get("tool_calls")
    assert isinstance(assistant_tool_calls, list)
    assert assistant_tool_calls
    normalized_id = assistant_tool_calls[0]["id"]
    assert isinstance(normalized_id, str)
    assert normalized_id.startswith("call_")
    assert "__sig__" not in normalized_id
    assert len(normalized_id) <= 120
    assert captured[2]["tool_call_id"] == normalized_id

    completion_messages = final_event["completion_messages"]
    assert completion_messages[1]["tool_calls"][0]["id"] == normalized_id
    assert completion_messages[2]["tool_call_id"] == normalized_id


def test_ai_assistant_chat_rejects_completion_messages_without_user_turn() -> None:
    client = build_client()

    response = client.post(
        "/api/v1/ai/assistant/chat",
        json={
            "completion_messages": [
                {"role": "assistant", "content": "No user turn is present."},
            ],
        },
    )

    assert response.status_code == 422, response.text
    detail = response.json()["detail"]
    messages = [entry.get("msg", "") for entry in detail if isinstance(entry, dict)]
    assert any(
        "completion_messages must include at least one user message" in message
        for message in messages
    )


def test_ai_assistant_chat_surfaces_read_only_policy_block_caveat() -> None:
    client = build_client_with_copilot(StubOntologyCopilotWithPolicyBlock())

    response = client.post(
        "/api/v1/ai/assistant/chat",
        json={
            "completion_messages": [
                {"role": "user", "content": "Please run an ontology mutation query."},
            ],
        },
    )

    assert response.status_code == 200, response.text
    events = _parse_sse_events(response.text)
    tool_status_events = [payload for event, payload in events if event == "tool_status"]
    assert [payload["status"] for payload in tool_status_events] == ["started", "failed"]
    assert tool_status_events[0]["call_id"] == "call_1"
    assert "running read-only sparql query" in str(tool_status_events[0]["summary"]).lower()
    assert "failed" in str(tool_status_events[1]["summary"]).lower()

    final_event = next(payload for event, payload in events if event == "final")
    assert final_event["module"] == "assistant"
    assert any(
        "read-only sparql policy blocked" in caveat.lower()
        for caveat in final_event["caveats"]
    )
    assert any(
        evidence["label"] == "Read-only SPARQL policy block"
        for evidence in final_event["evidence"]
    )


def test_ai_assistant_chat_streams_error_event_without_done_on_failure() -> None:
    client = build_client_with_copilot(StubOntologyCopilotNotReady())

    response = client.post(
        "/api/v1/ai/assistant/chat",
        json={
            "completion_messages": [
                {"role": "user", "content": "What is the latest ontology release?"},
            ]
        },
    )

    assert response.status_code == 200, response.text
    assert response.headers["content-type"].startswith("text/event-stream")
    events = _parse_sse_events(response.text)
    assert len(events) == 1
    assert events[0][0] == "error"
    assert not any(event_name == "done" for event_name, _ in events)
    assert events[0][1]["status_code"] == 409
    assert events[0][1]["code"] == "ontology_not_ready"
    assert "initializing" in str(events[0][1]["message"]).lower()
