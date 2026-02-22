from __future__ import annotations

import json
from pathlib import Path

from fastapi.testclient import TestClient

from seer_backend.analytics.rca_repository import InMemoryRootCauseRepository
from seer_backend.analytics.rca_service import RootCauseService
from seer_backend.history.repository import InMemoryHistoryRepository
from seer_backend.history.service import HistoryService
from seer_backend.main import create_app

FIXTURE_PATH = Path(__file__).parent / "fixtures" / "rca_phase4_orders.json"


def build_client() -> TestClient:
    app = create_app()
    history_repo = InMemoryHistoryRepository()
    app.state.history_service = HistoryService(repository=history_repo)
    app.state.root_cause_service = RootCauseService(
        repository=InMemoryRootCauseRepository.from_phase2_history_repository(history_repo),
        max_events_default=20_000,
        max_relations_default=120_000,
        max_traces_per_insight_default=50,
    )
    return TestClient(app)


def seed_fixture_dataset(client: TestClient) -> None:
    payloads = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
    for payload in payloads:
        response = client.post("/api/v1/history/events/ingest", json=payload)
        assert response.status_code == 200, response.text


def test_rca_extraction_lifts_depth_specific_features() -> None:
    client = build_client()
    seed_fixture_dataset(client)

    base_payload = {
        "anchor_object_type": "Order",
        "start_at": "2026-02-22T07:00:00Z",
        "end_at": "2026-02-22T11:00:00Z",
        "outcome": {"event_type": "order.delayed"},
    }

    depth1 = client.post(
        "/api/v1/root-cause/run",
        json={**base_payload, "depth": 1},
    )
    assert depth1.status_code == 200, depth1.text
    depth1_titles = [item["title"] for item in depth1.json()["insights"]]
    assert any("present.d1.Invoice.risk=high" in title for title in depth1_titles)
    assert all("present.d2.Supplier.region=overseas" not in title for title in depth1_titles)

    depth2 = client.post(
        "/api/v1/root-cause/run",
        json={**base_payload, "depth": 2},
    )
    assert depth2.status_code == 200, depth2.text
    depth2_titles = [item["title"] for item in depth2.json()["insights"]]
    assert any("present.d2.Supplier.region=overseas" in title for title in depth2_titles)


def test_rca_ranking_is_stable_for_identical_snapshot() -> None:
    client = build_client()
    seed_fixture_dataset(client)

    payload = {
        "anchor_object_type": "Order",
        "start_at": "2026-02-22T07:00:00Z",
        "end_at": "2026-02-22T11:00:00Z",
        "depth": 2,
        "outcome": {"event_type": "order.delayed"},
    }

    first = client.post("/api/v1/root-cause/run", json=payload)
    second = client.post("/api/v1/root-cause/run", json=payload)

    assert first.status_code == 200, first.text
    assert second.status_code == 200, second.text

    first_insights = [
        (item["title"], item["score"]["wracc"], item["score"]["lift"])
        for item in first.json()["insights"]
    ]
    second_insights = [
        (item["title"], item["score"]["wracc"], item["score"]["lift"])
        for item in second.json()["insights"]
    ]
    assert first_insights == second_insights


def test_rca_evidence_and_ai_assist_endpoints_return_actionable_payloads() -> None:
    client = build_client()
    seed_fixture_dataset(client)

    run = client.post(
        "/api/v1/root-cause/run",
        json={
            "anchor_object_type": "Order",
            "start_at": "2026-02-22T07:00:00Z",
            "end_at": "2026-02-22T11:00:00Z",
            "depth": 2,
            "outcome": {"event_type": "order.delayed"},
            "filters": [{"field": "anchor.order_id", "op": "contains", "value": "O-10"}],
        },
    )
    assert run.status_code == 200, run.text

    insights = run.json()["insights"]
    assert insights

    evidence = client.get(
        "/api/v1/root-cause/evidence",
        params={"handle": insights[0]["evidence_handle"], "limit": 5},
    )
    assert evidence.status_code == 200, evidence.text
    evidence_body = evidence.json()
    assert evidence_body["matched_anchor_count"] >= 1
    assert evidence_body["traces"]

    setup = client.post(
        "/api/v1/root-cause/assist/setup",
        json={
            "anchor_object_type": "Order",
            "start_at": "2026-02-22T07:00:00Z",
            "end_at": "2026-02-22T11:00:00Z",
        },
    )
    assert setup.status_code == 200, setup.text
    setup_body = setup.json()
    assert setup_body["suggestions"]

    interpret = client.post(
        "/api/v1/root-cause/assist/interpret",
        json={
            "baseline_rate": run.json()["baseline_rate"],
            "insights": insights,
        },
    )
    assert interpret.status_code == 200, interpret.text
    assert "Baseline outcome rate" in interpret.json()["summary"]
