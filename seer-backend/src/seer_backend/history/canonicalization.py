"""Deterministic object reference canonicalization and hashing."""

from __future__ import annotations

import json
from typing import Any

import xxhash


def canonicalize_object_ref(object_ref: dict[str, Any]) -> str:
    """Return deterministic UTF-8 JSON with recursive key sorting."""

    return json.dumps(
        object_ref,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        allow_nan=False,
    )


def xxhash64_uint64(text: str) -> int:
    """Return unsigned 64-bit xxhash digest for canonical text."""

    return xxhash.xxh64(text.encode("utf-8")).intdigest()
