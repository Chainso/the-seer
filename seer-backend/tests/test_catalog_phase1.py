from __future__ import annotations

from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

pytest.importorskip("rdflib")
pytest.importorskip("pyshacl")

from seer_backend.actions.models import ActionCreate
from seer_backend.actions.repository import InMemoryActionsRepository
from seer_backend.actions.service import ActionsService
from seer_backend.config.settings import Settings
from seer_backend.history.repository import InMemoryHistoryRepository
from seer_backend.history.service import HistoryService
from seer_backend.main import create_app
from seer_backend.ontology.repository import InMemoryOntologyRepository
from seer_backend.ontology.service import OntologyService
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

OBJECT_IRI = "http://prophet.platform/local/support_local#obj_ticket"
ACTION_IRI = "http://prophet.platform/local/support_local#act_triage_ticket"
EVENT_IRI = "http://prophet.platform/local/support_local#sig_ticket_created"


def _build_client() -> tuple[TestClient, InMemoryActionsRepository]:
    app = create_app(settings=Settings(prophet_metamodel_path=str(PROPHET_METAMODEL)))

    ontology_service = OntologyService(
        repository=InMemoryOntologyRepository(),
        validator=ShaclValidator(str(PROPHET_METAMODEL)),
    )
    history_service = HistoryService(repository=InMemoryHistoryRepository())
    actions_repository = InMemoryActionsRepository()
    actions_service = ActionsService(repository=actions_repository)

    app.state.ontology_service = ontology_service
    app.state.history_service = history_service
    app.state.actions_service = actions_service
    client = TestClient(app)

    ingest = client.post(
        "/api/v1/ontology/ingest",
        json={
            "release_id": "rel-catalog-phase1",
            "turtle": VALID_FIXTURE.read_text(encoding="utf-8"),
        },
    )
    assert ingest.status_code == 200, ingest.text

    occurred_at = datetime(2026, 3, 1, 12, 0, tzinfo=UTC)
    ingest_event = client.post(
        "/api/v1/history/events/ingest",
        json={
            "event_id": str(uuid4()),
            "occurred_at": occurred_at.isoformat(),
            "event_type": EVENT_IRI,
            "source": "support-api",
            "payload": {"ticket_id": "T-101", "status": "new"},
            "updated_objects": [
                {
                    "object_type": OBJECT_IRI,
                    "object_ref": {"ticket_id": "T-101"},
                    "object": {"object_type": OBJECT_IRI, "status": "new"},
                    "relation_role": "primary",
                }
            ],
        },
    )
    assert ingest_event.status_code == 200, ingest_event.text

    created = actions_repository.create_action(
        ActionCreate(
            user_id="catalog-phase1-user",
            action_uri=ACTION_IRI,
            input_payload={"ticket_id": "T-101"},
            ontology_release_id="rel-catalog-phase1",
            validation_contract_hash="catalog-phase1-hash",
            submitted_at=occurred_at,
            next_visible_at=occurred_at,
        )
    )
    actions_repository.claim_actions(
        user_id="catalog-phase1-user",
        instance_id="catalog-phase1-runner",
        capacity=1,
        max_actions=1,
        lease_seconds=60,
        now=occurred_at + timedelta(seconds=1),
    )
    actions_repository.complete_action(
        action_id=created.action_id,
        instance_id="catalog-phase1-runner",
        now=occurred_at + timedelta(seconds=2),
    )
    return client, actions_repository


def test_catalog_list_endpoints_expose_clean_concept_contracts() -> None:
    client, _ = _build_client()

    objects = client.get("/api/v1/catalog/objects")
    actions = client.get("/api/v1/catalog/actions")
    events = client.get("/api/v1/catalog/events")
    triggers = client.get("/api/v1/catalog/triggers")

    assert objects.status_code == 200, objects.text
    assert actions.status_code == 200, actions.text
    assert events.status_code == 200, events.text
    assert triggers.status_code == 200, triggers.text

    object_items = objects.json()["items"]
    action_items = actions.json()["items"]
    event_items = events.json()["items"]
    trigger_items = triggers.json()["items"]

    assert object_items
    assert action_items
    assert event_items
    assert trigger_items

    ticket_object = next(item for item in object_items if item["name"] == "Ticket")
    triage_action = next(item for item in action_items if item["name"] == "Triage Ticket")
    created_event = next(item for item in event_items if item["name"] == "Ticket Created")
    created_trigger = next(item for item in trigger_items if item["name"] == "On Ticket Created")

    assert ticket_object["description"] == "Support request tracked through a minimal triage lifecycle."
    assert triage_action["description"] == "Runs ticket triage and returns the updated ticket state."
    assert created_event["description"] == "Event emitted when a new ticket is created."
    assert created_trigger["description"] == "Starts triage when the TicketCreated event is observed."
    assert ticket_object["action_count"] >= 1
    assert ticket_object["event_count"] >= 1
    assert triage_action["object_count"] >= 1
    assert triage_action["trigger_count"] >= 1
    assert created_event["object_count"] >= 1
    assert created_event["trigger_count"] >= 1
    assert created_trigger["when_event"] == "Ticket Created"
    assert created_trigger["do_action"] == "Triage Ticket"

    assert "iri" not in ticket_object
    assert "iri" not in triage_action
    assert "iri" not in created_event
    assert "iri" not in created_trigger


def test_catalog_object_detail_and_instances_use_catalog_keys() -> None:
    client, _ = _build_client()
    objects = client.get("/api/v1/catalog/objects")
    assert objects.status_code == 200, objects.text
    object_key = next(item for item in objects.json()["items"] if item["name"] == "Ticket")[
        "catalog_key"
    ]

    detail = client.get(f"/api/v1/catalog/objects/{object_key}")
    instances = client.get(f"/api/v1/catalog/objects/{object_key}/instances")

    assert detail.status_code == 200, detail.text
    assert instances.status_code == 200, instances.text

    detail_body = detail.json()
    assert detail_body["catalog_key"] == object_key
    assert detail_body["name"] == "Ticket"
    assert detail_body["description"] == "Support request tracked through a minimal triage lifecycle."
    assert detail_body["documentation"] == "Support request tracked through a minimal triage lifecycle."
    assert detail_body["actions"]
    assert detail_body["events"]
    assert detail_body["triggers"]
    assert "iri" not in detail_body

    instances_body = instances.json()
    assert instances_body["catalog_key"] == object_key
    assert instances_body["total"] >= 1
    assert instances_body["instances"]
    first_instance = instances_body["instances"][0]
    assert "reference" in first_instance
    assert "data" in first_instance
    assert "object_ref_hash" not in first_instance


def test_catalog_action_event_and_trigger_runtime_endpoints() -> None:
    client, _ = _build_client()
    action_items = client.get("/api/v1/catalog/actions").json()["items"]
    event_items = client.get("/api/v1/catalog/events").json()["items"]
    trigger_items = client.get("/api/v1/catalog/triggers").json()["items"]
    action_key = next(item for item in action_items if item["name"] == "Triage Ticket")[
        "catalog_key"
    ]
    event_key = next(item for item in event_items if item["name"] == "Ticket Created")[
        "catalog_key"
    ]
    trigger_key = next(
        item for item in trigger_items if item["name"] == "On Ticket Created"
    )["catalog_key"]

    action_detail = client.get(f"/api/v1/catalog/actions/{action_key}")
    action_runs = client.get(f"/api/v1/catalog/actions/{action_key}/runs")
    event_detail = client.get(f"/api/v1/catalog/events/{event_key}")
    event_occurrences = client.get(f"/api/v1/catalog/events/{event_key}/occurrences")
    trigger_detail = client.get(f"/api/v1/catalog/triggers/{trigger_key}")
    trigger_firings = client.get(f"/api/v1/catalog/triggers/{trigger_key}/firings")

    assert action_detail.status_code == 200, action_detail.text
    assert action_runs.status_code == 200, action_runs.text
    assert event_detail.status_code == 200, event_detail.text
    assert event_occurrences.status_code == 200, event_occurrences.text
    assert trigger_detail.status_code == 200, trigger_detail.text
    assert trigger_firings.status_code == 200, trigger_firings.text

    action_runs_body = action_runs.json()
    assert action_runs_body["total"] >= 1
    assert action_runs_body["runs"]
    assert "action_uri" not in action_runs_body["runs"][0]

    event_occurrences_body = event_occurrences.json()
    assert event_occurrences_body["occurrences"]
    assert event_occurrences_body["occurrences"][0]["source"] == "support-api"

    trigger_firings_body = trigger_firings.json()
    assert trigger_firings_body["event"] is not None
    assert trigger_firings_body["action"] is not None
    assert trigger_firings_body["firings"]


def test_catalog_detail_returns_404_for_unknown_key() -> None:
    client, _ = _build_client()
    response = client.get("/api/v1/catalog/objects/not-a-real-catalog-key")
    assert response.status_code == 404
