from __future__ import annotations

import json
import re
from collections.abc import Iterator
from datetime import UTC, datetime
from functools import lru_cache
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from seer_backend.analytics.rca_repository import InMemoryRootCauseRepository
from seer_backend.analytics.rca_service import RootCauseService
from seer_backend.history.repository import InMemoryHistoryRepository
from seer_backend.history.service import HistoryService
from seer_backend.main import create_app

FAKE_DATA_PATH = Path(__file__).resolve().parent / "fixtures" / "root_cause_fake_data_250.json"
SMALL_BUSINESS_ONTOLOGY_PATH = (
    Path(__file__).resolve().parents[2]
    / "prophet"
    / "examples"
    / "turtle"
    / "prophet_example_turtle_small_business"
    / "gen"
    / "turtle"
    / "ontology.ttl"
)
_PREFIX_PATTERN = re.compile(r"^@prefix\s+([A-Za-z_][\w-]*):\s*<([^>]+)>\s*\.$", re.MULTILINE)
_CONCEPT_PATTERN = re.compile(
    r"^([A-Za-z_][\w-]*):([A-Za-z0-9_]+)\s+a\s+prophet:([A-Za-z0-9_]+)\s*;",
    re.MULTILINE,
)
_EVENT_LOCAL_NAME_BY_KEY: dict[str, str] = {
    "adjust_inventory_result": "aout_adjust_inventory",
    "create_purchase_order_result": "aout_create_purchase_order",
    "create_sales_order_result": "aout_create_sales_order",
    "invoice_mark_overdue_transition": "evt_invoice_marked_overdue",
    "invoice_mark_paid_transition": "evt_invoice_marked_paid",
    "invoice_payment_recorded": "sig_invoice_payment_recorded",
    "low_stock_detected": "sig_low_stock_detected",
    "purchase_order_close_transition": "evt_purchase_order_closed",
    "purchase_order_receive_transition": "evt_purchase_order_received",
    "purchase_order_submit_transition": "evt_purchase_order_submitted",
    "register_customer_result": "aout_register_customer",
    "restock_inventory_result": "aout_restock_inventory",
    "sales_order_cancel_transition": "evt_sales_order_cancelled",
    "sales_order_fulfill_transition": "evt_sales_order_fulfilled",
    "sales_order_mark_paid_transition": "evt_sales_order_marked_paid",
    "supplier_lead_time_updated": "sig_supplier_lead_time_updated",
}
_OBJECT_LOCAL_NAME_BY_KEY: dict[str, str] = {
    "customer": "obj_customer",
    "delivery": "obj_delivery",
    "inventory_item": "obj_inventory_item",
    "invoice": "obj_invoice",
    "purchase_order": "obj_purchase_order",
    "sales_order": "obj_sales_order",
    "supplier": "obj_supplier",
}
_EVENT_KEY_BY_LEGACY_IDENTIFIER: dict[str, str] = {
    "Adjust Inventory Result": "adjust_inventory_result",
    "AdjustInventoryResult": "adjust_inventory_result",
    "Create Purchase Order Result": "create_purchase_order_result",
    "CreatePurchaseOrderResult": "create_purchase_order_result",
    "Create Sales Order Result": "create_sales_order_result",
    "CreateSalesOrderResult": "create_sales_order_result",
    "InvoiceMarkOverdueTransition": "invoice_mark_overdue_transition",
    "InvoiceMarkPaidTransition": "invoice_mark_paid_transition",
    "evt_invoice_marked_overdue": "invoice_mark_overdue_transition",
    "evt_invoice_marked_paid": "invoice_mark_paid_transition",
    "Invoice Payment Recorded": "invoice_payment_recorded",
    "InvoicePaymentRecorded": "invoice_payment_recorded",
    "sig_invoice_payment_recorded": "invoice_payment_recorded",
    "Low Stock Detected": "low_stock_detected",
    "LowStockDetected": "low_stock_detected",
    "sig_low_stock_detected": "low_stock_detected",
    "PurchaseOrderCloseTransition": "purchase_order_close_transition",
    "PurchaseOrderReceiveTransition": "purchase_order_receive_transition",
    "PurchaseOrderSubmitTransition": "purchase_order_submit_transition",
    "evt_purchase_order_closed": "purchase_order_close_transition",
    "evt_purchase_order_received": "purchase_order_receive_transition",
    "evt_purchase_order_submitted": "purchase_order_submit_transition",
    "Register Customer Result": "register_customer_result",
    "RegisterCustomerResult": "register_customer_result",
    "aout_register_customer": "register_customer_result",
    "Restock Inventory Result": "restock_inventory_result",
    "RestockInventoryResult": "restock_inventory_result",
    "aout_restock_inventory": "restock_inventory_result",
    "SalesOrderCancelTransition": "sales_order_cancel_transition",
    "SalesOrderFulfillTransition": "sales_order_fulfill_transition",
    "SalesOrderMarkPaidTransition": "sales_order_mark_paid_transition",
    "evt_sales_order_cancelled": "sales_order_cancel_transition",
    "evt_sales_order_fulfilled": "sales_order_fulfill_transition",
    "evt_sales_order_marked_paid": "sales_order_mark_paid_transition",
    "Supplier Lead Time Updated": "supplier_lead_time_updated",
    "SupplierLeadTimeUpdated": "supplier_lead_time_updated",
    "sig_supplier_lead_time_updated": "supplier_lead_time_updated",
    "aout_adjust_inventory": "adjust_inventory_result",
    "aout_create_purchase_order": "create_purchase_order_result",
    "aout_create_sales_order": "create_sales_order_result",
    "trans_invoice_mark_overdue": "invoice_mark_overdue_transition",
    "trans_invoice_mark_paid": "invoice_mark_paid_transition",
    "trans_purchase_order_close": "purchase_order_close_transition",
    "trans_purchase_order_receive": "purchase_order_receive_transition",
    "trans_purchase_order_submit": "purchase_order_submit_transition",
    "trans_sales_order_cancel": "sales_order_cancel_transition",
    "trans_sales_order_fulfill": "sales_order_fulfill_transition",
    "trans_sales_order_mark_paid": "sales_order_mark_paid_transition",
}
_OBJECT_KEY_BY_LEGACY_IDENTIFIER: dict[str, str] = {
    "Customer": "customer",
    "Delivery": "delivery",
    "InventoryItem": "inventory_item",
    "Invoice": "invoice",
    "PurchaseOrder": "purchase_order",
    "SalesOrder": "sales_order",
    "Supplier": "supplier",
}


def _parse_utc(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


@lru_cache(maxsize=1)
def _load_small_business_uri_maps() -> tuple[dict[str, str], dict[str, str]]:
    if not SMALL_BUSINESS_ONTOLOGY_PATH.exists():
        raise ValueError(f"small-business ontology file not found: {SMALL_BUSINESS_ONTOLOGY_PATH}")
    turtle = SMALL_BUSINESS_ONTOLOGY_PATH.read_text(encoding="utf-8")
    prefix_by_alias = {alias: iri for alias, iri in _PREFIX_PATTERN.findall(turtle)}
    concept_kinds_by_alias: dict[str, dict[str, str]] = {}
    for alias, local_name, concept_kind in _CONCEPT_PATTERN.findall(turtle):
        concept_kinds_by_alias.setdefault(alias, {})[local_name] = concept_kind

    required_local_names = set(_EVENT_LOCAL_NAME_BY_KEY.values()) | set(
        _OBJECT_LOCAL_NAME_BY_KEY.values()
    )
    candidate_aliases = [
        alias
        for alias, local_names in concept_kinds_by_alias.items()
        if required_local_names.issubset(local_names.keys())
    ]
    if not candidate_aliases:
        raise ValueError("small-business ontology does not contain required local identifiers")
    if len(candidate_aliases) > 1:
        raise ValueError(
            f"ambiguous ontology alias resolution for URI maps: {sorted(candidate_aliases)!r}"
        )

    local_alias = candidate_aliases[0]
    local_base_uri = prefix_by_alias.get(local_alias)
    if local_base_uri is None:
        raise ValueError(f"missing prefix IRI for ontology alias: {local_alias}")
    concept_kind_by_local_name = concept_kinds_by_alias[local_alias]

    def _resolve_uri(local_name: str, expected_kinds: set[str]) -> str:
        concept_kind = concept_kind_by_local_name.get(local_name)
        if concept_kind is None:
            raise ValueError(
                "required concept local name missing from small-business ontology: "
                f"{local_alias}:{local_name}"
            )
        if concept_kind not in expected_kinds:
            expected = ", ".join(sorted(expected_kinds))
            raise ValueError(
                f"concept {local_alias}:{local_name} has type prophet:{concept_kind}; "
                f"expected one of prophet:{expected}"
            )
        return f"{local_base_uri}{local_name}"

    event_type_uri_by_key = {
        key: _resolve_uri(local_name, {"Event"})
        for key, local_name in _EVENT_LOCAL_NAME_BY_KEY.items()
    }
    object_type_uri_by_key = {
        key: _resolve_uri(local_name, {"ObjectModel"})
        for key, local_name in _OBJECT_LOCAL_NAME_BY_KEY.items()
    }
    return event_type_uri_by_key, object_type_uri_by_key


def _canonicalize_identifier(
    value: object,
    *,
    key_by_legacy_identifier: dict[str, str],
    uri_by_key: dict[str, str],
) -> str | None:
    if not isinstance(value, str):
        return None
    if value in uri_by_key.values():
        return value
    key = key_by_legacy_identifier.get(value)
    if key is None:
        local_name = re.split(r"[#/]", value)[-1]
        key = key_by_legacy_identifier.get(local_name)
    if key is None:
        return value
    return uri_by_key.get(key, value)


def _canonicalize_events_for_uris(events: list[dict[str, Any]]) -> None:
    event_type_uri_by_key, object_type_uri_by_key = _load_small_business_uri_maps()
    for event in events:
        event_type = _canonicalize_identifier(
            event.get("event_type"),
            key_by_legacy_identifier=_EVENT_KEY_BY_LEGACY_IDENTIFIER,
            uri_by_key=event_type_uri_by_key,
        )
        if event_type is not None:
            event["event_type"] = event_type

        updated_objects = event.get("updated_objects")
        if not isinstance(updated_objects, list):
            continue
        for updated_object in updated_objects:
            if not isinstance(updated_object, dict):
                continue
            object_type = _canonicalize_identifier(
                updated_object.get("object_type"),
                key_by_legacy_identifier=_OBJECT_KEY_BY_LEGACY_IDENTIFIER,
                uri_by_key=object_type_uri_by_key,
            )
            if object_type is not None:
                updated_object["object_type"] = object_type
            object_payload = updated_object.get("object")
            if isinstance(object_payload, dict) and object_type is not None:
                object_payload["object_type"] = object_type


@lru_cache(maxsize=1)
def _scenario_identifiers() -> dict[str, str]:
    event_type_uri_by_key, object_type_uri_by_key = _load_small_business_uri_maps()
    return {
        "sales_order_anchor_uri": object_type_uri_by_key["sales_order"],
        "invoice_anchor_uri": object_type_uri_by_key["invoice"],
        "sales_order_cancel_event_uri": event_type_uri_by_key["sales_order_cancel_transition"],
        "invoice_overdue_event_uri": event_type_uri_by_key["invoice_mark_overdue_transition"],
    }


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
    _canonicalize_events_for_uris(normalized)

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
    identifiers = _scenario_identifiers()
    _events, start_at, end_at = _load_fake_events()
    response = fake_data_client.post(
        "/api/v1/root-cause/run",
        json={
            "anchor_object_type": identifiers["sales_order_anchor_uri"],
            "start_at": start_at,
            "end_at": end_at,
            "depth": 2,
            "outcome": {
                "event_type": identifiers["sales_order_cancel_event_uri"],
            },
            "max_insights": 10,
            "min_coverage_ratio": 0.02,
        },
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["cohort_size"] >= 30
    assert body["positive_count"] >= 5
    assert len(body["insights"]) >= 3
    assert "anchor.status=cancelled" in body["insights"][0]["title"]
    assert body["insights"][0]["score"]["wracc"] >= 0.1


def test_fake_data_invoice_overdue_rca_surfaces_high_lift_signal(
    fake_data_client: TestClient,
) -> None:
    identifiers = _scenario_identifiers()
    _events, start_at, end_at = _load_fake_events()
    response = fake_data_client.post(
        "/api/v1/root-cause/run",
        json={
            "anchor_object_type": identifiers["invoice_anchor_uri"],
            "start_at": start_at,
            "end_at": end_at,
            "depth": 2,
            "outcome": {
                "event_type": identifiers["invoice_overdue_event_uri"],
            },
            "max_insights": 10,
            "min_coverage_ratio": 0.02,
        },
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["cohort_size"] >= 30
    assert body["positive_count"] >= 5
    assert len(body["insights"]) >= 3
    assert "anchor.status=overdue" in body["insights"][0]["title"]
    assert body["insights"][0]["score"]["lift"] >= 4.0
