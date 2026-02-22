from __future__ import annotations

from unittest.mock import AsyncMock

from fastapi.testclient import TestClient

import seer_backend.api.health as health_module
from seer_backend.main import create_app


def test_health_returns_ok_when_dependencies_are_reachable(monkeypatch) -> None:
    mock_probe = AsyncMock(side_effect=[True, True])
    monkeypatch.setattr(health_module, "_probe_tcp", mock_probe)

    client = TestClient(create_app())
    response = client.get("/api/v1/health")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["dependencies"]["fuseki"]["reachable"] is True
    assert body["dependencies"]["clickhouse"]["reachable"] is True


def test_health_returns_degraded_when_dependency_is_unreachable(monkeypatch) -> None:
    mock_probe = AsyncMock(side_effect=[True, False])
    monkeypatch.setattr(health_module, "_probe_tcp", mock_probe)

    client = TestClient(create_app())
    response = client.get("/api/v1/health")

    assert response.status_code == 503
    body = response.json()
    assert body["status"] == "degraded"
    assert body["dependencies"]["fuseki"]["reachable"] is True
    assert body["dependencies"]["clickhouse"]["reachable"] is False
