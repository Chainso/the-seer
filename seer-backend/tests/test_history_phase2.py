from __future__ import annotations

import re
from datetime import UTC, datetime
from uuid import UUID, uuid4

from fastapi.testclient import TestClient

from seer_backend.history.canonicalization import canonicalize_object_ref, xxhash64_uint64
from seer_backend.history.repository import InMemoryHistoryRepository, _relation_row_from_clickhouse
from seer_backend.history.service import HistoryService
from seer_backend.main import create_app


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
    app.state.history_service = HistoryService(repository=InMemoryHistoryRepository())
    return TestClient(app)


def _ingest_event(client: TestClient, payload: dict[str, object]) -> dict[str, object]:
    response = client.post("/api/v1/history/events/ingest", json=_normalize_event_payload(payload))
    assert response.status_code == 200, response.text
    return response.json()


def test_canonicalization_and_xxhash64_vectors_are_deterministic() -> None:
    canonical = canonicalize_object_ref({"tenant": "acme", "id": "order-1"})
    assert canonical == '{"id":"order-1","tenant":"acme"}'
    assert xxhash64_uint64(canonical) == 10102171535360337240


def test_ingest_supports_composite_object_refs_and_stable_hashes() -> None:
    client = build_client()

    event_one = {
        "event_id": str(uuid4()),
        "occurred_at": "2026-02-22T10:00:00Z",
        "event_type": "order.created",
        "source": "erp",
        "payload": {"order_id": "O-100", "status": "created"},
        "updated_objects": [
            {
                "object_type": "Order",
                "object_ref": {"tenant": "acme", "order_id": "O-100"},
                "object": {"object_type": "Order", "status": "created"},
                "relation_role": "primary",
            }
        ],
    }
    event_two = {
        "event_id": str(uuid4()),
        "occurred_at": "2026-02-22T11:00:00Z",
        "event_type": "order.updated",
        "source": "erp",
        "payload": {"order_id": "O-100", "status": "approved"},
        "updated_objects": [
            {
                "object_type": "Order",
                "object_ref": {"order_id": "O-100", "tenant": "acme"},
                "object": {"object_type": "Order", "status": "approved"},
                "relation_role": "primary",
            }
        ],
    }

    first_ingest = _ingest_event(client, event_one)
    second_ingest = _ingest_event(client, event_two)

    first_linked = first_ingest["linked_objects"][0]
    second_linked = second_ingest["linked_objects"][0]

    assert first_linked["object_ref_canonical"] == second_linked["object_ref_canonical"]
    assert first_linked["object_ref_hash"] == second_linked["object_ref_hash"]

    hash_value = first_linked["object_ref_hash"]
    object_timeline = client.get(
        "/api/v1/history/objects/timeline",
        params={"object_type": _to_uri_identifier("Order"), "object_ref_hash": hash_value},
    )

    assert object_timeline.status_code == 200, object_timeline.text
    timeline_items = object_timeline.json()["items"]
    assert len(timeline_items) == 2
    assert timeline_items[0]["recorded_at"] <= timeline_items[1]["recorded_at"]

    relations = client.get(
        "/api/v1/history/relations",
        params={"object_type": _to_uri_identifier("Order"), "object_ref_hash": hash_value},
    )
    assert relations.status_code == 200, relations.text
    relation_event_ids = {item["event_id"] for item in relations.json()["items"]}
    assert relation_event_ids == {event_one["event_id"], event_two["event_id"]}


def test_ingest_allows_missing_updated_objects() -> None:
    client = build_client()

    event_id = str(uuid4())
    response = _ingest_event(
        client,
        {
            "event_id": event_id,
            "occurred_at": "2026-02-22T12:00:00Z",
            "event_type": "ticket.created",
            "source": "crm",
            "payload": {"ticket": "T-1"},
            "trace_id": "trace-1",
            "attributes": {"priority": "high"},
        },
    )

    assert response["object_snapshot_count"] == 0
    assert response["link_count"] == 0

    relations = client.get("/api/v1/history/relations", params={"event_id": event_id})
    assert relations.status_code == 200
    assert relations.json()["items"] == []


def test_duplicate_event_id_is_rejected_with_conflict() -> None:
    client = build_client()
    event_id = str(uuid4())

    payload = {
        "event_id": event_id,
        "occurred_at": "2026-02-22T13:00:00Z",
        "event_type": _to_uri_identifier("invoice.created"),
        "source": "billing",
        "payload": {"invoice": "INV-1"},
    }

    first = client.post("/api/v1/history/events/ingest", json=_normalize_event_payload(payload))
    second = client.post("/api/v1/history/events/ingest", json=_normalize_event_payload(payload))

    assert first.status_code == 200
    assert second.status_code == 409
    assert "already exists" in second.json()["detail"]

    timeline = client.get(
        "/api/v1/history/events",
        params={
            "start_at": "2026-02-22T00:00:00Z",
            "end_at": "2026-02-23T00:00:00Z",
        },
    )
    assert timeline.status_code == 200
    assert len(timeline.json()["items"]) == 1


def test_event_provenance_round_trips_when_produced_by_execution_is_present() -> None:
    client = build_client()
    event_id = str(uuid4())
    produced_by_execution_id = str(uuid4())

    response = _ingest_event(
        client,
        {
            "event_id": event_id,
            "occurred_at": "2026-02-22T13:15:00Z",
            "event_type": "invoice.follow_up_sent",
            "source": "seer",
            "payload": {"invoice": "INV-7"},
            "produced_by_execution_id": produced_by_execution_id,
            "updated_objects": [
                {
                    "object_type": "Invoice",
                    "object_ref": {"tenant": "acme", "invoice_id": "INV-7"},
                    "object": {"object_type": "Invoice", "status": "follow-up-sent"},
                    "relation_role": "primary",
                }
            ],
        },
    )

    linked_object = response["linked_objects"][0]

    timeline = client.get(
        "/api/v1/history/events",
        params={
            "start_at": "2026-02-22T00:00:00Z",
            "end_at": "2026-02-23T00:00:00Z",
            "event_type": _to_uri_identifier("invoice.follow_up_sent"),
        },
    )
    assert timeline.status_code == 200, timeline.text
    assert timeline.json()["items"][0]["produced_by_execution_id"] == produced_by_execution_id

    object_events = client.get(
        "/api/v1/history/objects/events",
        params={
            "object_type": _to_uri_identifier("Invoice"),
            "object_ref_hash": linked_object["object_ref_hash"],
        },
    )
    assert object_events.status_code == 200, object_events.text
    assert object_events.json()["items"][0]["produced_by_execution_id"] == produced_by_execution_id

    relations = client.get("/api/v1/history/relations", params={"event_id": event_id})
    assert relations.status_code == 200, relations.text
    assert relations.json()["items"][0]["produced_by_execution_id"] == produced_by_execution_id


def test_ingest_rejects_invalid_event_uuid() -> None:
    client = build_client()

    response = client.post(
        "/api/v1/history/events/ingest",
        json={
            "event_id": "not-a-uuid",
            "occurred_at": "2026-02-22T13:30:00Z",
            "event_type": _to_uri_identifier("invoice.created"),
            "source": "billing",
            "payload": {"invoice": "INV-1"},
        },
    )

    assert response.status_code == 422


def test_object_type_mismatch_in_updated_objects_is_rejected() -> None:
    client = build_client()

    response = client.post(
        "/api/v1/history/events/ingest",
        json={
            "event_id": str(uuid4()),
            "occurred_at": "2026-02-22T14:00:00Z",
            "event_type": _to_uri_identifier("order.updated"),
            "source": "erp",
            "payload": {"order": "O-1"},
            "updated_objects": [
                {
                    "object_type": _to_uri_identifier("Order"),
                    "object_ref": {"order_id": "O-1"},
                    "object": {
                        "object_type": _to_uri_identifier("Invoice"),
                        "status": "incorrect-type",
                    },
                }
            ],
        },
    )

    assert response.status_code == 422
    assert "must match" in response.text


def test_event_timeline_uses_occurred_at_ordering() -> None:
    client = build_client()

    older_event_id = str(uuid4())
    newer_event_id = str(uuid4())

    _ingest_event(
        client,
        {
            "event_id": newer_event_id,
            "occurred_at": "2026-02-22T16:00:00Z",
            "event_type": "shipment.created",
            "source": "logistics",
            "payload": {"shipment": "S-2"},
        },
    )
    _ingest_event(
        client,
        {
            "event_id": older_event_id,
            "occurred_at": "2026-02-22T15:00:00Z",
            "event_type": "shipment.created",
            "source": "logistics",
            "payload": {"shipment": "S-1"},
        },
    )

    timeline = client.get(
        "/api/v1/history/events",
        params={
            "start_at": datetime(2026, 2, 22, 0, 0, tzinfo=UTC).isoformat(),
            "end_at": datetime(2026, 2, 23, 0, 0, tzinfo=UTC).isoformat(),
            "event_type": _to_uri_identifier("shipment.created"),
        },
    )

    assert timeline.status_code == 200
    items = timeline.json()["items"]
    assert [item["event_id"] for item in items] == [older_event_id, newer_event_id]


def test_latest_objects_returns_latest_snapshot_per_identity_with_pagination() -> None:
    client = build_client()

    order_created = _ingest_event(
        client,
        {
            "event_id": str(uuid4()),
            "occurred_at": "2026-02-22T10:00:00Z",
            "event_type": "order.created",
            "source": "erp",
            "payload": {"order_id": "O-100", "status": "created"},
            "updated_objects": [
                {
                    "object_type": "Order",
                    "object_ref": {"tenant": "acme", "order_id": "O-100"},
                    "object": {"object_type": "Order", "status": "created", "amount": 40},
                    "relation_role": "primary",
                }
            ],
        },
    )
    _ingest_event(
        client,
        {
            "event_id": str(uuid4()),
            "occurred_at": "2026-02-22T11:00:00Z",
            "event_type": "order.approved",
            "source": "erp",
            "payload": {"order_id": "O-100", "status": "approved"},
            "updated_objects": [
                {
                    "object_type": "Order",
                    "object_ref": {"order_id": "O-100", "tenant": "acme"},
                    "object": {"object_type": "Order", "status": "approved", "amount": 85},
                    "relation_role": "primary",
                }
            ],
        },
    )
    _ingest_event(
        client,
        {
            "event_id": str(uuid4()),
            "occurred_at": "2026-02-22T10:30:00Z",
            "event_type": "order.created",
            "source": "erp",
            "payload": {"order_id": "O-200", "status": "created"},
            "updated_objects": [
                {
                    "object_type": "Order",
                    "object_ref": {"tenant": "acme", "order_id": "O-200"},
                    "object": {"object_type": "Order", "status": "created", "amount": 120},
                    "relation_role": "primary",
                }
            ],
        },
    )
    _ingest_event(
        client,
        {
            "event_id": str(uuid4()),
            "occurred_at": "2026-02-22T09:45:00Z",
            "event_type": "invoice.created",
            "source": "billing",
            "payload": {"invoice_id": "INV-1", "status": "open"},
            "updated_objects": [
                {
                    "object_type": "Invoice",
                    "object_ref": {"tenant": "acme", "invoice_id": "INV-1"},
                    "object": {"object_type": "Invoice", "status": "open", "amount": 120},
                    "relation_role": "primary",
                }
            ],
        },
    )

    latest_page = client.post(
        "/api/v1/history/objects/latest/search",
        json={"page": 0, "size": 2},
    )
    assert latest_page.status_code == 200, latest_page.text
    body = latest_page.json()
    assert body["total"] == 3
    assert body["total_pages"] == 2
    assert len(body["items"]) == 2
    assert body["items"][0]["recorded_at"] >= body["items"][1]["recorded_at"]
    assert body["items"][0]["object_payload"]["status"] == "approved"

    order_hash = order_created["linked_objects"][0]["object_ref_hash"]
    filtered = client.post(
        "/api/v1/history/objects/latest/search",
        json={
            "object_type": _to_uri_identifier("Order"),
            "property_filters": [
                {"key": "status", "op": "eq", "value": "approved"},
                {"key": "amount", "op": "gte", "value": "80"},
            ],
            "page": 0,
            "size": 10,
        },
    )
    assert filtered.status_code == 200, filtered.text
    filtered_body = filtered.json()
    assert filtered_body["total"] == 1
    assert len(filtered_body["items"]) == 1
    assert filtered_body["items"][0]["object_type"] == _to_uri_identifier("Order")
    assert filtered_body["items"][0]["object_ref_hash"] == order_hash
    assert filtered_body["items"][0]["object_payload"]["status"] == "approved"


def test_latest_objects_rejects_invalid_property_filter_value() -> None:
    client = build_client()

    response = client.post(
        "/api/v1/history/objects/latest/search",
        json={
            "property_filters": [
                {"key": "status", "op": "gte", "value": "approved"},
            ]
        },
    )
    assert response.status_code == 422
    assert "comparable value" in response.json()["detail"]


def test_latest_objects_supports_temporal_property_filter_ranges() -> None:
    client = build_client()

    first = _ingest_event(
        client,
        {
            "event_id": str(uuid4()),
            "occurred_at": "2026-02-22T10:00:00Z",
            "event_type": "truck.created",
            "source": "fleet",
            "payload": {"truck_id": "T-100", "state": "active"},
            "updated_objects": [
                {
                    "object_type": "Truck",
                    "object_ref": {"tenant": "acme", "truck_id": "T-100"},
                    "object": {
                        "object_type": "Truck",
                        "state": "active",
                        "next_service_at": "2026-03-01T08:00:00Z",
                        "max_downtime": "P2D",
                    },
                    "relation_role": "primary",
                }
            ],
        },
    )
    _ingest_event(
        client,
        {
            "event_id": str(uuid4()),
            "occurred_at": "2026-02-22T10:05:00Z",
            "event_type": "truck.created",
            "source": "fleet",
            "payload": {"truck_id": "T-200", "state": "active"},
            "updated_objects": [
                {
                    "object_type": "Truck",
                    "object_ref": {"tenant": "acme", "truck_id": "T-200"},
                    "object": {
                        "object_type": "Truck",
                        "state": "active",
                        "next_service_at": "2026-02-24T08:00:00Z",
                        "max_downtime": "PT12H",
                    },
                    "relation_role": "primary",
                }
            ],
        },
    )

    first_hash = first["linked_objects"][0]["object_ref_hash"]

    date_filtered = client.post(
        "/api/v1/history/objects/latest/search",
        json={
            "object_type": _to_uri_identifier("Truck"),
            "property_filters": [
                {"key": "next_service_at", "op": "gt", "value": "2026-02-26T00:00:00Z"},
            ],
            "page": 0,
            "size": 10,
        },
    )
    assert date_filtered.status_code == 200, date_filtered.text
    date_filtered_body = date_filtered.json()
    assert date_filtered_body["total"] == 1
    assert date_filtered_body["items"][0]["object_ref_hash"] == first_hash

    duration_filtered = client.post(
        "/api/v1/history/objects/latest/search",
        json={
            "object_type": _to_uri_identifier("Truck"),
            "property_filters": [
                {"key": "max_downtime", "op": "gte", "value": "P1D"},
            ],
            "page": 0,
            "size": 10,
        },
    )
    assert duration_filtered.status_code == 200, duration_filtered.text
    duration_filtered_body = duration_filtered.json()
    assert duration_filtered_body["total"] == 1
    assert duration_filtered_body["items"][0]["object_ref_hash"] == first_hash


def test_object_events_returns_desc_timeline_with_pagination() -> None:
    client = build_client()
    order_type_uri = "https://example.com/ontology/object/Order"
    order_created_uri = "https://example.com/ontology/event/order.created"
    order_fulfilled_uri = "https://example.com/ontology/event/order.fulfilled"

    first = _ingest_event(
        client,
        {
            "event_id": str(uuid4()),
            "occurred_at": "2026-02-22T10:00:00Z",
            "event_type": order_created_uri,
            "source": "erp",
            "payload": {"order_id": "O-100", "status": "created"},
            "updated_objects": [
                {
                    "object_type": order_type_uri,
                    "object_ref": {"tenant": "acme", "order_id": "O-100"},
                    "object": {"object_type": order_type_uri, "status": "created"},
                    "relation_role": "primary",
                }
            ],
        },
    )
    _ingest_event(
        client,
        {
            "event_id": str(uuid4()),
            "occurred_at": "2026-02-22T11:30:00Z",
            "event_type": order_fulfilled_uri,
            "source": "erp",
            "payload": {"order_id": "O-100", "status": "fulfilled"},
            "updated_objects": [
                {
                    "object_type": order_type_uri,
                    "object_ref": {"order_id": "O-100", "tenant": "acme"},
                    "object": {"object_type": order_type_uri, "status": "fulfilled"},
                    "relation_role": "primary",
                }
            ],
        },
    )

    object_ref_hash = first["linked_objects"][0]["object_ref_hash"]
    object_ref_canonical = first["linked_objects"][0]["object_ref_canonical"]
    events_page = client.get(
        "/api/v1/history/objects/events",
        params={
            "object_type": order_type_uri,
            "object_ref_hash": object_ref_hash,
            "page": 0,
            "size": 1,
        },
    )
    assert events_page.status_code == 200, events_page.text
    body = events_page.json()
    assert body["total"] == 2
    assert body["total_pages"] == 2
    assert len(body["items"]) == 1
    assert body["items"][0]["event_type"] == order_fulfilled_uri

    events_by_canonical = client.get(
        "/api/v1/history/objects/events",
        params={
            "object_type": order_type_uri,
            "object_ref_canonical": object_ref_canonical,
            "page": 0,
            "size": 10,
        },
    )
    assert events_by_canonical.status_code == 200, events_by_canonical.text
    canonical_body = events_by_canonical.json()
    assert canonical_body["total"] == 2

    filtered_events = client.get(
        "/api/v1/history/objects/events",
        params={
            "object_type": order_type_uri,
            "object_ref_canonical": object_ref_canonical,
            "start_at": "2026-02-22T11:00:00Z",
            "end_at": "2026-02-22T12:00:00Z",
            "page": 0,
            "size": 10,
        },
    )
    assert filtered_events.status_code == 200, filtered_events.text
    filtered_body = filtered_events.json()
    assert filtered_body["total"] == 1
    assert filtered_body["items"][0]["event_type"] == order_fulfilled_uri


def test_relation_row_parser_accepts_qualified_join_keys() -> None:
    event_id = uuid4()
    object_history_id = uuid4()
    row = {
        "l.event_id": str(event_id),
        "l.object_history_id": str(object_history_id),
        "l.object_type": "urn:seer:test:order",
        "l.object_ref": '{"order_id":"O-100"}',
        "l.object_ref_canonical": '{"order_id":"O-100"}',
        "l.object_ref_hash": 12345,
        "l.relation_role": "primary",
        "l.linked_at": "2026-02-22T10:00:00Z",
        "e.occurred_at": "2026-02-22T10:00:00Z",
        "e.event_type": "urn:seer:test:order_created",
        "e.source": "erp",
        "o.object_payload": '{"status":"created"}',
        "o.recorded_at": "2026-02-22T10:00:00Z",
    }

    parsed = _relation_row_from_clickhouse(row)

    assert parsed.event_id == UUID(str(event_id))
    assert parsed.object_history_id == UUID(str(object_history_id))
    assert parsed.object_type == "urn:seer:test:order"
    assert parsed.object_ref == {"order_id": "O-100"}
    assert parsed.event_type == "urn:seer:test:order_created"
    assert parsed.source == "erp"
    assert parsed.object_payload == {"status": "created"}
