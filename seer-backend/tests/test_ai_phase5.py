from __future__ import annotations

import json
import re
from pathlib import Path

from fastapi.testclient import TestClient

from seer_backend.ai.gateway import GuidedInvestigationRequest
from seer_backend.analytics.rca_repository import InMemoryRootCauseRepository
from seer_backend.analytics.rca_service import RootCauseService
from seer_backend.analytics.repository import InMemoryProcessMiningRepository
from seer_backend.analytics.service import OcpnMiningWrapper, ProcessMiningService
from seer_backend.history.repository import InMemoryHistoryRepository
from seer_backend.history.service import HistoryService
from seer_backend.main import create_app
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
            "messages": [
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
    body = response.json()
    assert body["module"] == "assistant"
    assert body["task"] == "chat"
    assert body["response_policy"] == "informational"
    assert body["thread_id"] == "thread-seeded-1"
    assert body["answer"].startswith("Ontology context")
    assert "ontology.query(read_only)" in body["tool_permissions"]
    assert body["evidence"]
    assert len(body["completion_messages"]) >= 2
    assert body["completion_messages"][-1]["role"] == "assistant"


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
    body = response.json()
    assert body["thread_id"] == "thread-completion-1"
    assert body["answer"].startswith("Ontology context")
    assert len(body["completion_messages"]) >= 5
    assert body["completion_messages"][0]["role"] == "user"
    assert body["completion_messages"][-1]["role"] == "assistant"


def test_ai_assistant_chat_surfaces_read_only_policy_block_caveat() -> None:
    client = build_client_with_copilot(StubOntologyCopilotWithPolicyBlock())

    response = client.post(
        "/api/v1/ai/assistant/chat",
        json={
            "messages": [
                {"role": "user", "content": "Please run an ontology mutation query."},
            ],
        },
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["module"] == "assistant"
    assert any("read-only sparql policy blocked" in caveat.lower() for caveat in body["caveats"])
    assert any(
        evidence["label"] == "Read-only SPARQL policy block"
        for evidence in body["evidence"]
    )
