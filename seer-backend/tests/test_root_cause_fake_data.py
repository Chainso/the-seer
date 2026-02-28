from __future__ import annotations

import json
from collections.abc import Iterator
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from seer_backend.analytics.rca_repository import InMemoryRootCauseRepository
from seer_backend.analytics.rca_service import RootCauseService
from seer_backend.history.repository import InMemoryHistoryRepository
from seer_backend.history.service import HistoryService
from seer_backend.main import create_app

FAKE_DATA_PATH = Path(__file__).resolve().parents[2] / "fake-data.json"


def _parse_utc(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def _load_fake_events() -> tuple[list[dict[str, Any]], str, str]:
    payload = json.loads(FAKE_DATA_PATH.read_text(encoding="utf-8"))
    if isinstance(payload, list):
        events = payload
    elif isinstance(payload, dict) and isinstance(payload.get("events"), list):
        events = payload["events"]
    else:
        raise ValueError("fake data must be a list of events or {'events': [...]}")

    normalized: list[dict[str, Any]] = []
    occurred: list[datetime] = []
    for item in events:
        if not isinstance(item, dict):
            continue
        normalized.append(item)
        occurred_at = item.get("occurred_at")
        if isinstance(occurred_at, str):
            occurred.append(_parse_utc(occurred_at))

    if not normalized or not occurred:
        raise ValueError("fake data does not contain valid events with occurred_at")

    start = min(occurred).isoformat().replace("+00:00", "Z")
    end = max(occurred).isoformat().replace("+00:00", "Z")
    return normalized, start, end


@pytest.fixture(scope="module")
def fake_data_client() -> Iterator[TestClient]:
    app = create_app()
    history_repo = InMemoryHistoryRepository()
    app.state.history_service = HistoryService(repository=history_repo)
    app.state.root_cause_service = RootCauseService(
        repository=InMemoryRootCauseRepository.from_phase2_history_repository(history_repo),
        max_events_default=20_000,
        max_relations_default=200_000,
        max_traces_per_insight_default=50,
    )

    with TestClient(app) as client:
        events, _start, _end = _load_fake_events()
        for payload in events:
            response = client.post("/api/v1/history/events/ingest", json=payload)
            assert response.status_code == 200, response.text
        yield client


def test_fake_data_sales_order_cancel_rca_has_actionable_insights(
    fake_data_client: TestClient,
) -> None:
    _events, start_at, end_at = _load_fake_events()
    response = fake_data_client.post(
        "/api/v1/root-cause/run",
        json={
            "anchor_object_type": "SalesOrder",
            "start_at": start_at,
            "end_at": end_at,
            "depth": 2,
            "outcome": {"event_type": "SalesOrderCancelTransition"},
            "max_insights": 10,
            "min_coverage_ratio": 0.02,
        },
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["cohort_size"] >= 100
    assert body["positive_count"] >= 20
    assert len(body["insights"]) >= 3
    assert "anchor.state=cancelled" in body["insights"][0]["title"]
    assert body["insights"][0]["score"]["wracc"] >= 0.1


def test_fake_data_invoice_overdue_rca_surfaces_high_lift_signal(
    fake_data_client: TestClient,
) -> None:
    _events, start_at, end_at = _load_fake_events()
    response = fake_data_client.post(
        "/api/v1/root-cause/run",
        json={
            "anchor_object_type": "Invoice",
            "start_at": start_at,
            "end_at": end_at,
            "depth": 2,
            "outcome": {"event_type": "InvoiceMarkOverdueTransition"},
            "max_insights": 10,
            "min_coverage_ratio": 0.02,
        },
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["cohort_size"] >= 100
    assert body["positive_count"] >= 20
    assert len(body["insights"]) >= 3
    assert "anchor.state=overdue" in body["insights"][0]["title"]
    assert body["insights"][0]["score"]["lift"] >= 4.0
