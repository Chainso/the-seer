#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import random
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import uuid4


EVENT_STEPS: tuple[tuple[str, str, str], ...] = (
    ("order.created", "created", "erp"),
    ("order.approved", "approved", "erp"),
    ("invoice.issued", "invoiced", "billing"),
    ("shipment.dispatched", "shipped", "fulfillment"),
    ("order.completed", "completed", "fulfillment"),
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
            "Generate fake Seer event ingestion payloads with synthetic timestamps "
            "and write them to JSON."
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
        "--tenant",
        default="acme",
        help="Tenant key included in object references (default: %(default)s).",
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


def _build_event(index: int, occurred_at: datetime, tenant: str, rng: random.Random) -> dict[str, object]:
    step_idx = index % len(EVENT_STEPS)
    event_type, status, source = EVENT_STEPS[step_idx]
    order_num = (index // len(EVENT_STEPS)) + 1

    order_id = f"O-{order_num:06d}"
    customer_id = f"C-{(order_num % 5000) + 1:05d}"
    invoice_id = f"INV-{order_num:06d}"
    shipment_id = f"SHP-{order_num:06d}"
    total_amount = round(rng.uniform(8.0, 350.0), 2)
    line_count = rng.randint(1, 6)

    payload: dict[str, object] = {
        "order_id": order_id,
        "customer_id": customer_id,
        "status": status,
        "line_count": line_count,
        "total_amount": total_amount,
        "currency": "USD",
    }

    if event_type == "invoice.issued":
        payload["invoice_id"] = invoice_id
    if event_type == "shipment.dispatched":
        payload["shipment_id"] = shipment_id

    updated_objects: list[dict[str, object]] = [
        {
            "object_type": "Order",
            "object_ref": {"tenant": tenant, "order_id": order_id},
            "object": {
                "object_type": "Order",
                "order_id": order_id,
                "customer_id": customer_id,
                "status": status,
                "total_amount": total_amount,
                "currency": "USD",
                "line_count": line_count,
            },
            "relation_role": "primary",
        }
    ]

    if event_type == "invoice.issued":
        updated_objects.append(
            {
                "object_type": "Invoice",
                "object_ref": {"tenant": tenant, "invoice_id": invoice_id},
                "object": {
                    "object_type": "Invoice",
                    "invoice_id": invoice_id,
                    "order_id": order_id,
                    "status": "issued",
                    "amount": total_amount,
                    "currency": "USD",
                },
                "relation_role": "billing_document",
            }
        )
    if event_type == "shipment.dispatched":
        updated_objects.append(
            {
                "object_type": "Shipment",
                "object_ref": {"tenant": tenant, "shipment_id": shipment_id},
                "object": {
                    "object_type": "Shipment",
                    "shipment_id": shipment_id,
                    "order_id": order_id,
                    "status": "dispatched",
                },
                "relation_role": "fulfillment",
            }
        )

    return {
        "event_id": str(uuid4()),
        "occurred_at": _to_zulu(occurred_at),
        "event_type": event_type,
        "source": source,
        "payload": payload,
        "trace_id": f"trace-{order_id.lower()}",
        "schema_version": "v1",
        "attributes": {
            "tenant": tenant,
            "generator": "scripts/generate_fake_event_data.py",
        },
        "updated_objects": updated_objects,
    }


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
        start_at = (
            _parse_iso_datetime(args.start_at)
            if args.start_at
            else datetime.now(tz=UTC) - timedelta(hours=24)
        )
    except ValueError as exc:
        print(f"ERROR: invalid --start-at value: {exc}")
        return 1
    rng = random.Random(args.seed)

    events: list[dict[str, object]] = []
    previous: datetime | None = None
    for idx in range(args.count):
        occurred_at = _event_timestamp(
            start_at=start_at,
            index=idx,
            interval_seconds=args.interval_seconds,
            jitter_seconds=args.jitter_seconds,
            rng=rng,
            previous=previous,
        )
        previous = occurred_at
        events.append(_build_event(idx, occurred_at, args.tenant, rng))

    output_payload = {
        "schema": "seer.history.events.v1",
        "generated_at": _to_zulu(datetime.now(tz=UTC)),
        "generator": {
            "count": args.count,
            "start_at": _to_zulu(start_at),
            "interval_seconds": args.interval_seconds,
            "jitter_seconds": args.jitter_seconds,
            "seed": args.seed,
            "tenant": args.tenant,
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
