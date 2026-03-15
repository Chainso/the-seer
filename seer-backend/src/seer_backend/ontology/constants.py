"""Ontology graph and metadata constants."""

from __future__ import annotations

SEER_ONTOLOGY_NAMESPACE = "http://seer.platform/ontology#"
SEER_AGENTIC_WORKFLOW_IRI = f"{SEER_ONTOLOGY_NAMESPACE}AgenticWorkflow"
SEER_MANAGED_AGENT_INSTRUCTION_IRI = f"{SEER_ONTOLOGY_NAMESPACE}instruction"
SEER_MANAGED_AGENT_ENABLED_IRI = f"{SEER_ONTOLOGY_NAMESPACE}enabled"
SEER_MANAGED_AGENT_CREATED_AT_IRI = f"{SEER_ONTOLOGY_NAMESPACE}createdAt"
SEER_MANAGED_AGENT_UPDATED_AT_IRI = f"{SEER_ONTOLOGY_NAMESPACE}updatedAt"
SEER_EXTENSION_TURTLE = """
@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix prophet: <http://prophet.platform/ontology#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix seer: <http://seer.platform/ontology#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .

seer:AgenticWorkflow a rdfs:Class ;
  rdfs:label "Agentic Workflow" ;
  rdfs:subClassOf prophet:Action .

seer:instruction a owl:DatatypeProperty ;
  rdfs:label "Instruction" ;
  rdfs:domain seer:AgenticWorkflow ;
  rdfs:range xsd:string .

seer:enabled a owl:DatatypeProperty ;
  rdfs:label "Enabled" ;
  rdfs:domain seer:AgenticWorkflow ;
  rdfs:range xsd:boolean .

seer:createdAt a owl:DatatypeProperty ;
  rdfs:label "Created At" ;
  rdfs:domain seer:AgenticWorkflow ;
  rdfs:range xsd:dateTime .

seer:updatedAt a owl:DatatypeProperty ;
  rdfs:label "Updated At" ;
  rdfs:domain seer:AgenticWorkflow ;
  rdfs:range xsd:dateTime .
""".strip()

BASE_GRAPH_IRI = "urn:seer:ontology:base:prophet"
META_GRAPH_IRI = "urn:seer:ontology:meta"
SEER_DATA_GRAPH_IRI = "urn:seer:ontology:data:seer_data"
META_CURRENT_SUBJECT_IRI = "urn:seer:ontology:meta:current"
META_POINTS_TO_PREDICATE_IRI = "urn:seer:ontology:meta:pointsTo"
META_RELEASE_ID_PREDICATE_IRI = "urn:seer:ontology:meta:releaseId"
META_UPDATED_AT_PREDICATE_IRI = "urn:seer:ontology:meta:updatedAt"
