"""ClickHouse SQLAlchemy Core utilities using the ``clickhousedb`` dialect."""

from __future__ import annotations

from dataclasses import dataclass, field
from re import Pattern
from re import compile as re_compile
from threading import Lock
from typing import Any

from sqlalchemy import create_engine, text
from sqlalchemy.engine import URL, Engine

from seer_backend.clickhouse.errors import (
    ClickHouseCommandExecutionError,
    ClickHouseQueryExecutionError,
)

_IDENTIFIER_PATTERN: Pattern[str] = re_compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
_FORMAT_JSON_LINE_PATTERN: Pattern[str] = re_compile(r"(?im)^\s*FORMAT\s+JSON\s*$")
_FORMAT_JSON_SUFFIX_PATTERN: Pattern[str] = re_compile(r"(?is)\s+FORMAT\s+JSON\s*;?\s*$")


@dataclass(slots=True)
class ClickHouseSqlAlchemyCoreClient:
    """SQLAlchemy Core ClickHouse runtime helper.

    This utility intentionally supports SQLAlchemy Core execution only.
    ClickHouse transaction semantics are not assumed beyond statement grouping.
    """

    host: str
    port: int
    database: str
    user: str
    password: str
    timeout_seconds: float
    _engine: Engine | None = field(default=None, init=False, repr=False)
    _engine_lock: Lock = field(default_factory=Lock, init=False, repr=False)

    def select_rows(self, query: str | Any) -> list[dict[str, Any]]:
        try:
            with self._engine_instance().connect() as connection:
                result = connection.execute(_to_statement(query, strip_format_json=True))
                return [dict(row) for row in result.mappings().all()]
        except Exception as exc:
            raise ClickHouseQueryExecutionError(self._build_error_message("query", exc)) from exc

    def execute(self, statement: str | Any) -> None:
        try:
            with self._engine_instance().begin() as connection:
                connection.execute(_to_statement(statement, strip_format_json=False))
        except Exception as exc:
            raise ClickHouseCommandExecutionError(
                self._build_error_message("command", exc)
            ) from exc

    def insert_rows(self, table: str, rows: list[dict[str, Any]]) -> None:
        if not rows:
            return
        table_identifier = _validated_identifier(table)
        columns = [_validated_identifier(name) for name in rows[0]]
        column_sql = ", ".join(columns)
        value_sql = ", ".join(f":{column}" for column in columns)
        statement = text(f"INSERT INTO {table_identifier} ({column_sql}) VALUES ({value_sql})")
        payload = [{column: row.get(column) for column in columns} for row in rows]

        try:
            with self._engine_instance().begin() as connection:
                connection.execute(statement, payload)
        except Exception as exc:
            raise ClickHouseCommandExecutionError(
                self._build_error_message("command", exc)
            ) from exc

    def dispose(self) -> None:
        with self._engine_lock:
            if self._engine is not None:
                self._engine.dispose()
                self._engine = None

    def _engine_instance(self) -> Engine:
        if self._engine is not None:
            return self._engine

        with self._engine_lock:
            if self._engine is None:
                clickhouse_url = URL.create(
                    "clickhousedb",
                    username=self.user,
                    password=self.password,
                    host=self.host,
                    port=self.port,
                    database=self.database,
                )
                self._engine = create_engine(
                    clickhouse_url,
                    connect_args={
                        "connect_timeout": self.timeout_seconds,
                        "send_receive_timeout": self.timeout_seconds,
                    },
                )
        return self._engine

    def _build_error_message(self, operation: str, exc: Exception) -> str:
        return (
            f"ClickHouse {operation} failed for "
            f"{self.host}:{self.port}/{self.database}: {exc}"
        )


def _validated_identifier(raw: str) -> str:
    if not _IDENTIFIER_PATTERN.fullmatch(raw):
        raise ValueError(f"invalid ClickHouse identifier: {raw}")
    return raw


def _strip_format_json_clause(query: str) -> str:
    without_line = _FORMAT_JSON_LINE_PATTERN.sub("", query).strip()
    return _FORMAT_JSON_SUFFIX_PATTERN.sub("", without_line).strip()


def _to_statement(value: str | Any, *, strip_format_json: bool) -> Any:
    if isinstance(value, str):
        statement = _strip_format_json_clause(value) if strip_format_json else value
        return text(statement)
    return value
