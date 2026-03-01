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
    insert,
    select,
    update,
)
from sqlalchemy.dialects import postgresql
from sqlalchemy.engine import Connection, Engine, RowMapping
from sqlalchemy.exc import SQLAlchemyError

from seer_backend.actions.errors import ActionRepositoryError
from seer_backend.actions.models import (
    ActionAttemptRecord,
    ActionCreate,
    ActionRecord,
    ActionStatus,
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


class ActionsRepository(Protocol):
    def ensure_schema(self) -> None: ...

    def create_action(self, action: ActionCreate) -> ActionRecord: ...

    def get_action(self, action_id: UUID) -> ActionRecord | None: ...

    def claim_actions(
        self,
        *,
        user_id: str,
        instance_id: str,
        max_actions: int,
        lease_seconds: int,
        now: datetime | None = None,
    ) -> list[ActionRecord]: ...


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
                connection.execute(insert(actions_table).values(**values))
                row = (
                    connection.execute(
                        select(*actions_table.c).where(
                            actions_table.c.action_id == action.action_id
                        )
                    )
                    .mappings()
                    .first()
                )
        except SQLAlchemyError as exc:
            raise ActionRepositoryError(f"Postgres create action failed: {exc}") from exc

        if row is None:
            raise ActionRepositoryError(f"created action '{action.action_id}' could not be loaded")
        return _action_from_row(row)

    def get_action(self, action_id: UUID) -> ActionRecord | None:
        try:
            with self._engine_instance().connect() as connection:
                row = (
                    connection.execute(
                        select(*actions_table.c).where(actions_table.c.action_id == action_id)
                    )
                    .mappings()
                    .first()
                )
        except SQLAlchemyError as exc:
            raise ActionRepositoryError(f"Postgres get action failed: {exc}") from exc
        if row is None:
            return None
        return _action_from_row(row)

    def claim_actions(
        self,
        *,
        user_id: str,
        instance_id: str,
        max_actions: int,
        lease_seconds: int,
        now: datetime | None = None,
    ) -> list[ActionRecord]:
        if max_actions < 1:
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
                    capacity=max_actions,
                )
                candidate_rows = (
                    connection.execute(
                        select(actions_table.c.action_id, actions_table.c.attempt_count)
                        .where(
                            and_(
                                actions_table.c.user_id == user_id,
                                actions_table.c.status.in_(queued_statuses),
                                actions_table.c.next_visible_at <= now_utc,
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

    def _upsert_instance(
        self,
        *,
        connection: Connection,
        user_id: str,
        instance_id: str,
        now: datetime,
        capacity: int,
    ) -> None:
        upsert_stmt = postgresql.insert(instances_table).values(
            instance_id=instance_id,
            user_id=user_id,
            status=InstanceStatus.ACTIVE.value,
            last_seen_at=now,
            capacity=capacity,
            metadata=None,
        )
        connection.execute(
            upsert_stmt.on_conflict_do_update(
                index_elements=[instances_table.c.instance_id, instances_table.c.user_id],
                set_={
                    "status": InstanceStatus.ACTIVE.value,
                    "last_seen_at": now,
                    "capacity": capacity,
                },
            )
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
        self._instances: dict[tuple[str, str], InstanceRecord] = {}

    @property
    def ensure_schema_calls(self) -> int:
        return self._schema_ensure_calls

    def ensure_schema(self) -> None:
        self._schema_ensure_calls += 1

    def create_action(self, action: ActionCreate) -> ActionRecord:
        with self._lock:
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
            return _clone_action(record)

    def get_action(self, action_id: UUID) -> ActionRecord | None:
        with self._lock:
            row = self._actions.get(action_id)
            return _clone_action(row) if row is not None else None

    def claim_actions(
        self,
        *,
        user_id: str,
        instance_id: str,
        max_actions: int,
        lease_seconds: int,
        now: datetime | None = None,
    ) -> list[ActionRecord]:
        if max_actions < 1:
            return []

        now_utc = _ensure_utc(now or datetime.now(UTC))
        lease_expires_at = now_utc + timedelta(seconds=max(int(lease_seconds), 1))

        with self._lock:
            self._instances[(instance_id, user_id)] = InstanceRecord(
                instance_id=instance_id,
                user_id=user_id,
                status=InstanceStatus.ACTIVE,
                last_seen_at=now_utc,
                capacity=max_actions,
                metadata=None,
            )

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


def _split_sql_statements(sql_text: str) -> list[str]:
    statements: list[str] = []
    for chunk in sql_text.split(";"):
        line = chunk.strip()
        if line:
            statements.append(line)
    return statements
