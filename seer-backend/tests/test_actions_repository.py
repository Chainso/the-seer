from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from seer_backend.actions.errors import ActionDependencyUnavailableError
from seer_backend.actions.models import ActionCreate, ActionKind, ActionStatus, AttemptOutcome
from seer_backend.actions.repository import InMemoryActionsRepository, PostgresActionsRepository
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
    assert loaded.action_kind == ActionKind.WORKFLOW
    assert loaded.parent_execution_id is None
    assert loaded.attempt_count == 0
    assert loaded.lease_owner_instance_id is None


def test_actions_create_and_get_round_trip_preserves_parent_execution() -> None:
    repository = InMemoryActionsRepository()
    service = ActionsService(repository=repository)
    submitted_at = datetime(2026, 3, 1, 10, 5, tzinfo=UTC)
    parent = _run_async(
        service.create_action(
            ActionCreate(
                user_id="user-lineage-1",
                action_uri="urn:seer:test:agent.parent",
                action_kind=ActionKind.AGENTIC_WORKFLOW,
                input_payload={"invoice_id": "INV-1"},
                ontology_release_id="rel-2026-03-01",
                validation_contract_hash="contract-hash-parent",
                submitted_at=submitted_at,
                next_visible_at=submitted_at,
            )
        )
    )
    child = _run_async(
        service.create_action(
            ActionCreate(
                user_id="user-lineage-1",
                action_uri="urn:seer:test:action.child",
                action_kind=ActionKind.PROCESS,
                parent_execution_id=parent.action_id,
                input_payload={"invoice_id": "INV-1"},
                ontology_release_id="rel-2026-03-01",
                validation_contract_hash="contract-hash-child",
                submitted_at=submitted_at,
                next_visible_at=submitted_at,
            )
        )
    )
    loaded = _run_async(service.get_action(child.action_id))

    assert loaded is not None
    assert loaded.action_kind == ActionKind.PROCESS
    assert loaded.parent_execution_id == parent.action_id


def test_sweeper_reclaims_expired_lease_to_retry_wait_and_marks_attempt_outcome() -> None:
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
        capacity=1,
        max_actions=1,
        lease_seconds=60,
        now=now,
    )
    second_claim_during_expired_lease = repository.claim_actions(
        user_id="user-2",
        instance_id="instance-b",
        capacity=1,
        max_actions=1,
        lease_seconds=60,
        now=now + timedelta(seconds=61),
    )
    sweep = repository.sweep_expired_leases(
        advisory_lock_id=101,
        batch_size=10,
        retry_delay_seconds=0,
        now=now + timedelta(seconds=61),
    )
    action_after_sweep = repository.get_action(action.action_id)
    attempt_after_sweep = repository._load_attempt(action_id=action.action_id, attempt_no=1)
    third_claim_after_sweep = repository.claim_actions(
        user_id="user-2",
        instance_id="instance-b",
        capacity=1,
        max_actions=1,
        lease_seconds=60,
        now=now + timedelta(seconds=62),
    )

    assert len(first_claim) == 1
    assert first_claim[0].lease_owner_instance_id == "instance-a"
    assert second_claim_during_expired_lease == []
    assert sweep.leadership_acquired
    assert sweep.scanned_actions == 1
    assert sweep.transitioned_retry_wait == 1
    assert sweep.transitioned_dead_letter == 0
    assert sweep.attempts_marked_lease_expired == 1
    assert sweep.dead_letter_upserts == 0
    assert action_after_sweep is not None
    assert action_after_sweep.status == ActionStatus.RETRY_WAIT
    assert action_after_sweep.lease_owner_instance_id is None
    assert action_after_sweep.lease_expires_at is None
    assert action_after_sweep.last_error_code == "lease_expired"
    assert attempt_after_sweep is not None
    assert attempt_after_sweep.finished_at == now + timedelta(seconds=61)
    assert attempt_after_sweep.outcome == AttemptOutcome.LEASE_EXPIRED
    assert attempt_after_sweep.error_code == "lease_expired"
    assert len(third_claim_after_sweep) == 1
    assert third_claim_after_sweep[0].lease_owner_instance_id == "instance-b"
    assert third_claim_after_sweep[0].attempt_count == 2


def test_sweeper_transitions_to_dead_letter_when_attempt_budget_is_exhausted() -> None:
    repository = InMemoryActionsRepository()
    now = datetime(2026, 3, 1, 12, 30, tzinfo=UTC)
    action = repository.create_action(
        ActionCreate(
            user_id="user-3",
            action_uri="urn:seer:test:invoice.dead-letter",
            input_payload={"invoice_id": "INV-99"},
            ontology_release_id="rel-2026-03-01",
            validation_contract_hash="contract-hash-3",
            max_attempts=1,
            submitted_at=now,
            next_visible_at=now,
        )
    )
    repository.claim_actions(
        user_id="user-3",
        instance_id="instance-a",
        capacity=1,
        max_actions=1,
        lease_seconds=60,
        now=now,
    )

    sweep_time = now + timedelta(seconds=61)
    sweep = repository.sweep_expired_leases(
        advisory_lock_id=102,
        batch_size=10,
        retry_delay_seconds=0,
        now=sweep_time,
    )
    updated = repository.get_action(action.action_id)
    attempt = repository._load_attempt(action_id=action.action_id, attempt_no=1)

    assert sweep.leadership_acquired
    assert sweep.scanned_actions == 1
    assert sweep.transitioned_retry_wait == 0
    assert sweep.transitioned_dead_letter == 1
    assert sweep.attempts_marked_lease_expired == 1
    assert sweep.dead_letter_upserts == 1
    assert updated is not None
    assert updated.status == ActionStatus.DEAD_LETTER
    assert updated.lease_owner_instance_id is None
    assert updated.lease_expires_at is None
    assert updated.next_visible_at == sweep_time
    assert updated.last_error_code == "lease_expired"
    assert attempt is not None
    assert attempt.outcome == AttemptOutcome.LEASE_EXPIRED
    assert repository._dead_letters[action.action_id][1] == "max_attempts_exhausted"


class _FakeScalarResult:
    def __init__(self, value: object) -> None:
        self._value = value

    def scalar_one(self) -> object:
        return self._value


class _FakeConnection:
    def __init__(self) -> None:
        self.executed_sql: list[str] = []

    def execute(self, statement: object) -> _FakeScalarResult:
        sql = str(statement)
        self.executed_sql.append(sql)
        if "pg_try_advisory_xact_lock" in sql:
            return _FakeScalarResult(False)
        raise AssertionError(f"unexpected SQL execution in non-leader sweep: {sql}")


class _FakeBeginContext:
    def __init__(self, connection: _FakeConnection) -> None:
        self._connection = connection

    def __enter__(self) -> _FakeConnection:
        return self._connection

    def __exit__(self, exc_type: object, exc: object, traceback: object) -> bool:
        return False


class _FakeEngine:
    def __init__(self, connection: _FakeConnection) -> None:
        self._connection = connection

    def begin(self) -> _FakeBeginContext:
        return _FakeBeginContext(self._connection)


def test_postgres_sweeper_non_leader_returns_noop_after_failed_advisory_lock() -> None:
    repository = PostgresActionsRepository(
        dsn="postgresql+psycopg://seer:seer@localhost:5432/seer_actions",
        migrations_dir=Path("."),
    )
    fake_connection = _FakeConnection()
    repository._engine = _FakeEngine(fake_connection)  # type: ignore[assignment]

    result = repository.sweep_expired_leases(
        advisory_lock_id=103,
        batch_size=5,
        retry_delay_seconds=2,
        now=datetime(2026, 3, 1, 13, 0, tzinfo=UTC),
    )

    assert not result.leadership_acquired
    assert result.scanned_actions == 0
    assert result.transitioned_retry_wait == 0
    assert result.transitioned_dead_letter == 0
    assert result.attempts_marked_lease_expired == 0
    assert result.dead_letter_upserts == 0
    assert len(fake_connection.executed_sql) == 1
    assert "pg_try_advisory_xact_lock" in fake_connection.executed_sql[0]


def test_unavailable_actions_service_fails_closed_with_dependency_error() -> None:
    service = UnavailableActionsService("postgres unavailable")

    with pytest.raises(ActionDependencyUnavailableError, match="postgres unavailable"):
        _run_async(service.ensure_schema())
