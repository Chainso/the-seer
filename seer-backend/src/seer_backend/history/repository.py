"""History persistence adapters for ClickHouse and tests."""

from __future__ import annotations

import json
import re
from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Protocol
from uuid import UUID

from seer_backend.clickhouse.client import AsyncClickHouseClient
from seer_backend.clickhouse.errors import ClickHouseClientError
from seer_backend.history.errors import HistoryError, ObjectTypeMismatchError
from seer_backend.history.models import (
    EventHistoryRecord,
    EventObjectLinkRecord,
    EventObjectRelationRecord,
    LatestObjectRecord,
    ObjectEventRecord,
    ObjectHistoryRecord,
    ObjectPropertyFilter,
)

_MISSING = object()
_DURATION_PATTERN = re.compile(
    r"^P"
    r"(?:(?P<years>\d+(?:\.\d+)?)Y)?"
    r"(?:(?P<months>\d+(?:\.\d+)?)M)?"
    r"(?:(?P<weeks>\d+(?:\.\d+)?)W)?"
    r"(?:(?P<days>\d+(?:\.\d+)?)D)?"
    r"(?:T"
    r"(?:(?P<hours>\d+(?:\.\d+)?)H)?"
    r"(?:(?P<minutes>\d+(?:\.\d+)?)M)?"
    r"(?:(?P<seconds>\d+(?:\.\d+)?)S)?"
    r")?$"
)


class HistoryRepository(Protocol):
    async def ensure_schema(self) -> None: ...

    async def event_exists(self, event_id: UUID) -> bool: ...

    async def insert_event_history(self, record: EventHistoryRecord) -> None: ...

    async def insert_object_history_rows(self, records: Sequence[ObjectHistoryRecord]) -> None: ...

    async def insert_event_object_links(self, records: Sequence[EventObjectLinkRecord]) -> None: ...

    async def fetch_events(
        self,
        *,
        start_at: datetime | None,
        end_at: datetime | None,
        event_type: str | None,
        limit: int,
    ) -> list[EventHistoryRecord]: ...

    async def fetch_object_timeline(
        self,
        *,
        object_type: str,
        object_ref_hash: int,
        start_at: datetime | None,
        end_at: datetime | None,
        limit: int,
    ) -> list[ObjectHistoryRecord]: ...

    async def fetch_latest_objects(
        self,
        *,
        object_type: str | None,
        property_filters: Sequence[ObjectPropertyFilter],
        limit: int,
        offset: int,
    ) -> tuple[list[LatestObjectRecord], int]: ...

    async def fetch_object_events(
        self,
        *,
        object_type: str,
        object_ref_hash: int | None,
        object_ref_canonical: str | None,
        start_at: datetime | None,
        end_at: datetime | None,
        limit: int,
        offset: int,
    ) -> tuple[list[ObjectEventRecord], int]: ...

    async def fetch_relations(
        self,
        *,
        event_id: UUID | None,
        object_type: str | None,
        object_ref_hash: int | None,
        limit: int,
    ) -> list[EventObjectRelationRecord]: ...


@dataclass(slots=True)
class ClickHouseHistoryRepository:
    host: str
    port: int
    database: str
    user: str
    password: str
    timeout_seconds: float
    migrations_dir: Path
    _clickhouse_client: AsyncClickHouseClient | None = field(
        default=None,
        init=False,
        repr=False,
    )

    async def ensure_schema(self) -> None:
        if not self.migrations_dir.exists():
            raise HistoryError(f"Missing ClickHouse migrations directory: {self.migrations_dir}")

        migration_files = sorted(self.migrations_dir.glob("*.sql"))
        if not migration_files:
            raise HistoryError(f"No ClickHouse migration files found in {self.migrations_dir}")

        for file in migration_files:
            sql_text = file.read_text(encoding="utf-8")
            for statement in _split_sql_statements(sql_text):
                await self._execute(statement)

    async def event_exists(self, event_id: UUID) -> bool:
        query = (
            "SELECT count() AS cnt "
            "FROM event_history "
            f"WHERE event_id = {_uuid_literal(event_id)} "
        )
        rows = await self._select_rows(query)
        if not rows:
            return False
        return int(rows[0].get("cnt", 0)) > 0

    def _shared_clickhouse_client(self) -> AsyncClickHouseClient:
        if self._clickhouse_client is None:
            self._clickhouse_client = AsyncClickHouseClient(
                host=self.host,
                port=self.port,
                database=self.database,
                user=self.user,
                password=self.password,
                timeout_seconds=self.timeout_seconds,
            )
        return self._clickhouse_client

    async def insert_event_history(self, record: EventHistoryRecord) -> None:
        await self._insert_json_each_row(
            "event_history",
            [
                {
                    "event_id": str(record.event_id),
                    "occurred_at": _to_clickhouse_datetime(record.occurred_at),
                    "event_type": record.event_type,
                    "source": record.source,
                    "payload": json.dumps(
                        record.payload,
                        ensure_ascii=False,
                        separators=(",", ":"),
                    ),
                    "trace_id": record.trace_id,
                    "attributes": (
                        json.dumps(record.attributes, ensure_ascii=False, separators=(",", ":"))
                        if record.attributes is not None
                        else None
                    ),
                    "ingested_at": _to_clickhouse_datetime(record.ingested_at),
                }
            ],
        )

    async def insert_object_history_rows(self, records: Sequence[ObjectHistoryRecord]) -> None:
        if not records:
            return
        payload_rows = [
            {
                "object_history_id": str(record.object_history_id),
                "object_type": record.object_type,
                "object_ref": json.dumps(
                    record.object_ref,
                    ensure_ascii=False,
                    separators=(",", ":"),
                ),
                "object_ref_canonical": record.object_ref_canonical,
                "object_ref_hash": int(record.object_ref_hash),
                "object_payload": json.dumps(
                    record.object_payload,
                    ensure_ascii=False,
                    separators=(",", ":"),
                ),
                "recorded_at": _to_clickhouse_datetime(record.recorded_at),
                "source_event_id": str(record.source_event_id) if record.source_event_id else None,
            }
            for record in records
        ]
        await self._insert_json_each_row("object_history", payload_rows)

    async def insert_event_object_links(self, records: Sequence[EventObjectLinkRecord]) -> None:
        if not records:
            return
        payload_rows = [
            {
                "event_id": str(record.event_id),
                "object_history_id": str(record.object_history_id),
                "object_type": record.object_type,
                "object_ref": json.dumps(
                    record.object_ref,
                    ensure_ascii=False,
                    separators=(",", ":"),
                ),
                "object_ref_canonical": record.object_ref_canonical,
                "object_ref_hash": int(record.object_ref_hash),
                "relation_role": record.relation_role,
                "linked_at": _to_clickhouse_datetime(record.linked_at),
            }
            for record in records
        ]
        await self._insert_json_each_row("event_object_links", payload_rows)

    async def fetch_events(
        self,
        *,
        start_at: datetime | None,
        end_at: datetime | None,
        event_type: str | None,
        limit: int,
    ) -> list[EventHistoryRecord]:
        conditions: list[str] = []
        if start_at is not None:
            conditions.append(f"occurred_at >= {_datetime_literal(start_at)}")
        if end_at is not None:
            conditions.append(f"occurred_at <= {_datetime_literal(end_at)}")
        if event_type is not None:
            conditions.append(f"event_type = {_sql_string_literal(event_type)}")

        where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""

        query = f"""
SELECT
  event_id,
  occurred_at,
  event_type,
  source,
  payload,
  trace_id,
  attributes,
  ingested_at
FROM event_history
{where_clause}
ORDER BY occurred_at, event_id
LIMIT {int(limit)}
""".strip()
        rows = await self._select_rows(query)
        return [_event_row_from_clickhouse(row) for row in rows]

    async def fetch_object_timeline(
        self,
        *,
        object_type: str,
        object_ref_hash: int,
        start_at: datetime | None,
        end_at: datetime | None,
        limit: int,
    ) -> list[ObjectHistoryRecord]:
        conditions = [
            f"object_type = {_sql_string_literal(object_type)}",
            f"object_ref_hash = {int(object_ref_hash)}",
        ]
        if start_at is not None:
            conditions.append(f"recorded_at >= {_datetime_literal(start_at)}")
        if end_at is not None:
            conditions.append(f"recorded_at <= {_datetime_literal(end_at)}")

        query = f"""
SELECT
  object_history_id,
  object_type,
  object_ref,
  object_ref_canonical,
  object_ref_hash,
  object_payload,
  recorded_at,
  source_event_id
FROM object_history
WHERE {' AND '.join(conditions)}
ORDER BY object_type, object_ref_hash, recorded_at, object_history_id
LIMIT {int(limit)}
""".strip()
        rows = await self._select_rows(query)
        return [_object_row_from_clickhouse(row) for row in rows]

    async def fetch_latest_objects(
        self,
        *,
        object_type: str | None,
        property_filters: Sequence[ObjectPropertyFilter],
        limit: int,
        offset: int,
    ) -> tuple[list[LatestObjectRecord], int]:
        source_conditions: list[str] = []
        if object_type is not None:
            source_conditions.append(f"object_type = {_sql_string_literal(object_type)}")
        source_where = f"WHERE {' AND '.join(source_conditions)}" if source_conditions else ""

        latest_filter_conditions, residual_filters = _build_latest_object_filter_conditions(
            property_filters,
            payload_column="latest_object_payload",
        )
        latest_where = (
            f"WHERE {' AND '.join(latest_filter_conditions)}"
            if latest_filter_conditions
            else ""
        )

        base_latest_cte = f"""
WITH latest AS (
  SELECT
    argMax(object_history_id, tuple(recorded_at, object_history_id)) AS latest_object_history_id,
    object_type,
    object_ref_hash,
    argMax(object_ref, tuple(recorded_at, object_history_id)) AS latest_object_ref,
    argMax(
      object_ref_canonical,
      tuple(recorded_at, object_history_id)
    ) AS latest_object_ref_canonical,
    argMax(object_payload, tuple(recorded_at, object_history_id)) AS latest_object_payload,
    max(recorded_at) AS latest_recorded_at,
    argMax(source_event_id, tuple(recorded_at, object_history_id)) AS latest_source_event_id
  FROM object_history
  {source_where}
  GROUP BY object_type, object_ref_hash
)
""".strip()

        latest_select = f"""
SELECT
  latest_object_history_id AS object_history_id,
  object_type,
  object_ref_hash,
  latest_object_ref AS object_ref,
  latest_object_ref_canonical AS object_ref_canonical,
  latest_object_payload AS object_payload,
  latest_recorded_at AS recorded_at,
  latest_source_event_id AS source_event_id
FROM latest
{latest_where}
""".strip()

        if residual_filters:
            unbounded_query = f"""
{base_latest_cte}
{latest_select}
ORDER BY latest_recorded_at DESC, object_type, object_ref_hash
""".strip()
            data_rows = await self._select_rows(unbounded_query)
            all_rows = [_latest_object_row_from_clickhouse(row) for row in data_rows]
            filtered_rows = [
                row
                for row in all_rows
                if _matches_property_filters(row.object_payload, property_filters)
            ]
            total = len(filtered_rows)
            if total <= 0:
                return ([], 0)
            return (filtered_rows[offset : offset + limit], total)

        count_query = f"""
{base_latest_cte}
SELECT count() AS cnt
FROM latest
{latest_where}
""".strip()
        count_rows = await self._select_rows(count_query)
        total = int(count_rows[0].get("cnt", 0)) if count_rows else 0
        if total <= 0:
            return ([], 0)

        data_query = f"""
{base_latest_cte}
{latest_select}
ORDER BY latest_recorded_at DESC, object_type, object_ref_hash
LIMIT {int(limit)} OFFSET {int(offset)}
""".strip()
        data_rows = await self._select_rows(data_query)
        return ([_latest_object_row_from_clickhouse(row) for row in data_rows], total)

    async def fetch_object_events(
        self,
        *,
        object_type: str,
        object_ref_hash: int | None,
        object_ref_canonical: str | None,
        start_at: datetime | None,
        end_at: datetime | None,
        limit: int,
        offset: int,
    ) -> tuple[list[ObjectEventRecord], int]:
        count_conditions = [f"l.object_type = {_sql_string_literal(object_type)}"]
        link_conditions = [f"l.object_type = {_sql_string_literal(object_type)}"]
        if object_ref_canonical is not None:
            count_conditions.append(
                f"l.object_ref_canonical = {_sql_string_literal(object_ref_canonical)}"
            )
            link_conditions.append(
                f"l.object_ref_canonical = {_sql_string_literal(object_ref_canonical)}"
            )
        elif object_ref_hash is not None:
            count_conditions.append(f"l.object_ref_hash = {int(object_ref_hash)}")
            link_conditions.append(f"l.object_ref_hash = {int(object_ref_hash)}")
        else:
            raise ValueError("object_ref_hash or object_ref_canonical is required")
        if start_at is not None:
            start_literal = _datetime_literal(_ensure_utc(start_at))
            count_conditions.append(
                f"coalesce(e.occurred_at, l.linked_at) >= {start_literal}"
            )
            link_conditions.append(
                f"coalesce(e.occurred_at, l.linked_at) >= {start_literal}"
            )
        if end_at is not None:
            end_literal = _datetime_literal(_ensure_utc(end_at))
            count_conditions.append(
                f"coalesce(e.occurred_at, l.linked_at) <= {end_literal}"
            )
            link_conditions.append(
                f"coalesce(e.occurred_at, l.linked_at) <= {end_literal}"
            )

        count_query = f"""
SELECT count() AS cnt
FROM event_object_links AS l
LEFT JOIN event_history AS e ON e.event_id = l.event_id
WHERE {' AND '.join(count_conditions)}
""".strip()
        count_rows = await self._select_rows(count_query)
        total = int(count_rows[0].get("cnt", 0)) if count_rows else 0
        if total <= 0:
            return ([], 0)

        data_query = f"""
SELECT
  l.event_id AS event_id,
  l.relation_role AS relation_role,
  l.linked_at AS linked_at,
  l.object_history_id AS object_history_id,
  e.occurred_at AS occurred_at,
  e.event_type AS event_type,
  e.source AS source,
  e.trace_id AS trace_id,
  e.payload AS payload,
  e.attributes AS attributes,
  o.recorded_at AS recorded_at,
  o.object_payload AS object_payload
FROM event_object_links AS l
LEFT JOIN event_history AS e ON e.event_id = l.event_id
LEFT JOIN object_history AS o ON o.object_history_id = l.object_history_id
WHERE {' AND '.join(link_conditions)}
ORDER BY coalesce(e.occurred_at, l.linked_at) DESC, l.event_id DESC, l.object_history_id DESC
LIMIT {int(limit)} OFFSET {int(offset)}
""".strip()
        data_rows = await self._select_rows(data_query)
        return ([_object_event_row_from_clickhouse(row) for row in data_rows], total)

    async def fetch_relations(
        self,
        *,
        event_id: UUID | None,
        object_type: str | None,
        object_ref_hash: int | None,
        limit: int,
    ) -> list[EventObjectRelationRecord]:
        conditions: list[str] = []
        if event_id is not None:
            conditions.append(f"l.event_id = {_uuid_literal(event_id)}")
        if object_type is not None and object_ref_hash is not None:
            conditions.append(f"l.object_type = {_sql_string_literal(object_type)}")
            conditions.append(f"l.object_ref_hash = {int(object_ref_hash)}")

        where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""

        query = f"""
SELECT
  l.event_id AS event_id,
  l.object_history_id AS object_history_id,
  l.object_type AS object_type,
  l.object_ref AS object_ref,
  l.object_ref_canonical AS object_ref_canonical,
  l.object_ref_hash AS object_ref_hash,
  l.relation_role AS relation_role,
  l.linked_at AS linked_at,
  e.occurred_at AS occurred_at,
  e.event_type AS event_type,
  e.source AS source,
  o.object_payload AS object_payload,
  o.recorded_at AS recorded_at
FROM event_object_links AS l
LEFT JOIN event_history AS e ON e.event_id = l.event_id
LEFT JOIN object_history AS o ON o.object_history_id = l.object_history_id
{where_clause}
ORDER BY coalesce(e.occurred_at, l.linked_at), l.event_id, l.object_history_id
LIMIT {int(limit)}
""".strip()
        rows = await self._select_rows(query)
        return [_relation_row_from_clickhouse(row) for row in rows]

    async def _insert_json_each_row(self, table: str, rows: Sequence[dict[str, Any]]) -> None:
        try:
            await self._shared_clickhouse_client().insert_json_rows(table, rows)
        except ClickHouseClientError as exc:
            raise HistoryError(
                f"ClickHouse failed to execute ClickHouse statement: {exc}"
            ) from exc

    async def _select_rows(self, query: str) -> list[dict[str, Any]]:
        try:
            return await self._shared_clickhouse_client().select_rows(query)
        except ClickHouseClientError as exc:
            raise HistoryError(f"ClickHouse failed to execute ClickHouse query: {exc}") from exc

    async def _execute(self, statement: str) -> None:
        try:
            await self._shared_clickhouse_client().execute(statement)
        except ClickHouseClientError as exc:
            raise HistoryError(
                f"ClickHouse failed to execute ClickHouse statement: {exc}"
            ) from exc


class InMemoryHistoryRepository:
    """In-memory repository for tests."""

    def __init__(self) -> None:
        self._events: dict[UUID, EventHistoryRecord] = {}
        self._object_rows: list[ObjectHistoryRecord] = []
        self._object_by_id: dict[UUID, ObjectHistoryRecord] = {}
        self._links: list[EventObjectLinkRecord] = []

    async def ensure_schema(self) -> None:
        return None

    async def event_exists(self, event_id: UUID) -> bool:
        return event_id in self._events

    async def insert_event_history(self, record: EventHistoryRecord) -> None:
        self._events[record.event_id] = record

    async def insert_object_history_rows(self, records: Sequence[ObjectHistoryRecord]) -> None:
        for record in records:
            self._object_rows.append(record)
            self._object_by_id[record.object_history_id] = record

    async def insert_event_object_links(self, records: Sequence[EventObjectLinkRecord]) -> None:
        for record in records:
            object_row = self._object_by_id.get(record.object_history_id)
            if object_row is None:
                raise ObjectTypeMismatchError(
                    "event_object_links.object_history_id must reference object_history row"
                )
            if object_row.object_type != record.object_type:
                raise ObjectTypeMismatchError(
                    "event_object_links.object_type must equal object_history.object_type"
                )
            self._links.append(record)

    async def fetch_events(
        self,
        *,
        start_at: datetime | None,
        end_at: datetime | None,
        event_type: str | None,
        limit: int,
    ) -> list[EventHistoryRecord]:
        rows = list(self._events.values())
        if start_at is not None:
            rows = [row for row in rows if _ensure_utc(row.occurred_at) >= _ensure_utc(start_at)]
        if end_at is not None:
            rows = [row for row in rows if _ensure_utc(row.occurred_at) <= _ensure_utc(end_at)]
        if event_type is not None:
            rows = [row for row in rows if row.event_type == event_type]
        rows.sort(key=lambda row: (_ensure_utc(row.occurred_at), str(row.event_id)))
        return rows[:limit]

    async def fetch_object_timeline(
        self,
        *,
        object_type: str,
        object_ref_hash: int,
        start_at: datetime | None,
        end_at: datetime | None,
        limit: int,
    ) -> list[ObjectHistoryRecord]:
        rows = [
            row
            for row in self._object_rows
            if row.object_type == object_type and row.object_ref_hash == object_ref_hash
        ]
        if start_at is not None:
            rows = [row for row in rows if _ensure_utc(row.recorded_at) >= _ensure_utc(start_at)]
        if end_at is not None:
            rows = [row for row in rows if _ensure_utc(row.recorded_at) <= _ensure_utc(end_at)]
        rows.sort(
            key=lambda row: (
                row.object_type,
                row.object_ref_hash,
                _ensure_utc(row.recorded_at),
                str(row.object_history_id),
            )
        )
        return rows[:limit]

    async def fetch_latest_objects(
        self,
        *,
        object_type: str | None,
        property_filters: Sequence[ObjectPropertyFilter],
        limit: int,
        offset: int,
    ) -> tuple[list[LatestObjectRecord], int]:
        rows = list(self._object_rows)
        if object_type is not None:
            rows = [row for row in rows if row.object_type == object_type]

        latest_by_identity: dict[tuple[str, int], ObjectHistoryRecord] = {}
        for row in rows:
            key = (row.object_type, row.object_ref_hash)
            existing = latest_by_identity.get(key)
            if existing is None:
                latest_by_identity[key] = row
                continue
            current_key = (_ensure_utc(row.recorded_at), str(row.object_history_id))
            existing_key = (_ensure_utc(existing.recorded_at), str(existing.object_history_id))
            if current_key > existing_key:
                latest_by_identity[key] = row

        latest_rows = [
            row
            for row in latest_by_identity.values()
            if _matches_property_filters(row.object_payload, property_filters)
        ]
        latest_rows.sort(
            key=lambda row: (
                -_ensure_utc(row.recorded_at).timestamp(),
                row.object_type,
                row.object_ref_hash,
            )
        )
        total = len(latest_rows)
        page_rows = latest_rows[offset : offset + limit]
        output = [
            LatestObjectRecord(
                object_history_id=row.object_history_id,
                object_type=row.object_type,
                object_ref=row.object_ref,
                object_ref_canonical=row.object_ref_canonical,
                object_ref_hash=row.object_ref_hash,
                object_payload=row.object_payload,
                recorded_at=row.recorded_at,
                source_event_id=row.source_event_id,
            )
            for row in page_rows
        ]
        return (output, total)

    async def fetch_object_events(
        self,
        *,
        object_type: str,
        object_ref_hash: int | None,
        object_ref_canonical: str | None,
        start_at: datetime | None,
        end_at: datetime | None,
        limit: int,
        offset: int,
    ) -> tuple[list[ObjectEventRecord], int]:
        links = [row for row in self._links if row.object_type == object_type]
        if object_ref_canonical is not None:
            links = [
                row for row in links if row.object_ref_canonical == object_ref_canonical
            ]
        elif object_ref_hash is not None:
            links = [row for row in links if row.object_ref_hash == object_ref_hash]
        else:
            raise ValueError("object_ref_hash or object_ref_canonical is required")

        normalized_start_at = _ensure_utc(start_at) if start_at is not None else None
        normalized_end_at = _ensure_utc(end_at) if end_at is not None else None

        output: list[ObjectEventRecord] = []
        for link in links:
            event = self._events.get(link.event_id)
            object_row = self._object_by_id.get(link.object_history_id)
            event_time = _ensure_utc(event.occurred_at if event else link.linked_at)
            if normalized_start_at is not None and event_time < normalized_start_at:
                continue
            if normalized_end_at is not None and event_time > normalized_end_at:
                continue
            output.append(
                ObjectEventRecord(
                    event_id=link.event_id,
                    occurred_at=event.occurred_at if event else None,
                    event_type=event.event_type if event else None,
                    source=event.source if event else None,
                    trace_id=event.trace_id if event else None,
                    payload=event.payload if event else None,
                    attributes=event.attributes if event else None,
                    relation_role=link.relation_role,
                    linked_at=link.linked_at,
                    object_history_id=link.object_history_id,
                    recorded_at=object_row.recorded_at if object_row else None,
                    object_payload=object_row.object_payload if object_row else None,
                )
            )

        output.sort(
            key=lambda row: (
                _ensure_utc(row.occurred_at or row.linked_at),
                str(row.event_id),
                str(row.object_history_id),
            ),
            reverse=True,
        )
        total = len(output)
        return (output[offset : offset + limit], total)

    async def fetch_relations(
        self,
        *,
        event_id: UUID | None,
        object_type: str | None,
        object_ref_hash: int | None,
        limit: int,
    ) -> list[EventObjectRelationRecord]:
        links = list(self._links)
        if event_id is not None:
            links = [row for row in links if row.event_id == event_id]
        if object_type is not None and object_ref_hash is not None:
            links = [
                row
                for row in links
                if row.object_type == object_type and row.object_ref_hash == object_ref_hash
            ]

        output: list[EventObjectRelationRecord] = []
        for link in links:
            event = self._events.get(link.event_id)
            object_row = self._object_by_id.get(link.object_history_id)
            output.append(
                EventObjectRelationRecord(
                    event_id=link.event_id,
                    object_history_id=link.object_history_id,
                    object_type=link.object_type,
                    object_ref=link.object_ref,
                    object_ref_canonical=link.object_ref_canonical,
                    object_ref_hash=link.object_ref_hash,
                    relation_role=link.relation_role,
                    linked_at=link.linked_at,
                    occurred_at=event.occurred_at if event else None,
                    event_type=event.event_type if event else None,
                    source=event.source if event else None,
                    object_payload=object_row.object_payload if object_row else None,
                    recorded_at=object_row.recorded_at if object_row else None,
                )
            )

        output.sort(
            key=lambda row: (
                _ensure_utc(row.occurred_at or row.linked_at),
                str(row.event_id),
                str(row.object_history_id),
            )
        )
        return output[:limit]


def _event_row_from_clickhouse(row: dict[str, Any]) -> EventHistoryRecord:
    return EventHistoryRecord(
        event_id=UUID(str(row["event_id"])),
        occurred_at=_parse_clickhouse_datetime(str(row["occurred_at"])),
        event_type=str(row["event_type"]),
        source=str(row["source"]),
        payload=_load_json_object(row.get("payload")),
        trace_id=_to_optional_string(row.get("trace_id")),
        attributes=_load_json_object(row.get("attributes"), default=None),
        ingested_at=_parse_clickhouse_datetime(str(row["ingested_at"])),
    )


def _object_row_from_clickhouse(row: dict[str, Any]) -> ObjectHistoryRecord:
    return ObjectHistoryRecord(
        object_history_id=UUID(str(row["object_history_id"])),
        object_type=str(row["object_type"]),
        object_ref=_load_json_object(row.get("object_ref")),
        object_ref_canonical=str(row["object_ref_canonical"]),
        object_ref_hash=int(row["object_ref_hash"]),
        object_payload=_load_json_object(row.get("object_payload")),
        recorded_at=_parse_clickhouse_datetime(str(row["recorded_at"])),
        source_event_id=_to_optional_uuid(row.get("source_event_id")),
    )


def _latest_object_row_from_clickhouse(row: dict[str, Any]) -> LatestObjectRecord:
    return LatestObjectRecord(
        object_history_id=UUID(str(row["object_history_id"])),
        object_type=str(row["object_type"]),
        object_ref_hash=int(row["object_ref_hash"]),
        object_ref=_load_json_object(row.get("object_ref")),
        object_ref_canonical=str(row["object_ref_canonical"]),
        object_payload=_load_json_object(row.get("object_payload")),
        recorded_at=_parse_clickhouse_datetime(str(row["recorded_at"])),
        source_event_id=_to_optional_uuid(row.get("source_event_id")),
    )


def _object_event_row_from_clickhouse(row: dict[str, Any]) -> ObjectEventRecord:
    occurred_at_raw = _row_value(row, "occurred_at", "e.occurred_at", default=None)
    recorded_at_raw = _row_value(row, "recorded_at", "o.recorded_at", default=None)
    return ObjectEventRecord(
        event_id=UUID(str(_row_value(row, "event_id", "l.event_id"))),
        occurred_at=_parse_clickhouse_datetime(str(occurred_at_raw)) if occurred_at_raw else None,
        event_type=_to_optional_string(
            _row_value(row, "event_type", "e.event_type", default=None)
        ),
        source=_to_optional_string(_row_value(row, "source", "e.source", default=None)),
        trace_id=_to_optional_string(_row_value(row, "trace_id", "e.trace_id", default=None)),
        payload=_load_json_object(
            _row_value(row, "payload", "e.payload", default=None),
            default=None,
        ),
        attributes=_load_json_object(
            _row_value(row, "attributes", "e.attributes", default=None),
            default=None,
        ),
        relation_role=_to_optional_string(
            _row_value(row, "relation_role", "l.relation_role", default=None)
        ),
        linked_at=_parse_clickhouse_datetime(
            str(_row_value(row, "linked_at", "l.linked_at"))
        ),
        object_history_id=UUID(
            str(_row_value(row, "object_history_id", "l.object_history_id"))
        ),
        recorded_at=_parse_clickhouse_datetime(str(recorded_at_raw)) if recorded_at_raw else None,
        object_payload=_load_json_object(
            _row_value(row, "object_payload", "o.object_payload", default=None),
            default=None,
        ),
    )


def _relation_row_from_clickhouse(row: dict[str, Any]) -> EventObjectRelationRecord:
    occurred_at_raw = _row_value(row, "occurred_at", "e.occurred_at", default=None)
    recorded_at_raw = _row_value(row, "recorded_at", "o.recorded_at", default=None)
    return EventObjectRelationRecord(
        event_id=UUID(str(_row_value(row, "event_id", "l.event_id"))),
        object_history_id=UUID(
            str(_row_value(row, "object_history_id", "l.object_history_id"))
        ),
        object_type=str(_row_value(row, "object_type", "l.object_type")),
        object_ref=_load_json_object(
            _row_value(row, "object_ref", "l.object_ref", default=None)
        ),
        object_ref_canonical=str(
            _row_value(row, "object_ref_canonical", "l.object_ref_canonical")
        ),
        object_ref_hash=int(_row_value(row, "object_ref_hash", "l.object_ref_hash")),
        relation_role=_to_optional_string(
            _row_value(row, "relation_role", "l.relation_role", default=None)
        ),
        linked_at=_parse_clickhouse_datetime(
            str(_row_value(row, "linked_at", "l.linked_at"))
        ),
        occurred_at=_parse_clickhouse_datetime(str(occurred_at_raw)) if occurred_at_raw else None,
        event_type=_to_optional_string(
            _row_value(row, "event_type", "e.event_type", default=None)
        ),
        source=_to_optional_string(_row_value(row, "source", "e.source", default=None)),
        object_payload=_load_json_object(
            _row_value(row, "object_payload", "o.object_payload", default=None),
            default=None,
        ),
        recorded_at=_parse_clickhouse_datetime(str(recorded_at_raw)) if recorded_at_raw else None,
    )


def _build_latest_object_filter_conditions(
    property_filters: Sequence[ObjectPropertyFilter],
    *,
    payload_column: str = "object_payload",
) -> tuple[list[str], list[ObjectPropertyFilter]]:
    conditions: list[str] = []
    residual_filters: list[ObjectPropertyFilter] = []
    for property_filter in property_filters:
        key_literal = _sql_string_literal(property_filter.key)
        normalized_value_expr = (
            "replaceRegexpAll("
            f"coalesce(JSONExtractRaw({payload_column}, {key_literal}), ''),"
            r" '^\"|\"$'"
            ", '')"
        )
        value_literal = _sql_string_literal(property_filter.value)

        if property_filter.op == "eq":
            conditions.append(f"{normalized_value_expr} = {value_literal}")
            continue
        if property_filter.op == "contains":
            conditions.append(
                f"positionCaseInsensitiveUTF8({normalized_value_expr}, {value_literal}) > 0"
            )
            continue

        comparable_filter = _as_comparable_scalar(property_filter.value)
        if comparable_filter is None or comparable_filter[0] != "number":
            residual_filters.append(property_filter)
            continue
        numeric_value = comparable_filter[1]
        numeric_expr = f"toFloat64OrNull({normalized_value_expr})"
        if property_filter.op == "gt":
            conditions.append(f"{numeric_expr} > {numeric_value}")
        elif property_filter.op == "gte":
            conditions.append(f"{numeric_expr} >= {numeric_value}")
        elif property_filter.op == "lt":
            conditions.append(f"{numeric_expr} < {numeric_value}")
        elif property_filter.op == "lte":
            conditions.append(f"{numeric_expr} <= {numeric_value}")
    return conditions, residual_filters


def _matches_property_filters(
    object_payload: dict[str, Any],
    property_filters: Sequence[ObjectPropertyFilter],
) -> bool:
    for property_filter in property_filters:
        if not _matches_property_filter(object_payload, property_filter):
            return False
    return True


def _matches_property_filter(
    object_payload: dict[str, Any],
    property_filter: ObjectPropertyFilter,
) -> bool:
    raw = object_payload.get(property_filter.key)
    if raw is None:
        return False

    if property_filter.op == "eq":
        return _scalar_to_string(raw) == property_filter.value
    if property_filter.op == "contains":
        candidate = _scalar_to_string(raw)
        return property_filter.value.lower() in candidate.lower()

    candidate_value = _coerce_to_comparable_scalar(raw)
    filter_value = _as_comparable_scalar(property_filter.value)
    if candidate_value is None or filter_value is None:
        return False
    if candidate_value[0] != filter_value[0]:
        return False
    candidate_number = candidate_value[1]
    filter_number = filter_value[1]
    if property_filter.op == "gt":
        return candidate_number > filter_number
    if property_filter.op == "gte":
        return candidate_number >= filter_number
    if property_filter.op == "lt":
        return candidate_number < filter_number
    if property_filter.op == "lte":
        return candidate_number <= filter_number
    return False


def _scalar_to_string(raw: Any) -> str:
    if isinstance(raw, bool):
        return "true" if raw else "false"
    if isinstance(raw, (dict, list)):
        return ""
    return str(raw)


def _coerce_to_comparable_scalar(raw: Any) -> tuple[str, float] | None:
    if isinstance(raw, bool):
        return None
    if isinstance(raw, (int, float)):
        return ("number", float(raw))
    if isinstance(raw, str):
        return _as_comparable_scalar(raw)
    return None


def _as_comparable_number(value: str) -> tuple[str, float] | None:
    cleaned = value.strip()
    try:
        return ("number", float(cleaned))
    except (TypeError, ValueError):
        return None


def _as_comparable_datetime(value: str) -> tuple[str, float] | None:
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
    return ("datetime", parsed.timestamp())


def _as_comparable_duration(value: str) -> tuple[str, float] | None:
    cleaned = value.strip().upper()
    if not cleaned:
        return None
    match = _DURATION_PATTERN.fullmatch(cleaned)
    if not match:
        return None
    years = float(match.group("years") or 0.0)
    months = float(match.group("months") or 0.0)
    weeks = float(match.group("weeks") or 0.0)
    days = float(match.group("days") or 0.0)
    hours = float(match.group("hours") or 0.0)
    minutes = float(match.group("minutes") or 0.0)
    seconds = float(match.group("seconds") or 0.0)
    return (
        "duration",
        years * 365.0 * 24.0 * 60.0 * 60.0
        + months * 30.0 * 24.0 * 60.0 * 60.0
        + weeks * 7.0 * 24.0 * 60.0 * 60.0
        + days * 24.0 * 60.0 * 60.0
        + hours * 60.0 * 60.0
        + minutes * 60.0
        + seconds,
    )


def _as_comparable_scalar(value: str) -> tuple[str, float] | None:
    numeric = _as_comparable_number(value)
    if numeric is not None:
        return numeric
    timestamp = _as_comparable_datetime(value)
    if timestamp is not None:
        return timestamp
    duration = _as_comparable_duration(value)
    if duration is not None:
        return duration
    return None


def _split_sql_statements(sql_text: str) -> list[str]:
    statements = []
    for chunk in sql_text.split(";"):
        line = chunk.strip()
        if line:
            statements.append(line)
    return statements


def _parse_clickhouse_datetime(value: str) -> datetime:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        parsed = datetime.strptime(value, "%Y-%m-%d %H:%M:%S.%f")
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def _to_clickhouse_datetime(value: datetime) -> str:
    normalized = _ensure_utc(value)
    return normalized.strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]


def _datetime_literal(value: datetime) -> str:
    return f"toDateTime64('{_to_clickhouse_datetime(value)}', 3, 'UTC')"


def _uuid_literal(value: UUID) -> str:
    return f"toUUID('{value}')"


def _sql_string_literal(value: str) -> str:
    escaped = value.replace("\\", "\\\\").replace("'", "\\'")
    return f"'{escaped}'"


def _ensure_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


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


def _to_optional_uuid(raw: Any) -> UUID | None:
    value = _to_optional_string(raw)
    return UUID(value) if value else None


def _row_value(row: dict[str, Any], *keys: str, default: Any = _MISSING) -> Any:
    for key in keys:
        if key in row:
            return row[key]
    if default is not _MISSING:
        return default
    raise KeyError(keys[0] if keys else "missing row key")
