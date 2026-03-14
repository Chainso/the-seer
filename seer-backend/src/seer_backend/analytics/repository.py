"""Process mining extraction adapters."""

from __future__ import annotations

import json
from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Protocol
from uuid import UUID

from sqlalchemy import column, func, select, table, text

from seer_backend.analytics.errors import ProcessMiningError, ProcessMiningLimitExceededError
from seer_backend.analytics.models import (
    AnchorFilterCondition,
    ExtractedProcessFrames,
    OcdfgBoundaryMetrics,
    OcdfgEdgeMetrics,
    OcdfgNodeMetrics,
    OcdfgQueryResult,
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
    column("recorded_at"),
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

    async def mine_ocdfg(
        self,
        payload: ProcessMiningRequest,
        *,
        max_events: int,
        max_relations: int,
    ) -> OcdfgQueryResult: ...


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
        include_object_types = _effective_include_object_types(payload)
        scoped_events = _events_scope_subquery(
            payload=payload,
            include_object_types=include_object_types,
        )

        event_count_stmt = select(func.count().label("cnt")).select_from(scoped_events)
        event_count_rows = await self._select_rows(event_count_stmt)
        event_count = int(event_count_rows[0].get("cnt", 0)) if event_count_rows else 0
        if event_count > max_events:
            raise ProcessMiningLimitExceededError(
                "process mining scope is too large: "
                f"{event_count} events exceeds max_events={max_events}; "
                "narrow time window or object-type filters"
            )

        links = _EVENT_OBJECT_LINKS.alias("l")
        relation_source = links.join(scoped_events, scoped_events.c.event_id == links.c.event_id)
        relation_count_stmt = (
            select(func.count().label("cnt"))
            .select_from(relation_source)
            .where(links.c.object_type.in_(include_object_types))
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
            .select_from(events.join(scoped_events, scoped_events.c.event_id == events.c.event_id))
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
            .where(links.c.object_type.in_(include_object_types))
            .order_by(
                links.c.event_id,
                links.c.object_type,
                links.c.object_ref_hash,
                links.c.object_history_id,
            )
        )

        relation_objects_stmt = (
            select(links.c.object_history_id)
            .distinct()
            .select_from(relation_source)
            .where(links.c.object_type.in_(include_object_types))
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
                objects.c.recorded_at,
            )
            .select_from(
                objects.join(
                    relation_objects,
                    relation_objects.c.object_history_id == objects.c.object_history_id,
                )
            )
            .order_by(
                objects.c.object_type,
                objects.c.object_ref_hash,
                objects.c.recorded_at,
                objects.c.object_history_id,
            )
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

        return _apply_anchor_filters_to_frames(
            ExtractedProcessFrames(
                events=event_rows,
                objects=object_rows,
                relations=relation_rows,
            ),
            payload=payload,
        )

    async def mine_ocdfg(
        self,
        payload: ProcessMiningRequest,
        *,
        max_events: int,
        max_relations: int,
    ) -> OcdfgQueryResult:
        if payload.anchor_filters:
            frames = await self.extract_frames(
                payload,
                max_events=max_events,
                max_relations=max_relations,
            )
            return _build_ocdfg_query_result(frames)

        include_object_types = _effective_include_object_types(payload)
        scope_counts = await self._select_rows(
            _ocdfg_scope_counts_query(payload, include_object_types)
        )
        if scope_counts:
            event_count = int(scope_counts[0].get("event_count", 0) or 0)
            relation_count = int(scope_counts[0].get("relation_count", 0) or 0)
        else:
            event_count = 0
            relation_count = 0

        if event_count > max_events:
            raise ProcessMiningLimitExceededError(
                "process mining scope is too large: "
                f"{event_count} events exceeds max_events={max_events}; "
                "narrow time window or object-type filters"
            )
        if relation_count > max_relations:
            raise ProcessMiningLimitExceededError(
                "process mining scope is too large: "
                f"{relation_count} relations exceeds max_relations={max_relations}; "
                "narrow time window or include_object_types"
            )

        node_rows = await self._select_rows(_ocdfg_nodes_query(payload, include_object_types))
        boundary_rows = await self._select_rows(
            _ocdfg_boundary_query(payload, include_object_types)
        )
        edge_rows = await self._select_rows(_ocdfg_edges_query(payload, include_object_types))

        nodes = [_ocdfg_node_metrics_from_clickhouse(row) for row in node_rows]
        starts, ends = _ocdfg_boundaries_from_clickhouse(boundary_rows)
        edges = [_ocdfg_edge_metrics_from_clickhouse(row) for row in edge_rows]
        return OcdfgQueryResult(
            nodes=nodes,
            edges=edges,
            start_activities=starts,
            end_activities=ends,
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
                recorded_at=row.recorded_at,
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
        include_object_types = set(_effective_include_object_types(payload))

        scoped_event_ids: set[UUID] = set()
        for relation in self._relations:
            if relation.object_type not in include_object_types:
                continue
            event_row = self._events.get(relation.event_id)
            if event_row is None:
                continue
            occurred_at = _ensure_utc(event_row.occurred_at)
            if occurred_at < window_start or occurred_at > window_end:
                continue
            scoped_event_ids.add(event_row.event_id)

        selected_events = [
            event for event in self._events.values() if event.event_id in scoped_event_ids
        ]
        selected_events.sort(key=lambda row: (_ensure_utc(row.occurred_at), str(row.event_id)))

        selected_relations = [
            relation
            for relation in self._relations
            if relation.event_id in scoped_event_ids
            and relation.object_type in include_object_types
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
                _ensure_utc(row.recorded_at),
                str(row.object_history_id),
            )
        )

        return _apply_anchor_filters_to_frames(
            ExtractedProcessFrames(
                events=selected_events,
                objects=selected_objects,
                relations=selected_relations,
            ),
            payload=payload,
        )

    async def mine_ocdfg(
        self,
        payload: ProcessMiningRequest,
        *,
        max_events: int,
        max_relations: int,
    ) -> OcdfgQueryResult:
        frames = await self.extract_frames(
            payload,
            max_events=max_events,
            max_relations=max_relations,
        )
        return _build_ocdfg_query_result(frames)


def _events_scope_subquery(
    *,
    payload: ProcessMiningRequest,
    include_object_types: list[str],
) -> Any:
    links = _EVENT_OBJECT_LINKS.alias("l")
    events = _EVENT_HISTORY.alias("e")
    return (
        select(links.c.event_id)
        .distinct()
        .select_from(links.join(events, events.c.event_id == links.c.event_id))
        .where(
            links.c.object_type.in_(include_object_types),
            events.c.occurred_at >= _ensure_utc(payload.start_at),
            events.c.occurred_at <= _ensure_utc(payload.end_at),
        )
        .subquery("scoped_events")
    )


def _effective_include_object_types(payload: ProcessMiningRequest) -> list[str]:
    include_object_types = payload.include_object_types
    if include_object_types:
        return include_object_types
    return [payload.anchor_object_type]


def _apply_anchor_filters_to_frames(
    frames: ExtractedProcessFrames,
    *,
    payload: ProcessMiningRequest,
) -> ExtractedProcessFrames:
    if not payload.anchor_filters:
        return frames

    latest_anchor_payload_by_instance: dict[tuple[str, int, str], dict[str, str]] = {}
    latest_anchor_sort_key_by_instance: dict[tuple[str, int, str], tuple[float, str]] = {}
    for row in frames.objects:
        if row.object_type != payload.anchor_object_type or not row.object_payload:
            continue
        instance_key = (row.object_type, row.object_ref_hash, row.object_ref_canonical)
        sort_key = (_ensure_utc(row.recorded_at).timestamp(), str(row.object_history_id))
        existing_key = latest_anchor_sort_key_by_instance.get(instance_key)
        if existing_key is not None and existing_key >= sort_key:
            continue
        latest_anchor_sort_key_by_instance[instance_key] = sort_key
        latest_anchor_payload_by_instance[instance_key] = _flatten_payload_to_feature_map(
            row.object_payload
        )

    allowed_anchor_instances = {
        instance_key
        for instance_key, payload_fields in latest_anchor_payload_by_instance.items()
        if _matches_anchor_filters(payload_fields, payload.anchor_filters)
    }
    if not allowed_anchor_instances:
        return ExtractedProcessFrames(events=[], objects=[], relations=[])

    selected_event_ids = {
        relation.event_id
        for relation in frames.relations
        if relation.object_type == payload.anchor_object_type
        and (
            relation.object_type,
            relation.object_ref_hash,
            relation.object_ref_canonical,
        )
        in allowed_anchor_instances
    }
    if not selected_event_ids:
        return ExtractedProcessFrames(events=[], objects=[], relations=[])

    selected_events = [
        event for event in frames.events if event.event_id in selected_event_ids
    ]
    selected_relations = [
        relation for relation in frames.relations if relation.event_id in selected_event_ids
    ]
    selected_object_ids = {
        relation.object_history_id for relation in selected_relations
    }
    selected_objects = [
        row for row in frames.objects if row.object_history_id in selected_object_ids
    ]
    return ExtractedProcessFrames(
        events=selected_events,
        objects=selected_objects,
        relations=selected_relations,
    )


def _flatten_payload_to_feature_map(
    payload: dict[str, Any],
    prefix: str = "",
) -> dict[str, str]:
    flattened: dict[str, str] = {}
    for key in sorted(payload):
        if key == "object_type":
            continue
        value = payload[key]
        path = f"{prefix}.{key}" if prefix else key
        if isinstance(value, dict):
            flattened.update(_flatten_payload_to_feature_map(value, prefix=path))
            continue
        normalized = _normalize_scalar(value)
        if normalized is None:
            continue
        flattened[path] = normalized
    return flattened


def _normalize_scalar(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, str):
        cleaned = value.strip()
        return cleaned or None
    if isinstance(value, list):
        if not value:
            return None
        normalized_items = [
            item for item in (_normalize_scalar(item) for item in value[:6]) if item
        ]
        if not normalized_items:
            return None
        return "|".join(normalized_items)
    return str(value).strip() or None


def _matches_anchor_filters(
    payload_fields: dict[str, str],
    anchor_filters: Sequence[AnchorFilterCondition],
) -> bool:
    for item in anchor_filters:
        field_key = item.field.removeprefix("anchor.")
        current = payload_fields.get(field_key)
        if current is None:
            return False
        if item.op == "eq" and current != item.value:
            return False
        if item.op == "ne" and current == item.value:
            return False
        if item.op == "contains" and item.value.lower() not in current.lower():
            return False
        if item.op in {"gt", "gte", "lt", "lte"}:
            current_value = _as_comparable_scalar(current)
            filter_value = _as_comparable_scalar(item.value)
            if current_value is None or filter_value is None:
                return False
            if current_value[0] != filter_value[0]:
                return False
            current_number = current_value[1]
            filter_number = filter_value[1]
            if item.op == "gt" and not current_number > filter_number:
                return False
            if item.op == "gte" and not current_number >= filter_number:
                return False
            if item.op == "lt" and not current_number < filter_number:
                return False
            if item.op == "lte" and not current_number <= filter_number:
                return False
    return True


def _as_comparable_scalar(value: str) -> tuple[str, float] | None:
    numeric = _as_comparable_number(value)
    if numeric is not None:
        return ("number", numeric)

    timestamp = _as_comparable_datetime(value)
    if timestamp is not None:
        return ("temporal", timestamp)

    return None


def _as_comparable_number(value: str) -> float | None:
    try:
        return float(value.strip())
    except (TypeError, ValueError):
        return None


def _as_comparable_datetime(value: str) -> float | None:
    cleaned = value.strip()
    if not cleaned:
        return None
    normalized = cleaned.replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    else:
        parsed = parsed.astimezone(UTC)
    return parsed.timestamp()


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
        recorded_at=_parse_clickhouse_datetime(str(row["recorded_at"])),
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


def _build_ocdfg_query_result(frames: ExtractedProcessFrames) -> OcdfgQueryResult:
    event_index = {row.event_id: row for row in frames.events}

    activity_events: dict[str, set[UUID]] = {}
    activity_objects: dict[str, set[tuple[str, int]]] = {}
    activity_total_objects: dict[str, int] = {}
    object_sequences: dict[tuple[str, int], dict[UUID, ProcessEventRow]] = {}

    for relation in frames.relations:
        event = event_index.get(relation.event_id)
        if event is None:
            continue

        activity_events.setdefault(event.event_type, set()).add(event.event_id)
        activity_objects.setdefault(event.event_type, set()).add(
            (relation.object_type, relation.object_ref_hash)
        )
        activity_total_objects[event.event_type] = (
            activity_total_objects.get(event.event_type, 0) + 1
        )

        object_key = (relation.object_type, relation.object_ref_hash)
        object_sequences.setdefault(object_key, {})[event.event_id] = event

    nodes = [
        OcdfgNodeMetrics(
            activity=activity,
            event_count=len(activity_events[activity]),
            unique_object_count=len(activity_objects.get(activity, set())),
            total_object_count=activity_total_objects.get(activity, 0),
        )
        for activity in sorted(activity_events)
    ]

    start_event_counts: dict[tuple[str, str], set[UUID]] = {}
    start_total_counts: dict[tuple[str, str], int] = {}
    end_event_counts: dict[tuple[str, str], set[UUID]] = {}
    end_total_counts: dict[tuple[str, str], int] = {}
    edge_event_pairs: dict[tuple[str, str, str], set[tuple[UUID, UUID]]] = {}
    edge_objects: dict[tuple[str, str, str], set[int]] = {}
    edge_totals: dict[tuple[str, str, str], int] = {}
    edge_durations: dict[tuple[str, str, str], list[float]] = {}

    for object_key, event_map in object_sequences.items():
        object_type, object_ref_hash = object_key
        ordered_events = sorted(
            event_map.values(),
            key=lambda row: (_ensure_utc(row.occurred_at), str(row.event_id)),
        )
        if not ordered_events:
            continue

        start_event = ordered_events[0]
        start_key = (object_type, start_event.event_type)
        start_event_counts.setdefault(start_key, set()).add(start_event.event_id)
        start_total_counts[start_key] = start_total_counts.get(start_key, 0) + 1

        end_event = ordered_events[-1]
        end_key = (object_type, end_event.event_type)
        end_event_counts.setdefault(end_key, set()).add(end_event.event_id)
        end_total_counts[end_key] = end_total_counts.get(end_key, 0) + 1

        for index in range(len(ordered_events) - 1):
            source = ordered_events[index]
            target = ordered_events[index + 1]
            edge_key = (object_type, source.event_type, target.event_type)
            edge_event_pairs.setdefault(edge_key, set()).add((source.event_id, target.event_id))
            edge_objects.setdefault(edge_key, set()).add(object_ref_hash)
            edge_totals[edge_key] = edge_totals.get(edge_key, 0) + 1
            duration = (
                _ensure_utc(target.occurred_at) - _ensure_utc(source.occurred_at)
            ).total_seconds()
            edge_durations.setdefault(edge_key, []).append(duration)

    start_activities = [
        OcdfgBoundaryMetrics(
            object_type=object_type,
            activity=activity,
            event_count=len(start_event_counts[(object_type, activity)]),
            unique_object_count=start_total_counts[(object_type, activity)],
            total_object_count=start_total_counts[(object_type, activity)],
        )
        for object_type, activity in sorted(start_event_counts)
    ]

    end_activities = [
        OcdfgBoundaryMetrics(
            object_type=object_type,
            activity=activity,
            event_count=len(end_event_counts[(object_type, activity)]),
            unique_object_count=end_total_counts[(object_type, activity)],
            total_object_count=end_total_counts[(object_type, activity)],
        )
        for object_type, activity in sorted(end_event_counts)
    ]

    edges = [
        OcdfgEdgeMetrics(
            object_type=object_type,
            source_activity=source_activity,
            target_activity=target_activity,
            event_couple_count=len(
                edge_event_pairs[(object_type, source_activity, target_activity)]
            ),
            unique_object_count=len(edge_objects[(object_type, source_activity, target_activity)]),
            total_object_count=edge_totals[(object_type, source_activity, target_activity)],
            p50_seconds=_rounded_percentile(
                edge_durations[(object_type, source_activity, target_activity)],
                0.50,
            ),
            p95_seconds=_rounded_percentile(
                edge_durations[(object_type, source_activity, target_activity)],
                0.95,
            ),
        )
        for object_type, source_activity, target_activity in sorted(edge_totals)
    ]

    return OcdfgQueryResult(
        nodes=nodes,
        edges=edges,
        start_activities=start_activities,
        end_activities=end_activities,
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


def _rounded_percentile(values: list[float], q: float) -> float | None:
    if not values:
        return None
    sorted_values = sorted(float(item) for item in values)
    if len(sorted_values) == 1:
        return round(sorted_values[0], 6)
    index = (len(sorted_values) - 1) * q
    lower = int(index)
    upper = lower if index.is_integer() else lower + 1
    if lower == upper:
        return round(sorted_values[lower], 6)
    fraction = index - lower
    value = sorted_values[lower] + (sorted_values[upper] - sorted_values[lower]) * fraction
    return round(value, 6)


def _ocdfg_scope_counts_query(
    payload: ProcessMiningRequest,
    include_object_types: list[str],
) -> Any:
    return _ocdfg_text_query(
        payload,
        include_object_types,
        """
        SELECT
            uniqExact(event_id) AS event_count,
            count() AS relation_count
        FROM scoped_relations
        """,
    )


def _ocdfg_nodes_query(payload: ProcessMiningRequest, include_object_types: list[str]) -> Any:
    return _ocdfg_text_query(
        payload,
        include_object_types,
        """
        SELECT
            event_type AS activity,
            uniqExact(event_id) AS event_count,
            uniqExact(tuple(object_type, object_ref_hash)) AS unique_object_count,
            count() AS total_object_count
        FROM scoped_relations
        GROUP BY activity
        ORDER BY activity
        """,
    )


def _ocdfg_boundary_query(payload: ProcessMiningRequest, include_object_types: list[str]) -> Any:
    return _ocdfg_text_query(
        payload,
        include_object_types,
        """
        , object_boundaries AS (
            SELECT
                object_type,
                object_ref_hash,
                argMin(event_id, tuple(occurred_at, event_id)) AS start_event_id,
                argMin(event_type, tuple(occurred_at, event_id)) AS start_activity,
                argMax(event_id, tuple(occurred_at, event_id)) AS end_event_id,
                argMax(event_type, tuple(occurred_at, event_id)) AS end_activity
            FROM scoped_relations
            GROUP BY object_type, object_ref_hash
        )
        SELECT
            boundary_kind,
            object_type,
            activity,
            uniqExact(event_id) AS event_count,
            count() AS unique_object_count,
            count() AS total_object_count
        FROM (
            SELECT
                'start' AS boundary_kind,
                object_type,
                start_activity AS activity,
                start_event_id AS event_id
            FROM object_boundaries
            UNION ALL
            SELECT
                'end' AS boundary_kind,
                object_type,
                end_activity AS activity,
                end_event_id AS event_id
            FROM object_boundaries
        )
        GROUP BY boundary_kind, object_type, activity
        ORDER BY boundary_kind, object_type, activity
        """,
    )


def _ocdfg_edges_query(payload: ProcessMiningRequest, include_object_types: list[str]) -> Any:
    return _ocdfg_text_query(
        payload,
        include_object_types,
        """
        , ordered_relations AS (
            SELECT
                object_type,
                object_ref_hash,
                event_id,
                occurred_at,
                event_type,
                lagInFrame(toNullable(event_id)) OVER (
                    PARTITION BY object_type, object_ref_hash
                    ORDER BY occurred_at, event_id
                ) AS previous_event_id,
                lagInFrame(toNullable(occurred_at)) OVER (
                    PARTITION BY object_type, object_ref_hash
                    ORDER BY occurred_at, event_id
                ) AS previous_occurred_at,
                lagInFrame(toNullable(event_type)) OVER (
                    PARTITION BY object_type, object_ref_hash
                    ORDER BY occurred_at, event_id
                ) AS previous_event_type
            FROM scoped_relations
        )
        SELECT
            object_type,
            previous_event_type AS source_activity,
            event_type AS target_activity,
            uniqExact(tuple(previous_event_id, event_id)) AS event_couple_count,
            uniqExact(object_ref_hash) AS unique_object_count,
            count() AS total_object_count,
            round(
                quantileTDigest(0.5)(
                    toFloat64(dateDiff('millisecond', previous_occurred_at, occurred_at)) / 1000.0
                ),
                6
            ) AS p50_seconds,
            round(
                quantileTDigest(0.95)(
                    toFloat64(dateDiff('millisecond', previous_occurred_at, occurred_at)) / 1000.0
                ),
                6
            ) AS p95_seconds
        FROM ordered_relations
        WHERE previous_event_id IS NOT NULL
        GROUP BY object_type, source_activity, target_activity
        ORDER BY object_type, source_activity, target_activity
        """,
    )


def _ocdfg_text_query(
    payload: ProcessMiningRequest,
    include_object_types: list[str],
    query_suffix: str,
) -> Any:
    object_types_sql = ", ".join(_sql_string_literal(item) for item in include_object_types)
    return text(
        f"""
        WITH scoped_events AS (
            SELECT
                event_id,
                occurred_at,
                event_type
            FROM event_history
            PREWHERE occurred_at >= :start_at AND occurred_at <= :end_at
        ),
        scoped_relations AS (
            SELECT DISTINCT
                l.object_type AS object_type,
                toUInt64(l.object_ref_hash) AS object_ref_hash,
                e.event_id AS event_id,
                e.occurred_at AS occurred_at,
                e.event_type AS event_type
            FROM scoped_events AS e
            INNER JOIN event_object_links AS l ON l.event_id = e.event_id
            WHERE l.object_type IN ({object_types_sql})
        )
        {query_suffix}
        """
    ).bindparams(
        start_at=_ensure_utc(payload.start_at),
        end_at=_ensure_utc(payload.end_at),
    )


def _sql_string_literal(value: str) -> str:
    return "'" + value.replace("\\", "\\\\").replace("'", "''") + "'"


def _ocdfg_node_metrics_from_clickhouse(row: dict[str, Any]) -> OcdfgNodeMetrics:
    return OcdfgNodeMetrics(
        activity=str(row["activity"]),
        event_count=int(row["event_count"]),
        unique_object_count=int(row["unique_object_count"]),
        total_object_count=int(row["total_object_count"]),
    )


def _ocdfg_edge_metrics_from_clickhouse(row: dict[str, Any]) -> OcdfgEdgeMetrics:
    return OcdfgEdgeMetrics(
        object_type=str(row["object_type"]),
        source_activity=str(row["source_activity"]),
        target_activity=str(row["target_activity"]),
        event_couple_count=int(row["event_couple_count"]),
        unique_object_count=int(row["unique_object_count"]),
        total_object_count=int(row["total_object_count"]),
        p50_seconds=_to_optional_float(row.get("p50_seconds")),
        p95_seconds=_to_optional_float(row.get("p95_seconds")),
    )


def _ocdfg_boundaries_from_clickhouse(
    rows: list[dict[str, Any]],
) -> tuple[list[OcdfgBoundaryMetrics], list[OcdfgBoundaryMetrics]]:
    starts: list[OcdfgBoundaryMetrics] = []
    ends: list[OcdfgBoundaryMetrics] = []
    for row in rows:
        item = OcdfgBoundaryMetrics(
            object_type=str(row["object_type"]),
            activity=str(row["activity"]),
            event_count=int(row["event_count"]),
            unique_object_count=int(row["unique_object_count"]),
            total_object_count=int(row["total_object_count"]),
        )
        if str(row["boundary_kind"]) == "start":
            starts.append(item)
        else:
            ends.append(item)
    return starts, ends


def _to_optional_float(raw: Any) -> float | None:
    if raw is None:
        return None
    value = float(raw)
    return round(value, 6)


def _ensure_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)
