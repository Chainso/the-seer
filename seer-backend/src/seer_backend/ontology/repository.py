"""Ontology persistence adapters."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Protocol
from urllib.parse import quote

import httpx

from seer_backend.ontology.constants import (
    META_CURRENT_SUBJECT_IRI,
    META_GRAPH_IRI,
    META_POINTS_TO_PREDICATE_IRI,
    META_RELEASE_ID_PREDICATE_IRI,
    META_UPDATED_AT_PREDICATE_IRI,
)
from seer_backend.ontology.errors import OntologyDependencyUnavailableError, OntologyError
from seer_backend.ontology.models import CurrentReleasePointer

try:
    from rdflib import Dataset as RdfDataset
    from rdflib import Graph, Literal, URIRef
except ImportError:  # pragma: no cover - covered via dependency availability checks
    Graph = None
    RdfDataset = None
    URIRef = None
    Literal = None


class OntologyRepository(Protocol):
    async def replace_graph(self, graph_iri: str, turtle_content: str) -> None: ...

    async def set_current_release(self, pointer: CurrentReleasePointer) -> None: ...

    async def get_current_release(self) -> CurrentReleasePointer | None: ...

    async def select(
        self,
        query: str,
        default_graph_uris: Sequence[str] | None = None,
    ) -> list[dict[str, str]]: ...

    async def ask(self, query: str, default_graph_uris: Sequence[str] | None = None) -> bool: ...


@dataclass(slots=True)
class FusekiOntologyRepository:
    host: str
    port: int
    dataset: str
    timeout_seconds: float

    @property
    def _dataset_root(self) -> str:
        dataset = self.dataset.strip("/")
        return f"http://{self.host}:{self.port}/{dataset}"

    @property
    def _query_url(self) -> str:
        return f"{self._dataset_root}/query"

    @property
    def _update_url(self) -> str:
        return f"{self._dataset_root}/update"

    @property
    def _graph_store_url(self) -> str:
        return f"{self._dataset_root}/data"

    async def replace_graph(self, graph_iri: str, turtle_content: str) -> None:
        async with self._client() as client:
            response = await client.put(
                f"{self._graph_store_url}?graph={quote(graph_iri, safe='')}",
                content=turtle_content.encode("utf-8"),
                headers={"Content-Type": "text/turtle; charset=utf-8"},
            )
        self._raise_for_status(response, "replace graph")

    async def set_current_release(self, pointer: CurrentReleasePointer) -> None:
        updated_iso = (
            pointer.updated_at.astimezone(UTC).replace(microsecond=0).isoformat()
        )
        escaped_release_id = _escape_sparql_string(pointer.release_id)
        update_query = f"""
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
WITH <{META_GRAPH_IRI}>
DELETE {{
  <{META_CURRENT_SUBJECT_IRI}> <{META_POINTS_TO_PREDICATE_IRI}> ?existingGraph .
  <{META_CURRENT_SUBJECT_IRI}> <{META_RELEASE_ID_PREDICATE_IRI}> ?existingRelease .
  <{META_CURRENT_SUBJECT_IRI}> <{META_UPDATED_AT_PREDICATE_IRI}> ?existingUpdated .
}}
INSERT {{
  <{META_CURRENT_SUBJECT_IRI}> <{META_POINTS_TO_PREDICATE_IRI}> <{pointer.graph_iri}> .
  <{META_CURRENT_SUBJECT_IRI}> <{META_RELEASE_ID_PREDICATE_IRI}> "{escaped_release_id}" .
  <{META_CURRENT_SUBJECT_IRI}> <{META_UPDATED_AT_PREDICATE_IRI}> "{updated_iso}"^^xsd:dateTime .
}}
WHERE {{
  OPTIONAL {{ <{META_CURRENT_SUBJECT_IRI}> <{META_POINTS_TO_PREDICATE_IRI}> ?existingGraph . }}
  OPTIONAL {{ <{META_CURRENT_SUBJECT_IRI}> <{META_RELEASE_ID_PREDICATE_IRI}> ?existingRelease . }}
  OPTIONAL {{ <{META_CURRENT_SUBJECT_IRI}> <{META_UPDATED_AT_PREDICATE_IRI}> ?existingUpdated . }}
}}
""".strip()
        async with self._client() as client:
            response = await client.post(
                self._update_url,
                data={"update": update_query},
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
        self._raise_for_status(response, "set current release pointer")

    async def get_current_release(self) -> CurrentReleasePointer | None:
        query = f"""
SELECT ?graph ?releaseId ?updatedAt
WHERE {{
  GRAPH <{META_GRAPH_IRI}> {{
    <{META_CURRENT_SUBJECT_IRI}> <{META_POINTS_TO_PREDICATE_IRI}> ?graph .
    OPTIONAL {{ <{META_CURRENT_SUBJECT_IRI}> <{META_RELEASE_ID_PREDICATE_IRI}> ?releaseId . }}
    OPTIONAL {{ <{META_CURRENT_SUBJECT_IRI}> <{META_UPDATED_AT_PREDICATE_IRI}> ?updatedAt . }}
  }}
}}
LIMIT 1
""".strip()
        rows = await self.select(query)
        if not rows:
            return None
        row = rows[0]
        release_id = row.get("releaseId")
        graph_iri = row.get("graph")
        updated_at_text = row.get("updatedAt")
        if not release_id or not graph_iri or not updated_at_text:
            return None
        return CurrentReleasePointer(
            release_id=release_id,
            graph_iri=graph_iri,
            updated_at=datetime.fromisoformat(updated_at_text.replace("Z", "+00:00")),
        )

    async def select(
        self, query: str, default_graph_uris: Sequence[str] | None = None
    ) -> list[dict[str, str]]:
        payload: list[tuple[str, str]] = [("query", query)]
        if default_graph_uris:
            payload.extend(("default-graph-uri", uri) for uri in default_graph_uris)
        async with self._client() as client:
            response = await client.post(
                self._query_url,
                data=payload,
                headers={"Accept": "application/sparql-results+json"},
            )
        self._raise_for_status(response, "execute SELECT query")
        body = response.json()
        bindings = body.get("results", {}).get("bindings", [])
        return [_json_binding_row_to_strings(row) for row in bindings]

    async def ask(self, query: str, default_graph_uris: Sequence[str] | None = None) -> bool:
        payload: list[tuple[str, str]] = [("query", query)]
        if default_graph_uris:
            payload.extend(("default-graph-uri", uri) for uri in default_graph_uris)
        async with self._client() as client:
            response = await client.post(
                self._query_url,
                data=payload,
                headers={"Accept": "application/sparql-results+json"},
            )
        self._raise_for_status(response, "execute ASK query")
        body = response.json()
        return bool(body.get("boolean"))

    def _client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(timeout=self.timeout_seconds)

    def _raise_for_status(self, response: httpx.Response, operation: str) -> None:
        if response.is_success:
            return
        message = f"Fuseki failed to {operation}: HTTP {response.status_code} - {response.text}"
        raise OntologyError(message)


class InMemoryOntologyRepository:
    """In-memory RDF dataset for tests."""

    def __init__(self) -> None:
        if RdfDataset is None or URIRef is None or Graph is None or Literal is None:
            raise OntologyDependencyUnavailableError(
                "rdflib is required for in-memory ontology repository"
            )
        self._dataset = RdfDataset()
        self._current_pointer: CurrentReleasePointer | None = None

    async def replace_graph(self, graph_iri: str, turtle_content: str) -> None:
        target_graph = self._dataset.graph(URIRef(graph_iri))
        target_graph.remove((None, None, None))
        target_graph.parse(data=turtle_content, format="turtle")

    async def set_current_release(self, pointer: CurrentReleasePointer) -> None:
        self._current_pointer = pointer
        meta_graph = self._dataset.graph(URIRef(META_GRAPH_IRI))
        meta_graph.remove((None, None, None))
        meta_graph.add(
            (
                URIRef(META_CURRENT_SUBJECT_IRI),
                URIRef(META_POINTS_TO_PREDICATE_IRI),
                URIRef(pointer.graph_iri),
            )
        )
        meta_graph.add(
            (
                URIRef(META_CURRENT_SUBJECT_IRI),
                URIRef(META_RELEASE_ID_PREDICATE_IRI),
                Literal(pointer.release_id),
            )
        )
        meta_graph.add(
            (
                URIRef(META_CURRENT_SUBJECT_IRI),
                URIRef(META_UPDATED_AT_PREDICATE_IRI),
                Literal(pointer.updated_at.isoformat()),
            )
        )

    async def get_current_release(self) -> CurrentReleasePointer | None:
        return self._current_pointer

    async def select(
        self, query: str, default_graph_uris: Sequence[str] | None = None
    ) -> list[dict[str, str]]:
        query_target = self._build_query_graph(default_graph_uris)
        result = query_target.query(query)
        rows: list[dict[str, str]] = []
        for row in result:
            converted: dict[str, str] = {}
            for variable in result.vars:
                value = row.get(variable)
                if value is None:
                    continue
                converted[str(variable)] = _term_to_string(value)
            rows.append(converted)
        return rows

    async def ask(self, query: str, default_graph_uris: Sequence[str] | None = None) -> bool:
        query_target = self._build_query_graph(default_graph_uris)
        result = query_target.query(query)
        if hasattr(result, "askAnswer"):
            return bool(result.askAnswer)
        return bool(result)

    def _build_query_graph(self, default_graph_uris: Sequence[str] | None) -> Any:
        if not default_graph_uris:
            return self._dataset
        union_graph = Graph()
        for graph_iri in default_graph_uris:
            source_graph = self._dataset.graph(URIRef(graph_iri))
            for triple in source_graph:
                union_graph.add(triple)
        return union_graph


def _json_binding_row_to_strings(row: dict[str, Any]) -> dict[str, str]:
    output: dict[str, str] = {}
    for key, value in row.items():
        if isinstance(value, dict):
            output[key] = str(value.get("value", ""))
        else:
            output[key] = str(value)
    return output


def _term_to_string(term: Any) -> str:
    if hasattr(term, "toPython"):
        py_value = term.toPython()
        return str(py_value) if py_value is not None else ""
    return str(term)


def _escape_sparql_string(value: str) -> str:
    return value.replace("\\", "\\\\").replace('"', '\\"')
