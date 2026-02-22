from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

from fastapi.testclient import TestClient

from seer_backend.history.canonicalization import canonicalize_object_ref, xxhash64_uint64
from seer_backend.history.repository import InMemoryHistoryRepository
from seer_backend.history.service import HistoryService
from seer_backend.main import create_app


def build_client() -> TestClient:
    app = create_app()
    app.state.history_service = HistoryService(repository=InMemoryHistoryRepository())
    return TestClient(app)


def _ingest_event(client: TestClient, payload: dict[str, object]) -> dict[str, object]:
    response = client.post("/api/v1/history/events/ingest", json=payload)
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
        params={"object_type": "Order", "object_ref_hash": hash_value},
    )

    assert object_timeline.status_code == 200, object_timeline.text
    timeline_items = object_timeline.json()["items"]
    assert len(timeline_items) == 2
    assert timeline_items[0]["recorded_at"] <= timeline_items[1]["recorded_at"]

    relations = client.get(
        "/api/v1/history/relations",
        params={"object_type": "Order", "object_ref_hash": hash_value},
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
        "event_type": "invoice.created",
        "source": "billing",
        "payload": {"invoice": "INV-1"},
    }

    first = client.post("/api/v1/history/events/ingest", json=payload)
    second = client.post("/api/v1/history/events/ingest", json=payload)

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


def test_ingest_rejects_invalid_event_uuid() -> None:
    client = build_client()

    response = client.post(
        "/api/v1/history/events/ingest",
        json={
            "event_id": "not-a-uuid",
            "occurred_at": "2026-02-22T13:30:00Z",
            "event_type": "invoice.created",
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
            "event_type": "order.updated",
            "source": "erp",
            "payload": {"order": "O-1"},
            "updated_objects": [
                {
                    "object_type": "Order",
                    "object_ref": {"order_id": "O-1"},
                    "object": {
                        "object_type": "Invoice",
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
            "event_type": "shipment.created",
        },
    )

    assert timeline.status_code == 200
    items = timeline.json()["items"]
    assert [item["event_id"] for item in items] == [older_event_id, newer_event_id]
