#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any
from urllib import error, request


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_TURTLE_PATH = (
    REPO_ROOT
    / "prophet"
    / "examples"
    / "turtle"
    / "prophet_example_turtle_small_business"
    / "gen"
    / "turtle"
    / "ontology.ttl"
)


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
            status = getattr(response, "status", 200)
            raw_text = response.read().decode("utf-8")
            return status, _decode_json(raw_text)
    except error.HTTPError as exc:
        raw_text = exc.read().decode("utf-8", errors="replace")
        return exc.code, _decode_json(raw_text)
    except error.URLError as exc:
        raise RuntimeError(f"request failed: {exc.reason}") from exc


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Send the complex Prophet Turtle example to Seer ontology ingestion "
            "(/api/v1/ontology/ingest)."
        )
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
        "--release-id",
        default="artisan-bakery-local-complex",
        help="Release ID for ontology ingest (default: %(default)s).",
    )
    parser.add_argument(
        "--turtle-path",
        type=Path,
        default=DEFAULT_TURTLE_PATH,
        help="Path to Turtle file to ingest (default: complex small_business fixture).",
    )
    parser.add_argument(
        "--timeout-seconds",
        type=float,
        default=30.0,
        help="HTTP timeout in seconds (default: %(default)s).",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    turtle_path = args.turtle_path
    if not turtle_path.exists():
        print(f"ERROR: Turtle file not found: {turtle_path}", file=sys.stderr)
        return 1

    turtle = turtle_path.read_text(encoding="utf-8").strip()
    if not turtle:
        print(f"ERROR: Turtle file is empty: {turtle_path}", file=sys.stderr)
        return 1

    payload = {"release_id": args.release_id, "turtle": turtle}
    url = _build_url(args.api_base_url, args.api_prefix, "/ontology/ingest")
    try:
        status_code, response_json = _post_json(url, payload, args.timeout_seconds)
    except RuntimeError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1

    print(f"POST {url}")
    print(f"Turtle file: {turtle_path}")
    print(f"release_id: {args.release_id}")
    print(f"status_code: {status_code}")
    print(json.dumps(response_json, indent=2, sort_keys=True))

    return 0 if 200 <= status_code < 300 else 1


if __name__ == "__main__":
    raise SystemExit(main())
