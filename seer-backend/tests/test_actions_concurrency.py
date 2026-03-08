from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from threading import Barrier

from seer_backend.actions.models import ActionCreate, ActionRecord, ActionStatus
from seer_backend.actions.repository import InMemoryActionsRepository


def _enqueue_action(
    repository: InMemoryActionsRepository,
    *,
    user_id: str,
    action_uri: str,
    submitted_at: datetime,
    priority: int,
) -> ActionRecord:
    return repository.create_action(
        ActionCreate(
            user_id=user_id,
            action_uri=action_uri,
            input_payload={"ticket_id": "T-400"},
            ontology_release_id="rel-2026-03-01",
            validation_contract_hash="contract-hash-concurrency-test",
            priority=priority,
            submitted_at=submitted_at,
            next_visible_at=submitted_at,
        )
    )


def test_parallel_claim_contention_does_not_duplicate_single_lease() -> None:
    repository = InMemoryActionsRepository()
    now = datetime(2026, 3, 1, 18, 0, tzinfo=UTC)
    created = _enqueue_action(
        repository,
        user_id="user-concurrency-1",
        action_uri="urn:seer:test:concurrency.single",
        submitted_at=now,
        priority=1,
    )

    worker_count = 8
    barrier = Barrier(worker_count)

    def claim_once(worker_index: int) -> list[ActionRecord]:
        barrier.wait()
        return repository.claim_actions(
            user_id="user-concurrency-1",
            instance_id=f"instance-{worker_index}",
            capacity=1,
            max_actions=1,
            lease_seconds=60,
            now=now,
        )

    with ThreadPoolExecutor(max_workers=worker_count) as pool:
        results = list(pool.map(claim_once, range(worker_count)))

    claimed_ids = [row.action_id for batch in results for row in batch]
    assert claimed_ids == [created.action_id]

    stored = repository.get_action(created.action_id)
    assert stored is not None
    assert stored.status == ActionStatus.RUNNING
    assert stored.attempt_count == 1
    assert stored.lease_owner_instance_id is not None


def test_parallel_claims_respect_priority_then_fifo_under_contention() -> None:
    repository = InMemoryActionsRepository()
    base = datetime(2026, 3, 1, 18, 30, tzinfo=UTC)
    created = [
        _enqueue_action(
            repository,
            user_id="user-concurrency-2",
            action_uri="urn:seer:test:concurrency.low",
            submitted_at=base + timedelta(seconds=40),
            priority=1,
        ),
        _enqueue_action(
            repository,
            user_id="user-concurrency-2",
            action_uri="urn:seer:test:concurrency.p5.older",
            submitted_at=base + timedelta(seconds=5),
            priority=5,
        ),
        _enqueue_action(
            repository,
            user_id="user-concurrency-2",
            action_uri="urn:seer:test:concurrency.p10",
            submitted_at=base + timedelta(seconds=20),
            priority=10,
        ),
        _enqueue_action(
            repository,
            user_id="user-concurrency-2",
            action_uri="urn:seer:test:concurrency.p5.newer",
            submitted_at=base + timedelta(seconds=30),
            priority=5,
        ),
    ]
    expected_top_ids = {
        row.action_id
        for row in sorted(
            created,
            key=lambda action: (-action.priority, action.submitted_at, str(action.action_id)),
        )[:3]
    }

    claim_time = base + timedelta(seconds=45)
    worker_count = 3
    barrier = Barrier(worker_count)

    def claim_one(worker_index: int) -> list[ActionRecord]:
        barrier.wait()
        return repository.claim_actions(
            user_id="user-concurrency-2",
            instance_id=f"instance-{worker_index}",
            capacity=1,
            max_actions=1,
            lease_seconds=60,
            now=claim_time,
        )

    with ThreadPoolExecutor(max_workers=worker_count) as pool:
        results = list(pool.map(claim_one, range(worker_count)))

    claimed = [row for batch in results for row in batch]
    assert len(claimed) == 3
    assert {row.action_id for row in claimed} == expected_top_ids
    assert all(row.status == ActionStatus.RUNNING for row in claimed)
    assert all(row.attempt_count == 1 for row in claimed)
