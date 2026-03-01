#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import random
import re
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from functools import lru_cache
from pathlib import Path
from uuid import uuid4


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
SALES_EVENT_KEYS: tuple[str, ...] = (
    "create_sales_order_result",
    "invoice_payment_recorded",
    "invoice_mark_paid_transition",
    "sales_order_mark_paid_transition",
    "sales_order_fulfill_transition",
    "sales_order_cancel_transition",
    "invoice_mark_overdue_transition",
)
OPERATIONS_EVENT_KEYS: tuple[str, ...] = (
    "low_stock_detected",
    "create_purchase_order_result",
    "purchase_order_submit_transition",
    "purchase_order_receive_transition",
    "restock_inventory_result",
    "purchase_order_close_transition",
    "adjust_inventory_result",
)
REFERENCE_EVENT_KEYS: tuple[str, ...] = (
    "register_customer_result",
    "supplier_lead_time_updated",
)
EVENT_LOCAL_NAME_BY_KEY: dict[str, str] = {
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
OBJECT_LOCAL_NAME_BY_KEY: dict[str, str] = {
    "customer": "obj_customer",
    "delivery": "obj_delivery",
    "inventory_item": "obj_inventory_item",
    "invoice": "obj_invoice",
    "purchase_order": "obj_purchase_order",
    "sales_order": "obj_sales_order",
    "supplier": "obj_supplier",
}


@dataclass(slots=True)
class EventDraft:
    event_type: str
    source: str
    payload: dict[str, object]
    updated_objects: list[dict[str, object]]
    trace_id: str
    trace_kind: str


@dataclass(frozen=True, slots=True)
class OntologyIdentifierCatalog:
    event_type_uri_by_key: dict[str, str]
    object_type_uri_by_key: dict[str, str]

    @property
    def sales_event_types(self) -> tuple[str, ...]:
        return tuple(self.event_type_uri_by_key[key] for key in SALES_EVENT_KEYS)

    @property
    def operations_event_types(self) -> tuple[str, ...]:
        return tuple(self.event_type_uri_by_key[key] for key in OPERATIONS_EVENT_KEYS)

    @property
    def reference_event_types(self) -> tuple[str, ...]:
        return tuple(self.event_type_uri_by_key[key] for key in REFERENCE_EVENT_KEYS)


@lru_cache(maxsize=1)
def _load_small_business_identifier_catalog() -> OntologyIdentifierCatalog:
    if not SMALL_BUSINESS_ONTOLOGY_PATH.exists():
        raise ValueError(f"small-business ontology file not found: {SMALL_BUSINESS_ONTOLOGY_PATH}")

    turtle = SMALL_BUSINESS_ONTOLOGY_PATH.read_text(encoding="utf-8")
    prefix_by_alias = {alias: iri for alias, iri in _PREFIX_PATTERN.findall(turtle)}
    concept_kinds_by_alias: dict[str, dict[str, str]] = {}
    for alias, local_name, concept_kind in _CONCEPT_PATTERN.findall(turtle):
        concept_kinds_by_alias.setdefault(alias, {})[local_name] = concept_kind

    required_local_names = set(EVENT_LOCAL_NAME_BY_KEY.values()) | set(OBJECT_LOCAL_NAME_BY_KEY.values())
    candidate_aliases = [
        alias
        for alias, local_names in concept_kinds_by_alias.items()
        if required_local_names.issubset(local_names.keys())
    ]
    if not candidate_aliases:
        raise ValueError(
            "small-business ontology does not contain required local identifiers for fake-data generation"
        )
    if len(candidate_aliases) > 1:
        raise ValueError(
            f"ambiguous ontology alias resolution for fake-data generation: {sorted(candidate_aliases)!r}"
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
        for key, local_name in EVENT_LOCAL_NAME_BY_KEY.items()
    }
    object_type_uri_by_key = {
        key: _resolve_uri(local_name, {"ObjectModel"})
        for key, local_name in OBJECT_LOCAL_NAME_BY_KEY.items()
    }
    return OntologyIdentifierCatalog(
        event_type_uri_by_key=event_type_uri_by_key,
        object_type_uri_by_key=object_type_uri_by_key,
    )


def _to_zulu(value: datetime) -> str:
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


def _parse_iso_datetime(value: str) -> datetime:
    normalized = value.strip()
    if normalized.endswith("Z"):
        normalized = f"{normalized[:-1]}+00:00"
    parsed = datetime.fromisoformat(normalized)
    if parsed.tzinfo is None:
        raise ValueError("timestamp must include timezone (for example, 2026-02-22T10:00:00Z)")
    return parsed.astimezone(UTC)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Generate synthetic Seer event ingestion payloads that align with the "
            "Prophet small-business bakery model."
        )
    )
    parser.add_argument(
        "--output",
        type=Path,
        required=True,
        help="Output JSON file path.",
    )
    parser.add_argument(
        "--count",
        type=int,
        default=250,
        help="Number of events to generate (default: %(default)s).",
    )
    parser.add_argument(
        "--start-at",
        default=None,
        help=(
            "Start timestamp (ISO-8601, timezone required), "
            "default: now-24h in UTC."
        ),
    )
    parser.add_argument(
        "--interval-seconds",
        type=int,
        default=120,
        help="Base spacing between events in seconds (default: %(default)s).",
    )
    parser.add_argument(
        "--jitter-seconds",
        type=int,
        default=30,
        help="Random +/- jitter added to each timestamp (default: %(default)s).",
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=42,
        help="RNG seed for deterministic output (default: %(default)s).",
    )
    parser.add_argument(
        "--id-prefix",
        "--tenant",
        dest="id_prefix",
        default="",
        help=(
            "Optional token inserted into synthetic IDs "
            "(for example, SO-ACME-00001). Not part of event payload semantics."
        ),
    )
    return parser.parse_args()


def _event_timestamp(
    start_at: datetime,
    index: int,
    interval_seconds: int,
    jitter_seconds: int,
    rng: random.Random,
    previous: datetime | None,
) -> datetime:
    jitter = rng.randint(-jitter_seconds, jitter_seconds) if jitter_seconds > 0 else 0
    candidate = start_at + timedelta(seconds=(index * interval_seconds) + jitter)
    if previous is not None and candidate <= previous:
        return previous + timedelta(seconds=1)
    return candidate


def _updated_object(
    object_type: str,
    object_ref: dict[str, object],
    object_payload: dict[str, object],
    relation_role: str,
) -> dict[str, object]:
    return {
        "object_type": object_type,
        "object_ref": object_ref,
        "object": object_payload,
        "relation_role": relation_role,
    }


def _address(seed: int, rng: random.Random) -> dict[str, object]:
    cities = ("Springfield", "Riverton", "Maple Grove", "Lakeview", "Fairfield")
    states = ("CA", "WA", "OR", "CO", "AZ")
    city = rng.choice(cities)
    region = rng.choice(states)
    return {
        "line1": f"{100 + seed} Market St",
        "city": city,
        "region": region,
        "postal_code": f"{90000 + (seed % 999):05d}",
        "country_code": "USA",
    }


def _id(prefix: str, value: int, id_prefix: str) -> str:
    if id_prefix:
        return f"{prefix}-{id_prefix.upper()}-{value:05d}"
    return f"{prefix}-{value:05d}"


class SmallBusinessGenerator:
    def __init__(self, id_prefix: str, rng: random.Random) -> None:
        self.id_prefix = id_prefix
        self.rng = rng
        self.identifiers = _load_small_business_identifier_catalog()
        self.customer_seq = 40
        self.sales_order_seq = 1
        self.invoice_seq = 1
        self.purchase_order_seq = 1
        self.delivery_seq = 1
        self.customers = self._seed_customers()
        self.employees = self._seed_employees()
        self.suppliers = self._seed_suppliers()
        self.products = self._seed_products()
        self.inventory_items = self._seed_inventory_items()

    def _event_type(self, key: str) -> str:
        return self.identifiers.event_type_uri_by_key[key]

    def _object_type(self, key: str) -> str:
        return self.identifiers.object_type_uri_by_key[key]

    def _seed_customers(self) -> list[dict[str, object]]:
        customers: list[dict[str, object]] = []
        for idx in range(1, self.customer_seq + 1):
            customer_id = _id("CUS", idx, self.id_prefix)
            customers.append(
                {
                    "customer_id": customer_id,
                    "full_name": f"Customer {idx:03d}",
                    "email": f"customer{idx:03d}@example.com",
                    "phone": f"+1555{idx:07d}",
                    "billing_address": _address(idx, self.rng),
                    "shipping_address": _address(idx + 500, self.rng),
                    "preferred_currency": "USD",
                    "loyalty_points": self.rng.randint(0, 800),
                    "tags": ["retail", "online"] if idx % 4 == 0 else ["retail"],
                }
            )
        return customers

    def _seed_employees(self) -> list[dict[str, object]]:
        employees: list[dict[str, object]] = []
        roles = ("owner", "shift_lead", "baker", "cashier", "operations")
        for idx in range(1, 8):
            employee_id = _id("EMP", idx, self.id_prefix)
            payload: dict[str, object] = {
                "employee_id": employee_id,
                "full_name": f"Employee {idx:02d}",
                "email": f"employee{idx:02d}@artisan.local",
                "role": roles[(idx - 1) % len(roles)],
                "active": True,
            }
            if idx > 1:
                payload["manager"] = {"employee_id": _id("EMP", 1, self.id_prefix)}
            if idx % 3 == 0:
                payload["phone"] = f"+1444{idx:07d}"
            employees.append(payload)
        return employees

    def _seed_suppliers(self) -> list[dict[str, object]]:
        supplier_names = (
            "Harvest Grain Co",
            "Sunny Dairy Partners",
            "Cocoa Fields United",
            "North Mill Logistics",
            "Maple Sweeteners",
            "Evergreen Produce",
        )
        suppliers: list[dict[str, object]] = []
        for idx, name in enumerate(supplier_names, start=1):
            supplier_id = _id("SUP", idx, self.id_prefix)
            suppliers.append(
                {
                    "supplier_id": supplier_id,
                    "legal_name": name,
                    "primary_contact": {
                        "name": f"Contact {idx}",
                        "email": f"contact{idx}@supplier.example",
                        "phone": f"+1666{idx:07d}",
                    },
                    "payment_terms_days": self.rng.choice((15, 30, 45)),
                    "address": _address(200 + idx, self.rng),
                    "active": True,
                }
            )
        return suppliers

    def _seed_products(self) -> list[dict[str, object]]:
        product_names = (
            ("Flour Blend", "SKU-FLOUR"),
            ("Whole Milk", "SKU-MILK"),
            ("Dark Cocoa", "SKU-COCOA"),
            ("Raw Sugar", "SKU-SUGAR"),
            ("Sea Salt", "SKU-SALT"),
            ("Butter Block", "SKU-BUTTER"),
            ("Vanilla Extract", "SKU-VANILLA"),
            ("Blueberry Mix", "SKU-BERRY"),
            ("Yeast Pack", "SKU-YEAST"),
            ("Olive Oil", "SKU-OIL"),
            ("Cinnamon", "SKU-CINNAMON"),
            ("Baking Powder", "SKU-BAKING"),
        )
        products: list[dict[str, object]] = []
        for idx, (name, sku) in enumerate(product_names, start=1):
            supplier = self.rng.choice(self.suppliers)
            list_price = round(self.rng.uniform(2.5, 35.0), 2)
            cost_price = round(list_price * self.rng.uniform(0.45, 0.75), 2)
            products.append(
                {
                    "product_id": _id("PRD", idx, self.id_prefix),
                    "sku": sku,
                    "name": name,
                    "description": f"{name} ingredient",
                    "supplier": {"supplier_id": supplier["supplier_id"]},
                    "list_price": list_price,
                    "cost_price": cost_price,
                    "active": True,
                    "tags": ["ingredient"],
                }
            )
        return products

    def _seed_inventory_items(self) -> list[dict[str, object]]:
        items: list[dict[str, object]] = []
        for idx, product in enumerate(self.products, start=1):
            reorder_threshold = round(self.rng.uniform(8.0, 22.0), 2)
            quantity_on_hand = round(reorder_threshold + self.rng.uniform(12.0, 45.0), 2)
            reorder_quantity = round(self.rng.uniform(20.0, 80.0), 2)
            items.append(
                {
                    "inventory_item_id": _id("INVITEM", idx, self.id_prefix),
                    "product": {"product_id": product["product_id"]},
                    "quantity_on_hand": quantity_on_hand,
                    "reorder_threshold": reorder_threshold,
                    "reorder_quantity": reorder_quantity,
                    "location_code": f"A-{(idx % 6) + 1}",
                    "last_restocked_at": _to_zulu(
                        datetime.now(tz=UTC) - timedelta(days=self.rng.randint(2, 20))
                    ),
                }
            )
        return items

    def _pick(self, collection: list[dict[str, object]]) -> dict[str, object]:
        return self.rng.choice(collection)

    def _sales_order_lines(self) -> tuple[list[dict[str, object]], float]:
        line_count = self.rng.randint(1, 4)
        products = self.rng.sample(self.products, k=line_count)
        lines: list[dict[str, object]] = []
        subtotal = 0.0
        for product in products:
            quantity = round(self.rng.uniform(1.0, 6.0), 2)
            unit_price = float(product["list_price"])
            subtotal += quantity * unit_price
            lines.append(
                {
                    "product": {"product_id": product["product_id"]},
                    "quantity": quantity,
                    "unit_price": round(unit_price, 2),
                    "note": "auto-generated" if self.rng.random() < 0.3 else None,
                }
            )
            if lines[-1]["note"] is None:
                lines[-1].pop("note")
        return lines, round(subtotal, 2)

    def _purchase_order_lines(
        self, inventory_item: dict[str, object]
    ) -> tuple[list[dict[str, object]], float]:
        base_product_id = inventory_item["product"]["product_id"]
        base_product = next(
            product for product in self.products if product["product_id"] == base_product_id
        )
        lines = [
            {
                "product": {"product_id": base_product["product_id"]},
                "quantity": round(float(inventory_item["reorder_quantity"]), 2),
                "unit_cost": round(float(base_product["cost_price"]), 2),
            }
        ]
        supplier_id = base_product["supplier"]["supplier_id"]
        sibling_products = [
            product
            for product in self.products
            if product["supplier"]["supplier_id"] == supplier_id
            and product["product_id"] != base_product["product_id"]
        ]
        if sibling_products and self.rng.random() < 0.45:
            extra = self.rng.choice(sibling_products)
            lines.append(
                {
                    "product": {"product_id": extra["product_id"]},
                    "quantity": round(self.rng.uniform(5.0, 30.0), 2),
                    "unit_cost": round(float(extra["cost_price"]), 2),
                }
            )
        total = round(sum(float(line["quantity"]) * float(line["unit_cost"]) for line in lines), 2)
        return lines, total

    def _new_customer(self) -> dict[str, object]:
        self.customer_seq += 1
        customer_id = _id("CUS", self.customer_seq, self.id_prefix)
        payload = {
            "customer_id": customer_id,
            "full_name": f"Customer {self.customer_seq:03d}",
            "email": f"customer{self.customer_seq:03d}@example.com",
            "phone": f"+1555{self.customer_seq:07d}",
            "billing_address": _address(self.customer_seq + 1000, self.rng),
            "shipping_address": _address(self.customer_seq + 1500, self.rng),
            "preferred_currency": "USD",
            "loyalty_points": self.rng.randint(0, 200),
            "tags": ["new"],
        }
        self.customers.append(payload)
        return payload

    def _register_customer_event(self) -> EventDraft:
        customer = self._new_customer()
        trace_id = f"trace-customer-{customer['customer_id'].lower()}"
        return EventDraft(
            event_type=self._event_type("register_customer_result"),
            source="prophet.small_business.crm",
            payload={
                "customer": {"customer_id": customer["customer_id"]},
                "welcomeTier": self.rng.choice(("bronze", "silver", "gold")),
            },
            updated_objects=[
                _updated_object(
                    self._object_type("customer"),
                    {"customer_id": customer["customer_id"]},
                    {"object_type": self._object_type("customer"), **customer},
                    "customer",
                )
            ],
            trace_id=trace_id,
            trace_kind="customer_registration",
        )

    def _supplier_lead_time_event(self) -> EventDraft:
        supplier = self._pick(self.suppliers)
        trace_id = f"trace-supplier-{supplier['supplier_id'].lower()}"
        return EventDraft(
            event_type=self._event_type("supplier_lead_time_updated"),
            source="prophet.small_business.procurement",
            payload={
                "supplier": {"supplier_id": supplier["supplier_id"]},
                "lead_time_days": self.rng.randint(1, 14),
            },
            updated_objects=[
                _updated_object(
                    self._object_type("supplier"),
                    {"supplier_id": supplier["supplier_id"]},
                    {"object_type": self._object_type("supplier"), **supplier},
                    "supplier",
                )
            ],
            trace_id=trace_id,
            trace_kind="supplier_update",
        )

    def _adjust_inventory_event(self) -> EventDraft:
        item = self._pick(self.inventory_items)
        delta = round(self.rng.uniform(-3.0, 3.0), 2)
        new_quantity = max(0.0, round(float(item["quantity_on_hand"]) + delta, 2))
        item["quantity_on_hand"] = new_quantity
        trace_id = f"trace-inventory-{item['inventory_item_id'].lower()}"
        return EventDraft(
            event_type=self._event_type("adjust_inventory_result"),
            source="prophet.small_business.inventory",
            payload={
                "inventoryItem": {"inventory_item_id": item["inventory_item_id"]},
                "newQuantity": new_quantity,
            },
            updated_objects=[
                _updated_object(
                    self._object_type("inventory_item"),
                    {"inventory_item_id": item["inventory_item_id"]},
                    {"object_type": self._object_type("inventory_item"), **item},
                    "inventory_item",
                )
            ],
            trace_id=trace_id,
            trace_kind="inventory_adjustment",
        )

    def _sales_trace(self) -> list[EventDraft]:
        customer = self._pick(self.customers)
        employee = self._pick(self.employees)
        lines, subtotal = self._sales_order_lines()
        tax_amount = round(subtotal * 0.0825, 2)
        total_amount = round(subtotal + tax_amount, 2)

        sales_order_id = _id("SO", self.sales_order_seq, self.id_prefix)
        invoice_id = _id("INV", self.invoice_seq, self.id_prefix)
        self.sales_order_seq += 1
        self.invoice_seq += 1
        trace_id = f"trace-sales-{sales_order_id.lower()}"

        sales_order = {
            "object_type": self._object_type("sales_order"),
            "sales_order_id": sales_order_id,
            "customer": {"customer_id": customer["customer_id"]},
            "created_by": {"employee_id": employee["employee_id"]},
            "lines": lines,
            "subtotal": subtotal,
            "tax_amount": tax_amount,
            "total_amount": total_amount,
            "invoice": {"invoice_id": invoice_id},
            "notes": "synthetic order",
            "state": "pending_payment",
        }
        invoice = {
            "object_type": self._object_type("invoice"),
            "invoice_id": invoice_id,
            "sales_order": {"sales_order_id": sales_order_id},
            "issued_at": _to_zulu(datetime.now(tz=UTC)),
            "due_on": (datetime.now(tz=UTC) + timedelta(days=14)).date().isoformat(),
            "subtotal": subtotal,
            "tax_amount": tax_amount,
            "total_due": total_amount,
            "balance_due": total_amount,
            "currency": "USD",
            "state": "issued",
        }

        events: list[EventDraft] = [
            EventDraft(
                event_type=self._event_type("create_sales_order_result"),
                source="prophet.small_business.sales",
                payload={
                    "salesOrder": {"sales_order_id": sales_order_id},
                    "invoice": {"invoice_id": invoice_id},
                    "totalAmount": total_amount,
                },
                updated_objects=[
                    _updated_object(
                        self._object_type("sales_order"),
                        {"sales_order_id": sales_order_id},
                        sales_order,
                        "primary",
                    ),
                    _updated_object(
                        self._object_type("invoice"),
                        {"invoice_id": invoice_id},
                        invoice,
                        "billing_document",
                    ),
                ],
                trace_id=trace_id,
                trace_kind="sales_order",
            )
        ]

        outcome = self.rng.choices(
            ("paid_fulfilled", "cancelled", "overdue"),
            weights=(0.60, 0.22, 0.18),
            k=1,
        )[0]
        now_iso = _to_zulu(datetime.now(tz=UTC))

        if outcome == "cancelled":
            sales_order_cancelled = {**sales_order, "state": "cancelled"}
            events.append(
                EventDraft(
                    event_type=self._event_type("sales_order_cancel_transition"),
                    source="prophet.small_business.sales",
                    payload={
                        "sales_order_id": sales_order_id,
                        "fromState": "pending_payment",
                        "toState": "cancelled",
                        "cancelledAt": now_iso,
                        "reason": self.rng.choice(
                            (
                                "customer requested cancellation",
                                "payment failed",
                                "inventory unavailable",
                            )
                        ),
                    },
                    updated_objects=[
                        _updated_object(
                            self._object_type("sales_order"),
                            {"sales_order_id": sales_order_id},
                            sales_order_cancelled,
                            "primary",
                        )
                    ],
                    trace_id=trace_id,
                    trace_kind="sales_order",
                )
            )
            return events

        if outcome == "overdue":
            invoice_overdue = {**invoice, "state": "overdue"}
            events.append(
                EventDraft(
                    event_type=self._event_type("invoice_mark_overdue_transition"),
                    source="prophet.small_business.billing",
                    payload={
                        "invoice_id": invoice_id,
                        "fromState": "issued",
                        "toState": "overdue",
                        "markedAt": now_iso,
                    },
                    updated_objects=[
                        _updated_object(
                            self._object_type("invoice"),
                            {"invoice_id": invoice_id},
                            invoice_overdue,
                            "billing_document",
                        )
                    ],
                    trace_id=trace_id,
                    trace_kind="sales_order",
                )
            )
            return events

        events.append(
            EventDraft(
                event_type=self._event_type("invoice_payment_recorded"),
                source="prophet.small_business.billing",
                payload={
                    "invoice": {"invoice_id": invoice_id},
                    "amount": total_amount,
                    "method_details": {
                        "method": self.rng.choice(("card", "cash", "bank_transfer")),
                        "provider_reference": f"PAY-{uuid4().hex[:10]}",
                        "note": "synthetic payment",
                    },
                },
                updated_objects=[
                    _updated_object(
                        self._object_type("invoice"),
                        {"invoice_id": invoice_id},
                        invoice,
                        "billing_document",
                    )
                ],
                trace_id=trace_id,
                trace_kind="sales_order",
            )
        )

        invoice_paid = {**invoice, "state": "paid", "balance_due": 0.0}
        events.append(
            EventDraft(
                event_type=self._event_type("invoice_mark_paid_transition"),
                source="prophet.small_business.billing",
                payload={
                    "invoice_id": invoice_id,
                    "fromState": "issued",
                    "toState": "paid",
                    "paidAt": now_iso,
                    "paymentReference": f"PAY-{uuid4().hex[:10]}",
                },
                updated_objects=[
                    _updated_object(
                        self._object_type("invoice"),
                        {"invoice_id": invoice_id},
                        invoice_paid,
                        "billing_document",
                    )
                ],
                trace_id=trace_id,
                trace_kind="sales_order",
            )
        )

        sales_order_paid = {**sales_order, "state": "paid"}
        events.append(
            EventDraft(
                event_type=self._event_type("sales_order_mark_paid_transition"),
                source="prophet.small_business.sales",
                payload={
                    "sales_order_id": sales_order_id,
                    "fromState": "pending_payment",
                    "toState": "paid",
                    "paymentAmount": total_amount,
                    "paidAt": now_iso,
                },
                updated_objects=[
                    _updated_object(
                        self._object_type("sales_order"),
                        {"sales_order_id": sales_order_id},
                        sales_order_paid,
                        "primary",
                    )
                ],
                trace_id=trace_id,
                trace_kind="sales_order",
            )
        )

        shipment_tracking = f"TRK-{uuid4().hex[:12].upper()}"
        delivery_id = _id("DLV", self.delivery_seq, self.id_prefix)
        self.delivery_seq += 1
        delivery = {
            "object_type": self._object_type("delivery"),
            "delivery_id": delivery_id,
            "sales_order": {"sales_order_id": sales_order_id},
            "destination": customer["shipping_address"],
            "carrier": self.rng.choice(("UPS", "FedEx", "DHL", "LocalCourier")),
            "tracking_number": shipment_tracking,
            "scheduled_for": _to_zulu(datetime.now(tz=UTC) + timedelta(hours=6)),
            "status_text": "out_for_delivery",
        }
        sales_order_fulfilled = {**sales_order_paid, "state": "fulfilled"}
        events.append(
            EventDraft(
                event_type=self._event_type("sales_order_fulfill_transition"),
                source="prophet.small_business.fulfillment",
                payload={
                    "sales_order_id": sales_order_id,
                    "fromState": "paid",
                    "toState": "fulfilled",
                    "fulfilledAt": now_iso,
                    "shipmentTracking": shipment_tracking,
                },
                updated_objects=[
                    _updated_object(
                        self._object_type("sales_order"),
                        {"sales_order_id": sales_order_id},
                        sales_order_fulfilled,
                        "primary",
                    ),
                    _updated_object(
                        self._object_type("delivery"),
                        {"delivery_id": delivery_id},
                        delivery,
                        "fulfillment",
                    ),
                ],
                trace_id=trace_id,
                trace_kind="sales_order",
            )
        )
        return events

    def _purchase_trace(self) -> list[EventDraft]:
        item = self._pick(self.inventory_items)
        product_id = item["product"]["product_id"]
        product = next(product for product in self.products if product["product_id"] == product_id)
        supplier_id = product["supplier"]["supplier_id"]
        supplier = next(supplier for supplier in self.suppliers if supplier["supplier_id"] == supplier_id)
        employee = self._pick(self.employees)
        purchase_order_id = _id("PO", self.purchase_order_seq, self.id_prefix)
        self.purchase_order_seq += 1
        trace_id = f"trace-po-{purchase_order_id.lower()}"

        current_quantity = round(
            max(0.0, float(item["reorder_threshold"]) - self.rng.uniform(0.5, 4.0)),
            2,
        )
        item["quantity_on_hand"] = current_quantity
        lines, estimated_total = self._purchase_order_lines(item)
        now_iso = _to_zulu(datetime.now(tz=UTC))
        purchase_order = {
            "object_type": self._object_type("purchase_order"),
            "purchase_order_id": purchase_order_id,
            "supplier": {"supplier_id": supplier["supplier_id"]},
            "requested_by": {"employee_id": employee["employee_id"]},
            "lines": lines,
            "notes": "auto-generated restock",
            "total_cost": estimated_total,
            "state": "draft",
        }

        events: list[EventDraft] = [
            EventDraft(
                event_type=self._event_type("low_stock_detected"),
                source="prophet.small_business.inventory",
                payload={
                    "inventory_item": {"inventory_item_id": item["inventory_item_id"]},
                    "current_quantity": current_quantity,
                    "threshold": float(item["reorder_threshold"]),
                },
                updated_objects=[
                    _updated_object(
                        self._object_type("inventory_item"),
                        {"inventory_item_id": item["inventory_item_id"]},
                        {"object_type": self._object_type("inventory_item"), **item},
                        "inventory_item",
                    )
                ],
                trace_id=trace_id,
                trace_kind="purchase_flow",
            ),
            EventDraft(
                event_type=self._event_type("create_purchase_order_result"),
                source="prophet.small_business.procurement",
                payload={
                    "purchaseOrder": {"purchase_order_id": purchase_order_id},
                    "estimatedTotal": estimated_total,
                },
                updated_objects=[
                    _updated_object(
                        self._object_type("purchase_order"),
                        {"purchase_order_id": purchase_order_id},
                        purchase_order,
                        "primary",
                    )
                ],
                trace_id=trace_id,
                trace_kind="purchase_flow",
            ),
            EventDraft(
                event_type=self._event_type("purchase_order_submit_transition"),
                source="prophet.small_business.procurement",
                payload={
                    "purchase_order_id": purchase_order_id,
                    "fromState": "draft",
                    "toState": "submitted",
                    "submittedAt": now_iso,
                    "buyerNote": "auto submit from low stock trigger",
                },
                updated_objects=[
                    _updated_object(
                        self._object_type("purchase_order"),
                        {"purchase_order_id": purchase_order_id},
                        {
                            **purchase_order,
                            "state": "submitted",
                            "submitted_at": now_iso,
                        },
                        "primary",
                    )
                ],
                trace_id=trace_id,
                trace_kind="purchase_flow",
            ),
            EventDraft(
                event_type=self._event_type("purchase_order_receive_transition"),
                source="prophet.small_business.procurement",
                payload={
                    "purchase_order_id": purchase_order_id,
                    "fromState": "submitted",
                    "toState": "received",
                    "receivedAt": now_iso,
                    "invoiceNumber": _id("BILL", self.purchase_order_seq, self.id_prefix),
                },
                updated_objects=[
                    _updated_object(
                        self._object_type("purchase_order"),
                        {"purchase_order_id": purchase_order_id},
                        {
                            **purchase_order,
                            "state": "received",
                            "submitted_at": now_iso,
                            "received_at": now_iso,
                        },
                        "primary",
                    )
                ],
                trace_id=trace_id,
                trace_kind="purchase_flow",
            ),
        ]

        restocked_quantity = round(current_quantity + float(item["reorder_quantity"]), 2)
        item["quantity_on_hand"] = restocked_quantity
        item["last_restocked_at"] = now_iso
        events.append(
            EventDraft(
                event_type=self._event_type("restock_inventory_result"),
                source="prophet.small_business.inventory",
                payload={
                    "updatedItems": [
                        {"inventory_item_id": item["inventory_item_id"]},
                    ]
                },
                updated_objects=[
                    _updated_object(
                        self._object_type("inventory_item"),
                        {"inventory_item_id": item["inventory_item_id"]},
                        {"object_type": self._object_type("inventory_item"), **item},
                        "restocked_item",
                    )
                ],
                trace_id=trace_id,
                trace_kind="purchase_flow",
            )
        )
        events.append(
            EventDraft(
                event_type=self._event_type("purchase_order_close_transition"),
                source="prophet.small_business.procurement",
                payload={
                    "purchase_order_id": purchase_order_id,
                    "fromState": "received",
                    "toState": "closed",
                    "closedAt": now_iso,
                },
                updated_objects=[
                    _updated_object(
                        self._object_type("purchase_order"),
                        {"purchase_order_id": purchase_order_id},
                        {
                            **purchase_order,
                            "state": "closed",
                            "submitted_at": now_iso,
                            "received_at": now_iso,
                        },
                        "primary",
                    )
                ],
                trace_id=trace_id,
                trace_kind="purchase_flow",
            )
        )
        return events

    def one_off_event(self) -> EventDraft:
        event_key = self.rng.choices(
            REFERENCE_EVENT_KEYS + ("adjust_inventory_result",),
            weights=(0.25, 0.30, 0.45),
            k=1,
        )[0]
        if event_key == "register_customer_result":
            return self._register_customer_event()
        if event_key == "supplier_lead_time_updated":
            return self._supplier_lead_time_event()
        return self._adjust_inventory_event()

    def generate_trace(self, remaining: int) -> list[EventDraft]:
        if remaining <= 1:
            return [self.one_off_event()]
        trace_family = self.rng.choices(
            ("sales", "purchase", "one_off"),
            weights=(0.60, 0.30, 0.10),
            k=1,
        )[0]
        if trace_family == "sales":
            return self._sales_trace()
        if trace_family == "purchase":
            return self._purchase_trace()
        return [self.one_off_event()]


def _materialize_event(
    draft: EventDraft,
    occurred_at: datetime,
) -> dict[str, object]:
    return {
        "event_id": str(uuid4()),
        "occurred_at": _to_zulu(occurred_at),
        "event_type": draft.event_type,
        "source": draft.source,
        "payload": draft.payload,
        "trace_id": draft.trace_id,
        "schema_version": "v1",
        "attributes": {
            "generator": "scripts/generate_fake_event_data.py",
            "trace_kind": draft.trace_kind,
        },
        "updated_objects": draft.updated_objects,
    }


def _build_event_drafts(count: int, id_prefix: str, rng: random.Random) -> list[EventDraft]:
    generator = SmallBusinessGenerator(id_prefix=id_prefix, rng=rng)
    events: list[EventDraft] = []
    while len(events) < count:
        remaining = count - len(events)
        trace = generator.generate_trace(remaining=remaining)
        if len(trace) > remaining:
            trace = trace[:remaining]
        events.extend(trace)
    return events


def _shift_if_future(times: list[datetime], now_utc: datetime) -> tuple[list[datetime], timedelta]:
    if not times:
        return times, timedelta(0)
    latest = times[-1]
    if latest <= now_utc:
        return times, timedelta(0)
    shift = latest - now_utc
    return [ts - shift for ts in times], shift


def main() -> int:
    args = parse_args()
    if args.count <= 0:
        print("ERROR: --count must be greater than zero")
        return 1
    if args.interval_seconds <= 0:
        print("ERROR: --interval-seconds must be greater than zero")
        return 1
    if args.jitter_seconds < 0:
        print("ERROR: --jitter-seconds must be zero or greater")
        return 1

    try:
        now_utc = datetime.now(tz=UTC)
        start_at = _parse_iso_datetime(args.start_at) if args.start_at else now_utc - timedelta(hours=24)
    except ValueError as exc:
        print(f"ERROR: invalid --start-at value: {exc}")
        return 1
    rng = random.Random(args.seed)
    identifier_catalog = _load_small_business_identifier_catalog()

    event_drafts = _build_event_drafts(count=args.count, id_prefix=args.id_prefix, rng=rng)
    occurred_times: list[datetime] = []
    previous: datetime | None = None
    for idx, _draft in enumerate(event_drafts):
        occurred_at = _event_timestamp(
            start_at=start_at,
            index=idx,
            interval_seconds=args.interval_seconds,
            jitter_seconds=args.jitter_seconds,
            rng=rng,
            previous=previous,
        )
        previous = occurred_at
        occurred_times.append(occurred_at)

    occurred_times, shifted_by = _shift_if_future(occurred_times, now_utc)
    if shifted_by > timedelta(0):
        start_at = start_at - shifted_by

    events = [
        _materialize_event(draft=draft, occurred_at=occurred_at)
        for draft, occurred_at in zip(event_drafts, occurred_times, strict=True)
    ]

    output_payload = {
        "schema": "seer.history.events.v1",
        "generated_at": _to_zulu(datetime.now(tz=UTC)),
        "generator": {
            "count": args.count,
            "start_at": _to_zulu(start_at),
            "interval_seconds": args.interval_seconds,
            "jitter_seconds": args.jitter_seconds,
            "seed": args.seed,
            "model": "prophet_example_turtle_small_business",
            "event_families": {
                "sales": list(identifier_catalog.sales_event_types),
                "operations": list(identifier_catalog.operations_event_types),
                "reference": list(identifier_catalog.reference_event_types),
            },
        },
        "events": events,
    }

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output_payload, indent=2), encoding="utf-8")

    print(f"Wrote {len(events)} events to {args.output}")
    print(f"First occurred_at: {events[0]['occurred_at']}")
    print(f"Last occurred_at:  {events[-1]['occurred_at']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
