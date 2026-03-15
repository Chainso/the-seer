from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

pytest.importorskip("rdflib")
pytest.importorskip("pyshacl")

from seer_backend.actions.models import ActionCreate, ActionKind, ActionStatus
from seer_backend.actions.repository import InMemoryActionsRepository
from seer_backend.actions.service import ActionsService, UnavailableActionsService
from seer_backend.config.settings import Settings
from seer_backend.main import create_app

REPO_ROOT = Path(__file__).resolve().parents[2]
PROPHET_METAMODEL = REPO_ROOT / "prophet" / "prophet.ttl"


def _run_async(coro: object) -> object:
    return asyncio.run(coro)


def _build_claim_client() -> tuple[TestClient, InMemoryActionsRepository]:
    app = create_app(settings=Settings(prophet_metamodel_path=str(PROPHET_METAMODEL)))
    repository = InMemoryActionsRepository()
    app.state.actions_service = ActionsService(repository=repository)
    return TestClient(app), repository


def _enqueue_action(
    repository: InMemoryActionsRepository,
    *,
    user_id: str,
    action_uri: str,
    submitted_at: datetime,
) -> None:
    _run_async(
        ActionsService(repository=repository).create_action(
            ActionCreate(
                user_id=user_id,
                action_uri=action_uri,
                input_payload={"ticket_id": "T-100"},
                ontology_release_id="rel-2026-03-01",
                validation_contract_hash="contract-hash-claim-test",
                submitted_at=submitted_at,
                next_visible_at=submitted_at,
            )
        )
    )


def test_claim_excludes_other_instances_during_active_lease() -> None:
    client, repository = _build_claim_client()
    now = datetime(2026, 3, 1, 12, 0, tzinfo=UTC)
    _enqueue_action(
        repository,
        user_id="user-claim-1",
        action_uri="urn:seer:test:claim.email",
        submitted_at=now,
    )

    first = client.post(
        "/api/v1/actions/claim",
        json={
            "user_id": "user-claim-1",
            "instance_id": "instance-a",
            "capacity": 2,
            "max_actions": 1,
        },
    )
    second = client.post(
        "/api/v1/actions/claim",
        json={
            "user_id": "user-claim-1",
            "instance_id": "instance-b",
            "capacity": 1,
            "max_actions": 1,
        },
    )

    assert first.status_code == 200, first.text
    assert second.status_code == 200, second.text
    first_body = first.json()
    second_body = second.json()
    assert first_body["claimed_count"] == 1
    assert first_body["actions"][0]["lease_owner_instance_id"] == "instance-a"
    assert first_body["actions"][0]["action_kind"] == ActionKind.ACTION.value
    assert first_body["actions"][0]["parent_execution_id"] is None
    assert second_body["claimed_count"] == 0
    assert second_body["actions"] == []


def test_claim_reclaims_after_lease_expiry_once_sweeper_reconciles() -> None:
    repository = InMemoryActionsRepository()
    now = datetime(2026, 3, 1, 12, 30, tzinfo=UTC)
    created = repository.create_action(
        ActionCreate(
            user_id="user-claim-2",
            action_uri="urn:seer:test:claim.retry",
            input_payload={"ticket_id": "T-101"},
            ontology_release_id="rel-2026-03-01",
            validation_contract_hash="contract-hash-claim-retry",
            submitted_at=now,
            next_visible_at=now,
        )
    )

    first = repository.claim_actions(
        user_id="user-claim-2",
        instance_id="instance-a",
        capacity=1,
        max_actions=1,
        lease_seconds=60,
        now=now,
    )
    second = repository.claim_actions(
        user_id="user-claim-2",
        instance_id="instance-b",
        capacity=1,
        max_actions=1,
        lease_seconds=60,
        now=now + timedelta(seconds=61),
    )
    sweep = repository.sweep_expired_leases(
        advisory_lock_id=201,
        batch_size=10,
        retry_delay_seconds=0,
        now=now + timedelta(seconds=61),
    )
    third = repository.claim_actions(
        user_id="user-claim-2",
        instance_id="instance-b",
        capacity=1,
        max_actions=1,
        lease_seconds=60,
        now=now + timedelta(seconds=62),
    )
    current = repository.get_action(created.action_id)

    assert len(first) == 1
    assert second == []
    assert sweep.leadership_acquired
    assert sweep.transitioned_retry_wait == 1
    assert len(third) == 1
    assert third[0].lease_owner_instance_id == "instance-b"
    assert current is not None
    assert current.status == ActionStatus.RUNNING
    assert current.attempt_count == 2


def test_draining_instance_cannot_claim_new_actions() -> None:
    client, repository = _build_claim_client()
    now = datetime(2026, 3, 1, 13, 0, tzinfo=UTC)
    _enqueue_action(
        repository,
        user_id="user-claim-3",
        action_uri="urn:seer:test:claim.draining",
        submitted_at=now,
    )

    heartbeat = client.post(
        "/api/v1/actions/instances/heartbeat",
        json={
            "user_id": "user-claim-3",
            "instance_id": "instance-draining",
            "status": "draining",
            "capacity": 1,
        },
    )
    claim = client.post(
        "/api/v1/actions/claim",
        json={
            "user_id": "user-claim-3",
            "instance_id": "instance-draining",
            "capacity": 1,
            "max_actions": 1,
        },
    )

    assert heartbeat.status_code == 200, heartbeat.text
    assert claim.status_code == 200, claim.text
    assert heartbeat.json()["status"] == "draining"
    assert claim.json()["claimed_count"] == 0
    assert claim.json()["actions"] == []


def test_instance_heartbeat_updates_liveness_and_status() -> None:
    client, _ = _build_claim_client()

    first = client.post(
        "/api/v1/actions/instances/heartbeat",
        json={
            "user_id": "user-claim-4",
            "instance_id": "instance-heartbeat",
            "status": "active",
            "capacity": 2,
            "metadata": {"region": "us-east-1"},
        },
    )
    second = client.post(
        "/api/v1/actions/instances/heartbeat",
        json={
            "user_id": "user-claim-4",
            "instance_id": "instance-heartbeat",
            "status": "draining",
            "capacity": 3,
            "metadata": {"region": "us-west-2"},
        },
    )

    assert first.status_code == 200, first.text
    assert second.status_code == 200, second.text
    first_body = first.json()
    second_body = second.json()
    first_seen = datetime.fromisoformat(first_body["last_seen_at"])
    second_seen = datetime.fromisoformat(second_body["last_seen_at"])
    assert second_seen >= first_seen
    assert second_body["status"] == "draining"
    assert second_body["capacity"] == 3
    assert second_body["metadata"] == {"region": "us-west-2"}


def test_claim_and_instance_heartbeat_map_unavailable_dependency_to_503() -> None:
    app = create_app(settings=Settings(prophet_metamodel_path=str(PROPHET_METAMODEL)))
    app.state.actions_service = UnavailableActionsService("actions unavailable")
    client = TestClient(app)

    claim = client.post(
        "/api/v1/actions/claim",
        json={
            "user_id": "user-claim-5",
            "instance_id": "instance-a",
            "capacity": 1,
            "max_actions": 1,
        },
    )
    heartbeat = client.post(
        "/api/v1/actions/instances/heartbeat",
        json={
            "user_id": "user-claim-5",
            "instance_id": "instance-a",
            "status": "active",
            "capacity": 1,
        },
    )

    assert claim.status_code == 503
    assert heartbeat.status_code == 503
    assert "actions unavailable" in claim.json()["detail"]
    assert "actions unavailable" in heartbeat.json()["detail"]
