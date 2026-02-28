#!/usr/bin/env python3
from __future__ import annotations

import asyncio
import argparse
import json
import multiprocessing as mp
import os
import sys
import tempfile
import time
from pathlib import Path
from typing import Any

try:
    import httpx
except ModuleNotFoundError:
    httpx = None  # type: ignore[assignment]


def _build_url(api_base_url: str, api_prefix: str, endpoint: str) -> str:
    base = api_base_url.rstrip("/")
    prefix = f"/{api_prefix.strip('/')}" if api_prefix else ""
    return f"{base}{prefix}{endpoint}"


def _decode_json(raw_text: str) -> Any:
    try:
        return json.loads(raw_text)
    except json.JSONDecodeError:
        return raw_text


def _truncate(value: str, limit: int = 500) -> str:
    if len(value) <= limit:
        return value
    return f"{value[:limit]}...<truncated>"


def _error_response_summary(response: httpx.Response) -> Any:
    try:
        return response.json()
    except Exception:
        return _truncate(response.text)


def _split_ranges(total: int, parts: int) -> list[tuple[int, int]]:
    if parts <= 0:
        return []
    ranges: list[tuple[int, int]] = []
    base = total // parts
    remainder = total % parts
    start = 0
    for idx in range(parts):
        size = base + (1 if idx < remainder else 0)
        end = start + size
        if start < end:
            ranges.append((start, end))
        start = end
    return ranges


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
        help=(
            "Optional delay before each request in milliseconds "
            "(default: %(default)s)."
        ),
    )
    parser.add_argument(
        "--workers",
        type=int,
        default=256,
        help=(
            "Number of concurrent ingestion workers "
            "(default: %(default)s, set to 1 for sequential mode)."
        ),
    )
    parser.add_argument(
        "--processes",
        type=int,
        default=1,
        help=(
            "Number of ingestion processes for shard-level parallelism "
            "(default: %(default)s). Approximate total concurrency is "
            "--processes * --workers."
        ),
    )
    parser.add_argument(
        "--max-connections",
        type=int,
        default=None,
        help=(
            "HTTP connection pool max connections "
            "(default: --workers value)."
        ),
    )
    parser.add_argument(
        "--max-keepalive-connections",
        type=int,
        default=None,
        help=(
            "HTTP keep-alive pool size "
            "(default: --workers value)."
        ),
    )
    parser.add_argument(
        "--http2",
        action="store_true",
        help="Enable HTTP/2 if supported by the server.",
    )
    parser.add_argument(
        "--progress-every",
        type=int,
        default=0,
        help=(
            "Optional progress interval in completed requests "
            "(default: disabled)."
        ),
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


def _load_events(path: Path) -> tuple[list[dict[str, Any]], str | None]:
    raw = path.read_text(encoding="utf-8")
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        return [], f"input is not valid JSON: {exc}"
    try:
        return _extract_events(payload), None
    except ValueError as exc:
        return [], str(exc)


async def _ingest_events_async(
    *,
    events: list[dict[str, Any]],
    url: str,
    args: argparse.Namespace,
    log_prefix: str = "",
) -> tuple[int, int, int, int, float]:
    if httpx is None:
        raise RuntimeError(
            "httpx is required for high-throughput ingestion. "
            "Run with seer-backend/.venv/bin/python or install httpx."
        )

    total = len(events)
    max_connections = args.max_connections or args.workers
    max_keepalive_connections = args.max_keepalive_connections or args.workers
    limits = httpx.Limits(
        max_connections=max_connections,
        max_keepalive_connections=max_keepalive_connections,
        keepalive_expiry=30.0,
    )
    timeout = httpx.Timeout(
        connect=args.timeout_seconds,
        read=args.timeout_seconds,
        write=args.timeout_seconds,
        pool=args.timeout_seconds,
    )
    headers = {"Content-Type": "application/json", "Accept": "application/json"}

    start_perf = time.perf_counter()
    counter_lock = asyncio.Lock()
    stop_event = asyncio.Event()
    next_index = 0
    success = 0
    failures = 0

    async def worker(worker_id: int) -> None:
        del worker_id
        nonlocal next_index, success, failures
        while True:
            async with counter_lock:
                if stop_event.is_set() and not args.continue_on_error:
                    return
                if next_index >= total:
                    return
                idx = next_index + 1
                event = events[next_index]
                next_index += 1

            if args.sleep_ms > 0:
                await asyncio.sleep(args.sleep_ms / 1000.0)

            event_id = str(event.get("event_id", "<missing>"))
            body = json.dumps(event, separators=(",", ":")).encode("utf-8")
            try:
                response = await client.post(url, content=body, headers=headers)
            except httpx.RequestError as exc:
                async with counter_lock:
                    failures += 1
                    attempted = success + failures
                    if args.progress_every > 0 and attempted % args.progress_every == 0:
                        elapsed = max(0.001, time.perf_counter() - start_perf)
                        print(
                            f"{log_prefix}progress attempted={attempted}/{total} "
                            f"success={success} failures={failures} "
                            f"rps={attempted / elapsed:.1f}",
                            file=sys.stderr,
                        )
                print(
                    f"{log_prefix}[{idx}/{total}] FAIL {event_id} "
                    f"error=request failed: {exc}",
                    file=sys.stderr,
                )
                if not args.continue_on_error and not stop_event.is_set():
                    stop_event.set()
                    print(
                        f"{log_prefix}Stopping due to failure "
                        "(use --continue-on-error to keep going).",
                        file=sys.stderr,
                    )
                continue

            status_code = response.status_code
            if 200 <= status_code < 300:
                async with counter_lock:
                    success += 1
                    attempted = success + failures
                    if args.progress_every > 0 and attempted % args.progress_every == 0:
                        elapsed = max(0.001, time.perf_counter() - start_perf)
                        print(
                            f"{log_prefix}progress attempted={attempted}/{total} "
                            f"success={success} failures={failures} "
                            f"rps={attempted / elapsed:.1f}",
                            file=sys.stderr,
                        )
                if not args.quiet:
                    print(f"{log_prefix}[{idx}/{total}] OK {event_id} status={status_code}")
                continue

            response_summary = _error_response_summary(response)
            async with counter_lock:
                failures += 1
                attempted = success + failures
                if args.progress_every > 0 and attempted % args.progress_every == 0:
                    elapsed = max(0.001, time.perf_counter() - start_perf)
                    print(
                        f"{log_prefix}progress attempted={attempted}/{total} "
                        f"success={success} failures={failures} "
                        f"rps={attempted / elapsed:.1f}",
                        file=sys.stderr,
                    )
            print(
                f"{log_prefix}[{idx}/{total}] FAIL {event_id} status={status_code} "
                f"response={response_summary}",
                file=sys.stderr,
            )
            if not args.continue_on_error and not stop_event.is_set():
                stop_event.set()
                print(
                    f"{log_prefix}Stopping due to failure "
                    "(use --continue-on-error to keep going).",
                    file=sys.stderr,
                )

    async with httpx.AsyncClient(
        timeout=timeout,
        limits=limits,
        http2=args.http2,
    ) as client:
        tasks = [asyncio.create_task(worker(i + 1)) for i in range(args.workers)]
        await asyncio.gather(*tasks)

    attempted = success + failures
    cancelled = total - attempted
    elapsed = max(0.001, time.perf_counter() - start_perf)
    return success, failures, attempted, cancelled, elapsed


def _process_worker_entry(
    *,
    process_index: int,
    process_count: int,
    events: list[dict[str, Any]],
    start: int,
    end: int,
    url: str,
    args: argparse.Namespace,
    result_path: str,
) -> None:
    shard = events[start:end]
    prefix = f"[p{process_index + 1}/{process_count}] "
    output_path = Path(result_path)
    try:
        success, failures, attempted, cancelled, elapsed = asyncio.run(
            _ingest_events_async(events=shard, url=url, args=args, log_prefix=prefix)
        )
        output_path.write_text(
            json.dumps(
                {
                    "process_index": process_index,
                    "success": success,
                    "failures": failures,
                    "attempted": attempted,
                    "cancelled": cancelled,
                    "elapsed": elapsed,
                    "shard_size": len(shard),
                }
            ),
            encoding="utf-8",
        )
    except Exception as exc:  # pragma: no cover - process boundary
        try:
            output_path.write_text(
                json.dumps(
                    {
                        "process_index": process_index,
                        "error": str(exc),
                        "shard_size": len(shard),
                    }
                ),
                encoding="utf-8",
            )
        except Exception:
            pass


def _ingest_events_multi_process(
    *,
    events: list[dict[str, Any]],
    url: str,
    args: argparse.Namespace,
) -> tuple[int, int, int, int, float, int]:
    start_method = "fork" if "fork" in mp.get_all_start_methods() else mp.get_start_method()
    if start_method is None:
        start_method = mp.get_all_start_methods()[0]
    ctx = mp.get_context(start_method)

    ranges = _split_ranges(len(events), args.processes)
    if not ranges:
        return 0, 0, 0, 0, 0.0, 0

    process_start = time.perf_counter()
    processes: list[mp.Process] = []
    result_paths: dict[int, Path] = {}
    with tempfile.TemporaryDirectory(prefix="ingest_history_events_") as tmp_dir:
        for proc_index, (start, end) in enumerate(ranges):
            result_path = Path(tmp_dir) / f"result_{proc_index:04d}.json"
            result_paths[proc_index] = result_path
            proc = ctx.Process(
                target=_process_worker_entry,
                kwargs={
                    "process_index": proc_index,
                    "process_count": len(ranges),
                    "events": events,
                    "start": start,
                    "end": end,
                    "url": url,
                    "args": args,
                    "result_path": str(result_path),
                },
            )
            proc.start()
            processes.append(proc)

        for proc in processes:
            proc.join()

        results: list[dict[str, Any]] = []
        for proc_index in range(len(ranges)):
            result_path = result_paths[proc_index]
            if not result_path.exists():
                continue
            try:
                result = json.loads(result_path.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                continue
            if isinstance(result, dict):
                results.append(result)

    by_process_idx = {result.get("process_index"): result for result in results}
    process_errors = 0
    errored_processes: set[int] = set()
    success = 0
    failures = 0
    attempted = 0
    cancelled = 0

    for proc_index, (start, end) in enumerate(ranges):
        result = by_process_idx.get(proc_index)
        if result is None:
            process_errors += 1
            errored_processes.add(proc_index)
            cancelled += end - start
            print(
                f"[p{proc_index + 1}/{len(ranges)}] FAIL no result returned from process",
                file=sys.stderr,
            )
            continue
        if "error" in result:
            process_errors += 1
            errored_processes.add(proc_index)
            cancelled += int(result.get("shard_size", 0))
            print(
                f"[p{proc_index + 1}/{len(ranges)}] FAIL process error={result['error']}",
                file=sys.stderr,
            )
            continue
        success += int(result.get("success", 0))
        failures += int(result.get("failures", 0))
        attempted += int(result.get("attempted", 0))
        cancelled += int(result.get("cancelled", 0))

    for proc_index, proc in enumerate(processes):
        if proc.exitcode not in (0, None) and proc_index not in errored_processes:
            process_errors += 1
            print(
                f"[p{proc_index + 1}/{len(ranges)}] FAIL exit_code={proc.exitcode}",
                file=sys.stderr,
            )

    elapsed = max(0.001, time.perf_counter() - process_start)
    return success, failures, attempted, cancelled, elapsed, process_errors


def main() -> int:
    args = parse_args()
    if not args.input.exists():
        print(f"ERROR: Input file not found: {args.input}", file=sys.stderr)
        return 1
    if args.workers <= 0:
        print("ERROR: --workers must be greater than zero", file=sys.stderr)
        return 1
    if args.processes <= 0:
        print("ERROR: --processes must be greater than zero", file=sys.stderr)
        return 1
    if args.max_connections is not None and args.max_connections <= 0:
        print("ERROR: --max-connections must be greater than zero", file=sys.stderr)
        return 1
    if args.max_keepalive_connections is not None and args.max_keepalive_connections <= 0:
        print("ERROR: --max-keepalive-connections must be greater than zero", file=sys.stderr)
        return 1
    if args.progress_every < 0:
        print("ERROR: --progress-every must be zero or greater", file=sys.stderr)
        return 1

    events, load_error = _load_events(args.input)
    if load_error is not None:
        print(f"ERROR: {load_error}", file=sys.stderr)
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
    process_errors = 0
    try:
        if args.processes == 1:
            success, failures, attempted, cancelled, elapsed = asyncio.run(
                _ingest_events_async(events=events, url=url, args=args)
            )
        else:
            success, failures, attempted, cancelled, elapsed, process_errors = _ingest_events_multi_process(
                events=events,
                url=url,
                args=args,
            )
    except RuntimeError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1

    throughput = attempted / elapsed if attempted > 0 else 0.0
    print(
        f"Ingestion finished: success={success}, failures={failures}, attempted={attempted}, "
        f"cancelled={cancelled}, process_errors={process_errors}, "
        f"elapsed_seconds={elapsed:.2f}, req_per_sec={throughput:.1f}"
    )
    return 0 if failures == 0 and process_errors == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
