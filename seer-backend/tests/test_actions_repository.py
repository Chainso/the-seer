from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta

import pytest

from seer_backend.actions.errors import ActionDependencyUnavailableError
from seer_backend.actions.models import ActionCreate, ActionStatus
from seer_backend.actions.repository import InMemoryActionsRepository
from seer_backend.actions.service import ActionsService, UnavailableActionsService


def _run_async(coro: object) -> object:
    return asyncio.run(coro)


def test_actions_service_ensure_schema_runs_once() -> None:
    repository = InMemoryActionsRepository()
    service = ActionsService(repository=repository)

    _run_async(service.ensure_schema())
    _run_async(service.ensure_schema())

    assert repository.ensure_schema_calls == 1


def test_actions_create_and_get_round_trip() -> None:
    repository = InMemoryActionsRepository()
    service = ActionsService(repository=repository)
    submitted_at = datetime(2026, 3, 1, 10, 0, tzinfo=UTC)

    created = _run_async(
        service.create_action(
            ActionCreate(
                user_id="user-1",
                action_uri="urn:seer:test:email.send",
                input_payload={"to": "ops@acme.test"},
                ontology_release_id="rel-2026-03-01",
                validation_contract_hash="contract-hash-1",
                submitted_at=submitted_at,
                next_visible_at=submitted_at,
            )
        )
    )
    loaded = _run_async(service.get_action(created.action_id))

    assert loaded is not None
    assert loaded.action_id == created.action_id
    assert loaded.status == ActionStatus.QUEUED
    assert loaded.attempt_count == 0
    assert loaded.lease_owner_instance_id is None


def test_claim_enforces_lease_exclusivity_and_supports_reclaim_after_expiry() -> None:
    repository = InMemoryActionsRepository()
    service = ActionsService(repository=repository)
    now = datetime(2026, 3, 1, 12, 0, tzinfo=UTC)

    action = _run_async(
        service.create_action(
            ActionCreate(
                user_id="user-2",
                action_uri="urn:seer:test:invoice.generate",
                input_payload={"invoice_id": "INV-42"},
                ontology_release_id="rel-2026-03-01",
                validation_contract_hash="contract-hash-2",
                submitted_at=now,
                next_visible_at=now,
            )
        )
    )

    first_claim = repository.claim_actions(
        user_id="user-2",
        instance_id="instance-a",
        max_actions=1,
        lease_seconds=60,
        now=now,
    )
    second_claim_during_lease = repository.claim_actions(
        user_id="user-2",
        instance_id="instance-b",
        max_actions=1,
        lease_seconds=60,
        now=now + timedelta(seconds=10),
    )
    third_claim_after_expiry = repository.claim_actions(
        user_id="user-2",
        instance_id="instance-b",
        max_actions=1,
        lease_seconds=60,
        now=now + timedelta(seconds=61),
    )
    current = repository.get_action(action.action_id)

    assert len(first_claim) == 1
    assert first_claim[0].lease_owner_instance_id == "instance-a"
    assert second_claim_during_lease == []
    assert len(third_claim_after_expiry) == 1
    assert third_claim_after_expiry[0].lease_owner_instance_id == "instance-b"
    assert current is not None
    assert current.status == ActionStatus.LEASED
    assert current.attempt_count == 2


def test_unavailable_actions_service_fails_closed_with_dependency_error() -> None:
    service = UnavailableActionsService("postgres unavailable")

    with pytest.raises(ActionDependencyUnavailableError, match="postgres unavailable"):
        _run_async(service.ensure_schema())
