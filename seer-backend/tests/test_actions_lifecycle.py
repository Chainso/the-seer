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

REPO_ROOT = Path(__file__).resolve().parents[2]
PROPHET_METAMODEL = REPO_ROOT / "prophet" / "prophet.ttl"


def _build_lifecycle_client() -> tuple[TestClient, InMemoryActionsRepository]:
    app = create_app(settings=Settings(prophet_metamodel_path=str(PROPHET_METAMODEL)))
    repository = InMemoryActionsRepository()
    app.state.actions_service = ActionsService(repository=repository)
    return TestClient(app), repository


def _enqueue_action(
    repository: InMemoryActionsRepository,
    *,
    user_id: str,
    action_uri: str,
    max_attempts: int = 3,
) -> UUID:
    now = datetime(2026, 3, 1, 15, 0, tzinfo=UTC)
    action = repository.create_action(
        ActionCreate(
            user_id=user_id,
            action_uri=action_uri,
            input_payload={"ticket_id": "T-200"},
            ontology_release_id="rel-2026-03-01",
            validation_contract_hash="contract-hash-lifecycle-test",
            max_attempts=max_attempts,
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

    assert complete.status_code == 503
    assert fail.status_code == 503
    assert "actions unavailable" in complete.json()["detail"]
    assert "actions unavailable" in fail.json()["detail"]
