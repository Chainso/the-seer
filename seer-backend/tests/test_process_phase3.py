from __future__ import annotations

import re
from datetime import UTC, datetime
from uuid import uuid4

from fastapi.testclient import TestClient

from seer_backend.analytics import service as process_service_module
from seer_backend.analytics.errors import ProcessMiningDependencyUnavailableError
from seer_backend.analytics.repository import InMemoryProcessMiningRepository
from seer_backend.analytics.service import OcpnMiningWrapper, ProcessMiningService
from seer_backend.history.repository import InMemoryHistoryRepository
from seer_backend.history.service import HistoryService
from seer_backend.main import create_app

_ORDER_URI = "urn:seer:test:order"
_INVOICE_URI = "urn:seer:test:invoice"
_INVOICE_REMINDER_EVENT_URI = "urn:seer:test:invoice_reminded"


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
        {
            "event_id": str(uuid4()),
            "occurred_at": "2026-02-22T10:35:00Z",
            "event_type": "invoice.reminded",
            "source": "billing",
            "trace_id": "trace-order-100",
            "payload": {"invoice_id": "INV-100", "status": "reminded"},
            "updated_objects": [
                {
                    "object_type": "Invoice",
                    "object_ref": {"tenant": "acme", "invoice_id": "INV-100"},
                    "object": {"object_type": "Invoice", "status": "reminded"},
                    "relation_role": "primary",
                }
            ],
        },
    ]

    for payload in events:
        response = client.post(
            "/api/v1/history/events/ingest",
            json=_normalize_event_payload(payload),
        )
        assert response.status_code == 200, response.text


def test_process_mining_returns_ui_payload_and_trace_handles() -> None:
    client = build_client()
    _seed_phase2_style_dataset(client)

    response = client.post(
        "/api/v1/process/mine",
        json={
            "anchor_object_type": _ORDER_URI,
            "start_at": "2026-02-22T09:00:00Z",
            "end_at": "2026-02-22T11:00:00Z",
        },
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["nodes"]
    assert body["edges"]
    assert body["path_stats"]
    assert _ORDER_URI in body["object_types"]
    assert all(edge["trace_handle"] for edge in body["edges"])


def test_process_mining_is_deterministic_for_same_snapshot() -> None:
    client = build_client()
    _seed_phase2_style_dataset(client)

    payload = {
        "anchor_object_type": _ORDER_URI,
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


def test_process_mining_include_object_types_expands_event_scope() -> None:
    client = build_client()
    _seed_phase2_style_dataset(client)

    anchor_only = client.post(
        "/api/v1/process/mine",
        json={
            "anchor_object_type": _ORDER_URI,
            "start_at": "2026-02-22T09:00:00Z",
            "end_at": "2026-02-22T11:00:00Z",
        },
    )
    include_invoice = client.post(
        "/api/v1/process/mine",
        json={
            "anchor_object_type": _ORDER_URI,
            "include_object_types": [_INVOICE_URI],
            "start_at": "2026-02-22T09:00:00Z",
            "end_at": "2026-02-22T11:00:00Z",
        },
    )

    assert anchor_only.status_code == 200, anchor_only.text
    assert include_invoice.status_code == 200, include_invoice.text

    anchor_body = anchor_only.json()
    include_body = include_invoice.json()

    anchor_node_labels = {node["label"] for node in anchor_body["nodes"]}
    include_node_labels = {node["label"] for node in include_body["nodes"]}
    assert _INVOICE_REMINDER_EVENT_URI not in anchor_node_labels
    assert _INVOICE_REMINDER_EVENT_URI in include_node_labels

    anchor_edge_types = {edge["object_type"] for edge in anchor_body["edges"]}
    include_edge_types = {edge["object_type"] for edge in include_body["edges"]}
    assert anchor_edge_types == {_ORDER_URI}
    assert include_edge_types == {_ORDER_URI, _INVOICE_URI}


def test_process_mining_validation_errors_are_actionable() -> None:
    client = build_client()

    window_error = client.post(
        "/api/v1/process/mine",
        json={
            "anchor_object_type": _ORDER_URI,
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
            "anchor_object_type": _ORDER_URI,
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
            "anchor_object_type": _ORDER_URI,
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
            "anchor_object_type": _ORDER_URI,
            "start_at": datetime(2026, 2, 22, 0, 0, tzinfo=UTC).isoformat(),
            "end_at": datetime(2026, 2, 22, 1, 0, tzinfo=UTC).isoformat(),
        },
    )

    assert response.status_code == 404
    assert "no process-mining data" in response.text


def test_ocdfg_mining_returns_ui_payload_and_trace_handles() -> None:
    client = build_client()
    _seed_phase2_style_dataset(client)

    response = client.post(
        "/api/v1/process/ocdfg/mine",
        json={
            "anchor_object_type": _ORDER_URI,
            "start_at": "2026-02-22T09:00:00Z",
            "end_at": "2026-02-22T11:00:00Z",
        },
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["nodes"]
    assert body["edges"]
    assert body["start_activities"]
    assert body["end_activities"]
    assert _ORDER_URI in body["object_types"]
    assert all(node["trace_handle"] for node in body["nodes"])
    assert all(edge["trace_handle"] for edge in body["edges"])
    assert all(item["trace_handle"] for item in body["start_activities"])
    assert all(item["trace_handle"] for item in body["end_activities"])

    edge_handle = body["edges"][0]["trace_handle"]
    drilldown = client.get("/api/v1/process/traces", params={"handle": edge_handle, "limit": 10})
    assert drilldown.status_code == 200, drilldown.text
    drilldown_body = drilldown.json()
    assert drilldown_body["matched_count"] >= 1
    assert drilldown_body["traces"]


def test_ocdfg_mining_is_deterministic_for_same_snapshot() -> None:
    client = build_client()
    _seed_phase2_style_dataset(client)

    payload = {
        "anchor_object_type": _ORDER_URI,
        "start_at": "2026-02-22T09:00:00Z",
        "end_at": "2026-02-22T11:00:00Z",
    }

    first = client.post("/api/v1/process/ocdfg/mine", json=payload)
    second = client.post("/api/v1/process/ocdfg/mine", json=payload)

    assert first.status_code == 200, first.text
    assert second.status_code == 200, second.text

    first_body = first.json()
    second_body = second.json()

    assert first_body["nodes"] == second_body["nodes"]
    assert first_body["edges"] == second_body["edges"]
    assert first_body["start_activities"] == second_body["start_activities"]
    assert first_body["end_activities"] == second_body["end_activities"]
    assert first_body["object_types"] == second_body["object_types"]
    assert first_body["warnings"] == second_body["warnings"]


def test_ocdfg_mining_include_object_types_expands_event_scope() -> None:
    client = build_client()
    _seed_phase2_style_dataset(client)

    anchor_only = client.post(
        "/api/v1/process/ocdfg/mine",
        json={
            "anchor_object_type": _ORDER_URI,
            "start_at": "2026-02-22T09:00:00Z",
            "end_at": "2026-02-22T11:00:00Z",
        },
    )
    include_invoice = client.post(
        "/api/v1/process/ocdfg/mine",
        json={
            "anchor_object_type": _ORDER_URI,
            "include_object_types": [_INVOICE_URI],
            "start_at": "2026-02-22T09:00:00Z",
            "end_at": "2026-02-22T11:00:00Z",
        },
    )

    assert anchor_only.status_code == 200, anchor_only.text
    assert include_invoice.status_code == 200, include_invoice.text

    anchor_body = anchor_only.json()
    include_body = include_invoice.json()

    anchor_activities = {node["activity"] for node in anchor_body["nodes"]}
    include_activities = {node["activity"] for node in include_body["nodes"]}
    assert _INVOICE_REMINDER_EVENT_URI not in anchor_activities
    assert _INVOICE_REMINDER_EVENT_URI in include_activities

    assert set(anchor_body["object_types"]) == {_ORDER_URI}
    assert set(include_body["object_types"]) == {_ORDER_URI, _INVOICE_URI}


def test_ocdfg_mining_validation_errors_are_actionable() -> None:
    client = build_client()

    response = client.post(
        "/api/v1/process/ocdfg/mine",
        json={
            "anchor_object_type": _ORDER_URI,
            "start_at": "2026-02-22T12:00:00Z",
            "end_at": "2026-02-22T11:00:00Z",
        },
    )

    assert response.status_code == 422
    assert "start_at must be earlier than end_at" in response.text


def test_ocdfg_mining_oversized_scope_returns_guidance() -> None:
    client = build_client()
    _seed_phase2_style_dataset(client)

    response = client.post(
        "/api/v1/process/ocdfg/mine",
        json={
            "anchor_object_type": _ORDER_URI,
            "start_at": "2026-02-22T09:00:00Z",
            "end_at": "2026-02-22T11:00:00Z",
            "max_events": 1,
        },
    )

    assert response.status_code == 413
    assert "narrow time window" in response.json()["detail"]


def test_ocdfg_mining_no_data_returns_not_found() -> None:
    client = build_client()

    response = client.post(
        "/api/v1/process/ocdfg/mine",
        json={
            "anchor_object_type": _ORDER_URI,
            "start_at": datetime(2026, 2, 22, 0, 0, tzinfo=UTC).isoformat(),
            "end_at": datetime(2026, 2, 22, 1, 0, tzinfo=UTC).isoformat(),
        },
    )

    assert response.status_code == 404
    assert "no process-mining data" in response.text


def test_ocdfg_returns_503_when_pm4py_runtime_is_unavailable(monkeypatch) -> None:
    client = build_client()
    _seed_phase2_style_dataset(client)

    def _missing_pm4py() -> None:
        raise ProcessMiningDependencyUnavailableError("pm4py is required for OC-DFG mining")

    monkeypatch.setattr(process_service_module, "_load_pm4py_ocdfg_apply", _missing_pm4py)

    response = client.post(
        "/api/v1/process/ocdfg/mine",
        json={
            "anchor_object_type": _ORDER_URI,
            "start_at": "2026-02-22T09:00:00Z",
            "end_at": "2026-02-22T11:00:00Z",
        },
    )

    assert response.status_code == 503
    assert "pm4py is required for OC-DFG mining" in response.text
