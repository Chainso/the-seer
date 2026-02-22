from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

from fastapi.testclient import TestClient

from seer_backend.analytics.repository import InMemoryProcessMiningRepository
from seer_backend.analytics.service import OcpnMiningWrapper, ProcessMiningService
from seer_backend.history.repository import InMemoryHistoryRepository
from seer_backend.history.service import HistoryService
from seer_backend.main import create_app


def build_client() -> TestClient:
    app = create_app()
    history_repo = InMemoryHistoryRepository()
    app.state.history_service = HistoryService(repository=history_repo)
    app.state.process_service = ProcessMiningService(
        repository=InMemoryProcessMiningRepository.from_phase2_history_repository(history_repo),
        miner=OcpnMiningWrapper(),
        max_events_default=5_000,
        max_relations_default=40_000,
        max_traces_per_handle_default=100,
    )
    return TestClient(app)


def _seed_phase2_style_dataset(client: TestClient) -> None:
    events = [
        {
            "event_id": str(uuid4()),
            "occurred_at": "2026-02-22T10:00:00Z",
            "event_type": "order.created",
            "source": "erp",
            "trace_id": "trace-order-100",
            "payload": {"order_id": "O-100", "status": "created"},
            "updated_objects": [
                {
                    "object_type": "Order",
                    "object_ref": {"tenant": "acme", "order_id": "O-100"},
                    "object": {"object_type": "Order", "status": "created"},
                    "relation_role": "primary",
                }
            ],
        },
        {
            "event_id": str(uuid4()),
            "occurred_at": "2026-02-22T10:05:00Z",
            "event_type": "invoice.created",
            "source": "billing",
            "trace_id": "trace-order-100",
            "payload": {"invoice_id": "INV-100", "order_id": "O-100"},
            "updated_objects": [
                {
                    "object_type": "Invoice",
                    "object_ref": {"tenant": "acme", "invoice_id": "INV-100"},
                    "object": {"object_type": "Invoice", "status": "created"},
                    "relation_role": "primary",
                },
                {
                    "object_type": "Order",
                    "object_ref": {"tenant": "acme", "order_id": "O-100"},
                    "object": {"object_type": "Order", "status": "invoiced"},
                    "relation_role": "context",
                },
            ],
        },
        {
            "event_id": str(uuid4()),
            "occurred_at": "2026-02-22T10:10:00Z",
            "event_type": "order.approved",
            "source": "erp",
            "trace_id": "trace-order-100",
            "payload": {"order_id": "O-100", "status": "approved"},
            "updated_objects": [
                {
                    "object_type": "Order",
                    "object_ref": {"tenant": "acme", "order_id": "O-100"},
                    "object": {"object_type": "Order", "status": "approved"},
                    "relation_role": "primary",
                },
                {
                    "object_type": "Invoice",
                    "object_ref": {"tenant": "acme", "invoice_id": "INV-100"},
                    "object": {"object_type": "Invoice", "status": "pending"},
                    "relation_role": "context",
                },
            ],
        },
        {
            "event_id": str(uuid4()),
            "occurred_at": "2026-02-22T10:20:00Z",
            "event_type": "invoice.paid",
            "source": "billing",
            "trace_id": "trace-order-100",
            "payload": {"invoice_id": "INV-100", "status": "paid"},
            "updated_objects": [
                {
                    "object_type": "Invoice",
                    "object_ref": {"tenant": "acme", "invoice_id": "INV-100"},
                    "object": {"object_type": "Invoice", "status": "paid"},
                    "relation_role": "primary",
                },
                {
                    "object_type": "Order",
                    "object_ref": {"tenant": "acme", "order_id": "O-100"},
                    "object": {"object_type": "Order", "status": "ready_for_ship"},
                    "relation_role": "context",
                },
            ],
        },
        {
            "event_id": str(uuid4()),
            "occurred_at": "2026-02-22T10:30:00Z",
            "event_type": "shipment.sent",
            "source": "logistics",
            "trace_id": "trace-order-100",
            "payload": {"shipment_id": "S-100", "order_id": "O-100"},
            "updated_objects": [
                {
                    "object_type": "Order",
                    "object_ref": {"tenant": "acme", "order_id": "O-100"},
                    "object": {"object_type": "Order", "status": "shipped"},
                    "relation_role": "primary",
                },
                {
                    "object_type": "Shipment",
                    "object_ref": {"tenant": "acme", "shipment_id": "S-100"},
                    "object": {"object_type": "Shipment", "status": "sent"},
                    "relation_role": "primary",
                },
            ],
        },
    ]

    for payload in events:
        response = client.post("/api/v1/history/events/ingest", json=payload)
        assert response.status_code == 200, response.text


def test_process_mining_returns_ui_payload_and_trace_handles() -> None:
    client = build_client()
    _seed_phase2_style_dataset(client)

    response = client.post(
        "/api/v1/process/mine",
        json={
            "anchor_object_type": "Order",
            "start_at": "2026-02-22T09:00:00Z",
            "end_at": "2026-02-22T11:00:00Z",
        },
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["nodes"]
    assert body["edges"]
    assert body["path_stats"]
    assert "Order" in body["object_types"]
    assert all(edge["trace_handle"] for edge in body["edges"])


def test_process_mining_is_deterministic_for_same_snapshot() -> None:
    client = build_client()
    _seed_phase2_style_dataset(client)

    payload = {
        "anchor_object_type": "Order",
        "start_at": "2026-02-22T09:00:00Z",
        "end_at": "2026-02-22T11:00:00Z",
    }

    first = client.post("/api/v1/process/mine", json=payload)
    second = client.post("/api/v1/process/mine", json=payload)

    assert first.status_code == 200, first.text
    assert second.status_code == 200, second.text

    first_body = first.json()
    second_body = second.json()

    assert first_body["nodes"] == second_body["nodes"]
    assert first_body["edges"] == second_body["edges"]
    assert first_body["object_types"] == second_body["object_types"]
    assert first_body["path_stats"] == second_body["path_stats"]


def test_process_mining_validation_errors_are_actionable() -> None:
    client = build_client()

    window_error = client.post(
        "/api/v1/process/mine",
        json={
            "anchor_object_type": "Order",
            "start_at": "2026-02-22T12:00:00Z",
            "end_at": "2026-02-22T11:00:00Z",
        },
    )

    assert window_error.status_code == 422
    assert "start_at must be earlier than end_at" in window_error.text


def test_process_mining_oversized_scope_returns_guidance() -> None:
    client = build_client()
    _seed_phase2_style_dataset(client)

    response = client.post(
        "/api/v1/process/mine",
        json={
            "anchor_object_type": "Order",
            "start_at": "2026-02-22T09:00:00Z",
            "end_at": "2026-02-22T11:00:00Z",
            "max_events": 1,
        },
    )

    assert response.status_code == 413
    assert "narrow time window" in response.json()["detail"]


def test_trace_drilldown_returns_supporting_traces() -> None:
    client = build_client()
    _seed_phase2_style_dataset(client)

    run = client.post(
        "/api/v1/process/mine",
        json={
            "anchor_object_type": "Order",
            "start_at": "2026-02-22T09:00:00Z",
            "end_at": "2026-02-22T11:00:00Z",
        },
    )
    assert run.status_code == 200, run.text

    handle = run.json()["edges"][0]["trace_handle"]
    drilldown = client.get("/api/v1/process/traces", params={"handle": handle, "limit": 10})

    assert drilldown.status_code == 200, drilldown.text
    payload = drilldown.json()
    assert payload["matched_count"] >= 1
    assert payload["traces"]
    assert payload["traces"][0]["event_ids"]


def test_process_mining_no_data_returns_not_found() -> None:
    client = build_client()

    response = client.post(
        "/api/v1/process/mine",
        json={
            "anchor_object_type": "Order",
            "start_at": datetime(2026, 2, 22, 0, 0, tzinfo=UTC).isoformat(),
            "end_at": datetime(2026, 2, 22, 1, 0, tzinfo=UTC).isoformat(),
        },
    )

    assert response.status_code == 404
    assert "no process-mining data" in response.text
