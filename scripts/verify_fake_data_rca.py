#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any


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


SCENARIOS: tuple[_RcaScenario, ...] = (
    _RcaScenario(
        name="sales-order-cancel",
        anchor_object_type="SalesOrder",
        outcome_event_type="SalesOrderCancelTransition",
        expected_title_contains="anchor.state=cancelled",
        min_wracc=0.10,
    ),
    _RcaScenario(
        name="invoice-overdue",
        anchor_object_type="Invoice",
        outcome_event_type="InvoiceMarkOverdueTransition",
        expected_title_contains="anchor.state=overdue",
        min_wracc=0.08,
    ),
)


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
        "outcome": {"event_type": scenario.outcome_event_type},
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
    for scenario in SCENARIOS:
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
