from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient

pytest.importorskip("rdflib")
pytest.importorskip("pyshacl")

from seer_backend.actions.models import ActionCreate, ActionStatus
from seer_backend.actions.repository import InMemoryActionsRepository
from seer_backend.actions.service import ActionsService, UnavailableActionsService
from seer_backend.config.settings import Settings
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
TRIAGE_ACTION_URI = "http://prophet.platform/local/support_local#act_triage_ticket"


def _build_lifecycle_client() -> tuple[TestClient, InMemoryActionsRepository]:
    app = create_app(settings=Settings(prophet_metamodel_path=str(PROPHET_METAMODEL)))
    repository = InMemoryActionsRepository()
    app.state.actions_service = ActionsService(repository=repository)
    app.state.ontology_service = OntologyService(
        repository=InMemoryOntologyRepository(),
        validator=ShaclValidator(str(PROPHET_METAMODEL)),
    )
    return TestClient(app), repository


def _ingest_release(client: TestClient, release_id: str = "rel-2026-03-01") -> None:
    response = client.post(
        "/api/v1/ontology/ingest",
        json={
            "release_id": release_id,
            "turtle": VALID_FIXTURE.read_text(encoding="utf-8"),
        },
    )
    assert response.status_code == 200, response.text


def _enqueue_action(
    repository: InMemoryActionsRepository,
    *,
    user_id: str,
    action_uri: str,
    max_attempts: int = 3,
    payload: dict[str, object] | None = None,
    priority: int = 0,
) -> UUID:
    now = datetime(2026, 3, 1, 15, 0, tzinfo=UTC)
    action = repository.create_action(
        ActionCreate(
            user_id=user_id,
            action_uri=action_uri,
            input_payload=payload or {"ticket_id": "T-200"},
            ontology_release_id="rel-2026-03-01",
            validation_contract_hash="contract-hash-lifecycle-test",
            max_attempts=max_attempts,
            priority=priority,
            submitted_at=now,
            next_visible_at=now,
        )
    )
    return action.action_id


def _claim_one(
    client: TestClient,
    *,
    user_id: str,
    instance_id: str,
) -> dict[str, object]:
    response = client.post(
        "/api/v1/actions/claim",
        json={
            "user_id": user_id,
            "instance_id": instance_id,
            "capacity": 1,
            "max_actions": 1,
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["claimed_count"] == 1
    return body["actions"][0]


def test_complete_transition_success() -> None:
    client, repository = _build_lifecycle_client()
    action_id = _enqueue_action(
        repository,
        user_id="user-lifecycle-1",
        action_uri="urn:seer:test:lifecycle.complete",
    )
    _claim_one(client, user_id="user-lifecycle-1", instance_id="instance-a")

    response = client.post(
        f"/api/v1/actions/{action_id}/complete",
        json={"instance_id": "instance-a"},
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["action_id"] == str(action_id)
    assert body["status"] == "completed"
    assert body["completed_at"] is not None

    stored = repository.get_action(action_id)
    assert stored is not None
    assert stored.status == ActionStatus.COMPLETED
    assert stored.lease_owner_instance_id is None
    assert stored.lease_expires_at is None


def test_duplicate_complete_is_idempotent() -> None:
    client, repository = _build_lifecycle_client()
    action_id = _enqueue_action(
        repository,
        user_id="user-lifecycle-2",
        action_uri="urn:seer:test:lifecycle.complete.idempotent",
    )
    _claim_one(client, user_id="user-lifecycle-2", instance_id="instance-a")

    first = client.post(
        f"/api/v1/actions/{action_id}/complete",
        json={"instance_id": "instance-a"},
    )
    second = client.post(
        f"/api/v1/actions/{action_id}/complete",
        json={"instance_id": "instance-a"},
    )

    assert first.status_code == 200, first.text
    assert second.status_code == 200, second.text
    first_body = first.json()
    second_body = second.json()
    assert first_body["status"] == "completed"
    assert second_body["status"] == "completed"
    assert first_body["completed_at"] == second_body["completed_at"]


def test_fail_retryable_transitions_to_retry_wait_with_next_visible_at() -> None:
    client, repository = _build_lifecycle_client()
    action_id = _enqueue_action(
        repository,
        user_id="user-lifecycle-3",
        action_uri="urn:seer:test:lifecycle.retryable",
    )
    _claim_one(client, user_id="user-lifecycle-3", instance_id="instance-a")
    before_fail = datetime.now(UTC)

    response = client.post(
        f"/api/v1/actions/{action_id}/fail",
        json={
            "instance_id": "instance-a",
            "error_code": "upstream_timeout",
            "error_detail": "gateway timeout",
        },
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "retry_wait"
    assert body["last_error_code"] == "upstream_timeout"
    assert datetime.fromisoformat(body["next_visible_at"]) > before_fail

    stored = repository.get_action(action_id)
    assert stored is not None
    assert stored.status == ActionStatus.RETRY_WAIT
    assert stored.lease_owner_instance_id is None
    assert stored.lease_expires_at is None

    immediate_reclaim = client.post(
        "/api/v1/actions/claim",
        json={
            "user_id": "user-lifecycle-3",
            "instance_id": "instance-b",
            "capacity": 1,
            "max_actions": 1,
        },
    )
    assert immediate_reclaim.status_code == 200, immediate_reclaim.text
    assert immediate_reclaim.json()["claimed_count"] == 0


def test_fail_terminal_transitions_to_failed_terminal() -> None:
    client, repository = _build_lifecycle_client()
    action_id = _enqueue_action(
        repository,
        user_id="user-lifecycle-4",
        action_uri="urn:seer:test:lifecycle.terminal",
    )
    _claim_one(client, user_id="user-lifecycle-4", instance_id="instance-a")

    response = client.post(
        f"/api/v1/actions/{action_id}/fail",
        json={
            "instance_id": "instance-a",
            "error_code": "authorization_failed",
            "error_detail": "policy denied",
        },
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "failed_terminal"
    assert body["last_error_code"] == "authorization_failed"

    stored = repository.get_action(action_id)
    assert stored is not None
    assert stored.status == ActionStatus.FAILED_TERMINAL


def test_retryable_fail_exceeding_max_attempts_transitions_to_dead_letter() -> None:
    client, repository = _build_lifecycle_client()
    action_id = _enqueue_action(
        repository,
        user_id="user-lifecycle-5",
        action_uri="urn:seer:test:lifecycle.deadletter",
        max_attempts=1,
    )
    _claim_one(client, user_id="user-lifecycle-5", instance_id="instance-a")

    response = client.post(
        f"/api/v1/actions/{action_id}/fail",
        json={
            "instance_id": "instance-a",
            "error_code": "upstream_timeout",
            "error_detail": "retry budget exhausted",
        },
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "dead_letter"
    assert body["last_error_code"] == "upstream_timeout"

    stored = repository.get_action(action_id)
    assert stored is not None
    assert stored.status == ActionStatus.DEAD_LETTER


def test_retry_failed_terminal_creates_fresh_queued_action() -> None:
    client, repository = _build_lifecycle_client()
    _ingest_release(client)
    action_id = _enqueue_action(
        repository,
        user_id="user-lifecycle-retry-terminal",
        action_uri=TRIAGE_ACTION_URI,
        payload={"ticket": {"tenant": "acme", "ticket_id": "T-500"}},
        priority=7,
    )
    _claim_one(client, user_id="user-lifecycle-retry-terminal", instance_id="instance-a")
    fail = client.post(
        f"/api/v1/actions/{action_id}/fail",
        json={
            "instance_id": "instance-a",
            "error_code": "authorization_failed",
            "error_detail": "policy denied",
        },
    )
    assert fail.status_code == 200, fail.text
    assert fail.json()["status"] == "failed_terminal"

    retry = client.post(f"/api/v1/actions/{action_id}/retry")

    assert retry.status_code == 200, retry.text
    body = retry.json()
    assert body["retried_from_action_id"] == str(action_id)
    assert body["action"]["status"] == "queued"
    assert body["action"]["action_id"] != str(action_id)
    assert body["action"]["action_uri"] == TRIAGE_ACTION_URI
    assert body["action"]["user_id"] == "user-lifecycle-retry-terminal"
    assert body["action"]["priority"] == 7
    assert body["action"]["payload"] == {"ticket": {"tenant": "acme", "ticket_id": "T-500"}}

    original = repository.get_action(action_id)
    retried = repository.get_action(UUID(body["action"]["action_id"]))
    assert original is not None
    assert retried is not None
    assert original.status == ActionStatus.FAILED_TERMINAL
    assert retried.status == ActionStatus.QUEUED
    assert retried.attempt_count == 0


def test_retry_dead_letter_creates_fresh_queued_action() -> None:
    client, repository = _build_lifecycle_client()
    _ingest_release(client)
    action_id = _enqueue_action(
        repository,
        user_id="user-lifecycle-retry-dead-letter",
        action_uri=TRIAGE_ACTION_URI,
        payload={"ticket": {"tenant": "acme", "ticket_id": "T-501"}},
        max_attempts=1,
    )
    _claim_one(client, user_id="user-lifecycle-retry-dead-letter", instance_id="instance-a")
    fail = client.post(
        f"/api/v1/actions/{action_id}/fail",
        json={
            "instance_id": "instance-a",
            "error_code": "upstream_timeout",
            "error_detail": "retry budget exhausted",
        },
    )
    assert fail.status_code == 200, fail.text
    assert fail.json()["status"] == "dead_letter"

    retry = client.post(f"/api/v1/actions/{action_id}/retry")

    assert retry.status_code == 200, retry.text
    body = retry.json()
    assert body["retried_from_action_id"] == str(action_id)
    assert body["action"]["status"] == "queued"
    assert body["action"]["action_id"] != str(action_id)

    original = repository.get_action(action_id)
    retried = repository.get_action(UUID(body["action"]["action_id"]))
    assert original is not None
    assert retried is not None
    assert original.status == ActionStatus.DEAD_LETTER
    assert retried.status == ActionStatus.QUEUED


def test_retry_rejects_non_failed_action_states() -> None:
    client, repository = _build_lifecycle_client()
    _ingest_release(client)
    action_id = _enqueue_action(
        repository,
        user_id="user-lifecycle-retry-conflict",
        action_uri=TRIAGE_ACTION_URI,
        payload={"ticket": {"tenant": "acme", "ticket_id": "T-502"}},
    )

    retry = client.post(f"/api/v1/actions/{action_id}/retry")

    assert retry.status_code == 409, retry.text
    detail = retry.json()["detail"]
    assert detail["code"] == "action_not_retryable"
    assert "cannot be manually retried" in detail["message"]


def test_invalid_lease_owner_maps_to_actionable_409() -> None:
    client, repository = _build_lifecycle_client()
    action_id = _enqueue_action(
        repository,
        user_id="user-lifecycle-6",
        action_uri="urn:seer:test:lifecycle.lease-owner",
    )
    _claim_one(client, user_id="user-lifecycle-6", instance_id="instance-a")

    response = client.post(
        f"/api/v1/actions/{action_id}/complete",
        json={"instance_id": "instance-b"},
    )

    assert response.status_code == 409, response.text
    detail = response.json()["detail"]
    assert detail["code"] == "invalid_lease_owner"
    assert "does not own the active lease" in detail["message"]


def test_complete_and_fail_map_dependency_unavailable_to_503() -> None:
    app = create_app(settings=Settings(prophet_metamodel_path=str(PROPHET_METAMODEL)))
    app.state.actions_service = UnavailableActionsService("actions unavailable")
    client = TestClient(app)
    action_id = uuid4()

    complete = client.post(
        f"/api/v1/actions/{action_id}/complete",
        json={"instance_id": "instance-a"},
    )
    fail = client.post(
        f"/api/v1/actions/{action_id}/fail",
        json={
            "instance_id": "instance-a",
            "error_code": "upstream_timeout",
            "error_detail": "dependency unavailable",
        },
    )
    retry = client.post(f"/api/v1/actions/{action_id}/retry")

    assert complete.status_code == 503
    assert fail.status_code == 503
    assert retry.status_code == 503
    assert "actions unavailable" in complete.json()["detail"]
    assert "actions unavailable" in fail.json()["detail"]
    assert "actions unavailable" in retry.json()["detail"]
