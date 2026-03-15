from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

pytest.importorskip("rdflib")
pytest.importorskip("pyshacl")

from seer_backend.actions.repository import InMemoryActionsRepository
from seer_backend.actions.service import ActionsService
from seer_backend.agent_orchestration.repository import InMemoryAgentTranscriptRepository
from seer_backend.agent_orchestration.service import (
    AgentOrchestrationService,
    AgentTranscriptService,
)
from seer_backend.config.settings import Settings
from seer_backend.history.repository import InMemoryHistoryRepository
from seer_backend.history.service import HistoryService
from seer_backend.main import create_app
from seer_backend.ontology.repository import InMemoryOntologyRepository
from seer_backend.ontology.service import OntologyService
from seer_backend.ontology.validation import ShaclValidator

REPO_ROOT = Path(__file__).resolve().parents[2]
PROPHET_METAMODEL = REPO_ROOT / "prophet" / "prophet.ttl"
SUPPORT_FIXTURE = (
    REPO_ROOT
    / "prophet"
    / "examples"
    / "turtle"
    / "prophet_example_turtle_minimal"
    / "gen"
    / "turtle"
    / "ontology.ttl"
)
SUPPORT_OBJECT_MODEL_IRI = "http://prophet.platform/local/support_local#obj_ticket"
STRING_TYPE_IRI = "http://prophet.platform/standard-types#String"


def _build_client() -> TestClient:
    app = create_app(settings=Settings(prophet_metamodel_path=str(PROPHET_METAMODEL)))
    ontology_service = OntologyService(
        repository=InMemoryOntologyRepository(),
        validator=ShaclValidator(str(PROPHET_METAMODEL)),
    )
    actions_service = ActionsService(repository=InMemoryActionsRepository())
    history_service = HistoryService(repository=InMemoryHistoryRepository())
    transcript_service = AgentTranscriptService(repository=InMemoryAgentTranscriptRepository())
    app.state.ontology_service = ontology_service
    app.state.actions_service = actions_service
    app.state.history_service = history_service
    app.state.agent_orchestration_service = AgentOrchestrationService(
        actions_service=actions_service,
        history_service=history_service,
        transcript_service=transcript_service,
    )
    return TestClient(app)


def _ingest_support_release(client: TestClient) -> None:
    response = client.post(
        "/api/v1/ontology/ingest",
        json={
            "release_id": "rel-support-authoring",
            "turtle": SUPPORT_FIXTURE.read_text(encoding="utf-8"),
        },
    )
    assert response.status_code == 200, response.text


def _managed_agent_payload() -> dict[str, object]:
    return {
        "managed_agent_key": "ticket_triage_assistant",
        "name": "Ticket Triage Assistant",
        "description": "Reviews a created ticket and decides the next state.",
        "instruction": "Review the ticket evidence and assign the next triage state.",
        "enabled": True,
        "input_name": "Ticket Triage Request",
        "input_description": "Request payload that identifies the ticket to review.",
        "output_name": "Ticket Triage Result",
        "output_description": "Outcome event containing the triaged ticket and resulting state.",
        "input_fields": [
            {
                "field_key": "ticket",
                "label": "Ticket",
                "description": "The ticket to review.",
                "required": True,
                "multi_value": False,
                "field_type": "object_reference",
                "object_model_iri": SUPPORT_OBJECT_MODEL_IRI,
            }
        ],
        "output_fields": [
            {
                "field_key": "newState",
                "label": "New State",
                "description": "The state assigned by the managed agent.",
                "required": True,
                "multi_value": False,
                "field_type": "value_type",
                "value_type_iri": STRING_TYPE_IRI,
            },
            {
                "field_key": "ticket",
                "label": "Ticket",
                "description": "Reference to the ticket after triage.",
                "required": True,
                "multi_value": False,
                "field_type": "object_reference",
                "object_model_iri": SUPPORT_OBJECT_MODEL_IRI,
            },
        ],
    }


def test_managed_agent_editor_catalog_returns_object_models_and_value_types() -> None:
    client = _build_client()
    _ingest_support_release(client)

    response = client.get("/api/v1/agentic-workflows/managed-agents/editor-catalog")

    assert response.status_code == 200, response.text
    body = response.json()
    assert any(
        item["iri"] == SUPPORT_OBJECT_MODEL_IRI for item in body["object_models"]
    )
    assert any(item["iri"] == STRING_TYPE_IRI for item in body["value_types"])


def test_can_create_list_fetch_and_submit_ui_authored_managed_agent() -> None:
    client = _build_client()
    _ingest_support_release(client)

    create_response = client.post(
        "/api/v1/agentic-workflows/managed-agents",
        json=_managed_agent_payload(),
    )

    assert create_response.status_code == 200, create_response.text
    created = create_response.json()
    assert created["managed_agent_key"] == "ticket_triage_assistant"
    assert created["action_uri"] == "urn:seer:managed-agent:ticket_triage_assistant"
    assert created["enabled"] is True
    assert created["input_fields"][0]["field_type"] == "object_reference"
    assert created["output_fields"][0]["value_type_iri"] == STRING_TYPE_IRI

    list_response = client.get("/api/v1/agentic-workflows/managed-agents")
    assert list_response.status_code == 200, list_response.text
    listed = list_response.json()
    assert listed["total"] == 1
    assert listed["managed_agents"][0]["action_uri"] == created["action_uri"]
    assert listed["managed_agents"][0]["input_field_count"] == 1
    assert listed["managed_agents"][0]["output_field_count"] == 2

    detail_response = client.get(
        "/api/v1/agentic-workflows/managed-agents/ticket_triage_assistant"
    )
    assert detail_response.status_code == 200, detail_response.text
    detail = detail_response.json()
    assert detail["instruction"] == _managed_agent_payload()["instruction"]
    assert detail["output_name"] == "Ticket Triage Result"

    submit_response = client.post(
        "/api/v1/actions/submit",
        json={
            "user_id": "managed-agent-test-user",
            "action_uri": created["action_uri"],
            "payload": {"ticket": {"ticketId": "T-100"}},
        },
    )
    assert submit_response.status_code == 200, submit_response.text
    submitted = submit_response.json()
    assert submitted["action_kind"] == "agentic_workflow"
    assert submitted["ontology_release_id"] == "rel-support-authoring"


def test_invalid_object_model_rejected_during_managed_agent_authoring() -> None:
    client = _build_client()
    _ingest_support_release(client)
    payload = _managed_agent_payload()
    payload["input_fields"][0]["object_model_iri"] = "urn:seer:test:missing-model"

    response = client.post(
        "/api/v1/agentic-workflows/managed-agents",
        json=payload,
    )

    assert response.status_code == 422, response.text
    body = response.json()
    assert body["detail"]["code"] == "unknown_object_model"


def test_can_update_managed_agent_in_place() -> None:
    client = _build_client()
    _ingest_support_release(client)
    create_response = client.post(
        "/api/v1/agentic-workflows/managed-agents",
        json=_managed_agent_payload(),
    )
    assert create_response.status_code == 200, create_response.text

    updated_payload = _managed_agent_payload()
    updated_payload["instruction"] = "Review the ticket and decide the best triage destination."
    updated_payload["enabled"] = False
    updated_payload["output_fields"].append(
        {
            "field_key": "agentNote",
            "label": "Agent Note",
            "description": "Optional operator-facing note from the run.",
            "required": False,
            "multi_value": False,
            "field_type": "value_type",
            "value_type_iri": STRING_TYPE_IRI,
        }
    )

    update_response = client.put(
        "/api/v1/agentic-workflows/managed-agents/ticket_triage_assistant",
        json=updated_payload,
    )

    assert update_response.status_code == 200, update_response.text
    updated = update_response.json()
    assert updated["enabled"] is False
    assert updated["instruction"] == updated_payload["instruction"]
    assert len(updated["output_fields"]) == 3
