"""Ontology graph and metadata constants."""

from __future__ import annotations

SEER_ONTOLOGY_NAMESPACE = "http://seer.platform/ontology#"
SEER_AGENTIC_WORKFLOW_IRI = f"{SEER_ONTOLOGY_NAMESPACE}AgenticWorkflow"
SEER_EXTENSION_TURTLE = """
@prefix prophet: <http://prophet.platform/ontology#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix seer: <http://seer.platform/ontology#> .

seer:AgenticWorkflow a rdfs:Class ;
  rdfs:label "Agentic Workflow" ;
  rdfs:subClassOf prophet:Action .
""".strip()

BASE_GRAPH_IRI = "urn:seer:ontology:base:prophet"
META_GRAPH_IRI = "urn:seer:ontology:meta"
META_CURRENT_SUBJECT_IRI = "urn:seer:ontology:meta:current"
META_POINTS_TO_PREDICATE_IRI = "urn:seer:ontology:meta:pointsTo"
META_RELEASE_ID_PREDICATE_IRI = "urn:seer:ontology:meta:releaseId"
META_UPDATED_AT_PREDICATE_IRI = "urn:seer:ontology:meta:updatedAt"
