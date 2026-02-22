"""Read-only SPARQL query guardrails."""

from __future__ import annotations

import re
from typing import Literal

from seer_backend.ontology.errors import OntologyReadOnlyViolationError

_UPDATE_KEYWORDS = re.compile(
    r"\b(INSERT|DELETE|LOAD|CLEAR|CREATE|DROP|COPY|MOVE|ADD)\b",
    re.IGNORECASE,
)
_UNSUPPORTED_DATASET_CLAUSES = re.compile(
    r"\b(FROM|GRAPH|SERVICE|WITH|USING)\b", re.IGNORECASE
)
_FIRST_OPERATION = re.compile(
    r"\b(SELECT|ASK|CONSTRUCT|DESCRIBE|INSERT|DELETE|LOAD|CLEAR|CREATE|DROP|COPY|MOVE|ADD)\b",
    re.IGNORECASE,
)


def enforce_read_only_query(query: str) -> Literal["SELECT", "ASK"]:
    scrubbed = _strip_comments(query)
    op = _first_operation(scrubbed)

    if _UPDATE_KEYWORDS.search(scrubbed):
        raise OntologyReadOnlyViolationError("SPARQL update operations are not allowed")
    if _UNSUPPORTED_DATASET_CLAUSES.search(scrubbed):
        raise OntologyReadOnlyViolationError(
            "SPARQL dataset clauses are restricted in read-only mode"
        )
    if op not in {"SELECT", "ASK"}:
        raise OntologyReadOnlyViolationError("Only SELECT and ASK queries are supported")
    return op


def _strip_comments(query: str) -> str:
    lines = []
    for line in query.splitlines():
        comment_idx = line.find("#")
        if comment_idx >= 0:
            line = line[:comment_idx]
        lines.append(line)
    return "\n".join(lines)


def _first_operation(query: str) -> str:
    match = _FIRST_OPERATION.search(query)
    return match.group(1).upper() if match else ""
