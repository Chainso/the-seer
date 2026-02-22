#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path
from typing import Any
from urllib import error, request


def _build_url(api_base_url: str, api_prefix: str, endpoint: str) -> str:
    base = api_base_url.rstrip("/")
    prefix = f"/{api_prefix.strip('/')}" if api_prefix else ""
    return f"{base}{prefix}{endpoint}"


def _decode_json(raw_text: str) -> Any:
    try:
        return json.loads(raw_text)
    except json.JSONDecodeError:
        return raw_text


def _post_json(url: str, payload: dict[str, Any], timeout_seconds: float) -> tuple[int, Any]:
    body = json.dumps(payload).encode("utf-8")
    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    req = request.Request(url, data=body, headers=headers, method="POST")
    try:
        with request.urlopen(req, timeout=timeout_seconds) as response:
            status_code = getattr(response, "status", 200)
            raw_text = response.read().decode("utf-8")
            return status_code, _decode_json(raw_text)
    except error.HTTPError as exc:
        raw_text = exc.read().decode("utf-8", errors="replace")
        return exc.code, _decode_json(raw_text)
    except error.URLError as exc:
        raise RuntimeError(f"request failed: {exc.reason}") from exc


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Ingest events from a JSON file into Seer history event ingestion "
            "(/api/v1/history/events/ingest)."
        )
    )
    parser.add_argument(
        "--input",
        type=Path,
        required=True,
        help="Path to JSON file containing events (list or {'events': [...]})",
    )
    parser.add_argument(
        "--api-base-url",
        default=os.environ.get("SEER_API_BASE_URL", "http://localhost:8000"),
        help="Seer backend base URL (default: %(default)s).",
    )
    parser.add_argument(
        "--api-prefix",
        default=os.environ.get("SEER_API_PREFIX", "/api/v1"),
        help="Seer API prefix (default: %(default)s).",
    )
    parser.add_argument(
        "--timeout-seconds",
        type=float,
        default=30.0,
        help="HTTP timeout in seconds (default: %(default)s).",
    )
    parser.add_argument(
        "--max-events",
        type=int,
        default=None,
        help="Optional max number of events to ingest from file.",
    )
    parser.add_argument(
        "--sleep-ms",
        type=int,
        default=0,
        help="Optional delay between requests in milliseconds (default: %(default)s).",
    )
    parser.add_argument(
        "--continue-on-error",
        action="store_true",
        help="Continue ingesting remaining events even if one request fails.",
    )
    parser.add_argument(
        "--quiet",
        action="store_true",
        help="Suppress per-event success logs and print summary only.",
    )
    return parser.parse_args()


def _extract_events(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, list):
        events = payload
    elif isinstance(payload, dict) and isinstance(payload.get("events"), list):
        events = payload["events"]
    else:
        raise ValueError("JSON must be a list of events or an object with an 'events' array")

    normalized: list[dict[str, Any]] = []
    for idx, item in enumerate(events, start=1):
        if not isinstance(item, dict):
            raise ValueError(f"Event at index {idx} is not a JSON object")
        normalized.append(item)
    return normalized


def main() -> int:
    args = parse_args()
    if not args.input.exists():
        print(f"ERROR: Input file not found: {args.input}", file=sys.stderr)
        return 1

    raw = args.input.read_text(encoding="utf-8")
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        print(f"ERROR: input is not valid JSON: {exc}", file=sys.stderr)
        return 1
    try:
        events = _extract_events(payload)
    except ValueError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    if not events:
        print("No events found in input file.")
        return 0

    if args.max_events is not None:
        if args.max_events <= 0:
            print("ERROR: --max-events must be greater than zero", file=sys.stderr)
            return 1
        events = events[: args.max_events]

    url = _build_url(args.api_base_url, args.api_prefix, "/history/events/ingest")
    success = 0
    failures = 0

    for idx, event in enumerate(events, start=1):
        try:
            status_code, response_json = _post_json(url, event, args.timeout_seconds)
        except RuntimeError as exc:
            failures += 1
            print(
                f"[{idx}/{len(events)}] FAIL {event.get('event_id', '<missing>')} error={exc}",
                file=sys.stderr,
            )
            if not args.continue_on_error:
                print("Stopping due to failure (use --continue-on-error to keep going).", file=sys.stderr)
                break
            continue
        event_id = event.get("event_id", "<missing>")

        if 200 <= status_code < 300:
            success += 1
            if not args.quiet:
                print(f"[{idx}/{len(events)}] OK {event_id} status={status_code}")
        else:
            failures += 1
            print(
                f"[{idx}/{len(events)}] FAIL {event_id} status={status_code} response={response_json}",
                file=sys.stderr,
            )
            if not args.continue_on_error:
                print("Stopping due to failure (use --continue-on-error to keep going).", file=sys.stderr)
                break

        if args.sleep_ms > 0:
            time.sleep(args.sleep_ms / 1000.0)

    print(f"Ingestion finished: success={success}, failures={failures}, attempted={success + failures}")
    return 0 if failures == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
