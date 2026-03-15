from __future__ import annotations

from pathlib import Path
from uuid import UUID

import pytest
from fastapi.testclient import TestClient

pytest.importorskip("rdflib")
pytest.importorskip("pyshacl")

from seer_backend.actions.models import ActionKind
from seer_backend.actions.repository import InMemoryActionsRepository
from seer_backend.actions.service import ActionsService, UnavailableActionsService
from seer_backend.config.settings import Settings
from seer_backend.main import create_app
from seer_backend.ontology.repository import InMemoryOntologyRepository
from seer_backend.ontology.service import OntologyService, UnavailableOntologyService
from seer_backend.ontology.validation import ShaclValidator

REPO_ROOT = Path(__file__).resolve().parents[2]
PROPHET_METAMODEL = REPO_ROOT / "prophet" / "prophet.ttl"
VALID_FIXTURE = (
    REPO_ROOT
    / "prophet"
    / "examples"
    / "turtle"
    / "prophet_example_turtle_minimal"
    / "gen"
    / "turtle"
    / "ontology.ttl"
)
TRIAGE_ACTION_URI = "http://prophet.platform/local/support_local#act_triage_ticket"


def _build_submit_client() -> tuple[TestClient, InMemoryActionsRepository]:
    app = create_app(settings=Settings(prophet_metamodel_path=str(PROPHET_METAMODEL)))
    actions_repository = InMemoryActionsRepository()
    app.state.actions_service = ActionsService(repository=actions_repository)
    app.state.ontology_service = OntologyService(
        repository=InMemoryOntologyRepository(),
        validator=ShaclValidator(str(PROPHET_METAMODEL)),
    )
    return TestClient(app), actions_repository


def _ingest_release(client: TestClient, release_id: str = "rel-2026-03-01") -> None:
    response = client.post(
        "/api/v1/ontology/ingest",
        json={
            "release_id": release_id,
            "turtle": VALID_FIXTURE.read_text(encoding="utf-8"),
        },
    )
    assert response.status_code == 200, response.text


def test_submit_enqueues_action_with_ontology_release_and_contract_hash() -> None:
    client, repository = _build_submit_client()
    _ingest_release(client, release_id="rel-2026-03-01")

    response = client.post(
        "/api/v1/actions/submit",
        json={
            "user_id": "user-1",
            "action_uri": TRIAGE_ACTION_URI,
            "payload": {"ticket": {"tenant": "acme", "ticket_id": "T-100"}},
            "priority": 4,
        },
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "queued"
    assert body["action_kind"] == ActionKind.ACTION.value
    assert body["dedupe_hit"] is False
    assert body["ontology_release_id"] == "rel-2026-03-01"

    action_id = UUID(body["action_id"])
    stored = repository.get_action(action_id)
    assert stored is not None
    assert stored.action_uri == TRIAGE_ACTION_URI
    assert stored.action_kind == ActionKind.ACTION
    assert stored.ontology_release_id == "rel-2026-03-01"
    assert len(stored.validation_contract_hash) == 64


def test_submit_rejects_unknown_action_and_invalid_payload_with_actionable_422() -> None:
    client, _ = _build_submit_client()
    _ingest_release(client)

    unknown_action = client.post(
        "/api/v1/actions/submit",
        json={
            "user_id": "user-1",
            "action_uri": "http://prophet.platform/local/support_local#act_does_not_exist",
            "payload": {"ticket": {"tenant": "acme", "ticket_id": "T-101"}},
        },
    )
    assert unknown_action.status_code == 422, unknown_action.text
    unknown_detail = unknown_action.json()["detail"]
    assert unknown_detail["issues"][0]["code"] == "unknown_or_non_executable_action"
    assert unknown_detail["issues"][0]["field"] == "action_uri"

    invalid_payload = client.post(
        "/api/v1/actions/submit",
        json={
            "user_id": "user-1",
            "action_uri": TRIAGE_ACTION_URI,
            "payload": {"unexpected": {"ticket_id": "T-101"}},
        },
    )
    assert invalid_payload.status_code == 422, invalid_payload.text
    issue_codes = {issue["code"] for issue in invalid_payload.json()["detail"]["issues"]}
    assert "missing_required_field" in issue_codes
    assert "unknown_payload_field" in issue_codes


def test_submit_idempotency_key_returns_stable_dedupe_response() -> None:
    client, _ = _build_submit_client()
    _ingest_release(client)
    payload = {
        "user_id": "user-1",
        "action_uri": TRIAGE_ACTION_URI,
        "payload": {"ticket": {"tenant": "acme", "ticket_id": "T-102"}},
        "idempotency_key": "retry-token-1",
    }

    first = client.post("/api/v1/actions/submit", json=payload)
    second = client.post("/api/v1/actions/submit", json=payload)

    assert first.status_code == 200, first.text
    assert second.status_code == 200, second.text
    first_body = first.json()
    second_body = second.json()
    assert first_body["action_id"] == second_body["action_id"]
    assert first_body["dedupe_hit"] is False
    assert second_body["dedupe_hit"] is True
    assert first_body["action_kind"] == ActionKind.ACTION.value
    assert second_body["action_kind"] == ActionKind.ACTION.value


def test_submit_classifies_agentic_workflow_from_seer_ontology_extension() -> None:
    client, repository = _build_submit_client()
    source_turtle = VALID_FIXTURE.read_text(encoding="utf-8")
    agentic_turtle = "\n".join(
        [
            "@prefix seer: <http://seer.platform/ontology#> .",
            source_turtle.replace(
                "support_local:act_triage_ticket a prophet:Action ;",
                "support_local:act_triage_ticket a seer:AgenticWorkflow ;",
            ),
        ]
    )

    ingest = client.post(
        "/api/v1/ontology/ingest",
        json={"release_id": "rel-2026-03-02", "turtle": agentic_turtle},
    )
    assert ingest.status_code == 200, ingest.text

    response = client.post(
        "/api/v1/actions/submit",
        json={
            "user_id": "user-1",
            "action_uri": TRIAGE_ACTION_URI,
            "payload": {"ticket": {"tenant": "acme", "ticket_id": "T-104"}},
        },
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["action_kind"] == ActionKind.AGENTIC_WORKFLOW.value

    stored = repository.get_action(UUID(body["action_id"]))
    assert stored is not None
    assert stored.action_kind == ActionKind.AGENTIC_WORKFLOW


def test_submit_maps_dependency_unavailable_to_503() -> None:
    app = create_app(settings=Settings(prophet_metamodel_path=str(PROPHET_METAMODEL)))
    app.state.actions_service = UnavailableActionsService("actions unavailable")
    app.state.ontology_service = UnavailableOntologyService("ontology unavailable")
    client = TestClient(app)

    response = client.post(
        "/api/v1/actions/submit",
        json={
            "user_id": "user-1",
            "action_uri": TRIAGE_ACTION_URI,
            "payload": {"ticket": {"tenant": "acme", "ticket_id": "T-103"}},
        },
    )

    assert response.status_code == 503
    assert "actions unavailable" in response.json()["detail"]
