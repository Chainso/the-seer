"""Managed-agent authoring models and RDF helpers."""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import UTC, datetime
from enum import StrEnum

from pydantic import BaseModel, Field, field_validator, model_validator

from seer_backend.ontology.models import assert_valid_iri

try:
    from rdflib import Graph as RdfGraph
    from rdflib import Literal, Namespace, URIRef
    from rdflib.namespace import RDF, RDFS, XSD
except ImportError:  # pragma: no cover - covered via dependency checks
    RdfGraph = None
    Literal = None
    Namespace = None
    URIRef = None
    RDF = None
    RDFS = None
    XSD = None

MANAGED_AGENT_KEY_PATTERN = re.compile(r"^[a-z][a-z0-9_:-]{2,79}$")
MANAGED_AGENT_IRI_PREFIX = "urn:seer:managed-agent:"
MANAGED_AGENT_DATA_LOCAL_ONTOLOGY_IRI = "urn:seer:ontology:data:seer_data:local"


class ManagedAgentFieldType(StrEnum):
    VALUE_TYPE = "value_type"
    OBJECT_REFERENCE = "object_reference"


class ManagedAgentFieldDefinition(BaseModel):
    field_key: str = Field(min_length=1, max_length=120)
    label: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=1000)
    required: bool = False
    multi_value: bool = False
    field_type: ManagedAgentFieldType
    value_type_iri: str | None = Field(default=None, max_length=2048)
    object_model_iri: str | None = Field(default=None, max_length=2048)

    @field_validator("field_key")
    @classmethod
    def normalize_field_key(cls, field_key: str) -> str:
        normalized = field_key.strip()
        if not normalized:
            raise ValueError("field_key must not be blank")
        return normalized

    @field_validator("value_type_iri")
    @classmethod
    def validate_value_type_iri(cls, value_type_iri: str | None) -> str | None:
        if value_type_iri is None:
            return None
        return assert_valid_iri(value_type_iri.strip())

    @field_validator("object_model_iri")
    @classmethod
    def validate_object_model_iri(cls, object_model_iri: str | None) -> str | None:
        if object_model_iri is None:
            return None
        return assert_valid_iri(object_model_iri.strip())

    @model_validator(mode="after")
    def validate_field_target(self) -> ManagedAgentFieldDefinition:
        if self.field_type is ManagedAgentFieldType.VALUE_TYPE:
            if not self.value_type_iri:
                raise ValueError("value_type_iri is required for value_type fields")
            if self.object_model_iri:
                raise ValueError("object_model_iri is not allowed for value_type fields")
            return self

        if self.field_type is ManagedAgentFieldType.OBJECT_REFERENCE:
            if not self.object_model_iri:
                raise ValueError("object_model_iri is required for object_reference fields")
            if self.value_type_iri:
                raise ValueError("value_type_iri is not allowed for object_reference fields")
            return self

        raise ValueError("unsupported managed-agent field type")


class ManagedAgentUpsertRequest(BaseModel):
    managed_agent_key: str = Field(min_length=3, max_length=80)
    name: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=1000)
    instruction: str = Field(min_length=1, max_length=6000)
    enabled: bool = True
    input_name: str = Field(min_length=1, max_length=200)
    input_description: str | None = Field(default=None, max_length=1000)
    output_name: str = Field(min_length=1, max_length=200)
    output_description: str | None = Field(default=None, max_length=1000)
    input_fields: list[ManagedAgentFieldDefinition] = Field(default_factory=list)
    output_fields: list[ManagedAgentFieldDefinition] = Field(default_factory=list)

    @field_validator("managed_agent_key")
    @classmethod
    def validate_managed_agent_key(cls, managed_agent_key: str) -> str:
        normalized = managed_agent_key.strip()
        if not MANAGED_AGENT_KEY_PATTERN.match(normalized):
            raise ValueError(
                "managed_agent_key must start with a letter and use only lowercase "
                "letters, digits, `_`, `:`, or `-` (3-80 chars)"
            )
        return normalized

    @model_validator(mode="after")
    def validate_field_sets(self) -> ManagedAgentUpsertRequest:
        _validate_field_key_uniqueness(self.input_fields, container_name="input_fields")
        _validate_field_key_uniqueness(self.output_fields, container_name="output_fields")
        return self


class ManagedAgentSummary(BaseModel):
    managed_agent_key: str
    action_uri: str
    name: str
    description: str | None = None
    enabled: bool
    instruction: str
    updated_at: datetime
    input_field_count: int
    output_field_count: int


class ManagedAgentDetail(BaseModel):
    managed_agent_key: str
    action_uri: str
    name: str
    description: str | None = None
    instruction: str
    enabled: bool
    updated_at: datetime
    input_name: str
    input_description: str | None = None
    output_name: str
    output_description: str | None = None
    input_fields: list[ManagedAgentFieldDefinition] = Field(default_factory=list)
    output_fields: list[ManagedAgentFieldDefinition] = Field(default_factory=list)


class ManagedAgentListResponse(BaseModel):
    total: int
    managed_agents: list[ManagedAgentSummary] = Field(default_factory=list)


class ManagedAgentCatalogItem(BaseModel):
    iri: str
    label: str
    kind: str


class ManagedAgentEditorCatalog(BaseModel):
    object_models: list[ManagedAgentCatalogItem] = Field(default_factory=list)
    value_types: list[ManagedAgentCatalogItem] = Field(default_factory=list)


@dataclass(slots=True)
class ManagedAgentCluster:
    managed_agent_key: str
    action_uri: str
    graph: RdfGraph

    @property
    def subject_prefix(self) -> str:
        return managed_agent_subject_prefix(self.managed_agent_key)


def managed_agent_action_iri(managed_agent_key: str) -> str:
    return f"{MANAGED_AGENT_IRI_PREFIX}{managed_agent_key}"


def managed_agent_output_event_iri(managed_agent_key: str) -> str:
    return f"{managed_agent_action_iri(managed_agent_key)}:output"


def managed_agent_subject_prefix(managed_agent_key: str) -> str:
    return f"{managed_agent_action_iri(managed_agent_key)}:"


def managed_agent_key_from_action_uri(action_uri: str) -> str | None:
    if not action_uri.startswith(MANAGED_AGENT_IRI_PREFIX):
        return None
    return action_uri.removeprefix(MANAGED_AGENT_IRI_PREFIX)


def build_managed_agent_cluster(
    payload: ManagedAgentUpsertRequest,
    *,
    updated_at: datetime | None = None,
) -> ManagedAgentCluster:
    if RdfGraph is None or Literal is None or Namespace is None or URIRef is None:
        raise RuntimeError("rdflib is required for managed-agent graph building")

    graph = RdfGraph()

    prophet = Namespace("http://prophet.platform/ontology#")
    seer = Namespace("http://seer.platform/ontology#")
    graph.bind("prophet", prophet)
    graph.bind("seer", seer)
    graph.bind("rdfs", RDFS)

    action_uri = managed_agent_action_iri(payload.managed_agent_key)
    action = URIRef(action_uri)
    action_input = URIRef(f"{action_uri}:input")
    output_event = URIRef(f"{action_uri}:output")
    local_ontology = URIRef(MANAGED_AGENT_DATA_LOCAL_ONTOLOGY_IRI)
    updated_value = (updated_at or datetime.now(UTC)).astimezone(UTC).replace(microsecond=0)

    graph.add((local_ontology, RDF.type, prophet.LocalOntology))
    graph.add((local_ontology, prophet.name, Literal("Seer Managed Agent Data")))
    graph.add(
        (
            local_ontology,
            prophet.description,
            Literal("Managed agents authored from Seer UI and stored in seer_data."),
        )
    )

    graph.add((action, RDF.type, seer.AgenticWorkflow))
    graph.add((action, prophet.name, Literal(payload.name)))
    if payload.description:
        graph.add((action, prophet.description, Literal(payload.description)))
    graph.add((action, prophet.acceptsInput, action_input))
    graph.add((action, prophet.producesEvent, output_event))
    graph.add((action, prophet.inLocalOntology, local_ontology))
    graph.add((action, seer.instruction, Literal(payload.instruction)))
    graph.add((action, seer.enabled, Literal(payload.enabled)))
    graph.add((action, seer.updatedAt, Literal(updated_value.isoformat(), datatype=XSD.dateTime)))

    graph.add((action_input, RDF.type, prophet.ActionInput))
    graph.add((action_input, prophet.name, Literal(payload.input_name)))
    if payload.input_description:
        graph.add((action_input, prophet.description, Literal(payload.input_description)))
    graph.add((action_input, prophet.inLocalOntology, local_ontology))

    graph.add((output_event, RDF.type, prophet.Event))
    graph.add((output_event, prophet.name, Literal(payload.output_name)))
    if payload.output_description:
        graph.add((output_event, prophet.description, Literal(payload.output_description)))
    graph.add((output_event, prophet.inLocalOntology, local_ontology))

    for field in payload.input_fields:
        property_uri, object_ref_uri = _field_subjects(
            managed_agent_key=payload.managed_agent_key,
            container="input",
            field_key=field.field_key,
        )
        property_ref = URIRef(property_uri)
        graph.add((action_input, prophet.hasProperty, property_ref))
        _add_field_triples(
            graph=graph,
            property_ref=property_ref,
            object_ref_uri=object_ref_uri,
            field=field,
            local_ontology=local_ontology,
        )

    for field in payload.output_fields:
        property_uri, object_ref_uri = _field_subjects(
            managed_agent_key=payload.managed_agent_key,
            container="output",
            field_key=field.field_key,
        )
        property_ref = URIRef(property_uri)
        graph.add((output_event, prophet.hasProperty, property_ref))
        _add_field_triples(
            graph=graph,
            property_ref=property_ref,
            object_ref_uri=object_ref_uri,
            field=field,
            local_ontology=local_ontology,
        )

    return ManagedAgentCluster(
        managed_agent_key=payload.managed_agent_key,
        action_uri=action_uri,
        graph=graph,
    )


def extract_managed_agent_summaries(data_graph: RdfGraph) -> list[ManagedAgentSummary]:
    if URIRef is None or Namespace is None:
        raise RuntimeError("rdflib is required for managed-agent graph inspection")

    prophet = Namespace("http://prophet.platform/ontology#")
    seer = Namespace("http://seer.platform/ontology#")
    summaries: list[ManagedAgentSummary] = []

    for action in data_graph.subjects(RDF.type, seer.AgenticWorkflow):
        action_uri = str(action)
        managed_agent_key = _managed_agent_key_from_action_uri(action_uri)
        if managed_agent_key is None:
            continue
        input_iri = data_graph.value(action, prophet.acceptsInput)
        output_iri = data_graph.value(action, prophet.producesEvent)
        input_field_count = (
            len(list(data_graph.objects(input_iri, prophet.hasProperty))) if input_iri else 0
        )
        output_field_count = (
            len(list(data_graph.objects(output_iri, prophet.hasProperty))) if output_iri else 0
        )
        summaries.append(
            ManagedAgentSummary(
                managed_agent_key=managed_agent_key,
                action_uri=action_uri,
                name=_literal_string(data_graph.value(action, prophet.name)) or action_uri,
                description=_literal_string(data_graph.value(action, prophet.description)),
                instruction=_literal_string(data_graph.value(action, seer.instruction)) or "",
                enabled=_literal_bool(data_graph.value(action, seer.enabled), default=True),
                updated_at=_literal_datetime(data_graph.value(action, seer.updatedAt)),
                input_field_count=input_field_count,
                output_field_count=output_field_count,
            )
        )

    return sorted(
        summaries,
        key=lambda item: (item.updated_at, item.name.lower(), item.action_uri),
        reverse=True,
    )


def extract_managed_agent_detail(
    data_graph: RdfGraph,
    *,
    managed_agent_key: str,
) -> ManagedAgentDetail | None:
    if URIRef is None or Namespace is None:
        raise RuntimeError("rdflib is required for managed-agent graph inspection")

    prophet = Namespace("http://prophet.platform/ontology#")
    seer = Namespace("http://seer.platform/ontology#")
    action_uri = managed_agent_action_iri(managed_agent_key)
    action = URIRef(action_uri)
    if (action, RDF.type, seer.AgenticWorkflow) not in data_graph:
        return None

    action_input = data_graph.value(action, prophet.acceptsInput)
    output_event = data_graph.value(action, prophet.producesEvent)
    if action_input is None or output_event is None:
        return None

    return ManagedAgentDetail(
        managed_agent_key=managed_agent_key,
        action_uri=action_uri,
        name=_literal_string(data_graph.value(action, prophet.name)) or action_uri,
        description=_literal_string(data_graph.value(action, prophet.description)),
        instruction=_literal_string(data_graph.value(action, seer.instruction)) or "",
        enabled=_literal_bool(data_graph.value(action, seer.enabled), default=True),
        updated_at=_literal_datetime(data_graph.value(action, seer.updatedAt)),
        input_name=_literal_string(data_graph.value(action_input, prophet.name)) or "Input",
        input_description=_literal_string(data_graph.value(action_input, prophet.description)),
        output_name=_literal_string(data_graph.value(output_event, prophet.name)) or "Output",
        output_description=_literal_string(data_graph.value(output_event, prophet.description)),
        input_fields=_extract_fields(data_graph, container_iri=action_input),
        output_fields=_extract_fields(data_graph, container_iri=output_event),
    )


def remove_managed_agent_cluster(data_graph: RdfGraph, *, managed_agent_key: str) -> None:
    action_uri = managed_agent_action_iri(managed_agent_key)
    subject_prefix = managed_agent_subject_prefix(managed_agent_key)
    removable_subjects = {
        subject
        for subject in set(data_graph.subjects())
        if str(subject) == action_uri or str(subject).startswith(subject_prefix)
    }
    for subject in removable_subjects:
        data_graph.remove((subject, None, None))


def _field_subjects(
    *,
    managed_agent_key: str,
    container: str,
    field_key: str,
) -> tuple[str, str]:
    base = f"{managed_agent_action_iri(managed_agent_key)}:{container}:field:{field_key}"
    return base, f"{base}:object-ref"


def _add_field_triples(
    *,
    graph: RdfGraph,
    property_ref: URIRef,
    object_ref_uri: str,
    field: ManagedAgentFieldDefinition,
    local_ontology: URIRef,
) -> None:
    prophet = Namespace("http://prophet.platform/ontology#")

    graph.add((property_ref, RDF.type, prophet.PropertyDefinition))
    graph.add((property_ref, prophet.name, Literal(field.label)))
    graph.add((property_ref, prophet.fieldKey, Literal(field.field_key)))
    graph.add((property_ref, prophet.inLocalOntology, local_ontology))
    if field.description:
        graph.add((property_ref, prophet.description, Literal(field.description)))
    graph.add(
        (
            property_ref,
            prophet.minCardinality,
            Literal(1 if field.required else 0, datatype=XSD.integer),
        )
    )
    if not field.multi_value:
        graph.add((property_ref, prophet.maxCardinality, Literal(1, datatype=XSD.integer)))

    if field.field_type is ManagedAgentFieldType.VALUE_TYPE:
        graph.add((property_ref, prophet.valueType, URIRef(field.value_type_iri)))
        return

    object_ref = URIRef(object_ref_uri)
    graph.add((object_ref, RDF.type, prophet.ObjectReference))
    graph.add((object_ref, prophet.name, Literal(f"{field.label} Reference")))
    graph.add((object_ref, prophet.inLocalOntology, local_ontology))
    if field.description:
        graph.add((object_ref, prophet.description, Literal(field.description)))
    graph.add((object_ref, prophet.referencesObjectModel, URIRef(field.object_model_iri)))
    graph.add((property_ref, prophet.valueType, object_ref))


def _extract_fields(
    data_graph: RdfGraph,
    *,
    container_iri: object,
) -> list[ManagedAgentFieldDefinition]:
    prophet = Namespace("http://prophet.platform/ontology#")
    fields: list[ManagedAgentFieldDefinition] = []
    for property_ref in data_graph.objects(container_iri, prophet.hasProperty):
        field_key = _literal_string(data_graph.value(property_ref, prophet.fieldKey))
        if not field_key:
            continue
        value_type = data_graph.value(property_ref, prophet.valueType)
        field_type = ManagedAgentFieldType.VALUE_TYPE
        value_type_iri: str | None = str(value_type) if value_type is not None else None
        object_model_iri: str | None = None

        if value_type is not None and (value_type, RDF.type, prophet.ObjectReference) in data_graph:
            field_type = ManagedAgentFieldType.OBJECT_REFERENCE
            value_type_iri = None
            object_model = data_graph.value(value_type, prophet.referencesObjectModel)
            object_model_iri = str(object_model) if object_model is not None else None

        min_cardinality = _literal_int(
            data_graph.value(property_ref, prophet.minCardinality),
            default=0,
        )
        max_cardinality = _literal_int(
            data_graph.value(property_ref, prophet.maxCardinality),
            default=1,
        )
        fields.append(
            ManagedAgentFieldDefinition(
                field_key=field_key,
                label=_literal_string(data_graph.value(property_ref, prophet.name)) or field_key,
                description=_literal_string(data_graph.value(property_ref, prophet.description)),
                required=min_cardinality >= 1,
                multi_value=max_cardinality > 1 if max_cardinality is not None else True,
                field_type=field_type,
                value_type_iri=value_type_iri,
                object_model_iri=object_model_iri,
            )
        )
    return sorted(fields, key=lambda item: item.field_key)


def _validate_field_key_uniqueness(
    fields: list[ManagedAgentFieldDefinition],
    *,
    container_name: str,
) -> None:
    seen: set[str] = set()
    for field in fields:
        lowered = field.field_key.lower()
        if lowered in seen:
            raise ValueError(f"{container_name} contains duplicate field_key '{field.field_key}'")
        seen.add(lowered)


def _managed_agent_key_from_action_uri(action_uri: str) -> str | None:
    return managed_agent_key_from_action_uri(action_uri)


def _literal_string(value: object | None) -> str | None:
    if value is None:
        return None
    if hasattr(value, "toPython"):
        python_value = value.toPython()
        return str(python_value) if python_value is not None else None
    return str(value)


def _literal_bool(value: object | None, *, default: bool) -> bool:
    if value is None:
        return default
    if hasattr(value, "toPython"):
        python_value = value.toPython()
        if isinstance(python_value, bool):
            return python_value
        if isinstance(python_value, str):
            return python_value.strip().lower() == "true"
    return default


def _literal_int(value: object | None, *, default: int | None) -> int | None:
    if value is None:
        return default
    if hasattr(value, "toPython"):
        python_value = value.toPython()
        if python_value is None:
            return default
        return int(python_value)
    return int(str(value))


def _literal_datetime(value: object | None) -> datetime:
    if value is None:
        return datetime(1970, 1, 1, tzinfo=UTC)
    if hasattr(value, "toPython"):
        python_value = value.toPython()
        if isinstance(python_value, datetime):
            return python_value.astimezone(UTC)
        if isinstance(python_value, str):
            return datetime.fromisoformat(python_value.replace("Z", "+00:00")).astimezone(UTC)
    return datetime.fromisoformat(str(value).replace("Z", "+00:00")).astimezone(UTC)
