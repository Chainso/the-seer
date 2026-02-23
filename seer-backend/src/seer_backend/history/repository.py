"""History persistence adapters for ClickHouse and tests."""

from __future__ import annotations

import json
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Protocol
from uuid import UUID

import httpx

from seer_backend.history.errors import HistoryError, ObjectTypeMismatchError
from seer_backend.history.models import (
    EventHistoryRecord,
    EventObjectLinkRecord,
    EventObjectRelationRecord,
    ObjectHistoryRecord,
)

_MISSING = object()


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

    @property
    def _query_url(self) -> str:
        return f"http://{self.host}:{self.port}/"

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
            "FORMAT JSON"
        )
        rows = await self._select_rows(query)
        if not rows:
            return False
        return int(rows[0].get("cnt", 0)) > 0

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
FORMAT JSON
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
FORMAT JSON
""".strip()
        rows = await self._select_rows(query)
        return [_object_row_from_clickhouse(row) for row in rows]

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
FORMAT JSON
""".strip()
        rows = await self._select_rows(query)
        return [_relation_row_from_clickhouse(row) for row in rows]

    async def _insert_json_each_row(self, table: str, rows: Sequence[dict[str, Any]]) -> None:
        payload = "\n".join(
            json.dumps(row, ensure_ascii=False, separators=(",", ":")) for row in rows
        )
        query = f"INSERT INTO {table} FORMAT JSONEachRow\n{payload}"
        await self._execute(query)

    async def _select_rows(self, query: str) -> list[dict[str, Any]]:
        async with self._client() as client:
            response = await client.post(
                self._query_url,
                params={"database": self.database},
                content=query.encode("utf-8"),
                headers={"Content-Type": "text/plain; charset=utf-8"},
            )
        self._raise_for_status(response, "execute ClickHouse query")
        body = response.json()
        data = body.get("data", [])
        return data if isinstance(data, list) else []

    async def _execute(self, statement: str) -> None:
        async with self._client() as client:
            response = await client.post(
                self._query_url,
                params={"database": self.database},
                content=statement.encode("utf-8"),
                headers={"Content-Type": "text/plain; charset=utf-8"},
            )
        self._raise_for_status(response, "execute ClickHouse statement")

    def _client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(
            timeout=self.timeout_seconds,
            auth=(self.user, self.password),
        )

    def _raise_for_status(self, response: httpx.Response, operation: str) -> None:
        if response.is_success:
            return
        raise HistoryError(
            f"ClickHouse failed to {operation}: HTTP {response.status_code} - {response.text}"
        )


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
