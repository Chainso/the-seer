from __future__ import annotations

import json
import re
from pathlib import Path

from fastapi.testclient import TestClient

from seer_backend.analytics.rca_repository import InMemoryRootCauseRepository
from seer_backend.analytics.rca_service import RootCauseService
from seer_backend.history.repository import InMemoryHistoryRepository
from seer_backend.history.service import HistoryService
from seer_backend.main import create_app

FIXTURE_PATH = Path(__file__).parent / "fixtures" / "rca_phase4_orders.json"
_ORDER_URI = "urn:seer:test:order"
_ORDER_DELAYED_EVENT_URI = "urn:seer:test:order_delayed"


def _to_uri_identifier(value: str) -> str:
    cleaned = value.strip()
    if "://" in cleaned or cleaned.startswith("urn:"):
        return cleaned
    token = re.sub(r"[^a-zA-Z0-9]+", "_", cleaned).strip("_").lower()
    return f"urn:seer:test:{token}" if token else "urn:seer:test:unknown"


def _normalize_event_payload(payload: dict[str, object]) -> dict[str, object]:
    normalized = dict(payload)
    event_type = normalized.get("event_type")
    if isinstance(event_type, str):
        normalized["event_type"] = _to_uri_identifier(event_type)

    updated_objects = normalized.get("updated_objects")
    if not isinstance(updated_objects, list):
        return normalized

    normalized_objects: list[dict[str, object]] = []
    for item in updated_objects:
        if not isinstance(item, dict):
            continue
        updated = dict(item)
        object_type = updated.get("object_type")
        if isinstance(object_type, str):
            uri = _to_uri_identifier(object_type)
            updated["object_type"] = uri
            payload_object = updated.get("object")
            if isinstance(payload_object, dict):
                payload_object_copy = dict(payload_object)
                payload_object_copy["object_type"] = uri
                updated["object"] = payload_object_copy
        normalized_objects.append(updated)
    normalized["updated_objects"] = normalized_objects
    return normalized


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
        response = client.post(
            "/api/v1/history/events/ingest",
            json=_normalize_event_payload(payload),
        )
        assert response.status_code == 200, response.text


def test_rca_extraction_lifts_depth_specific_features() -> None:
    client = build_client()
    seed_fixture_dataset(client)

    base_payload = {
        "anchor_object_type": _ORDER_URI,
        "start_at": "2026-02-22T07:00:00Z",
        "end_at": "2026-02-22T11:00:00Z",
        "outcome": {"event_type": _ORDER_DELAYED_EVENT_URI},
    }

    depth1 = client.post(
        "/api/v1/root-cause/run",
        json={**base_payload, "depth": 1},
    )
    assert depth1.status_code == 200, depth1.text
    depth1_titles = [item["title"] for item in depth1.json()["insights"]]
    assert any("present.d1." in title and "risk=high" in title for title in depth1_titles)
    assert all("region=overseas" not in title for title in depth1_titles)

    depth2 = client.post(
        "/api/v1/root-cause/run",
        json={**base_payload, "depth": 2},
    )
    assert depth2.status_code == 200, depth2.text
    depth2_titles = [item["title"] for item in depth2.json()["insights"]]
    assert any("present.d2." in title and "region=overseas" in title for title in depth2_titles)


def test_rca_ranking_is_stable_for_identical_snapshot() -> None:
    client = build_client()
    seed_fixture_dataset(client)

    payload = {
        "anchor_object_type": _ORDER_URI,
        "start_at": "2026-02-22T07:00:00Z",
        "end_at": "2026-02-22T11:00:00Z",
        "depth": 2,
        "outcome": {"event_type": _ORDER_DELAYED_EVENT_URI},
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
            "anchor_object_type": _ORDER_URI,
            "start_at": "2026-02-22T07:00:00Z",
            "end_at": "2026-02-22T11:00:00Z",
            "depth": 2,
            "outcome": {"event_type": _ORDER_DELAYED_EVENT_URI},
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
            "anchor_object_type": _ORDER_URI,
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


def test_rca_filters_support_numeric_comparison_operators() -> None:
    client = build_client()
    seed_fixture_dataset(client)

    response = client.post(
        "/api/v1/root-cause/run",
        json={
            "anchor_object_type": _ORDER_URI,
            "start_at": "2026-02-22T07:00:00Z",
            "end_at": "2026-02-22T11:00:00Z",
            "depth": 2,
            "outcome": {"event_type": _ORDER_DELAYED_EVENT_URI},
            "filters": [
                {"field": f"event.count.{_ORDER_DELAYED_EVENT_URI}", "op": "gte", "value": "1"},
                {
                    "field": f"object_type.count.{_to_uri_identifier('Invoice')}",
                    "op": "lt",
                    "value": "4+",
                },
            ],
        },
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["cohort_size"] >= 1
    assert body["feature_count"] >= 1


def test_rca_filters_support_temporal_comparison_operators() -> None:
    client = build_client()

    events = [
        {
            "event_id": "f2fdb15f-b4d8-4f23-a618-e27506d73200",
            "occurred_at": "2026-03-01T08:00:00Z",
            "event_type": "order.created",
            "source": "erp",
            "payload": {"order_id": "O-201"},
            "updated_objects": [
                {
                    "object_type": "Order",
                    "object_ref": {"order_id": "O-201"},
                    "object": {
                        "object_type": "Order",
                        "order_id": "O-201",
                        "scheduled_at": "2026-03-05T09:00:00Z",
                        "sla_duration": "PT45M",
                    },
                }
            ],
        },
        {
            "event_id": "c12f3bb1-d31e-4c0e-8ef1-0d6e1da03f63",
            "occurred_at": "2026-03-01T08:10:00Z",
            "event_type": "order.created",
            "source": "erp",
            "payload": {"order_id": "O-202"},
            "updated_objects": [
                {
                    "object_type": "Order",
                    "object_ref": {"order_id": "O-202"},
                    "object": {
                        "object_type": "Order",
                        "order_id": "O-202",
                        "scheduled_at": "2026-03-06T11:30:00Z",
                        "sla_duration": "PT2H30M",
                    },
                }
            ],
        },
        {
            "event_id": "f2dc0241-ef56-4b5d-99f0-d765af4ccf36",
            "occurred_at": "2026-03-01T09:00:00Z",
            "event_type": "order.delayed",
            "source": "erp",
            "payload": {"order_id": "O-202"},
            "updated_objects": [
                {
                    "object_type": "Order",
                    "object_ref": {"order_id": "O-202"},
                    "object": {
                        "object_type": "Order",
                        "order_id": "O-202",
                        "scheduled_at": "2026-03-06T11:30:00Z",
                        "sla_duration": "PT2H30M",
                        "status": "delayed",
                    },
                }
            ],
        },
    ]

    for payload in events:
        ingest = client.post(
            "/api/v1/history/events/ingest",
            json=_normalize_event_payload(payload),
        )
        assert ingest.status_code == 200, ingest.text

    response = client.post(
        "/api/v1/root-cause/run",
        json={
            "anchor_object_type": _ORDER_URI,
            "start_at": "2026-03-01T07:00:00Z",
            "end_at": "2026-03-01T12:00:00Z",
            "depth": 1,
            "outcome": {"event_type": _ORDER_DELAYED_EVENT_URI},
            "filters": [
                {"field": "anchor.scheduled_at", "op": "gt", "value": "2026-03-06T00:00:00Z"},
                {"field": "anchor.sla_duration", "op": "gte", "value": "PT2H"},
            ],
        },
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["cohort_size"] == 1
    assert body["positive_count"] == 1
