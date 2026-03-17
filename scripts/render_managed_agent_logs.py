#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import sys
from typing import Any

_USE_COLOR = sys.stdout.isatty() and os.environ.get("NO_COLOR") is None
_RESET = "\033[0m"
_DIM = "\033[2m"
_CYAN = "\033[36m"
_BLUE = "\033[34m"
_MAGENTA = "\033[35m"
_YELLOW = "\033[33m"
_GREEN = "\033[32m"
_RED = "\033[31m"


def _paint(text: str, color: str) -> str:
    if not _USE_COLOR:
        return text
    return f"{color}{text}{_RESET}"


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


def _single_line(value: Any) -> str:
    return " ".join(_string(value).split()).strip()


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
    ts = _paint(_compact_ts(record.get("ts")), f"{_DIM}{_CYAN}")

    if message == "managed_agent_runner_started":
        return (
            f"{ts} {_paint('START', _BLUE)} runner instance={_string(extra.get('instance_id')) or '-'} "
            f"interval={extra.get('interval_seconds', '-')}s batch={extra.get('batch_size', '-')}"
        )

    if message == "managed_agent_runner_cycle":
        return (
            f"{ts} {_paint('CYCLE', _MAGENTA)} claimed={extra.get('claimed_count', 0)} "
            f"completed={extra.get('completed_count', 0)} "
            f"failed={extra.get('failed_count', 0)} "
            f"duration={extra.get('duration_ms', '-')}ms"
        )

    if message == "managed_agent_execution_started":
        return (
            f"{ts} {_paint('RUN', _BLUE)}   id={_short_id(extra.get('action_id'))} "
            f"attempt={extra.get('attempt_no', '-')} "
            f"user={_string(extra.get('user_id')) or '-'} "
            f"action={_compact(extra.get('action_uri'))}"
        )

    if message == "managed_agent_execution_completed":
        return (
            f"{ts} {_paint('DONE', _GREEN)}  id={_short_id(extra.get('action_id'))} "
            f"attempt={extra.get('attempt_no', '-')} "
            f"event={_compact(extra.get('produced_event_type'))}"
        )

    if message == "managed_agent_execution_failed":
        return (
            f"{ts} {_paint('FAIL', _RED)}  id={_short_id(extra.get('action_id'))} "
            f"attempt={extra.get('attempt_no', '-')} "
            f"code={_string(extra.get('error_code')) or '-'} "
            f"detail=\"{_single_line(extra.get('error_detail'))}\""
        )

    if message == "managed_agent_transcript_tool_call":
        message_json = _as_dict(extra.get("message_json"))
        tool_calls = message_json.get("tool_calls")
        first_tool = tool_calls[0] if isinstance(tool_calls, list) and tool_calls else {}
        function_payload = _as_dict(_as_dict(first_tool).get("function"))
        tool_name = _string(function_payload.get("name")) or "-"
        arguments = _compact(function_payload.get("arguments"))
        return (
            f"{ts} {_paint('CALL', _YELLOW)}  id={_short_id(extra.get('action_id'))} "
            f"seq={extra.get('sequence_no', '-')} call={_short_id(extra.get('call_id'))} "
            f"name={tool_name} args=\"{arguments}\""
        )

    if message == "managed_agent_transcript_tool_result":
        message_json = _as_dict(extra.get("message_json"))
        content = message_json.get("content")
        content_text = _string(content)
        try:
            parsed_content = json.loads(content_text) if content_text else {}
        except json.JSONDecodeError:
            parsed_content = {}
        tool_name = _string(_as_dict(parsed_content).get("tool")) or "-"
        error_text = _string(_as_dict(parsed_content).get("error"))
        detail = _single_line(error_text or content_text)
        return (
            f"{ts} {_paint('RESULT', _GREEN)} id={_short_id(extra.get('action_id'))} "
            f"seq={extra.get('sequence_no', '-')} call={_short_id(extra.get('call_id'))} "
            f"result={tool_name} detail=\"{detail}\""
        )

    if message == "managed_agent_transcript_message":
        message_json = _as_dict(extra.get("message_json"))
        role = _string(message_json.get("role")) or _string(extra.get("role")) or "-"
        content_preview = _single_line(message_json.get("content"))
        return (
            f"{ts} {_paint('MSG', _BLUE)}   id={_short_id(extra.get('action_id'))} "
            f"seq={extra.get('sequence_no', '-')} role={role} "
            f"kind={_string(extra.get('message_kind')) or '-'} "
            f"content=\"{content_preview}\""
        )

    if message == "managed_agent_runner_cycle_failed":
        return f'{ts} {_paint("FAIL", _RED)}  cycle error="{_single_line(extra.get("error"))}"'

    if message == "managed_agent_runner_stopped":
        return f"{ts} {_paint('STOP', _RED)}  runner stopped"

    if message == "managed_agent_runner_disabled":
        return f"{ts} {_paint('STOP', _RED)}  runner disabled"

    return f"{ts} {_paint('LOG', _YELLOW)}   {message} {_compact(json.dumps(extra, default=str), limit=120)}"


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
