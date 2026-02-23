"""Ontology ingest and query orchestration."""

from __future__ import annotations

from datetime import UTC, datetime

from seer_backend.ontology.constants import BASE_GRAPH_IRI, META_GRAPH_IRI
from seer_backend.ontology.errors import (
    OntologyDependencyUnavailableError,
    OntologyNotReadyError,
)
from seer_backend.ontology.models import (
    CurrentReleasePointer,
    OntologyConceptDetail,
    OntologyConceptSummary,
    OntologyCurrentResponse,
    OntologyIngestResponse,
    OntologySparqlQueryResponse,
    ValidationDiagnostic,
    assert_valid_iri,
    make_release_graph_iri,
)
from seer_backend.ontology.query_guard import enforce_read_only_query
from seer_backend.ontology.repository import OntologyRepository
from seer_backend.ontology.validation import ShaclValidator

_PREFIXES = """
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX owl: <http://www.w3.org/2002/07/owl#>
PREFIX prophet: <http://prophet.platform/ontology#>
""".strip()

_BASE_CONCEPT_IRI_PREFIXES = (
    "http://prophet.platform/ontology#",
    "http://prophet.platform/standard-types#",
    "http://www.w3.org/",
)
_GRAPH_CONCEPT_CATEGORIES = frozenset(
    {
        "ObjectModel",
        "Action",
        "Process",
        "Workflow",
        "Event",
        "Signal",
        "Transition",
        "EventTrigger",
    }
)

_CONCEPT_LIST_QUERY = f"""
{_PREFIXES}
SELECT DISTINCT ?concept ?label ?category
WHERE {{
  VALUES ?categoryIri {{
    prophet:ObjectModel
    prophet:Action
    prophet:Process
    prophet:Workflow
    prophet:Event
    prophet:Signal
    prophet:Transition
    prophet:EventTrigger
  }}
  ?concept a ?categoryIri .
  OPTIONAL {{ ?concept prophet:name ?prophetName . }}
  OPTIONAL {{ ?concept rdfs:label ?rdfsLabel . }}
  BIND(COALESCE(STR(?prophetName), STR(?rdfsLabel), STR(?concept)) AS ?label)
  BIND(REPLACE(STR(?categoryIri), "^.*[#/]", "") AS ?category)
}}
LIMIT 300
""".strip()


class OntologyService:
    """Domain service for ingest, pointer semantics, and read-only querying."""

    def __init__(
        self,
        repository: OntologyRepository,
        validator: ShaclValidator,
        base_graph_iri: str = BASE_GRAPH_IRI,
        meta_graph_iri: str = META_GRAPH_IRI,
    ) -> None:
        self._repository = repository
        self._validator = validator
        self._base_graph_iri = base_graph_iri
        self._meta_graph_iri = meta_graph_iri

    async def ingest(self, release_id: str, turtle: str) -> OntologyIngestResponse:
        release_graph_iri = make_release_graph_iri(release_id)
        validation = self._validator.validate(turtle)
        current = await self._repository.get_current_release()
        if not validation.conforms:
            return OntologyIngestResponse(
                release_id=release_id,
                release_graph_iri=release_graph_iri,
                meta_graph_iri=self._meta_graph_iri,
                current_graph_iri=current.graph_iri if current else None,
                validation_status="failed",
                diagnostics=validation.diagnostics,
            )

        await self._repository.replace_graph(self._base_graph_iri, self._validator.base_turtle)
        await self._repository.replace_graph(release_graph_iri, turtle)
        pointer = CurrentReleasePointer(
            release_id=release_id,
            graph_iri=release_graph_iri,
            updated_at=datetime.now(UTC),
        )
        await self._repository.set_current_release(pointer)

        return OntologyIngestResponse(
            release_id=release_id,
            release_graph_iri=release_graph_iri,
            meta_graph_iri=self._meta_graph_iri,
            current_graph_iri=release_graph_iri,
            validation_status="passed",
            diagnostics=[],
        )

    async def current(self) -> OntologyCurrentResponse:
        pointer = await self._repository.get_current_release()
        if pointer is None:
            return OntologyCurrentResponse(
                release_id=None,
                current_graph_iri=None,
                meta_graph_iri=self._meta_graph_iri,
                updated_at=None,
            )
        return OntologyCurrentResponse(
            release_id=pointer.release_id,
            current_graph_iri=pointer.graph_iri,
            meta_graph_iri=self._meta_graph_iri,
            updated_at=pointer.updated_at,
        )

    async def list_concepts(
        self,
        search: str = "",
        limit: int = 50,
    ) -> list[OntologyConceptSummary]:
        rows = await self._select_scoped(_CONCEPT_LIST_QUERY)
        normalized_search = search.lower().strip()
        dedup: dict[str, OntologyConceptSummary] = {}
        for row in rows:
            concept_iri = row.get("concept")
            if not concept_iri:
                continue
            if not _is_user_concept_iri(concept_iri):
                continue
            category = row.get("category", "Concept")
            if not _is_graph_concept_category(category):
                continue
            label = row.get("label", concept_iri)
            if normalized_search and normalized_search not in label.lower():
                continue
            if concept_iri not in dedup:
                dedup[concept_iri] = OntologyConceptSummary(
                    iri=concept_iri,
                    label=label,
                    category=category,
                )
            if len(dedup) >= limit:
                break
        return list(dedup.values())

    async def concept_detail(self, iri: str) -> OntologyConceptDetail:
        iri = assert_valid_iri(iri)
        detail_query = f"""
{_PREFIXES}
SELECT ?label ?comment ?category
WHERE {{
  BIND(<{iri}> AS ?concept)
  OPTIONAL {{
    ?concept a ?categoryIri .
    BIND(REPLACE(STR(?categoryIri), "^.*[#/]", "") AS ?category)
  }}
  OPTIONAL {{ ?concept prophet:name ?prophetName . }}
  OPTIONAL {{ ?concept rdfs:label ?rdfsLabel . }}
  OPTIONAL {{ ?concept rdfs:comment ?comment . }}
  BIND(COALESCE(STR(?prophetName), STR(?rdfsLabel), STR(?concept)) AS ?label)
}}
LIMIT 1
""".strip()

        outgoing_query = f"""
{_PREFIXES}
SELECT DISTINCT ?predicate
WHERE {{
  <{iri}> ?predicate ?object .
}}
ORDER BY ?predicate
LIMIT 50
""".strip()

        incoming_query = f"""
{_PREFIXES}
SELECT DISTINCT ?predicate
WHERE {{
  ?subject ?predicate <{iri}> .
}}
ORDER BY ?predicate
LIMIT 50
""".strip()

        detail_rows = await self._select_scoped(detail_query)
        outgoing_rows = await self._select_scoped(outgoing_query)
        incoming_rows = await self._select_scoped(incoming_query)

        detail = detail_rows[0] if detail_rows else {}
        return OntologyConceptDetail(
            iri=iri,
            label=detail.get("label", iri),
            category=detail.get("category", "Concept"),
            comment=detail.get("comment"),
            outgoing_relations=[
                row["predicate"] for row in outgoing_rows if row.get("predicate")
            ],
            incoming_relations=[
                row["predicate"] for row in incoming_rows if row.get("predicate")
            ],
        )

    async def run_read_only_query(self, query: str) -> OntologySparqlQueryResponse:
        query_type = enforce_read_only_query(query)
        graphs = await self._scoped_graphs()

        if query_type == "ASK":
            ask_result = await self._repository.ask(query, default_graph_uris=graphs)
            return OntologySparqlQueryResponse(
                query_type="ASK",
                ask_result=ask_result,
                graphs=graphs,
            )

        bindings = await self._repository.select(query, default_graph_uris=graphs)
        return OntologySparqlQueryResponse(
            query_type="SELECT",
            bindings=bindings,
            graphs=graphs,
        )

    async def _select_scoped(self, query: str) -> list[dict[str, str]]:
        graphs = await self._scoped_graphs()
        return await self._repository.select(query, default_graph_uris=graphs)

    async def _scoped_graphs(self) -> list[str]:
        pointer = await self._repository.get_current_release()
        if pointer is None:
            raise OntologyNotReadyError("No current ontology release has been ingested")
        return [self._base_graph_iri, pointer.graph_iri]


class UnavailableOntologyService:
    """Fallback service when ontology dependencies are unavailable."""

    def __init__(self, reason: str) -> None:
        self.reason = reason

    async def ingest(self, release_id: str, turtle: str) -> OntologyIngestResponse:
        del release_id, turtle
        raise OntologyDependencyUnavailableError(self.reason)

    async def current(self) -> OntologyCurrentResponse:
        raise OntologyDependencyUnavailableError(self.reason)

    async def list_concepts(
        self,
        search: str = "",
        limit: int = 50,
    ) -> list[OntologyConceptSummary]:
        del search, limit
        raise OntologyDependencyUnavailableError(self.reason)

    async def concept_detail(self, iri: str) -> OntologyConceptDetail:
        del iri
        raise OntologyDependencyUnavailableError(self.reason)

    async def run_read_only_query(self, query: str) -> OntologySparqlQueryResponse:
        del query
        raise OntologyDependencyUnavailableError(self.reason)

    async def health_diagnostic(self) -> ValidationDiagnostic:
        return ValidationDiagnostic(severity="Error", message=self.reason)


def _is_user_concept_iri(concept_iri: str) -> bool:
    return not any(
        concept_iri.startswith(base_prefix) for base_prefix in _BASE_CONCEPT_IRI_PREFIXES
    )


def _is_graph_concept_category(category: str) -> bool:
    return category in _GRAPH_CONCEPT_CATEGORIES
