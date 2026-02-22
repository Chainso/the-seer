from __future__ import annotations

import json
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
)

FIXTURE_PATH = Path(__file__).parent / "fixtures" / "rca_phase4_orders.json"


class StubOntologyCopilotService:
    async def answer(
        self,
        question: str,
        conversation: list[CopilotConversationMessage] | None = None,
    ) -> CopilotChatResponse:
        del conversation
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


def seed_fixture_dataset(client: TestClient) -> None:
    payloads = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
    for payload in payloads:
        response = client.post("/api/v1/history/events/ingest", json=payload)
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
            "anchor_object_type": "Order",
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
        anchor_object_type="Order",
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
