"""Read-only SPARQL query guardrails."""

from __future__ import annotations

from typing import Literal

from seer_backend.ontology.errors import OntologyReadOnlyViolationError

_UPDATE_KEYWORDS = {"INSERT", "DELETE", "LOAD", "CLEAR", "CREATE", "DROP", "COPY", "MOVE", "ADD"}
_UNSUPPORTED_DATASET_CLAUSES = {"FROM", "GRAPH", "SERVICE", "WITH", "USING"}
_OPERATIONS = {"SELECT", "ASK", "CONSTRUCT", "DESCRIBE", *_UPDATE_KEYWORDS}


def enforce_read_only_query(query: str) -> Literal["SELECT", "ASK"]:
    tokens = _scan_bare_identifier_tokens(query)
    op = _first_operation(tokens)

    if any(token in _UPDATE_KEYWORDS for token in tokens):
        raise OntologyReadOnlyViolationError("SPARQL update operations are not allowed")
    if any(token in _UNSUPPORTED_DATASET_CLAUSES for token in tokens):
        raise OntologyReadOnlyViolationError(
            "SPARQL dataset clauses are restricted in read-only mode"
        )
    if op not in {"SELECT", "ASK"}:
        raise OntologyReadOnlyViolationError("Only SELECT and ASK queries are supported")
    return op


def _first_operation(tokens: list[str]) -> str:
    for token in tokens:
        if token in _OPERATIONS:
            return token
    return ""


def _scan_bare_identifier_tokens(query: str) -> list[str]:
    """Return uppercase bare identifier tokens from query text.

    This scanner intentionally ignores:
    - comments (`# ...`),
    - IRIs (`<...>`),
    - string literals,
    - variables (`?from`, `$graph`),
    - prefixed names (`ex:graph`).

    That prevents false positives where the old regex policy matched keywords inside
    variable names like `?from` or `?graph`.
    """

    tokens: list[str] = []
    length = len(query)
    i = 0

    while i < length:
        ch = query[i]

        if ch.isspace():
            i += 1
            continue

        # SPARQL comments begin with `#` and run to end-of-line.
        if ch == "#":
            i += 1
            while i < length and query[i] not in "\r\n":
                i += 1
            continue

        # IRI refs: <...>
        if ch == "<":
            i += 1
            while i < length and query[i] != ">":
                i += 1
            if i < length:
                i += 1
            continue

        # String literals: "...", '...'
        if ch in {"'", '"'}:
            quote = ch
            i += 1
            while i < length:
                if query[i] == "\\":
                    i += 2
                    continue
                if query[i] == quote:
                    i += 1
                    break
                i += 1
            continue

        # Variables: ?x or $x
        if ch in {"?", "$"}:
            i += 1
            while i < length and _is_identifier_char(query[i]):
                i += 1
            continue

        # Bare identifiers and prefixed names.
        if _is_identifier_start(ch):
            start = i
            i += 1
            while i < length and _is_identifier_char(query[i]):
                i += 1

            # Prefixed name, e.g. ex:Graph
            if i < length and query[i] == ":":
                i += 1
                while i < length and _is_prefixed_local_char(query[i]):
                    i += 1
                continue

            tokens.append(query[start:i].upper())
            continue

        i += 1

    return tokens


def _is_identifier_start(ch: str) -> bool:
    return ch.isalpha() or ch == "_"


def _is_identifier_char(ch: str) -> bool:
    return ch.isalnum() or ch in {"_", "-"}


def _is_prefixed_local_char(ch: str) -> bool:
    return ch.isalnum() or ch in {"_", "-", ".", "~"}
