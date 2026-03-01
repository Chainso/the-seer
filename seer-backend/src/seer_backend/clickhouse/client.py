"""Shared async ClickHouse client wrapper built on clickhouse-connect."""

from __future__ import annotations

import asyncio
import json
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

import clickhouse_connect
from clickhouse_connect.driver.client import Client

from seer_backend.clickhouse.errors import (
    ClickHouseCommandExecutionError,
    ClickHouseQueryExecutionError,
)


@dataclass(slots=True, frozen=True)
class AsyncClickHouseClient:
    host: str
    port: int
    database: str
    user: str
    password: str
    timeout_seconds: float

    async def select_rows(self, query: str) -> list[dict[str, Any]]:
        return await asyncio.to_thread(self._select_rows_sync, query)

    async def execute(
        self,
        statement: str,
        *,
        data: str | bytes | None = None,
    ) -> None:
        await asyncio.to_thread(self._execute_sync, statement, data)

    async def insert_json_rows(self, table: str, rows: Sequence[dict[str, Any]]) -> None:
        if not rows:
            return
        payload = "\n".join(
            json.dumps(row, ensure_ascii=False, separators=(",", ":")) for row in rows
        )
        await self.execute(
            f"INSERT INTO {table} FORMAT JSONEachRow",
            data=payload.encode("utf-8"),
        )

    def _select_rows_sync(self, query: str) -> list[dict[str, Any]]:
        client = self._build_client()
        try:
            result = client.query(query)
            return [dict(row) for row in result.named_results()]
        except Exception as exc:
            raise ClickHouseQueryExecutionError(self._build_error_message("query", exc)) from exc
        finally:
            client.close()

    def _execute_sync(self, statement: str, data: str | bytes | None) -> None:
        client = self._build_client()
        try:
            client.command(statement, data=data)
        except Exception as exc:
            raise ClickHouseCommandExecutionError(
                self._build_error_message("command", exc)
            ) from exc
        finally:
            client.close()

    def _build_client(self) -> Client:
        return clickhouse_connect.get_client(
            host=self.host,
            port=self.port,
            username=self.user,
            password=self.password,
            database=self.database,
            connect_timeout=self.timeout_seconds,
            send_receive_timeout=self.timeout_seconds,
        )

    def _build_error_message(self, operation: str, exc: Exception) -> str:
        return (
            f"ClickHouse {operation} failed for "
            f"{self.host}:{self.port}/{self.database}: {exc}"
        )
