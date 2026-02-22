"""Process mining extraction adapters."""

from __future__ import annotations

import json
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Protocol
from uuid import UUID

import httpx

from seer_backend.analytics.errors import ProcessMiningError, ProcessMiningLimitExceededError
from seer_backend.analytics.models import (
    ExtractedProcessFrames,
    ProcessEventRow,
    ProcessMiningRequest,
    ProcessObjectRow,
    ProcessRelationRow,
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

    @property
    def _query_url(self) -> str:
        return f"http://{self.host}:{self.port}/"

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
        anchor_events_subquery = _anchor_events_subquery(payload)

        event_count_rows = await self._select_rows(
            "\n".join(
                [
                    "SELECT count() AS cnt",
                    f"FROM ({anchor_events_subquery}) AS anchor_events",
                    "FORMAT JSON",
                ]
            )
        )
        event_count = int(event_count_rows[0].get("cnt", 0)) if event_count_rows else 0
        if event_count > max_events:
            raise ProcessMiningLimitExceededError(
                "process mining scope is too large: "
                f"{event_count} events exceeds max_events={max_events}; "
                "narrow time window or object-type filters"
            )

        relation_filter_clause = _relation_object_type_clause(payload.include_object_types)
        relation_count_query = "\n".join(
            [
                "SELECT count() AS cnt",
                "FROM event_object_links AS l",
                f"INNER JOIN ({anchor_events_subquery}) AS anchor_events",
                "  ON anchor_events.event_id = l.event_id",
                relation_filter_clause,
                "FORMAT JSON",
            ]
        )
        relation_count_rows = await self._select_rows(relation_count_query)
        relation_count = int(relation_count_rows[0].get("cnt", 0)) if relation_count_rows else 0
        if relation_count > max_relations:
            raise ProcessMiningLimitExceededError(
                "process mining scope is too large: "
                f"{relation_count} relations exceeds max_relations={max_relations}; "
                "narrow time window or include_object_types"
            )

        events_query = "\n".join(
            [
                "SELECT",
                "  e.event_id,",
                "  e.occurred_at,",
                "  e.event_type,",
                "  e.source,",
                "  e.trace_id",
                "FROM event_history AS e",
                f"INNER JOIN ({anchor_events_subquery}) AS anchor_events",
                "  ON anchor_events.event_id = e.event_id",
                "ORDER BY e.occurred_at, e.event_id",
                "FORMAT JSON",
            ]
        )

        relations_query = "\n".join(
            [
                "SELECT",
                "  l.event_id,",
                "  l.object_history_id,",
                "  l.object_type,",
                "  l.object_ref_hash,",
                "  l.object_ref_canonical,",
                "  l.relation_role",
                "FROM event_object_links AS l",
                f"INNER JOIN ({anchor_events_subquery}) AS anchor_events",
                "  ON anchor_events.event_id = l.event_id",
                relation_filter_clause,
                "ORDER BY l.event_id, l.object_type, l.object_ref_hash, l.object_history_id",
                "FORMAT JSON",
            ]
        )

        objects_query = "\n".join(
            [
                "SELECT",
                "  o.object_history_id,",
                "  o.object_type,",
                "  o.object_ref_hash,",
                "  o.object_ref_canonical,",
                "  o.object_ref,",
                "  o.object_payload",
                "FROM object_history AS o",
                "INNER JOIN (",
                "  SELECT DISTINCT l.object_history_id",
                "  FROM event_object_links AS l",
                f"  INNER JOIN ({anchor_events_subquery}) AS anchor_events",
                "    ON anchor_events.event_id = l.event_id",
                relation_filter_clause,
                ") AS relation_objects",
                "  ON relation_objects.object_history_id = o.object_history_id",
                "ORDER BY o.object_type, o.object_ref_hash, o.object_history_id",
                "FORMAT JSON",
            ]
        )

        event_rows = [
            _event_row_from_clickhouse(row) for row in await self._select_rows(events_query)
        ]
        relation_rows = [
            _relation_row_from_clickhouse(row) for row in await self._select_rows(relations_query)
        ]
        object_rows = [
            _object_row_from_clickhouse(row) for row in await self._select_rows(objects_query)
        ]

        return ExtractedProcessFrames(
            events=event_rows,
            objects=object_rows,
            relations=relation_rows,
        )

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
        raise ProcessMiningError(
            f"ClickHouse failed to {operation}: HTTP {response.status_code} - {response.text}"
        )


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
            event
            for event in self._events.values()
            if event.event_id in anchor_event_ids
        ]
        selected_events.sort(key=lambda row: (_ensure_utc(row.occurred_at), str(row.event_id)))

        object_type_filter = set(payload.include_object_types or [])
        selected_relations = [
            relation
            for relation in self._relations
            if relation.event_id in anchor_event_ids
            and (
                not object_type_filter
                or relation.object_type in object_type_filter
            )
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


def _anchor_events_subquery(payload: ProcessMiningRequest) -> str:
    return "\n".join(
        [
            "SELECT DISTINCT l.event_id",
            "FROM event_object_links AS l",
            "INNER JOIN event_history AS e ON e.event_id = l.event_id",
            "WHERE",
            f"  l.object_type = {_sql_string_literal(payload.anchor_object_type)}",
            f"  AND e.occurred_at >= {_datetime_literal(payload.start_at)}",
            f"  AND e.occurred_at <= {_datetime_literal(payload.end_at)}",
        ]
    )


def _relation_object_type_clause(object_types: list[str] | None) -> str:
    if not object_types:
        return ""
    values = ", ".join(_sql_string_literal(item) for item in object_types)
    return f"WHERE l.object_type IN ({values})"


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


def _datetime_literal(value: datetime) -> str:
    return f"toDateTime64('{_to_clickhouse_datetime(value)}', 3, 'UTC')"


def _to_clickhouse_datetime(value: datetime) -> str:
    normalized = _ensure_utc(value)
    return normalized.strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]


def _parse_clickhouse_datetime(value: str) -> datetime:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        parsed = datetime.strptime(value, "%Y-%m-%d %H:%M:%S.%f")
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def _sql_string_literal(value: str) -> str:
    escaped = value.replace("\\", "\\\\").replace("'", "\\'")
    return f"'{escaped}'"


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
