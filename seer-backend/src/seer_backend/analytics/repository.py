"""Process mining extraction adapters."""

from __future__ import annotations

import json
from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Protocol
from uuid import UUID

from sqlalchemy import column, func, select, table

from seer_backend.analytics.errors import ProcessMiningError, ProcessMiningLimitExceededError
from seer_backend.analytics.models import (
    ExtractedProcessFrames,
    ProcessEventRow,
    ProcessMiningRequest,
    ProcessObjectRow,
    ProcessRelationRow,
)
from seer_backend.clickhouse.client import AsyncClickHouseClient
from seer_backend.clickhouse.errors import ClickHouseClientError

_EVENT_HISTORY = table(
    "event_history",
    column("event_id"),
    column("occurred_at"),
    column("event_type"),
    column("source"),
    column("trace_id"),
)
_EVENT_OBJECT_LINKS = table(
    "event_object_links",
    column("event_id"),
    column("object_history_id"),
    column("object_type"),
    column("object_ref_hash"),
    column("object_ref_canonical"),
    column("relation_role"),
)
_OBJECT_HISTORY = table(
    "object_history",
    column("object_history_id"),
    column("object_type"),
    column("object_ref_hash"),
    column("object_ref_canonical"),
    column("object_ref"),
    column("object_payload"),
)


class ProcessMiningRepository(Protocol):
    async def ensure_schema(self) -> None: ...

    async def extract_frames(
        self,
        payload: ProcessMiningRequest,
        *,
        max_events: int,
        max_relations: int,
    ) -> ExtractedProcessFrames: ...


@dataclass(slots=True)
class ClickHouseProcessMiningRepository:
    host: str
    port: int
    database: str
    user: str
    password: str
    timeout_seconds: float
    migrations_dir: Path
    connect_timeout_seconds: float | None = None
    send_receive_timeout_seconds: float | None = None
    compression: str | None = None
    query_limit: int | None = None
    _clickhouse_client: AsyncClickHouseClient | None = field(
        default=None,
        init=False,
        repr=False,
    )

    def _shared_clickhouse_client(self) -> AsyncClickHouseClient:
        if self._clickhouse_client is None:
            self._clickhouse_client = AsyncClickHouseClient(
                host=self.host,
                port=self.port,
                database=self.database,
                user=self.user,
                password=self.password,
                timeout_seconds=self.timeout_seconds,
                connect_timeout_seconds=self.connect_timeout_seconds,
                send_receive_timeout_seconds=self.send_receive_timeout_seconds,
                compression=self.compression,
                query_limit=self.query_limit,
            )
        return self._clickhouse_client

    async def ensure_schema(self) -> None:
        if not self.migrations_dir.exists():
            raise ProcessMiningError(
                f"Missing ClickHouse migrations directory: {self.migrations_dir}"
            )

        migration_files = sorted(self.migrations_dir.glob("*.sql"))
        if not migration_files:
            raise ProcessMiningError(
                f"No ClickHouse migration files found in {self.migrations_dir}"
            )

        for file in migration_files:
            sql_text = file.read_text(encoding="utf-8")
            for statement in _split_sql_statements(sql_text):
                await self._execute(statement)

    async def extract_frames(
        self,
        payload: ProcessMiningRequest,
        *,
        max_events: int,
        max_relations: int,
    ) -> ExtractedProcessFrames:
        include_object_types = payload.include_object_types
        anchor_events = _anchor_events_subquery(payload)

        event_count_stmt = select(func.count().label("cnt")).select_from(anchor_events)
        event_count_rows = await self._select_rows(event_count_stmt)
        event_count = int(event_count_rows[0].get("cnt", 0)) if event_count_rows else 0
        if event_count > max_events:
            raise ProcessMiningLimitExceededError(
                "process mining scope is too large: "
                f"{event_count} events exceeds max_events={max_events}; "
                "narrow time window or object-type filters"
            )

        links = _EVENT_OBJECT_LINKS.alias("l")
        relation_source = links.join(anchor_events, anchor_events.c.event_id == links.c.event_id)
        relation_count_stmt = select(func.count().label("cnt")).select_from(relation_source)
        if include_object_types:
            relation_count_stmt = relation_count_stmt.where(
                links.c.object_type.in_(include_object_types)
            )
        relation_count_rows = await self._select_rows(relation_count_stmt)
        relation_count = int(relation_count_rows[0].get("cnt", 0)) if relation_count_rows else 0
        if relation_count > max_relations:
            raise ProcessMiningLimitExceededError(
                "process mining scope is too large: "
                f"{relation_count} relations exceeds max_relations={max_relations}; "
                "narrow time window or include_object_types"
            )

        events = _EVENT_HISTORY.alias("e")
        events_stmt = (
            select(
                events.c.event_id,
                events.c.occurred_at,
                events.c.event_type,
                events.c.source,
                events.c.trace_id,
            )
            .select_from(events.join(anchor_events, anchor_events.c.event_id == events.c.event_id))
            .order_by(events.c.occurred_at, events.c.event_id)
        )

        relations_stmt = (
            select(
                links.c.event_id,
                links.c.object_history_id,
                links.c.object_type,
                links.c.object_ref_hash,
                links.c.object_ref_canonical,
                links.c.relation_role,
            )
            .select_from(relation_source)
            .order_by(
                links.c.event_id,
                links.c.object_type,
                links.c.object_ref_hash,
                links.c.object_history_id,
            )
        )
        if include_object_types:
            relations_stmt = relations_stmt.where(links.c.object_type.in_(include_object_types))

        relation_objects_stmt = select(links.c.object_history_id).distinct().select_from(
            relation_source
        )
        if include_object_types:
            relation_objects_stmt = relation_objects_stmt.where(
                links.c.object_type.in_(include_object_types)
            )
        relation_objects = relation_objects_stmt.subquery("relation_objects")

        objects = _OBJECT_HISTORY.alias("o")
        objects_stmt = (
            select(
                objects.c.object_history_id,
                objects.c.object_type,
                objects.c.object_ref_hash,
                objects.c.object_ref_canonical,
                objects.c.object_ref,
                objects.c.object_payload,
            )
            .select_from(
                objects.join(
                    relation_objects,
                    relation_objects.c.object_history_id == objects.c.object_history_id,
                )
            )
            .order_by(objects.c.object_type, objects.c.object_ref_hash, objects.c.object_history_id)
        )

        event_rows = [
            _event_row_from_clickhouse(row) for row in await self._select_rows(events_stmt)
        ]
        relation_rows = [
            _relation_row_from_clickhouse(row) for row in await self._select_rows(relations_stmt)
        ]
        object_rows = [
            _object_row_from_clickhouse(row) for row in await self._select_rows(objects_stmt)
        ]

        return ExtractedProcessFrames(
            events=event_rows,
            objects=object_rows,
            relations=relation_rows,
        )

    async def _select_rows(self, query: Any) -> list[dict[str, Any]]:
        try:
            return await self._shared_clickhouse_client().select_rows(query)
        except ClickHouseClientError as exc:
            raise ProcessMiningError(
                f"ClickHouse failed to execute ClickHouse query: {exc}"
            ) from exc

    async def _execute(self, statement: str) -> None:
        try:
            await self._shared_clickhouse_client().execute(statement)
        except ClickHouseClientError as exc:
            raise ProcessMiningError(
                f"ClickHouse failed to execute ClickHouse statement: {exc}"
            ) from exc


class InMemoryProcessMiningRepository:
    """In-memory extraction repository for tests and local fallbacks."""

    def __init__(
        self,
        *,
        events: Sequence[ProcessEventRow] | None = None,
        objects: Sequence[ProcessObjectRow] | None = None,
        relations: Sequence[ProcessRelationRow] | None = None,
        history_repo: Any | None = None,
    ) -> None:
        self._history_repo = history_repo
        self._events: dict[UUID, ProcessEventRow] = {
            row.event_id: row for row in (events or [])
        }
        self._objects: dict[UUID, ProcessObjectRow] = {
            row.object_history_id: row for row in (objects or [])
        }
        self._relations: list[ProcessRelationRow] = list(relations or [])

    @classmethod
    def from_phase2_history_repository(cls, history_repo: Any) -> InMemoryProcessMiningRepository:
        return cls(history_repo=history_repo)

    def _materialize_from_history_repo(self) -> None:
        if self._history_repo is None:
            return

        events = [
            ProcessEventRow(
                event_id=row.event_id,
                occurred_at=row.occurred_at,
                event_type=row.event_type,
                source=row.source,
                trace_id=row.trace_id,
            )
            for row in list(getattr(self._history_repo, "_events", {}).values())
        ]
        objects = [
            ProcessObjectRow(
                object_history_id=row.object_history_id,
                object_type=row.object_type,
                object_ref_hash=row.object_ref_hash,
                object_ref_canonical=row.object_ref_canonical,
                object_ref=row.object_ref,
                object_payload=row.object_payload,
            )
            for row in list(getattr(self._history_repo, "_object_by_id", {}).values())
        ]
        relations = [
            ProcessRelationRow(
                event_id=row.event_id,
                object_history_id=row.object_history_id,
                object_type=row.object_type,
                object_ref_hash=row.object_ref_hash,
                object_ref_canonical=row.object_ref_canonical,
                relation_role=row.relation_role,
            )
            for row in list(getattr(self._history_repo, "_links", []))
        ]
        self._events = {row.event_id: row for row in events}
        self._objects = {row.object_history_id: row for row in objects}
        self._relations = relations

    async def ensure_schema(self) -> None:
        return None

    async def extract_frames(
        self,
        payload: ProcessMiningRequest,
        *,
        max_events: int,
        max_relations: int,
    ) -> ExtractedProcessFrames:
        self._materialize_from_history_repo()
        window_start = _ensure_utc(payload.start_at)
        window_end = _ensure_utc(payload.end_at)

        anchor_event_ids: set[UUID] = set()
        for relation in self._relations:
            if relation.object_type != payload.anchor_object_type:
                continue
            event_row = self._events.get(relation.event_id)
            if event_row is None:
                continue
            occurred_at = _ensure_utc(event_row.occurred_at)
            if occurred_at < window_start or occurred_at > window_end:
                continue
            anchor_event_ids.add(event_row.event_id)

        selected_events = [
            event for event in self._events.values() if event.event_id in anchor_event_ids
        ]
        selected_events.sort(key=lambda row: (_ensure_utc(row.occurred_at), str(row.event_id)))

        object_type_filter = set(payload.include_object_types or [])
        selected_relations = [
            relation
            for relation in self._relations
            if relation.event_id in anchor_event_ids
            and (not object_type_filter or relation.object_type in object_type_filter)
        ]
        selected_relations.sort(
            key=lambda row: (
                str(row.event_id),
                row.object_type,
                row.object_ref_hash,
                str(row.object_history_id),
            )
        )

        if len(selected_events) > max_events:
            raise ProcessMiningLimitExceededError(
                "process mining scope is too large: "
                f"{len(selected_events)} events exceeds max_events={max_events}; "
                "narrow time window or object-type filters"
            )
        if len(selected_relations) > max_relations:
            raise ProcessMiningLimitExceededError(
                "process mining scope is too large: "
                f"{len(selected_relations)} relations exceeds max_relations={max_relations}; "
                "narrow time window or include_object_types"
            )

        selected_object_ids = {relation.object_history_id for relation in selected_relations}
        selected_objects = [
            row
            for object_history_id, row in self._objects.items()
            if object_history_id in selected_object_ids
        ]
        selected_objects.sort(
            key=lambda row: (
                row.object_type,
                row.object_ref_hash,
                str(row.object_history_id),
            )
        )

        return ExtractedProcessFrames(
            events=selected_events,
            objects=selected_objects,
            relations=selected_relations,
        )


def _anchor_events_subquery(payload: ProcessMiningRequest) -> Any:
    links = _EVENT_OBJECT_LINKS.alias("l")
    events = _EVENT_HISTORY.alias("e")
    return (
        select(links.c.event_id)
        .distinct()
        .select_from(links.join(events, events.c.event_id == links.c.event_id))
        .where(
            links.c.object_type == payload.anchor_object_type,
            events.c.occurred_at >= _ensure_utc(payload.start_at),
            events.c.occurred_at <= _ensure_utc(payload.end_at),
        )
        .subquery("anchor_events")
    )


def _split_sql_statements(sql_text: str) -> list[str]:
    statements = []
    for chunk in sql_text.split(";"):
        line = chunk.strip()
        if line:
            statements.append(line)
    return statements


def _event_row_from_clickhouse(row: dict[str, Any]) -> ProcessEventRow:
    return ProcessEventRow(
        event_id=UUID(str(row["event_id"])),
        occurred_at=_parse_clickhouse_datetime(str(row["occurred_at"])),
        event_type=str(row["event_type"]),
        source=str(row["source"]),
        trace_id=_to_optional_string(row.get("trace_id")),
    )


def _object_row_from_clickhouse(row: dict[str, Any]) -> ProcessObjectRow:
    return ProcessObjectRow(
        object_history_id=UUID(str(row["object_history_id"])),
        object_type=str(row["object_type"]),
        object_ref_hash=int(row["object_ref_hash"]),
        object_ref_canonical=str(row["object_ref_canonical"]),
        object_ref=_load_json_object(row.get("object_ref")),
        object_payload=_load_json_object(row.get("object_payload"), default=None),
    )


def _relation_row_from_clickhouse(row: dict[str, Any]) -> ProcessRelationRow:
    return ProcessRelationRow(
        event_id=UUID(str(row["event_id"])),
        object_history_id=UUID(str(row["object_history_id"])),
        object_type=str(row["object_type"]),
        object_ref_hash=int(row["object_ref_hash"]),
        object_ref_canonical=str(row["object_ref_canonical"]),
        relation_role=_to_optional_string(row.get("relation_role")),
    )


def _parse_clickhouse_datetime(value: str) -> datetime:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        parsed = datetime.strptime(value, "%Y-%m-%d %H:%M:%S.%f")
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def _load_json_object(raw: Any, default: dict[str, Any] | None = None) -> dict[str, Any] | None:
    if raw is None:
        return default
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str) and raw:
        loaded = json.loads(raw)
        if isinstance(loaded, dict):
            return loaded
    return default if default is not None else {}


def _to_optional_string(raw: Any) -> str | None:
    if raw is None:
        return None
    value = str(raw)
    return value if value else None


def _ensure_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)
