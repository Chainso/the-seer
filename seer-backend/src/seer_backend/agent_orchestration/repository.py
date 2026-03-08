"""Transcript persistence adapters for ClickHouse and tests."""

from __future__ import annotations

import json
from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Protocol
from uuid import UUID

from sqlalchemy import asc, column, func, select, table

from seer_backend.agent_orchestration.errors import AgentOrchestrationError
from seer_backend.agent_orchestration.models import AgentTranscriptMessageRecord
from seer_backend.clickhouse.client import AsyncClickHouseClient
from seer_backend.clickhouse.errors import ClickHouseClientError

_TRANSCRIPT_MESSAGES = table(
    "agentic_workflow_completion_messages",
    column("execution_id"),
    column("workflow_uri"),
    column("attempt_no"),
    column("sequence_no"),
    column("message_role"),
    column("message_kind"),
    column("call_id"),
    column("message_json"),
    column("persisted_at"),
)


class AgentTranscriptRepository(Protocol):
    async def ensure_schema(self) -> None: ...

    async def fetch_max_sequence_no(self, *, execution_id: UUID, attempt_no: int) -> int: ...

    async def insert_completion_messages(
        self,
        records: Sequence[AgentTranscriptMessageRecord],
    ) -> None: ...

    async def fetch_completion_messages(
        self,
        *,
        execution_id: UUID,
        attempt_no: int | None = None,
    ) -> list[AgentTranscriptMessageRecord]: ...


@dataclass(slots=True)
class ClickHouseAgentTranscriptRepository:
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

    async def ensure_schema(self) -> None:
        if not self.migrations_dir.exists():
            raise AgentOrchestrationError(
                f"Missing ClickHouse migrations directory: {self.migrations_dir}"
            )

        migration_files = sorted(self.migrations_dir.glob("*.sql"))
        if not migration_files:
            raise AgentOrchestrationError(
                f"No ClickHouse migration files found in {self.migrations_dir}"
            )

        for file in migration_files:
            sql_text = file.read_text(encoding="utf-8")
            for statement in _split_sql_statements(sql_text):
                await self._execute(statement)

    async def fetch_max_sequence_no(self, *, execution_id: UUID, attempt_no: int) -> int:
        transcript_messages = _TRANSCRIPT_MESSAGES.alias("m")
        stmt = (
            select(func.max(transcript_messages.c.sequence_no).label("max_sequence_no"))
            .select_from(transcript_messages)
            .where(
                transcript_messages.c.execution_id == str(execution_id),
                transcript_messages.c.attempt_no == int(attempt_no),
            )
        )
        rows = await self._select_rows(stmt)
        if not rows:
            return 0
        raw_value = rows[0].get("max_sequence_no")
        if raw_value is None:
            return 0
        return int(raw_value)

    async def insert_completion_messages(
        self,
        records: Sequence[AgentTranscriptMessageRecord],
    ) -> None:
        if not records:
            return
        payload_rows = [
            {
                "execution_id": str(record.execution_id),
                "workflow_uri": record.workflow_uri,
                "attempt_no": int(record.attempt_no),
                "sequence_no": int(record.sequence_no),
                "message_role": record.message_role,
                "message_kind": record.message_kind,
                "call_id": record.call_id,
                "message_json": json.dumps(
                    record.message_json,
                    ensure_ascii=False,
                    separators=(",", ":"),
                ),
                "persisted_at": _to_clickhouse_datetime(record.persisted_at),
            }
            for record in records
        ]
        await self._insert_json_each_row("agentic_workflow_completion_messages", payload_rows)

    async def fetch_completion_messages(
        self,
        *,
        execution_id: UUID,
        attempt_no: int | None = None,
    ) -> list[AgentTranscriptMessageRecord]:
        transcript_messages = _TRANSCRIPT_MESSAGES.alias("m")
        conditions: list[Any] = [transcript_messages.c.execution_id == str(execution_id)]
        if attempt_no is not None:
            conditions.append(transcript_messages.c.attempt_no == int(attempt_no))

        stmt = (
            select(
                transcript_messages.c.execution_id,
                transcript_messages.c.workflow_uri,
                transcript_messages.c.attempt_no,
                transcript_messages.c.sequence_no,
                transcript_messages.c.message_role,
                transcript_messages.c.message_kind,
                transcript_messages.c.call_id,
                transcript_messages.c.message_json,
                transcript_messages.c.persisted_at,
            )
            .select_from(transcript_messages)
            .where(*conditions)
            .order_by(
                asc(transcript_messages.c.attempt_no),
                asc(transcript_messages.c.sequence_no),
            )
        )
        rows = await self._select_rows(stmt)
        return [_transcript_row_from_clickhouse(row) for row in rows]

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

    async def _insert_json_each_row(self, table: str, rows: Sequence[dict[str, Any]]) -> None:
        try:
            await self._shared_clickhouse_client().insert_json_rows(table, rows)
        except ClickHouseClientError as exc:
            raise AgentOrchestrationError(
                f"ClickHouse failed to execute ClickHouse statement: {exc}"
            ) from exc

    async def _select_rows(self, query: Any) -> list[dict[str, Any]]:
        try:
            return await self._shared_clickhouse_client().select_rows(query)
        except ClickHouseClientError as exc:
            raise AgentOrchestrationError(
                f"ClickHouse failed to execute ClickHouse query: {exc}"
            ) from exc

    async def _execute(self, statement: str) -> None:
        try:
            await self._shared_clickhouse_client().execute(statement)
        except ClickHouseClientError as exc:
            raise AgentOrchestrationError(
                f"ClickHouse failed to execute ClickHouse statement: {exc}"
            ) from exc


class InMemoryAgentTranscriptRepository:
    """In-memory transcript repository for tests."""

    def __init__(self) -> None:
        self._messages: list[AgentTranscriptMessageRecord] = []
        self.ensure_schema_calls = 0

    async def ensure_schema(self) -> None:
        self.ensure_schema_calls += 1

    async def fetch_max_sequence_no(self, *, execution_id: UUID, attempt_no: int) -> int:
        matching = [
            record.sequence_no
            for record in self._messages
            if record.execution_id == execution_id and record.attempt_no == attempt_no
        ]
        return max(matching, default=0)

    async def insert_completion_messages(
        self,
        records: Sequence[AgentTranscriptMessageRecord],
    ) -> None:
        self._messages.extend(records)

    async def fetch_completion_messages(
        self,
        *,
        execution_id: UUID,
        attempt_no: int | None = None,
    ) -> list[AgentTranscriptMessageRecord]:
        rows = [record for record in self._messages if record.execution_id == execution_id]
        if attempt_no is not None:
            rows = [record for record in rows if record.attempt_no == attempt_no]
        return sorted(rows, key=lambda record: (record.attempt_no, record.sequence_no))


def _transcript_row_from_clickhouse(row: dict[str, Any]) -> AgentTranscriptMessageRecord:
    return AgentTranscriptMessageRecord(
        execution_id=UUID(str(row["execution_id"])),
        workflow_uri=str(row["workflow_uri"]),
        attempt_no=int(row["attempt_no"]),
        sequence_no=int(row["sequence_no"]),
        message_role=str(row["message_role"]),  # type: ignore[arg-type]
        message_kind=_to_optional_string(row.get("message_kind")),
        call_id=_to_optional_string(row.get("call_id")),
        message_json=_load_json_object(row.get("message_json")),
        persisted_at=_parse_clickhouse_datetime(str(row["persisted_at"])),
    )


def _load_json_object(raw_value: Any) -> dict[str, Any]:
    if raw_value is None:
        return {}
    if isinstance(raw_value, dict):
        return dict(raw_value)
    if isinstance(raw_value, str):
        loaded = json.loads(raw_value)
        if isinstance(loaded, dict):
            return loaded
    raise AgentOrchestrationError("expected transcript JSON object payload")


def _to_optional_string(value: Any) -> str | None:
    if value is None:
        return None
    normalized = str(value).strip()
    return normalized or None


def _to_clickhouse_datetime(value: datetime) -> str:
    normalized = _ensure_utc(value)
    return normalized.strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]


def _parse_clickhouse_datetime(value: str) -> datetime:
    raw = value.strip()
    if not raw:
        raise AgentOrchestrationError("missing ClickHouse datetime value")
    normalized = raw.replace(" ", "T")
    if normalized.endswith("Z"):
        normalized = normalized[:-1] + "+00:00"
    elif "+" not in normalized and normalized.count("-") >= 2:
        normalized = f"{normalized}+00:00"
    parsed = datetime.fromisoformat(normalized)
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def _ensure_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def _split_sql_statements(sql_text: str) -> list[str]:
    statements: list[str] = []
    current: list[str] = []
    for line in sql_text.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("--"):
            continue
        current.append(line)
        if stripped.endswith(";"):
            statements.append("\n".join(current).strip().rstrip(";"))
            current = []
    if current:
        statements.append("\n".join(current).strip().rstrip(";"))
    return [statement for statement in statements if statement]
