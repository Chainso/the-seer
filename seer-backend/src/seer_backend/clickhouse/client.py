"""Shared async ClickHouse client wrapper built on SQLAlchemy ``clickhousedb``."""

from __future__ import annotations

import asyncio
from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Any

from seer_backend.clickhouse.sqlalchemy import ClickHouseSqlAlchemyCoreClient


@dataclass(slots=True)
class AsyncClickHouseClient:
    host: str
    port: int
    database: str
    user: str
    password: str
    timeout_seconds: float
    connect_timeout_seconds: float | None = None
    send_receive_timeout_seconds: float | None = None
    compression: str | None = None
    query_limit: int | None = None
    _core_client: ClickHouseSqlAlchemyCoreClient = field(init=False, repr=False)

    def __post_init__(self) -> None:
        self._core_client = ClickHouseSqlAlchemyCoreClient(
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

    async def select_rows(self, query: str | Any) -> list[dict[str, Any]]:
        return await asyncio.to_thread(self._core_client.select_rows, query)

    async def execute(
        self,
        statement: str | Any,
    ) -> None:
        await asyncio.to_thread(self._core_client.execute, statement)

    async def insert_json_rows(self, table: str, rows: Sequence[dict[str, Any]]) -> None:
        if not rows:
            return
        await asyncio.to_thread(
            self._core_client.insert_rows,
            table,
            list(rows),
        )

    async def close(self) -> None:
        await asyncio.to_thread(self._core_client.dispose)
