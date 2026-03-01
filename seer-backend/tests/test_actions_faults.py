from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from seer_backend.actions.errors import ActionConflictError
from seer_backend.actions.models import ActionCreate, ActionStatus
from seer_backend.actions.repository import InMemoryActionsRepository


def _enqueue_action(
    repository: InMemoryActionsRepository,
    *,
    user_id: str,
    action_uri: str,
    submitted_at: datetime,
    max_attempts: int = 3,
) -> ActionCreate:
    return repository.create_action(
        ActionCreate(
            user_id=user_id,
            action_uri=action_uri,
            input_payload={"ticket_id": "T-500"},
            ontology_release_id="rel-2026-03-01",
            validation_contract_hash="contract-hash-fault-test",
            max_attempts=max_attempts,
            submitted_at=submitted_at,
            next_visible_at=submitted_at,
        )
    )


def test_dropped_callback_and_stale_lease_trigger_redelivery_before_completion() -> None:
    repository = InMemoryActionsRepository()
    now = datetime(2026, 3, 1, 19, 0, tzinfo=UTC)
    created = _enqueue_action(
        repository,
        user_id="user-faults-1",
        action_uri="urn:seer:test:faults.stale-lease",
        submitted_at=now,
    )

    first_claim = repository.claim_actions(
        user_id="user-faults-1",
        instance_id="instance-a",
        capacity=1,
        max_actions=1,
        lease_seconds=60,
        now=now,
    )
    # Simulate dropped completion callback from instance-a and lease expiry.
    no_claim_before_sweep = repository.claim_actions(
        user_id="user-faults-1",
        instance_id="instance-b",
        capacity=1,
        max_actions=1,
        lease_seconds=60,
        now=now + timedelta(seconds=61),
    )
    sweep = repository.sweep_expired_leases(
        advisory_lock_id=301,
        batch_size=10,
        retry_delay_seconds=0,
        now=now + timedelta(seconds=61),
    )
    second_claim = repository.claim_actions(
        user_id="user-faults-1",
        instance_id="instance-b",
        capacity=1,
        max_actions=1,
        lease_seconds=60,
        now=now + timedelta(seconds=62),
    )

    with pytest.raises(ActionConflictError, match="does not own the active lease") as exc_info:
        repository.complete_action(
            action_id=created.action_id,
            instance_id="instance-a",
            now=now + timedelta(seconds=62),
        )
    assert exc_info.value.code == "invalid_lease_owner"

    completed = repository.complete_action(
        action_id=created.action_id,
        instance_id="instance-b",
        now=now + timedelta(seconds=63),
    )

    assert len(first_claim) == 1
    assert no_claim_before_sweep == []
    assert sweep.leadership_acquired
    assert sweep.transitioned_retry_wait == 1
    assert len(second_claim) == 1
    assert first_claim[0].action_id == created.action_id
    assert second_claim[0].action_id == created.action_id
    assert first_claim[0].attempt_count == 1
    assert second_claim[0].attempt_count == 2
    assert completed.status == ActionStatus.COMPLETED
    assert completed.attempt_count == 2


def test_duplicate_completion_callback_is_idempotent_after_terminal_state() -> None:
    repository = InMemoryActionsRepository()
    now = datetime(2026, 3, 1, 19, 20, tzinfo=UTC)
    created = _enqueue_action(
        repository,
        user_id="user-faults-2",
        action_uri="urn:seer:test:faults.duplicate-complete",
        submitted_at=now,
    )
    repository.claim_actions(
        user_id="user-faults-2",
        instance_id="instance-a",
        capacity=1,
        max_actions=1,
        lease_seconds=60,
        now=now,
    )

    first = repository.complete_action(
        action_id=created.action_id,
        instance_id="instance-a",
        now=now + timedelta(seconds=1),
    )
    second = repository.complete_action(
        action_id=created.action_id,
        instance_id="instance-a",
        now=now + timedelta(seconds=2),
    )

    assert first.status == ActionStatus.COMPLETED
    assert second.status == ActionStatus.COMPLETED
    assert second.completed_at == first.completed_at
    assert second.attempt_count == first.attempt_count == 1


def test_retryable_failures_progress_until_dead_letter_terminal_state() -> None:
    repository = InMemoryActionsRepository()
    now = datetime(2026, 3, 1, 19, 40, tzinfo=UTC)
    created = _enqueue_action(
        repository,
        user_id="user-faults-3",
        action_uri="urn:seer:test:faults.retry-to-dead-letter",
        submitted_at=now,
        max_attempts=3,
    )

    first_claim = repository.claim_actions(
        user_id="user-faults-3",
        instance_id="instance-a",
        capacity=1,
        max_actions=1,
        lease_seconds=60,
        now=now,
    )
    first_fail = repository.fail_action(
        action_id=created.action_id,
        instance_id="instance-a",
        error_code="upstream_timeout",
        error_detail="attempt-1 timeout",
        retryable=True,
        retry_delay_seconds=2,
        now=now + timedelta(seconds=1),
    )

    second_claim = repository.claim_actions(
        user_id="user-faults-3",
        instance_id="instance-b",
        capacity=1,
        max_actions=1,
        lease_seconds=60,
        now=now + timedelta(seconds=3),
    )
    second_fail = repository.fail_action(
        action_id=created.action_id,
        instance_id="instance-b",
        error_code="upstream_timeout",
        error_detail="attempt-2 timeout",
        retryable=True,
        retry_delay_seconds=4,
        now=now + timedelta(seconds=4),
    )

    third_claim = repository.claim_actions(
        user_id="user-faults-3",
        instance_id="instance-c",
        capacity=1,
        max_actions=1,
        lease_seconds=60,
        now=now + timedelta(seconds=8),
    )
    third_fail = repository.fail_action(
        action_id=created.action_id,
        instance_id="instance-c",
        error_code="upstream_timeout",
        error_detail="attempt-3 timeout",
        retryable=True,
        retry_delay_seconds=8,
        now=now + timedelta(seconds=9),
    )

    assert len(first_claim) == 1
    assert first_fail.status == ActionStatus.RETRY_WAIT
    assert first_fail.attempt_count == 1
    assert first_fail.next_visible_at == now + timedelta(seconds=3)

    assert len(second_claim) == 1
    assert second_fail.status == ActionStatus.RETRY_WAIT
    assert second_fail.attempt_count == 2
    assert second_fail.next_visible_at == now + timedelta(seconds=8)

    assert len(third_claim) == 1
    assert third_fail.status == ActionStatus.DEAD_LETTER
    assert third_fail.attempt_count == 3
    assert third_fail.last_error_code == "upstream_timeout"
