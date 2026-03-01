#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import UTC, datetime
from functools import lru_cache
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[1]
SMALL_BUSINESS_ONTOLOGY_PATH = (
    REPO_ROOT
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
    "invoice_mark_overdue_transition": "trans_invoice_mark_overdue",
    "invoice_mark_paid_transition": "trans_invoice_mark_paid",
    "invoice_payment_recorded": "sig_invoice_payment_recorded",
    "low_stock_detected": "sig_low_stock_detected",
    "purchase_order_close_transition": "trans_purchase_order_close",
    "purchase_order_receive_transition": "trans_purchase_order_receive",
    "purchase_order_submit_transition": "trans_purchase_order_submit",
    "register_customer_result": "aout_register_customer",
    "restock_inventory_result": "aout_restock_inventory",
    "sales_order_cancel_transition": "trans_sales_order_cancel",
    "sales_order_fulfill_transition": "trans_sales_order_fulfill",
    "sales_order_mark_paid_transition": "trans_sales_order_mark_paid",
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
    "Invoice Payment Recorded": "invoice_payment_recorded",
    "InvoicePaymentRecorded": "invoice_payment_recorded",
    "Low Stock Detected": "low_stock_detected",
    "LowStockDetected": "low_stock_detected",
    "PurchaseOrderCloseTransition": "purchase_order_close_transition",
    "PurchaseOrderReceiveTransition": "purchase_order_receive_transition",
    "PurchaseOrderSubmitTransition": "purchase_order_submit_transition",
    "Register Customer Result": "register_customer_result",
    "RegisterCustomerResult": "register_customer_result",
    "Restock Inventory Result": "restock_inventory_result",
    "RestockInventoryResult": "restock_inventory_result",
    "SalesOrderCancelTransition": "sales_order_cancel_transition",
    "SalesOrderFulfillTransition": "sales_order_fulfill_transition",
    "SalesOrderMarkPaidTransition": "sales_order_mark_paid_transition",
    "Supplier Lead Time Updated": "supplier_lead_time_updated",
    "SupplierLeadTimeUpdated": "supplier_lead_time_updated",
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
_SCENARIO_BLUEPRINTS: tuple[dict[str, object], ...] = (
    {
        "name": "sales-order-cancel",
        "anchor_object_type_key": "sales_order",
        "outcome_event_type_key": "sales_order_cancel_transition",
        "expected_title_contains": "anchor.state=cancelled",
        "min_wracc": 0.10,
    },
    {
        "name": "invoice-overdue",
        "anchor_object_type_key": "invoice",
        "outcome_event_type_key": "invoice_mark_overdue_transition",
        "expected_title_contains": "anchor.state=overdue",
        "min_wracc": 0.08,
    },
)


@lru_cache(maxsize=1)
def _load_small_business_uri_maps() -> tuple[dict[str, str], dict[str, str]]:
    if not SMALL_BUSINESS_ONTOLOGY_PATH.exists():
        raise ValueError(f"small-business ontology file not found: {SMALL_BUSINESS_ONTOLOGY_PATH}")
    turtle = SMALL_BUSINESS_ONTOLOGY_PATH.read_text(encoding="utf-8")
    prefix_by_alias = {alias: iri for alias, iri in _PREFIX_PATTERN.findall(turtle)}
    concept_kinds_by_alias: dict[str, dict[str, str]] = {}
    for alias, local_name, concept_kind in _CONCEPT_PATTERN.findall(turtle):
        concept_kinds_by_alias.setdefault(alias, {})[local_name] = concept_kind

    required_local_names = set(_EVENT_LOCAL_NAME_BY_KEY.values()) | set(_OBJECT_LOCAL_NAME_BY_KEY.values())
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
        key: _resolve_uri(local_name, {"Signal", "Transition"})
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


def _build_url(api_base_url: str, api_prefix: str, endpoint: str) -> str:
    base = api_base_url.rstrip("/")
    prefix = f"/{api_prefix.strip('/')}" if api_prefix else ""
    return f"{base}{prefix}{endpoint}"


def _decode_json_bytes(body: bytes) -> Any:
    if not body:
        return None
    try:
        return json.loads(body.decode("utf-8"))
    except json.JSONDecodeError:
        return body.decode("utf-8", errors="replace")


def _post_json(url: str, payload: dict[str, Any], timeout_seconds: float) -> tuple[int, Any]:
    data = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    request = urllib.request.Request(
        url=url,
        data=data,
        method="POST",
        headers={"Content-Type": "application/json", "Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout_seconds) as response:
            return response.status, _decode_json_bytes(response.read())
    except urllib.error.HTTPError as exc:
        return exc.code, _decode_json_bytes(exc.read())


def _load_events(path: Path) -> list[dict[str, Any]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(payload, list):
        events = payload
    elif isinstance(payload, dict) and isinstance(payload.get("events"), list):
        events = payload["events"]
    else:
        raise ValueError("input JSON must be a list of events or {'events': [...]}")

    normalized: list[dict[str, Any]] = []
    for idx, event in enumerate(events, start=1):
        if not isinstance(event, dict):
            raise ValueError(f"event #{idx} is not a JSON object")
        normalized.append(event)
    _canonicalize_events_for_uris(normalized)
    return normalized


def _parse_utc(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def _window_for_events(events: list[dict[str, Any]]) -> tuple[str, str]:
    occurred = [event.get("occurred_at") for event in events if isinstance(event.get("occurred_at"), str)]
    if not occurred:
        raise ValueError("no occurred_at timestamps found in input events")

    start = min(_parse_utc(value) for value in occurred)
    end = max(_parse_utc(value) for value in occurred)
    return (
        start.isoformat().replace("+00:00", "Z"),
        end.isoformat().replace("+00:00", "Z"),
    )


@dataclass(frozen=True, slots=True)
class _RcaScenario:
    name: str
    anchor_object_type: str
    outcome_event_type: str
    expected_title_contains: str
    min_wracc: float
    depth: int = 2


def _build_scenarios() -> tuple[_RcaScenario, ...]:
    event_type_uri_by_key, object_type_uri_by_key = _load_small_business_uri_maps()
    scenarios: list[_RcaScenario] = []
    for blueprint in _SCENARIO_BLUEPRINTS:
        anchor_key = str(blueprint["anchor_object_type_key"])
        outcome_key = str(blueprint["outcome_event_type_key"])
        scenarios.append(
            _RcaScenario(
                name=str(blueprint["name"]),
                anchor_object_type=object_type_uri_by_key[anchor_key],
                outcome_event_type=event_type_uri_by_key[outcome_key],
                expected_title_contains=str(blueprint["expected_title_contains"]),
                min_wracc=float(blueprint["min_wracc"]),
            )
        )
    return tuple(scenarios)


def _ingest_events(
    *,
    events: list[dict[str, Any]],
    ingest_url: str,
    timeout_seconds: float,
) -> tuple[int, int, int]:
    ok = 0
    duplicate = 0
    failed = 0

    for event in events:
        status_code, _body = _post_json(ingest_url, event, timeout_seconds)
        if status_code == 200:
            ok += 1
            continue
        if status_code == 409:
            duplicate += 1
            continue
        failed += 1
        event_id = event.get("event_id", "<missing>")
        print(
            f"ingest failure event_id={event_id} status={status_code}",
            file=sys.stderr,
        )
    return ok, duplicate, failed


def _run_scenario(
    *,
    run_url: str,
    scenario: _RcaScenario,
    start_at: str,
    end_at: str,
    timeout_seconds: float,
) -> tuple[bool, str]:
    payload = {
        "anchor_object_type": scenario.anchor_object_type,
        "start_at": start_at,
        "end_at": end_at,
        "depth": scenario.depth,
        "outcome": {
            "event_type": scenario.outcome_event_type,
        },
        "max_insights": 10,
        "min_coverage_ratio": 0.02,
    }
    status_code, body = _post_json(run_url, payload, timeout_seconds)
    if status_code != 200:
        return False, f"{scenario.name}: RCA API returned status={status_code} body={body}"
    if not isinstance(body, dict):
        return False, f"{scenario.name}: RCA API returned non-JSON body={body}"

    insights = body.get("insights")
    if not isinstance(insights, list) or not insights:
        return False, f"{scenario.name}: no insights returned body={body}"

    first = insights[0] if isinstance(insights[0], dict) else {}
    title = str(first.get("title", ""))
    score = first.get("score", {}) if isinstance(first.get("score"), dict) else {}
    wracc = float(score.get("wracc", 0.0))

    if scenario.expected_title_contains not in title:
        return (
            False,
            f"{scenario.name}: top insight title missing '{scenario.expected_title_contains}' title={title}",
        )
    if wracc < scenario.min_wracc:
        return (
            False,
            f"{scenario.name}: top insight WRAcc too low wracc={wracc:.6f} threshold={scenario.min_wracc:.6f}",
        )

    cohort_size = body.get("cohort_size")
    positive_count = body.get("positive_count")
    baseline_rate = body.get("baseline_rate")
    return (
        True,
        (
            f"{scenario.name}: PASS cohort={cohort_size} positives={positive_count} "
            f"baseline={baseline_rate} top_title={title} wracc={wracc:.6f}"
        ),
    )


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Verify backend RCA quality on fake-data.json by running known-good RCA scenarios."
        )
    )
    parser.add_argument(
        "--input",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "fake-data.json",
        help="Path to fake events JSON (default: repo root fake-data.json).",
    )
    parser.add_argument(
        "--api-base-url",
        default="http://localhost:8000",
        help="Seer backend base URL.",
    )
    parser.add_argument(
        "--api-prefix",
        default="/api/v1",
        help="Seer API prefix.",
    )
    parser.add_argument(
        "--timeout-seconds",
        type=float,
        default=30.0,
        help="HTTP timeout per request.",
    )
    parser.add_argument(
        "--ingest",
        action="store_true",
        help="Ingest input events before running RCA checks.",
    )
    return parser.parse_args()


def main() -> int:
    args = _parse_args()
    if not args.input.exists():
        print(f"ERROR: input file not found: {args.input}", file=sys.stderr)
        return 1

    try:
        events = _load_events(args.input)
    except ValueError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    try:
        scenarios = _build_scenarios()
    except ValueError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1

    start_at, end_at = _window_for_events(events)
    print(f"loaded_events={len(events)} start_at={start_at} end_at={end_at}")

    ingest_url = _build_url(args.api_base_url, args.api_prefix, "/history/events/ingest")
    run_url = _build_url(args.api_base_url, args.api_prefix, "/root-cause/run")

    if args.ingest:
        ok, duplicate, failed = _ingest_events(
            events=events,
            ingest_url=ingest_url,
            timeout_seconds=args.timeout_seconds,
        )
        print(f"ingest_summary ok={ok} duplicates={duplicate} failed={failed}")
        if failed > 0:
            return 1

    failures = 0
    for scenario in scenarios:
        passed, summary = _run_scenario(
            run_url=run_url,
            scenario=scenario,
            start_at=start_at,
            end_at=end_at,
            timeout_seconds=args.timeout_seconds,
        )
        print(summary)
        if not passed:
            failures += 1

    if failures:
        print(f"RCA fake-data verification failed scenarios={failures}", file=sys.stderr)
        return 1

    print("RCA fake-data verification passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
