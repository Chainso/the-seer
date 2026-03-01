"""Action orchestration persistence adapters."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime, timedelta
from pathlib import Path
from threading import Lock
from typing import Protocol
from uuid import UUID, uuid4

from sqlalchemy import (
    JSON,
    Column,
    ForeignKey,
    MetaData,
    String,
    Table,
    Text,
    and_,
    create_engine,
    desc,
    func,
    insert,
    select,
    update,
)
from sqlalchemy.dialects import postgresql
from sqlalchemy.engine import Connection, Engine, RowMapping
from sqlalchemy.exc import IntegrityError, SQLAlchemyError

from seer_backend.actions.errors import (
    ActionConflictError,
    ActionNotFoundError,
    ActionRepositoryError,
)
from seer_backend.actions.models import (
    ActionAttemptRecord,
    ActionCreate,
    ActionRecord,
    ActionStatus,
    AttemptOutcome,
    InstanceRecord,
    InstanceStatus,
)

metadata = MetaData()

actions_table = Table(
    "actions",
    metadata,
    Column("action_id", postgresql.UUID(as_uuid=True), primary_key=True),
    Column("user_id", String(255), nullable=False),
    Column("action_uri", Text, nullable=False),
    Column("input_payload", postgresql.JSONB(astext_type=Text()), nullable=False),
    Column("status", String(32), nullable=False),
    Column("priority", postgresql.INTEGER, nullable=False),
    Column("idempotency_key", String(255), nullable=True),
    Column("ontology_release_id", String(255), nullable=False),
    Column("validation_contract_hash", String(255), nullable=False),
    Column("attempt_count", postgresql.INTEGER, nullable=False),
    Column("max_attempts", postgresql.INTEGER, nullable=False),
    Column("next_visible_at", postgresql.TIMESTAMP(timezone=True), nullable=False),
    Column("lease_owner_instance_id", String(255), nullable=True),
    Column("lease_expires_at", postgresql.TIMESTAMP(timezone=True), nullable=True),
    Column("last_error_code", String(255), nullable=True),
    Column("last_error_detail", Text, nullable=True),
    Column("submitted_at", postgresql.TIMESTAMP(timezone=True), nullable=False),
    Column("updated_at", postgresql.TIMESTAMP(timezone=True), nullable=False),
    Column("completed_at", postgresql.TIMESTAMP(timezone=True), nullable=True),
)

action_attempts_table = Table(
    "action_attempts",
    metadata,
    Column("attempt_id", postgresql.UUID(as_uuid=True), primary_key=True),
    Column(
        "action_id",
        postgresql.UUID(as_uuid=True),
        ForeignKey("actions.action_id", ondelete="CASCADE"),
        nullable=False,
    ),
    Column("attempt_no", postgresql.INTEGER, nullable=False),
    Column("instance_id", String(255), nullable=False),
    Column("leased_at", postgresql.TIMESTAMP(timezone=True), nullable=False),
    Column("started_at", postgresql.TIMESTAMP(timezone=True), nullable=True),
    Column("finished_at", postgresql.TIMESTAMP(timezone=True), nullable=True),
    Column("outcome", String(64), nullable=True),
    Column("error_code", String(255), nullable=True),
    Column("error_detail", Text, nullable=True),
)

instances_table = Table(
    "instances",
    metadata,
    Column("instance_id", String(255), nullable=False, primary_key=True),
    Column("user_id", String(255), nullable=False, primary_key=True),
    Column("status", String(32), nullable=False),
    Column("last_seen_at", postgresql.TIMESTAMP(timezone=True), nullable=False),
    Column("capacity", postgresql.INTEGER, nullable=True),
    Column("metadata", JSON, nullable=True),
)

action_dead_letters_table = Table(
    "action_dead_letters",
    metadata,
    Column(
        "action_id",
        postgresql.UUID(as_uuid=True),
        ForeignKey("actions.action_id", ondelete="CASCADE"),
        primary_key=True,
    ),
    Column("dead_lettered_at", postgresql.TIMESTAMP(timezone=True), nullable=False),
    Column("reason_code", String(255), nullable=False),
    Column("reason_detail", Text, nullable=True),
    Column(
        "replayed_from_action_id",
        postgresql.UUID(as_uuid=True),
        ForeignKey("actions.action_id"),
        nullable=True,
    ),
)


class ActionsRepository(Protocol):
    def ensure_schema(self) -> None: ...

    def create_action(self, action: ActionCreate) -> ActionRecord: ...

    def create_action_with_dedupe(self, action: ActionCreate) -> tuple[ActionRecord, bool]: ...

    def get_action(self, action_id: UUID) -> ActionRecord | None: ...

    def get_action_by_idempotency_key(
        self,
        *,
        user_id: str,
        idempotency_key: str,
    ) -> ActionRecord | None: ...

    def list_actions(
        self,
        *,
        user_id: str,
        status: ActionStatus | None = None,
        page: int = 1,
        size: int = 20,
        submitted_after: datetime | None = None,
        submitted_before: datetime | None = None,
    ) -> tuple[list[ActionRecord], int]: ...

    def claim_actions(
        self,
        *,
        user_id: str,
        instance_id: str,
        capacity: int,
        max_actions: int,
        lease_seconds: int,
        now: datetime | None = None,
    ) -> list[ActionRecord]: ...

    def heartbeat_instance(
        self,
        *,
        user_id: str,
        instance_id: str,
        status: InstanceStatus | None = None,
        capacity: int | None = None,
        metadata: Mapping[str, object] | None = None,
        now: datetime | None = None,
    ) -> InstanceRecord: ...

    def complete_action(
        self,
        *,
        action_id: UUID,
        instance_id: str,
        now: datetime | None = None,
    ) -> ActionRecord: ...

    def fail_action(
        self,
        *,
        action_id: UUID,
        instance_id: str,
        error_code: str,
        error_detail: str | None,
        retryable: bool,
        retry_delay_seconds: int,
        now: datetime | None = None,
    ) -> ActionRecord: ...


@dataclass(slots=True)
class PostgresActionsRepository:
    dsn: str
    migrations_dir: Path
    pool_size: int = 5
    max_overflow: int = 10
    _engine: Engine | None = field(default=None, init=False, repr=False)
    _engine_lock: Lock = field(default_factory=Lock, init=False, repr=False)

    def ensure_schema(self) -> None:
        if not self.migrations_dir.exists():
            raise ActionRepositoryError(
                f"Missing Postgres migrations directory: {self.migrations_dir}"
            )

        migration_files = sorted(self.migrations_dir.glob("*.sql"))
        if not migration_files:
            raise ActionRepositoryError(
                f"No Postgres migration files found in {self.migrations_dir}"
            )

        try:
            with self._engine_instance().begin() as connection:
                for file in migration_files:
                    sql_text = file.read_text(encoding="utf-8")
                    for statement in _split_sql_statements(sql_text):
                        connection.exec_driver_sql(statement)
        except SQLAlchemyError as exc:
            raise ActionRepositoryError(f"Postgres schema migration failed: {exc}") from exc

    def create_action(self, action: ActionCreate) -> ActionRecord:
        record, _dedupe_hit = self.create_action_with_dedupe(action)
        return record

    def create_action_with_dedupe(self, action: ActionCreate) -> tuple[ActionRecord, bool]:
        submitted_at = _ensure_utc(action.submitted_at)
        next_visible_at = _ensure_utc(action.next_visible_at or submitted_at)
        values = {
            "action_id": action.action_id,
            "user_id": action.user_id,
            "action_uri": action.action_uri,
            "input_payload": action.input_payload,
            "status": ActionStatus.QUEUED.value,
            "priority": int(action.priority),
            "idempotency_key": action.idempotency_key,
            "ontology_release_id": action.ontology_release_id,
            "validation_contract_hash": action.validation_contract_hash,
            "attempt_count": 0,
            "max_attempts": int(action.max_attempts),
            "next_visible_at": next_visible_at,
            "lease_owner_instance_id": None,
            "lease_expires_at": None,
            "last_error_code": None,
            "last_error_detail": None,
            "submitted_at": submitted_at,
            "updated_at": submitted_at,
            "completed_at": None,
        }
        try:
            with self._engine_instance().begin() as connection:
                try:
                    connection.execute(insert(actions_table).values(**values))
                    row = self._load_action_row_by_id(connection, action.action_id)
                    if row is None:
                        raise ActionRepositoryError(
                            f"created action '{action.action_id}' could not be loaded"
                        )
                    return _action_from_row(row), False
                except IntegrityError as exc:
                    if action.idempotency_key and _is_unique_violation(exc):
                        row = self._load_action_row_by_idempotency_key(
                            connection=connection,
                            user_id=action.user_id,
                            idempotency_key=action.idempotency_key,
                        )
                        if row is None:
                            raise ActionRepositoryError(
                                "idempotency collision detected but "
                                "existing action could not be loaded"
                            ) from exc
                        return _action_from_row(row), True
                    raise
        except SQLAlchemyError as exc:
            raise ActionRepositoryError(f"Postgres create action failed: {exc}") from exc

    def get_action(self, action_id: UUID) -> ActionRecord | None:
        try:
            with self._engine_instance().connect() as connection:
                row = self._load_action_row_by_id(connection, action_id)
        except SQLAlchemyError as exc:
            raise ActionRepositoryError(f"Postgres get action failed: {exc}") from exc
        if row is None:
            return None
        return _action_from_row(row)

    def get_action_by_idempotency_key(
        self,
        *,
        user_id: str,
        idempotency_key: str,
    ) -> ActionRecord | None:
        try:
            with self._engine_instance().connect() as connection:
                row = self._load_action_row_by_idempotency_key(
                    connection=connection,
                    user_id=user_id,
                    idempotency_key=idempotency_key,
                )
        except SQLAlchemyError as exc:
            raise ActionRepositoryError(f"Postgres get by idempotency key failed: {exc}") from exc
        if row is None:
            return None
        return _action_from_row(row)

    def list_actions(
        self,
        *,
        user_id: str,
        status: ActionStatus | None = None,
        page: int = 1,
        size: int = 20,
        submitted_after: datetime | None = None,
        submitted_before: datetime | None = None,
    ) -> tuple[list[ActionRecord], int]:
        page_number = max(int(page), 1)
        page_size = max(int(size), 1)
        offset = (page_number - 1) * page_size
        filters = [actions_table.c.user_id == user_id]
        if status is not None:
            filters.append(actions_table.c.status == status.value)
        if submitted_after is not None:
            filters.append(actions_table.c.submitted_at >= _ensure_utc(submitted_after))
        if submitted_before is not None:
            filters.append(actions_table.c.submitted_at <= _ensure_utc(submitted_before))
        clause = and_(*filters)

        try:
            with self._engine_instance().connect() as connection:
                total = connection.execute(
                    select(func.count()).select_from(actions_table).where(clause)
                ).scalar_one()
                rows = (
                    connection.execute(
                        select(*actions_table.c)
                        .where(clause)
                        .order_by(
                            desc(actions_table.c.submitted_at),
                            desc(actions_table.c.action_id),
                        )
                        .offset(offset)
                        .limit(page_size)
                    )
                    .mappings()
                    .all()
                )
        except SQLAlchemyError as exc:
            raise ActionRepositoryError(f"Postgres list actions failed: {exc}") from exc

        return [_action_from_row(row) for row in rows], int(total)

    def claim_actions(
        self,
        *,
        user_id: str,
        instance_id: str,
        capacity: int,
        max_actions: int,
        lease_seconds: int,
        now: datetime | None = None,
    ) -> list[ActionRecord]:
        if max_actions < 1 or capacity < 1:
            return []

        now_utc = _ensure_utc(now or datetime.now(UTC))
        lease_expires_at = now_utc + timedelta(seconds=max(int(lease_seconds), 1))
        queued_statuses = (ActionStatus.QUEUED.value, ActionStatus.RETRY_WAIT.value)

        try:
            with self._engine_instance().begin() as connection:
                self._upsert_instance(
                    connection=connection,
                    user_id=user_id,
                    instance_id=instance_id,
                    now=now_utc,
                    capacity=capacity,
                    preserve_status_on_conflict=True,
                    status=None,
                    metadata=None,
                )
                instance_row = (
                    connection.execute(
                        select(*instances_table.c)
                        .where(
                            and_(
                                instances_table.c.user_id == user_id,
                                instances_table.c.instance_id == instance_id,
                            )
                        )
                        .with_for_update()
                    )
                    .mappings()
                    .first()
                )
                if instance_row is None:
                    raise ActionRepositoryError(
                        f"instance heartbeat upsert failed for '{instance_id}' user '{user_id}'"
                    )
                instance_record = _instance_from_row(instance_row)
                if instance_record.status == InstanceStatus.DRAINING:
                    return []
                candidate_rows = (
                    connection.execute(
                        select(actions_table.c.action_id, actions_table.c.attempt_count)
                        .where(
                            and_(
                                actions_table.c.user_id == user_id,
                                (
                                    and_(
                                        actions_table.c.status.in_(queued_statuses),
                                        actions_table.c.next_visible_at <= now_utc,
                                    )
                                    | and_(
                                        actions_table.c.status.in_(
                                            (
                                                ActionStatus.LEASED.value,
                                                ActionStatus.RUNNING.value,
                                            )
                                        ),
                                        actions_table.c.lease_expires_at.is_not(None),
                                        actions_table.c.lease_expires_at <= now_utc,
                                    )
                                ),
                            )
                        )
                        .order_by(
                            desc(actions_table.c.priority),
                            actions_table.c.submitted_at,
                            actions_table.c.action_id,
                        )
                        .limit(int(max_actions))
                        .with_for_update(skip_locked=True)
                    )
                    .mappings()
                    .all()
                )
                if not candidate_rows:
                    return []

                action_ids = [row["action_id"] for row in candidate_rows]
                connection.execute(
                    update(actions_table)
                    .where(actions_table.c.action_id.in_(action_ids))
                    .values(
                        status=ActionStatus.LEASED.value,
                        lease_owner_instance_id=instance_id,
                        lease_expires_at=lease_expires_at,
                        attempt_count=actions_table.c.attempt_count + 1,
                        updated_at=now_utc,
                    )
                )

                attempt_rows = [
                    {
                        "attempt_id": uuid4(),
                        "action_id": row["action_id"],
                        "attempt_no": int(row["attempt_count"]) + 1,
                        "instance_id": instance_id,
                        "leased_at": now_utc,
                        "started_at": None,
                        "finished_at": None,
                        "outcome": None,
                        "error_code": None,
                        "error_detail": None,
                    }
                    for row in candidate_rows
                ]
                connection.execute(insert(action_attempts_table), attempt_rows)

                leased_rows = (
                    connection.execute(
                        select(*actions_table.c).where(actions_table.c.action_id.in_(action_ids))
                    )
                    .mappings()
                    .all()
                )
        except SQLAlchemyError as exc:
            raise ActionRepositoryError(f"Postgres claim actions failed: {exc}") from exc

        leased = [_action_from_row(row) for row in leased_rows]
        leased.sort(key=lambda row: (-row.priority, row.submitted_at, str(row.action_id)))
        return leased

    def heartbeat_instance(
        self,
        *,
        user_id: str,
        instance_id: str,
        status: InstanceStatus | None = None,
        capacity: int | None = None,
        metadata: Mapping[str, object] | None = None,
        now: datetime | None = None,
    ) -> InstanceRecord:
        now_utc = _ensure_utc(now or datetime.now(UTC))
        try:
            with self._engine_instance().begin() as connection:
                self._upsert_instance(
                    connection=connection,
                    user_id=user_id,
                    instance_id=instance_id,
                    now=now_utc,
                    capacity=capacity,
                    preserve_status_on_conflict=False,
                    status=status,
                    metadata=metadata,
                )
                instance_row = (
                    connection.execute(
                        select(*instances_table.c).where(
                            and_(
                                instances_table.c.user_id == user_id,
                                instances_table.c.instance_id == instance_id,
                            )
                        )
                    )
                    .mappings()
                    .first()
                )
        except SQLAlchemyError as exc:
            raise ActionRepositoryError(f"Postgres instance heartbeat failed: {exc}") from exc
        if instance_row is None:
            raise ActionRepositoryError(
                f"instance heartbeat upsert failed for '{instance_id}' user '{user_id}'"
            )
        return _instance_from_row(instance_row)

    def complete_action(
        self,
        *,
        action_id: UUID,
        instance_id: str,
        now: datetime | None = None,
    ) -> ActionRecord:
        now_utc = _ensure_utc(now or datetime.now(UTC))
        try:
            with self._engine_instance().begin() as connection:
                row = self._load_action_row_by_id_for_update(connection, action_id)
                if row is None:
                    raise ActionNotFoundError(f"action '{action_id}' was not found")
                action = _action_from_row(row)
                if action.status == ActionStatus.COMPLETED:
                    return action

                _assert_owned_active_lease(action=action, instance_id=instance_id, now_utc=now_utc)
                update_result = connection.execute(
                    update(action_attempts_table)
                    .where(
                        and_(
                            action_attempts_table.c.action_id == action_id,
                            action_attempts_table.c.attempt_no == action.attempt_count,
                        )
                    )
                    .values(
                        finished_at=now_utc,
                        outcome=AttemptOutcome.COMPLETED.value,
                        error_code=None,
                        error_detail=None,
                    )
                )
                if (update_result.rowcount or 0) < 1:
                    raise ActionRepositoryError(
                        "action attempt record missing for completion "
                        f"(action_id='{action_id}', attempt_no={action.attempt_count})"
                    )

                connection.execute(
                    update(actions_table)
                    .where(actions_table.c.action_id == action_id)
                    .values(
                        status=ActionStatus.COMPLETED.value,
                        next_visible_at=now_utc,
                        lease_owner_instance_id=None,
                        lease_expires_at=None,
                        last_error_code=None,
                        last_error_detail=None,
                        updated_at=now_utc,
                        completed_at=now_utc,
                    )
                )
                updated_row = self._load_action_row_by_id(connection, action_id)
        except (ActionConflictError, ActionNotFoundError):
            raise
        except SQLAlchemyError as exc:
            raise ActionRepositoryError(f"Postgres complete action failed: {exc}") from exc

        if updated_row is None:
            raise ActionRepositoryError(
                f"completed action '{action_id}' could not be loaded after update"
            )
        return _action_from_row(updated_row)

    def fail_action(
        self,
        *,
        action_id: UUID,
        instance_id: str,
        error_code: str,
        error_detail: str | None,
        retryable: bool,
        retry_delay_seconds: int,
        now: datetime | None = None,
    ) -> ActionRecord:
        now_utc = _ensure_utc(now or datetime.now(UTC))
        delay_seconds = max(int(retry_delay_seconds), 1)
        try:
            with self._engine_instance().begin() as connection:
                row = self._load_action_row_by_id_for_update(connection, action_id)
                if row is None:
                    raise ActionNotFoundError(f"action '{action_id}' was not found")
                action = _action_from_row(row)
                if action.status == ActionStatus.COMPLETED:
                    raise ActionConflictError(
                        code="action_already_completed",
                        message=(
                            f"Action '{action_id}' is already completed and cannot be failed."
                        ),
                    )

                _assert_owned_active_lease(action=action, instance_id=instance_id, now_utc=now_utc)
                exceeded_attempts = action.attempt_count >= action.max_attempts
                should_dead_letter = retryable and exceeded_attempts
                if retryable and not exceeded_attempts:
                    next_status = ActionStatus.RETRY_WAIT
                    next_visible_at = now_utc + timedelta(seconds=delay_seconds)
                    attempt_outcome = AttemptOutcome.RETRYABLE_FAILED
                elif should_dead_letter:
                    next_status = ActionStatus.DEAD_LETTER
                    next_visible_at = now_utc
                    attempt_outcome = AttemptOutcome.TERMINAL_FAILED
                else:
                    next_status = ActionStatus.FAILED_TERMINAL
                    next_visible_at = now_utc
                    attempt_outcome = AttemptOutcome.TERMINAL_FAILED

                attempt_update = connection.execute(
                    update(action_attempts_table)
                    .where(
                        and_(
                            action_attempts_table.c.action_id == action_id,
                            action_attempts_table.c.attempt_no == action.attempt_count,
                        )
                    )
                    .values(
                        finished_at=now_utc,
                        outcome=attempt_outcome.value,
                        error_code=error_code,
                        error_detail=error_detail,
                    )
                )
                if (attempt_update.rowcount or 0) < 1:
                    raise ActionRepositoryError(
                        "action attempt record missing for fail transition "
                        f"(action_id='{action_id}', attempt_no={action.attempt_count})"
                    )

                connection.execute(
                    update(actions_table)
                    .where(actions_table.c.action_id == action_id)
                    .values(
                        status=next_status.value,
                        next_visible_at=next_visible_at,
                        lease_owner_instance_id=None,
                        lease_expires_at=None,
                        last_error_code=error_code,
                        last_error_detail=error_detail,
                        updated_at=now_utc,
                        completed_at=None,
                    )
                )
                if should_dead_letter:
                    reason_code = "max_attempts_exhausted"
                    dead_letter_stmt = postgresql.insert(action_dead_letters_table).values(
                        action_id=action_id,
                        dead_lettered_at=now_utc,
                        reason_code=reason_code,
                        reason_detail=error_detail,
                        replayed_from_action_id=None,
                    )
                    connection.execute(
                        dead_letter_stmt.on_conflict_do_update(
                            index_elements=[action_dead_letters_table.c.action_id],
                            set_={
                                "dead_lettered_at": now_utc,
                                "reason_code": reason_code,
                                "reason_detail": error_detail,
                            },
                        )
                    )

                updated_row = self._load_action_row_by_id(connection, action_id)
        except (ActionConflictError, ActionNotFoundError):
            raise
        except SQLAlchemyError as exc:
            raise ActionRepositoryError(f"Postgres fail action failed: {exc}") from exc

        if updated_row is None:
            raise ActionRepositoryError(f"failed action '{action_id}' could not be loaded")
        return _action_from_row(updated_row)

    def _upsert_instance(
        self,
        *,
        connection: Connection,
        user_id: str,
        instance_id: str,
        now: datetime,
        capacity: int | None,
        preserve_status_on_conflict: bool,
        status: InstanceStatus | None,
        metadata: Mapping[str, object] | None,
    ) -> None:
        upsert_status = status.value if status is not None else InstanceStatus.ACTIVE.value
        normalized_metadata = dict(metadata) if metadata is not None else None
        upsert_stmt = postgresql.insert(instances_table).values(
            instance_id=instance_id,
            user_id=user_id,
            status=upsert_status,
            last_seen_at=now,
            capacity=capacity,
            metadata=normalized_metadata,
        )
        status_update: str | Column[str]
        if preserve_status_on_conflict:
            status_update = instances_table.c.status
        elif status is not None:
            status_update = status.value
        else:
            status_update = instances_table.c.status

        capacity_update: int | Column[int]
        if capacity is not None:
            capacity_update = int(capacity)
        else:
            capacity_update = instances_table.c.capacity

        metadata_update: Mapping[str, object] | Column[object] | None
        if metadata is not None:
            metadata_update = normalized_metadata
        else:
            metadata_update = instances_table.c.metadata

        connection.execute(
            upsert_stmt.on_conflict_do_update(
                index_elements=[instances_table.c.instance_id, instances_table.c.user_id],
                set_={
                    "status": status_update,
                    "last_seen_at": now,
                    "capacity": capacity_update,
                    "metadata": metadata_update,
                },
            )
        )

    def _load_action_row_by_id(
        self,
        connection: Connection,
        action_id: UUID,
    ) -> Mapping[str, object] | RowMapping | None:
        return (
            connection.execute(
                select(*actions_table.c).where(actions_table.c.action_id == action_id)
            )
            .mappings()
            .first()
        )

    def _load_action_row_by_id_for_update(
        self,
        connection: Connection,
        action_id: UUID,
    ) -> Mapping[str, object] | RowMapping | None:
        return (
            connection.execute(
                select(*actions_table.c)
                .where(actions_table.c.action_id == action_id)
                .with_for_update()
            )
            .mappings()
            .first()
        )

    def _load_action_row_by_idempotency_key(
        self,
        *,
        connection: Connection,
        user_id: str,
        idempotency_key: str,
    ) -> Mapping[str, object] | RowMapping | None:
        return (
            connection.execute(
                select(*actions_table.c).where(
                    and_(
                        actions_table.c.user_id == user_id,
                        actions_table.c.idempotency_key == idempotency_key,
                    )
                )
            )
            .mappings()
            .first()
        )

    def _engine_instance(self) -> Engine:
        if self._engine is not None:
            return self._engine

        with self._engine_lock:
            if self._engine is None:
                self._engine = create_engine(
                    self.dsn,
                    pool_size=int(self.pool_size),
                    max_overflow=int(self.max_overflow),
                    pool_pre_ping=True,
                )
        return self._engine


class InMemoryActionsRepository:
    """Deterministic in-memory action repository for tests."""

    def __init__(self) -> None:
        self._schema_ensure_calls = 0
        self._lock = Lock()
        self._actions: dict[UUID, ActionRecord] = {}
        self._attempts: list[ActionAttemptRecord] = []
        self._dead_letters: dict[UUID, tuple[datetime, str, str | None]] = {}
        self._instances: dict[tuple[str, str], InstanceRecord] = {}
        self._idempotency_index: dict[tuple[str, str], UUID] = {}

    @property
    def ensure_schema_calls(self) -> int:
        return self._schema_ensure_calls

    def ensure_schema(self) -> None:
        self._schema_ensure_calls += 1

    def create_action(self, action: ActionCreate) -> ActionRecord:
        record, _dedupe_hit = self.create_action_with_dedupe(action)
        return record

    def create_action_with_dedupe(self, action: ActionCreate) -> tuple[ActionRecord, bool]:
        with self._lock:
            if action.idempotency_key:
                existing_action_id = self._idempotency_index.get(
                    (action.user_id, action.idempotency_key)
                )
                if existing_action_id is not None:
                    existing = self._actions.get(existing_action_id)
                    if existing is None:
                        raise ActionRepositoryError(
                            "idempotency index points to missing action record"
                        )
                    return _clone_action(existing), True

            submitted_at = _ensure_utc(action.submitted_at)
            next_visible_at = _ensure_utc(action.next_visible_at or submitted_at)
            record = ActionRecord(
                action_id=action.action_id,
                user_id=action.user_id,
                action_uri=action.action_uri,
                input_payload=dict(action.input_payload),
                status=ActionStatus.QUEUED,
                priority=int(action.priority),
                idempotency_key=action.idempotency_key,
                ontology_release_id=action.ontology_release_id,
                validation_contract_hash=action.validation_contract_hash,
                attempt_count=0,
                max_attempts=int(action.max_attempts),
                next_visible_at=next_visible_at,
                lease_owner_instance_id=None,
                lease_expires_at=None,
                last_error_code=None,
                last_error_detail=None,
                submitted_at=submitted_at,
                updated_at=submitted_at,
                completed_at=None,
            )
            self._actions[record.action_id] = record
            if action.idempotency_key:
                self._idempotency_index[(action.user_id, action.idempotency_key)] = (
                    record.action_id
                )
            return _clone_action(record), False

    def get_action(self, action_id: UUID) -> ActionRecord | None:
        with self._lock:
            row = self._actions.get(action_id)
            return _clone_action(row) if row is not None else None

    def get_action_by_idempotency_key(
        self,
        *,
        user_id: str,
        idempotency_key: str,
    ) -> ActionRecord | None:
        with self._lock:
            action_id = self._idempotency_index.get((user_id, idempotency_key))
            if action_id is None:
                return None
            row = self._actions.get(action_id)
            return _clone_action(row) if row is not None else None

    def list_actions(
        self,
        *,
        user_id: str,
        status: ActionStatus | None = None,
        page: int = 1,
        size: int = 20,
        submitted_after: datetime | None = None,
        submitted_before: datetime | None = None,
    ) -> tuple[list[ActionRecord], int]:
        page_number = max(int(page), 1)
        page_size = max(int(size), 1)
        offset = (page_number - 1) * page_size
        submitted_after_utc = _ensure_utc(submitted_after) if submitted_after is not None else None
        submitted_before_utc = (
            _ensure_utc(submitted_before) if submitted_before is not None else None
        )

        with self._lock:
            filtered = []
            for action in self._actions.values():
                if action.user_id != user_id:
                    continue
                if status is not None and action.status != status:
                    continue
                if submitted_after_utc is not None and action.submitted_at < submitted_after_utc:
                    continue
                if submitted_before_utc is not None and action.submitted_at > submitted_before_utc:
                    continue
                filtered.append(action)
            filtered.sort(
                key=lambda row: (row.submitted_at, str(row.action_id)),
                reverse=True,
            )
            total = len(filtered)
            page_rows = filtered[offset : offset + page_size]
            return [_clone_action(row) for row in page_rows], total

    def claim_actions(
        self,
        *,
        user_id: str,
        instance_id: str,
        capacity: int,
        max_actions: int,
        lease_seconds: int,
        now: datetime | None = None,
    ) -> list[ActionRecord]:
        if max_actions < 1 or capacity < 1:
            return []

        now_utc = _ensure_utc(now or datetime.now(UTC))
        lease_expires_at = now_utc + timedelta(seconds=max(int(lease_seconds), 1))
        instance = self.heartbeat_instance(
            user_id=user_id,
            instance_id=instance_id,
            status=None,
            capacity=capacity,
            metadata=None,
            now=now_utc,
        )
        if instance.status == InstanceStatus.DRAINING:
            return []

        with self._lock:
            eligible = [
                action
                for action in self._actions.values()
                if action.user_id == user_id and _is_claim_eligible(action, now_utc)
            ]
            eligible.sort(key=lambda row: (-row.priority, row.submitted_at, str(row.action_id)))
            selected = eligible[:max_actions]

            leased: list[ActionRecord] = []
            for action in selected:
                action.attempt_count += 1
                action.status = ActionStatus.LEASED
                action.lease_owner_instance_id = instance_id
                action.lease_expires_at = lease_expires_at
                action.updated_at = now_utc
                self._attempts.append(
                    ActionAttemptRecord(
                        attempt_id=uuid4(),
                        action_id=action.action_id,
                        attempt_no=action.attempt_count,
                        instance_id=instance_id,
                        leased_at=now_utc,
                        started_at=None,
                        finished_at=None,
                        outcome=None,
                        error_code=None,
                        error_detail=None,
                    )
                )
                leased.append(_clone_action(action))
            return leased

    def heartbeat_instance(
        self,
        *,
        user_id: str,
        instance_id: str,
        status: InstanceStatus | None = None,
        capacity: int | None = None,
        metadata: Mapping[str, object] | None = None,
        now: datetime | None = None,
    ) -> InstanceRecord:
        now_utc = _ensure_utc(now or datetime.now(UTC))
        with self._lock:
            key = (instance_id, user_id)
            existing = self._instances.get(key)
            resolved_status = status or (existing.status if existing else InstanceStatus.ACTIVE)
            resolved_capacity = (
                int(capacity)
                if capacity is not None
                else (existing.capacity if existing is not None else None)
            )
            if metadata is not None:
                resolved_metadata: dict[str, object] | None = dict(metadata)
            elif existing is not None and existing.metadata is not None:
                resolved_metadata = dict(existing.metadata)
            else:
                resolved_metadata = None

            record = InstanceRecord(
                instance_id=instance_id,
                user_id=user_id,
                status=resolved_status,
                last_seen_at=now_utc,
                capacity=resolved_capacity,
                metadata=resolved_metadata,
            )
            self._instances[key] = record
            return _clone_instance(record)

    def complete_action(
        self,
        *,
        action_id: UUID,
        instance_id: str,
        now: datetime | None = None,
    ) -> ActionRecord:
        now_utc = _ensure_utc(now or datetime.now(UTC))
        with self._lock:
            action = self._actions.get(action_id)
            if action is None:
                raise ActionNotFoundError(f"action '{action_id}' was not found")
            if action.status == ActionStatus.COMPLETED:
                return _clone_action(action)

            _assert_owned_active_lease(action=action, instance_id=instance_id, now_utc=now_utc)
            attempt = self._load_attempt(action_id=action_id, attempt_no=action.attempt_count)
            if attempt is None:
                raise ActionRepositoryError(
                    "action attempt record missing for completion "
                    f"(action_id='{action_id}', attempt_no={action.attempt_count})"
                )

            attempt.finished_at = now_utc
            attempt.outcome = AttemptOutcome.COMPLETED
            attempt.error_code = None
            attempt.error_detail = None
            action.status = ActionStatus.COMPLETED
            action.next_visible_at = now_utc
            action.lease_owner_instance_id = None
            action.lease_expires_at = None
            action.last_error_code = None
            action.last_error_detail = None
            action.updated_at = now_utc
            action.completed_at = now_utc
            return _clone_action(action)

    def fail_action(
        self,
        *,
        action_id: UUID,
        instance_id: str,
        error_code: str,
        error_detail: str | None,
        retryable: bool,
        retry_delay_seconds: int,
        now: datetime | None = None,
    ) -> ActionRecord:
        now_utc = _ensure_utc(now or datetime.now(UTC))
        delay_seconds = max(int(retry_delay_seconds), 1)
        with self._lock:
            action = self._actions.get(action_id)
            if action is None:
                raise ActionNotFoundError(f"action '{action_id}' was not found")
            if action.status == ActionStatus.COMPLETED:
                raise ActionConflictError(
                    code="action_already_completed",
                    message=f"Action '{action_id}' is already completed and cannot be failed.",
                )

            _assert_owned_active_lease(action=action, instance_id=instance_id, now_utc=now_utc)
            attempt = self._load_attempt(action_id=action_id, attempt_no=action.attempt_count)
            if attempt is None:
                raise ActionRepositoryError(
                    "action attempt record missing for fail transition "
                    f"(action_id='{action_id}', attempt_no={action.attempt_count})"
                )

            exceeded_attempts = action.attempt_count >= action.max_attempts
            should_dead_letter = retryable and exceeded_attempts
            if retryable and not exceeded_attempts:
                next_status = ActionStatus.RETRY_WAIT
                next_visible_at = now_utc + timedelta(seconds=delay_seconds)
                attempt_outcome = AttemptOutcome.RETRYABLE_FAILED
            elif should_dead_letter:
                next_status = ActionStatus.DEAD_LETTER
                next_visible_at = now_utc
                attempt_outcome = AttemptOutcome.TERMINAL_FAILED
            else:
                next_status = ActionStatus.FAILED_TERMINAL
                next_visible_at = now_utc
                attempt_outcome = AttemptOutcome.TERMINAL_FAILED

            attempt.finished_at = now_utc
            attempt.outcome = attempt_outcome
            attempt.error_code = error_code
            attempt.error_detail = error_detail
            action.status = next_status
            action.next_visible_at = next_visible_at
            action.lease_owner_instance_id = None
            action.lease_expires_at = None
            action.last_error_code = error_code
            action.last_error_detail = error_detail
            action.updated_at = now_utc
            action.completed_at = None
            if should_dead_letter:
                self._dead_letters[action_id] = (
                    now_utc,
                    "max_attempts_exhausted",
                    error_detail,
                )
            return _clone_action(action)

    def _load_attempt(self, *, action_id: UUID, attempt_no: int) -> ActionAttemptRecord | None:
        for attempt in reversed(self._attempts):
            if attempt.action_id == action_id and attempt.attempt_no == attempt_no:
                return attempt
        return None


def _assert_owned_active_lease(
    *,
    action: ActionRecord,
    instance_id: str,
    now_utc: datetime,
) -> None:
    if action.status not in {ActionStatus.LEASED, ActionStatus.RUNNING}:
        raise ActionConflictError(
            code="action_not_in_progress",
            message=(
                f"Action '{action.action_id}' is in status '{action.status.value}' and cannot "
                "accept lifecycle callbacks."
            ),
        )
    if not action.lease_owner_instance_id:
        raise ActionConflictError(
            code="lease_owner_missing",
            message=f"Action '{action.action_id}' does not have an active lease owner.",
        )
    if action.lease_owner_instance_id != instance_id:
        raise ActionConflictError(
            code="invalid_lease_owner",
            message=(
                f"Instance '{instance_id}' does not own the active lease for action "
                f"'{action.action_id}'."
            ),
        )
    if action.lease_expires_at is None or action.lease_expires_at <= now_utc:
        raise ActionConflictError(
            code="lease_expired",
            message=f"Action '{action.action_id}' lease has expired and cannot be updated.",
        )


def _is_claim_eligible(action: ActionRecord, now_utc: datetime) -> bool:
    if action.status in {ActionStatus.QUEUED, ActionStatus.RETRY_WAIT}:
        return action.next_visible_at <= now_utc
    if action.status in {ActionStatus.LEASED, ActionStatus.RUNNING} and action.lease_expires_at:
        return action.lease_expires_at <= now_utc
    return False


def _action_from_row(row: Mapping[str, object] | RowMapping) -> ActionRecord:
    return ActionRecord(
        action_id=UUID(str(row["action_id"])),
        user_id=str(row["user_id"]),
        action_uri=str(row["action_uri"]),
        input_payload=_load_json(row["input_payload"]),
        status=ActionStatus(str(row["status"])),
        priority=int(row["priority"]),
        idempotency_key=_optional_string(row["idempotency_key"]),
        ontology_release_id=str(row["ontology_release_id"]),
        validation_contract_hash=str(row["validation_contract_hash"]),
        attempt_count=int(row["attempt_count"]),
        max_attempts=int(row["max_attempts"]),
        next_visible_at=_ensure_utc(_to_datetime(row["next_visible_at"])),
        lease_owner_instance_id=_optional_string(row["lease_owner_instance_id"]),
        lease_expires_at=_to_optional_datetime(row["lease_expires_at"]),
        last_error_code=_optional_string(row["last_error_code"]),
        last_error_detail=_optional_string(row["last_error_detail"]),
        submitted_at=_ensure_utc(_to_datetime(row["submitted_at"])),
        updated_at=_ensure_utc(_to_datetime(row["updated_at"])),
        completed_at=_to_optional_datetime(row["completed_at"]),
    )


def _clone_action(action: ActionRecord) -> ActionRecord:
    return replace(action, input_payload=dict(action.input_payload))


def _instance_from_row(row: Mapping[str, object] | RowMapping) -> InstanceRecord:
    metadata = row["metadata"]
    metadata_copy = dict(metadata) if isinstance(metadata, Mapping) else None
    return InstanceRecord(
        instance_id=str(row["instance_id"]),
        user_id=str(row["user_id"]),
        status=InstanceStatus(str(row["status"])),
        last_seen_at=_ensure_utc(_to_datetime(row["last_seen_at"])),
        capacity=int(row["capacity"]) if row["capacity"] is not None else None,
        metadata=metadata_copy,
    )


def _clone_instance(instance: InstanceRecord) -> InstanceRecord:
    metadata_copy = dict(instance.metadata) if instance.metadata is not None else None
    return replace(instance, metadata=metadata_copy)


def _optional_string(raw: object) -> str | None:
    if raw is None:
        return None
    value = str(raw)
    return value if value else None


def _to_datetime(raw: object) -> datetime:
    if isinstance(raw, datetime):
        return raw
    raise TypeError(f"expected datetime value, got {type(raw)!r}")


def _to_optional_datetime(raw: object) -> datetime | None:
    if raw is None:
        return None
    return _ensure_utc(_to_datetime(raw))


def _load_json(raw: object) -> dict[str, object]:
    if isinstance(raw, dict):
        return dict(raw)
    return {}


def _ensure_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def _is_unique_violation(exc: IntegrityError) -> bool:
    sqlstate = getattr(exc.orig, "sqlstate", None) or getattr(exc.orig, "pgcode", None)
    return str(sqlstate) == "23505"


def _split_sql_statements(sql_text: str) -> list[str]:
    statements: list[str] = []
    for chunk in sql_text.split(";"):
        line = chunk.strip()
        if line:
            statements.append(line)
    return statements
