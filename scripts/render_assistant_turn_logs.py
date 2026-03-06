#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
from typing import Any


def _as_dict(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    return {}


def _string(value: Any) -> str:
    if isinstance(value, str):
        return value
    return ""


def _compact(value: Any, limit: int = 96) -> str:
    text = " ".join(_string(value).split()).strip()
    if len(text) <= limit:
        return text
    return f"{text[: limit - 3]}..."


def _short_id(value: Any) -> str:
    text = _string(value)
    if len(text) <= 8:
        return text or "-"
    return text[:8]


def _compact_ts(value: Any) -> str:
    text = _string(value).strip()
    if not text:
        return "--:--:--"
    if "T" in text:
        text = text.split("T", 1)[1]
    return text.replace("Z", "")[:12]


def _format_line(record: dict[str, Any]) -> str:
    message = _string(record.get("message"))
    extra = _as_dict(record.get("extra"))
    ts = _compact_ts(record.get("ts"))
    turn = _short_id(extra.get("turn_id"))
    thread = _short_id(extra.get("thread_id"))

    if message == "assistant_turn_started":
        module_context = _string(extra.get("module_context")) or "-"
        route = _string(extra.get("route")) or "-"
        prompt = _compact(extra.get("prompt_preview"))
        return (
            f"{ts} START turn={turn} thread={thread} module={module_context} "
            f"route={route} prompt=\"{prompt}\""
        )

    if message == "assistant_turn_response_started":
        first_delta_ms = extra.get("time_to_first_delta_ms", "-")
        return f"{ts} MODEL turn={turn} thread={thread} first_delta={first_delta_ms}ms"

    if message == "assistant_turn_tool_status":
        tool = _string(extra.get("tool")) or "-"
        status = _string(extra.get("status")) or "-"
        call_id = _short_id(extra.get("call_id"))
        summary = _compact(extra.get("summary"))
        return (
            f"{ts} TOOL  turn={turn} thread={thread} status={status} tool={tool} "
            f"call={call_id} {summary}"
        )

    if message == "assistant_turn_completed":
        duration_ms = extra.get("duration_ms", "-")
        answer_chars = extra.get("answer_chars", 0)
        tool_event_count = extra.get("tool_event_count", 0)
        evidence_count = extra.get("evidence_count", 0)
        caveat_count = extra.get("caveat_count", 0)
        answer_preview = _compact(extra.get("answer_preview"))
        return (
            f"{ts} DONE  turn={turn} thread={thread} duration={duration_ms}ms "
            f"answer_chars={answer_chars} tools={tool_event_count} evidence={evidence_count} "
            f"caveats={caveat_count} answer=\"{answer_preview}\""
        )

    if message == "assistant_turn_failed":
        duration_ms = extra.get("duration_ms", "-")
        error_type = _string(extra.get("error_type")) or "Error"
        error_message = _compact(extra.get("error_message"))
        return (
            f"{ts} FAIL  turn={turn} thread={thread} duration={duration_ms}ms "
            f"{error_type}: {error_message}"
        )

    return f"{ts} LOG   {message} {_compact(json.dumps(extra, default=str), limit=120)}"


def main() -> int:
    for raw_line in sys.stdin:
        line = raw_line.strip()
        if not line:
            continue
        try:
            record = json.loads(line)
        except json.JSONDecodeError:
            print(line)
            sys.stdout.flush()
            continue
        print(_format_line(_as_dict(record)))
        sys.stdout.flush()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
