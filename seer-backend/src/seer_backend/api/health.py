"""Health and dependency reachability endpoints."""

from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter, Depends, status
from fastapi.responses import JSONResponse

from seer_backend.config.settings import Settings

router = APIRouter(tags=["health"])


def get_settings() -> Settings:
    return Settings()


async def _probe_tcp(host: str, port: int, timeout_seconds: float) -> bool:
    try:
        reader, writer = await asyncio.wait_for(
            asyncio.open_connection(host=host, port=port),
            timeout=timeout_seconds,
        )
        writer.close()
        await writer.wait_closed()
        del reader
        return True
    except (TimeoutError, OSError):
        return False


@router.get("/health")
async def health(settings: Settings = Depends(get_settings)) -> JSONResponse:
    fuseki_ok, clickhouse_ok = await asyncio.gather(
        _probe_tcp(settings.fuseki_host, settings.fuseki_port, settings.dependency_timeout_seconds),
        _probe_tcp(
            settings.clickhouse_host,
            settings.clickhouse_port,
            settings.dependency_timeout_seconds,
        ),
    )

    dependencies: dict[str, dict[str, Any]] = {
        "fuseki": {
            "host": settings.fuseki_host,
            "port": settings.fuseki_port,
            "reachable": fuseki_ok,
        },
        "clickhouse": {
            "host": settings.clickhouse_host,
            "port": settings.clickhouse_port,
            "reachable": clickhouse_ok,
        },
    }

    is_ok = fuseki_ok and clickhouse_ok
    payload = {
        "status": "ok" if is_ok else "degraded",
        "service": settings.app_name,
        "environment": settings.app_env,
        "dependencies": dependencies,
    }
    code = status.HTTP_200_OK if is_ok else status.HTTP_503_SERVICE_UNAVAILABLE
    return JSONResponse(status_code=code, content=payload)
