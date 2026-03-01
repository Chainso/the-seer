"""Root-cause analysis extraction adapters."""

from __future__ import annotations

import json
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Protocol
from uuid import UUID

from sqlalchemy import column, select, table, tuple_

from seer_backend.analytics.errors import RootCauseError, RootCauseLimitExceededError
from seer_backend.analytics.rca_models import (
    ExtractedRcaNeighborhood,
    RcaEventRow,
    RcaObjectInstance,
    RcaObjectRow,
    RcaRelationRow,
    RootCauseRequest,
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
    column("object_payload"),
    column("recorded_at"),
)


class RootCauseRepository(Protocol):
    async def ensure_schema(self) -> None: ...

    async def extract_neighborhood(
        self,
        payload: RootCauseRequest,
        *,
        max_events: int,
        max_relations: int,
    ) -> ExtractedRcaNeighborhood: ...


@dataclass(slots=True)
class ClickHouseRootCauseRepository:
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
            raise RootCauseError(f"Missing ClickHouse migrations directory: {self.migrations_dir}")

        migration_files = sorted(self.migrations_dir.glob("*.sql"))
        if not migration_files:
            raise RootCauseError(f"No ClickHouse migration files found in {self.migrations_dir}")

        for file in migration_files:
            sql_text = file.read_text(encoding="utf-8")
            for statement in _split_sql_statements(sql_text):
                await self._execute(statement)

    async def extract_neighborhood(
        self,
        payload: RootCauseRequest,
        *,
        max_events: int,
        max_relations: int,
    ) -> ExtractedRcaNeighborhood:
        anchors = await self._select_anchor_instances(payload)
        if not anchors:
            return ExtractedRcaNeighborhood(anchors=[], events=[], objects=[], relations=[])

        visited_instances: set[RcaObjectInstance] = set(anchors)
        frontier: set[RcaObjectInstance] = set(anchors)
        selected_event_ids: set[UUID] = set()
        selected_relations: list[RcaRelationRow] = []

        for _depth in range(payload.depth):
            if not frontier:
                break
            depth_event_ids = await self._select_event_ids_for_instances(frontier, payload)
            new_event_ids = [
                event_id for event_id in depth_event_ids if event_id not in selected_event_ids
            ]
            if not new_event_ids:
                frontier = set()
                continue

            if len(selected_event_ids) + len(new_event_ids) > max_events:
                raise RootCauseLimitExceededError(
                    "root-cause scope is too large: "
                    f"{len(selected_event_ids) + len(new_event_ids)} events exceeds "
                    f"max_events={max_events}; narrow time window or anchor filters"
                )

            selected_event_ids.update(new_event_ids)
            depth_relations = await self._select_relations_for_event_ids(new_event_ids)
            if len(selected_relations) + len(depth_relations) > max_relations:
                raise RootCauseLimitExceededError(
                    "root-cause scope is too large: "
                    f"{len(selected_relations) + len(depth_relations)} relations exceeds "
                    f"max_relations={max_relations}; lower depth or narrow time window"
                )

            selected_relations.extend(depth_relations)
            next_frontier: set[RcaObjectInstance] = set()
            for relation in depth_relations:
                instance = RcaObjectInstance(
                    object_type=relation.object_type,
                    object_ref_hash=relation.object_ref_hash,
                    object_ref_canonical=relation.object_ref_canonical,
                )
                if instance in visited_instances:
                    continue
                visited_instances.add(instance)
                next_frontier.add(instance)
            frontier = next_frontier

        if not selected_event_ids:
            return ExtractedRcaNeighborhood(anchors=anchors, events=[], objects=[], relations=[])

        relation_by_key: dict[tuple[UUID, UUID], RcaRelationRow] = {
            (row.event_id, row.object_history_id): row for row in selected_relations
        }
        relations = sorted(
            relation_by_key.values(),
            key=lambda row: (
                str(row.event_id),
                row.object_type,
                row.object_ref_hash,
                str(row.object_history_id),
            ),
        )
        object_history_ids = [row.object_history_id for row in relations]
        events = await self._select_events_by_ids(selected_event_ids)
        objects = await self._select_objects_by_ids(object_history_ids)

        return ExtractedRcaNeighborhood(
            anchors=sorted(
                anchors,
                key=lambda row: (row.object_type, row.object_ref_hash, row.object_ref_canonical),
            ),
            events=events,
            objects=objects,
            relations=relations,
        )

    async def _select_anchor_instances(self, payload: RootCauseRequest) -> list[RcaObjectInstance]:
        links = _EVENT_OBJECT_LINKS.alias("l")
        events = _EVENT_HISTORY.alias("e")
        stmt = (
            select(links.c.object_type, links.c.object_ref_hash, links.c.object_ref_canonical)
            .distinct()
            .select_from(links.join(events, events.c.event_id == links.c.event_id))
            .where(
                links.c.object_type == payload.anchor_object_type,
                events.c.occurred_at >= _ensure_utc(payload.start_at),
                events.c.occurred_at <= _ensure_utc(payload.end_at),
            )
            .order_by(links.c.object_ref_hash, links.c.object_ref_canonical)
        )
        rows = await self._select_rows(stmt)
        return [
            RcaObjectInstance(
                object_type=str(row["object_type"]),
                object_ref_hash=int(row["object_ref_hash"]),
                object_ref_canonical=str(row["object_ref_canonical"]),
            )
            for row in rows
        ]

    async def _select_event_ids_for_instances(
        self,
        instances: Iterable[RcaObjectInstance],
        payload: RootCauseRequest,
    ) -> set[UUID]:
        values = list(instances)
        if not values:
            return set()

        event_ids: set[UUID] = set()
        for chunk in _chunk(values, size=350):
            links = _EVENT_OBJECT_LINKS.alias("l")
            events = _EVENT_HISTORY.alias("e")
            instance_tuples = [
                (item.object_type, int(item.object_ref_hash), item.object_ref_canonical)
                for item in chunk
            ]
            stmt = (
                select(links.c.event_id)
                .distinct()
                .select_from(links.join(events, events.c.event_id == links.c.event_id))
                .where(
                    tuple_(
                        links.c.object_type,
                        links.c.object_ref_hash,
                        links.c.object_ref_canonical,
                    ).in_(instance_tuples),
                    events.c.occurred_at >= _ensure_utc(payload.start_at),
                    events.c.occurred_at <= _ensure_utc(payload.end_at),
                )
            )
            rows = await self._select_rows(stmt)
            event_ids.update(UUID(str(row["event_id"])) for row in rows)
        return event_ids

    async def _select_relations_for_event_ids(
        self,
        event_ids: Iterable[UUID],
    ) -> list[RcaRelationRow]:
        values = [str(value) for value in event_ids]
        if not values:
            return []

        relations: list[RcaRelationRow] = []
        links = _EVENT_OBJECT_LINKS.alias("l")
        for chunk in _chunk(values, size=500):
            stmt = (
                select(
                    links.c.event_id,
                    links.c.object_history_id,
                    links.c.object_type,
                    links.c.object_ref_hash,
                    links.c.object_ref_canonical,
                    links.c.relation_role,
                )
                .where(links.c.event_id.in_(chunk))
                .order_by(
                    links.c.event_id,
                    links.c.object_type,
                    links.c.object_ref_hash,
                    links.c.object_history_id,
                )
            )
            rows = await self._select_rows(stmt)
            relations.extend(_relation_row_from_clickhouse(row) for row in rows)
        return relations

    async def _select_events_by_ids(self, event_ids: Iterable[UUID]) -> list[RcaEventRow]:
        values = [str(value) for value in event_ids]
        if not values:
            return []

        events: list[RcaEventRow] = []
        event_history = _EVENT_HISTORY.alias("e")
        for chunk in _chunk(values, size=500):
            stmt = (
                select(
                    event_history.c.event_id,
                    event_history.c.occurred_at,
                    event_history.c.event_type,
                    event_history.c.source,
                    event_history.c.trace_id,
                )
                .where(event_history.c.event_id.in_(chunk))
                .order_by(event_history.c.occurred_at, event_history.c.event_id)
            )
            rows = await self._select_rows(stmt)
            events.extend(_event_row_from_clickhouse(row) for row in rows)

        events.sort(key=lambda row: (_ensure_utc(row.occurred_at), str(row.event_id)))
        return events

    async def _select_objects_by_ids(
        self, object_history_ids: Iterable[UUID]
    ) -> list[RcaObjectRow]:
        values = [str(item) for item in {item for item in object_history_ids}]
        if not values:
            return []

        objects: list[RcaObjectRow] = []
        object_history = _OBJECT_HISTORY.alias("o")
        for chunk in _chunk(values, size=500):
            stmt = (
                select(
                    object_history.c.object_history_id,
                    object_history.c.object_type,
                    object_history.c.object_ref_hash,
                    object_history.c.object_ref_canonical,
                    object_history.c.object_payload,
                    object_history.c.recorded_at,
                )
                .where(object_history.c.object_history_id.in_(chunk))
                .order_by(
                    object_history.c.object_type,
                    object_history.c.object_ref_hash,
                    object_history.c.recorded_at,
                    object_history.c.object_history_id,
                )
            )
            rows = await self._select_rows(stmt)
            objects.extend(_object_row_from_clickhouse(row) for row in rows)

        objects.sort(
            key=lambda row: (
                row.object_type,
                row.object_ref_hash,
                _ensure_utc(row.recorded_at),
                str(row.object_history_id),
            )
        )
        return objects

    async def _select_rows(self, query: Any) -> list[dict[str, Any]]:
        try:
            return await self._shared_clickhouse_client().select_rows(query)
        except ClickHouseClientError as exc:
            raise RootCauseError(f"ClickHouse failed to execute ClickHouse query: {exc}") from exc

    async def _execute(self, statement: str) -> None:
        try:
            await self._shared_clickhouse_client().execute(statement)
        except ClickHouseClientError as exc:
            raise RootCauseError(
                f"ClickHouse failed to execute ClickHouse statement: {exc}"
            ) from exc


class InMemoryRootCauseRepository:
    """In-memory RCA repository used in tests and local fallback workflows."""

    def __init__(
        self,
        *,
        events: Sequence[RcaEventRow] | None = None,
        objects: Sequence[RcaObjectRow] | None = None,
        relations: Sequence[RcaRelationRow] | None = None,
        history_repo: Any | None = None,
    ) -> None:
        self._history_repo = history_repo
        self._events: dict[UUID, RcaEventRow] = {row.event_id: row for row in (events or [])}
        self._objects: dict[UUID, RcaObjectRow] = {
            row.object_history_id: row for row in (objects or [])
        }
        self._relations: list[RcaRelationRow] = list(relations or [])

    @classmethod
    def from_phase2_history_repository(cls, history_repo: Any) -> InMemoryRootCauseRepository:
        return cls(history_repo=history_repo)

    def _materialize_from_history_repo(self) -> None:
        if self._history_repo is None:
            return

        self._events = {
            row.event_id: RcaEventRow(
                event_id=row.event_id,
                occurred_at=row.occurred_at,
                event_type=row.event_type,
                source=row.source,
                trace_id=row.trace_id,
            )
            for row in list(getattr(self._history_repo, "_events", {}).values())
        }
        self._objects = {
            row.object_history_id: RcaObjectRow(
                object_history_id=row.object_history_id,
                object_type=row.object_type,
                object_ref_hash=row.object_ref_hash,
                object_ref_canonical=row.object_ref_canonical,
                object_payload=row.object_payload,
                recorded_at=row.recorded_at,
            )
            for row in list(getattr(self._history_repo, "_object_by_id", {}).values())
        }
        self._relations = [
            RcaRelationRow(
                event_id=row.event_id,
                object_history_id=row.object_history_id,
                object_type=row.object_type,
                object_ref_hash=row.object_ref_hash,
                object_ref_canonical=row.object_ref_canonical,
                relation_role=row.relation_role,
            )
            for row in list(getattr(self._history_repo, "_links", []))
        ]

    async def ensure_schema(self) -> None:
        return None

    async def extract_neighborhood(
        self,
        payload: RootCauseRequest,
        *,
        max_events: int,
        max_relations: int,
    ) -> ExtractedRcaNeighborhood:
        self._materialize_from_history_repo()
        start_at = _ensure_utc(payload.start_at)
        end_at = _ensure_utc(payload.end_at)

        window_event_ids: set[UUID] = {
            event.event_id
            for event in self._events.values()
            if start_at <= _ensure_utc(event.occurred_at) <= end_at
        }

        anchors = sorted(
            {
                RcaObjectInstance(
                    object_type=row.object_type,
                    object_ref_hash=row.object_ref_hash,
                    object_ref_canonical=row.object_ref_canonical,
                )
                for row in self._relations
                if row.event_id in window_event_ids
                and row.object_type == payload.anchor_object_type
            },
            key=lambda row: (row.object_type, row.object_ref_hash, row.object_ref_canonical),
        )
        if not anchors:
            return ExtractedRcaNeighborhood(anchors=[], events=[], objects=[], relations=[])

        relations_by_instance: dict[RcaObjectInstance, list[RcaRelationRow]] = {}
        relations_by_event: dict[UUID, list[RcaRelationRow]] = {}
        for relation in self._relations:
            if relation.event_id not in window_event_ids:
                continue
            relations_by_event.setdefault(relation.event_id, []).append(relation)
            instance = RcaObjectInstance(
                object_type=relation.object_type,
                object_ref_hash=relation.object_ref_hash,
                object_ref_canonical=relation.object_ref_canonical,
            )
            relations_by_instance.setdefault(instance, []).append(relation)

        selected_event_ids: set[UUID] = set()
        selected_relations: dict[tuple[UUID, UUID], RcaRelationRow] = {}
        visited_instances = set(anchors)
        frontier = set(anchors)

        for _depth in range(payload.depth):
            if not frontier:
                break

            new_event_ids: set[UUID] = set()
            for instance in frontier:
                for relation in relations_by_instance.get(instance, []):
                    new_event_ids.add(relation.event_id)
            new_event_ids -= selected_event_ids

            if not new_event_ids:
                frontier = set()
                continue

            if len(selected_event_ids) + len(new_event_ids) > max_events:
                raise RootCauseLimitExceededError(
                    "root-cause scope is too large: "
                    f"{len(selected_event_ids) + len(new_event_ids)} events exceeds "
                    f"max_events={max_events}; narrow time window or anchor filters"
                )

            selected_event_ids.update(new_event_ids)
            next_frontier: set[RcaObjectInstance] = set()
            for event_id in new_event_ids:
                for relation in relations_by_event.get(event_id, []):
                    selected_relations[(relation.event_id, relation.object_history_id)] = relation
                    instance = RcaObjectInstance(
                        object_type=relation.object_type,
                        object_ref_hash=relation.object_ref_hash,
                        object_ref_canonical=relation.object_ref_canonical,
                    )
                    if instance in visited_instances:
                        continue
                    visited_instances.add(instance)
                    next_frontier.add(instance)

            if len(selected_relations) > max_relations:
                raise RootCauseLimitExceededError(
                    "root-cause scope is too large: "
                    f"{len(selected_relations)} relations exceeds max_relations={max_relations}; "
                    "lower depth or narrow time window"
                )
            frontier = next_frontier

        if not selected_event_ids:
            return ExtractedRcaNeighborhood(anchors=anchors, events=[], objects=[], relations=[])

        events = [
            self._events[event_id] for event_id in selected_event_ids if event_id in self._events
        ]
        events.sort(key=lambda row: (_ensure_utc(row.occurred_at), str(row.event_id)))

        relations = list(selected_relations.values())
        relations.sort(
            key=lambda row: (
                str(row.event_id),
                row.object_type,
                row.object_ref_hash,
                str(row.object_history_id),
            )
        )

        object_ids = {row.object_history_id for row in relations}
        objects = [
            self._objects[object_id] for object_id in object_ids if object_id in self._objects
        ]
        objects.sort(
            key=lambda row: (
                row.object_type,
                row.object_ref_hash,
                _ensure_utc(row.recorded_at),
                str(row.object_history_id),
            )
        )

        return ExtractedRcaNeighborhood(
            anchors=anchors,
            events=events,
            objects=objects,
            relations=relations,
        )


def _split_sql_statements(sql_text: str) -> list[str]:
    statements = []
    for chunk in sql_text.split(";"):
        line = chunk.strip()
        if line:
            statements.append(line)
    return statements


def _chunk(values: Sequence[Any], *, size: int) -> list[list[Any]]:
    return [list(values[index : index + size]) for index in range(0, len(values), size)]


def _event_row_from_clickhouse(row: dict[str, Any]) -> RcaEventRow:
    return RcaEventRow(
        event_id=UUID(str(row["event_id"])),
        occurred_at=_parse_clickhouse_datetime(str(row["occurred_at"])),
        event_type=str(row["event_type"]),
        source=str(row["source"]),
        trace_id=_to_optional_string(row.get("trace_id")),
    )


def _object_row_from_clickhouse(row: dict[str, Any]) -> RcaObjectRow:
    return RcaObjectRow(
        object_history_id=UUID(str(row["object_history_id"])),
        object_type=str(row["object_type"]),
        object_ref_hash=int(row["object_ref_hash"]),
        object_ref_canonical=str(row["object_ref_canonical"]),
        object_payload=_load_json_object(row.get("object_payload"), default=None),
        recorded_at=_parse_clickhouse_datetime(str(row["recorded_at"])),
    )


def _relation_row_from_clickhouse(row: dict[str, Any]) -> RcaRelationRow:
    return RcaRelationRow(
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
