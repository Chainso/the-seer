from __future__ import annotations

import pytest

from seer_backend.ontology.errors import OntologyReadOnlyViolationError
from seer_backend.ontology.query_guard import enforce_read_only_query


def test_allows_select_with_from_variable_name() -> None:
    query = """
SELECT ?from
WHERE {
  BIND("ok" AS ?from)
}
""".strip()
    assert enforce_read_only_query(query) == "SELECT"


def test_allows_select_with_graph_variable_name() -> None:
    query = """
SELECT ?graph
WHERE {
  BIND("ok" AS ?graph)
}
""".strip()
    assert enforce_read_only_query(query) == "SELECT"


def test_blocks_from_dataset_clause() -> None:
    query = """
SELECT ?s
FROM <urn:example:graph>
WHERE {
  ?s ?p ?o .
}
""".strip()
    with pytest.raises(OntologyReadOnlyViolationError, match="dataset clauses"):
        enforce_read_only_query(query)


def test_blocks_graph_dataset_clause() -> None:
    query = """
SELECT ?s
WHERE {
  GRAPH ?g {
    ?s ?p ?o .
  }
}
""".strip()
    with pytest.raises(OntologyReadOnlyViolationError, match="dataset clauses"):
        enforce_read_only_query(query)


def test_blocks_update_statement() -> None:
    query = 'INSERT DATA { <urn:test:s> <urn:test:p> "x" . }'
    with pytest.raises(OntologyReadOnlyViolationError, match="not allowed"):
        enforce_read_only_query(query)

