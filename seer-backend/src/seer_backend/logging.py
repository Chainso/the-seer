"""Logging bootstrap for Seer backend."""

from __future__ import annotations

import json
import logging
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

_ASSISTANT_TURN_LOGGER_NAME = "seer_backend.ai.assistant_turn"
_RESERVED_FIELDS = {
    "name",
    "msg",
    "args",
    "levelname",
    "levelno",
    "pathname",
    "filename",
    "module",
    "exc_info",
    "exc_text",
    "stack_info",
    "lineno",
    "funcName",
    "created",
    "msecs",
    "relativeCreated",
    "thread",
    "threadName",
    "processName",
    "process",
    "message",
    "asctime",
}


class JsonFormatter(logging.Formatter):
    """Render logs as structured JSON lines."""

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "ts": datetime.now(UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        extras = {
            key: value
            for key, value in record.__dict__.items()
            if key not in _RESERVED_FIELDS and not key.startswith("_")
        }
        if extras:
            payload["extra"] = extras
        if record.exc_info:
            payload["exc_info"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str)


def configure_logging(
    level: str = "INFO",
    *,
    assistant_turn_log_path: str | None = None,
) -> None:
    """Configure root logger once for the process."""

    root_logger = logging.getLogger()
    root_logger.setLevel(level.upper())

    if not _has_stdout_stream_handler(root_logger):
        handler = logging.StreamHandler(stream=sys.stdout)
        handler.setFormatter(JsonFormatter())
        root_logger.addHandler(handler)

    _configure_assistant_turn_logger(
        level=level,
        assistant_turn_log_path=assistant_turn_log_path,
    )


def _has_stdout_stream_handler(logger: logging.Logger) -> bool:
    return any(
        isinstance(handler, logging.StreamHandler)
        and getattr(handler, "stream", None) is sys.stdout
        for handler in logger.handlers
    )


def _configure_assistant_turn_logger(
    *,
    level: str,
    assistant_turn_log_path: str | None,
) -> None:
    logger = logging.getLogger(_ASSISTANT_TURN_LOGGER_NAME)
    logger.setLevel(level.upper())

    if not assistant_turn_log_path:
        return

    resolved_path = Path(assistant_turn_log_path).expanduser().resolve()
    resolved_path.parent.mkdir(parents=True, exist_ok=True)

    if _has_file_handler(logger, resolved_path):
        return

    handler = logging.FileHandler(resolved_path)
    handler.setFormatter(JsonFormatter())
    logger.addHandler(handler)


def _has_file_handler(logger: logging.Logger, path: Path) -> bool:
    normalized_path = str(path)
    return any(
        isinstance(handler, logging.FileHandler)
        and Path(handler.baseFilename).resolve() == Path(normalized_path)
        for handler in logger.handlers
    )
