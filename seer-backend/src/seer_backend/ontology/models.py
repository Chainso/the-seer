"""Ontology request/response and domain models."""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime
from json import loads
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator, model_validator

_RELEASE_ID_PATTERN = re.compile(r"^[A-Za-z0-9._-]{1,120}$")
_IRI_PATTERN = re.compile(r"^[a-zA-Z][a-zA-Z0-9+.-]*:[^\s<>]*$")


class ValidationDiagnostic(BaseModel):
    severity: str
    focus_node: str | None = None
    source_shape: str | None = None
    result_path: str | None = None
    message: str


@dataclass(slots=True)
class ValidationOutcome:
    conforms: bool
    diagnostics: list[ValidationDiagnostic]


@dataclass(slots=True)
class CurrentReleasePointer:
    release_id: str
    graph_iri: str
    updated_at: datetime


class OntologyIngestRequest(BaseModel):
    release_id: str = Field(description="Deterministic ontology release identifier")
    turtle: str = Field(min_length=1, description="Turtle content to ingest")

    @field_validator("release_id")
    @classmethod
    def validate_release_id(cls, release_id: str) -> str:
        if not _RELEASE_ID_PATTERN.match(release_id):
            raise ValueError("release_id must match [A-Za-z0-9._-] and be <= 120 chars")
        return release_id


class OntologyIngestResponse(BaseModel):
    release_id: str
    release_graph_iri: str
    meta_graph_iri: str
    current_graph_iri: str | None
    validation_status: Literal["passed", "failed"]
    diagnostics: list[ValidationDiagnostic] = Field(default_factory=list)


class OntologyCurrentResponse(BaseModel):
    release_id: str | None
    current_graph_iri: str | None
    meta_graph_iri: str
    updated_at: datetime | None


class OntologyConceptSummary(BaseModel):
    iri: str
    label: str
    category: str


class OntologyConceptDetail(BaseModel):
    iri: str
    label: str
    category: str
    comment: str | None
    outgoing_relations: list[str]
    incoming_relations: list[str]


class OntologyGraphNode(BaseModel):
    iri: str
    label: str
    category: str
    comment: str | None = None
    properties: dict[str, Any] = Field(default_factory=dict)


class OntologyGraphEdge(BaseModel):
    from_iri: str
    to_iri: str
    predicate: str


class OntologyGraphResponse(BaseModel):
    release_id: str
    graph_iri: str
    nodes: list[OntologyGraphNode] = Field(default_factory=list)
    edges: list[OntologyGraphEdge] = Field(default_factory=list)


class OntologySparqlQueryRequest(BaseModel):
    query: str = Field(min_length=3, max_length=20000)


class OntologySparqlQueryResponse(BaseModel):
    query_type: Literal["SELECT", "ASK"]
    bindings: list[dict[str, str]] = Field(default_factory=list)
    ask_result: bool | None = None
    graphs: list[str] = Field(default_factory=list)


class CopilotConversationMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=4000)


class CopilotChatRequest(BaseModel):
    question: str = Field(min_length=3, max_length=1000)
    conversation: list[CopilotConversationMessage] = Field(default_factory=list)


class CopilotEvidence(BaseModel):
    concept_iri: str
    query: str


CopilotToolName = Literal["sparql_read_only_query", "load_skill"]


class CopilotToolCall(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tool: CopilotToolName
    query: str | None = Field(default=None, max_length=20000)
    skill_name: str | None = Field(default=None, max_length=160)
    call_id: str | None = None
    raw_tool_call: dict[str, Any] | None = Field(default=None, exclude=True)

    @model_validator(mode="after")
    def validate_tool_arguments(self) -> CopilotToolCall:
        if self.tool == "sparql_read_only_query":
            if not self.query or len(self.query.strip()) < 3:
                raise ValueError("query is required for sparql_read_only_query")
        elif self.tool == "load_skill":
            if not self.skill_name or not self.skill_name.strip():
                raise ValueError("skill_name is required for load_skill")
        return self


class CopilotToolResult(BaseModel):
    tool: CopilotToolName
    query: str | None = None
    skill_name: str | None = None
    skill_description: str | None = None
    instructions_markdown: str | None = None
    allowed_tools: list[str] = Field(default_factory=list)
    loaded_skill_names: list[str] = Field(default_factory=list)
    query_type: Literal["SELECT", "ASK"] | None = None
    variables: list[str] = Field(default_factory=list)
    rows: list[dict[str, str]] = Field(default_factory=list)
    ask_result: bool | None = None
    row_count: int = 0
    truncated: bool = False
    graphs: list[str] = Field(default_factory=list)
    error: str | None = None


class CopilotStructuredOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    mode: Literal["direct_answer", "tool_call"]
    answer: str = Field(min_length=1, max_length=6000)
    evidence: list[CopilotEvidence] = Field(default_factory=list)
    tool_call: CopilotToolCall | None = None
    tool_calls: list[CopilotToolCall] = Field(default_factory=list, exclude=True)

    @model_validator(mode="after")
    def validate_mode_fields(self) -> CopilotStructuredOutput:
        if self.mode == "tool_call" and self.tool_call is None:
            raise ValueError("tool_call is required when mode is tool_call")
        if self.mode == "direct_answer" and self.tool_call is not None:
            raise ValueError("tool_call must be null when mode is direct_answer")
        return self


class CopilotChatResponse(BaseModel):
    mode: Literal["direct_answer", "tool_call"]
    answer: str
    evidence: list[CopilotEvidence] = Field(default_factory=list)
    current_release_id: str | None = None
    tool_call: CopilotToolCall | None = None
    tool_result: CopilotToolResult | None = None
    completion_messages_delta: list[dict[str, Any]] = Field(default_factory=list)


def parse_copilot_structured_output(output_json_text: str) -> CopilotStructuredOutput:
    parsed_raw = loads(output_json_text)
    return CopilotStructuredOutput.model_validate(parsed_raw)


def validate_copilot_structured_output(data: object) -> CopilotStructuredOutput:
    return CopilotStructuredOutput.model_validate(data)


def format_copilot_output_validation_error(exc: ValidationError) -> str:
    return "; ".join(
        f"{'.'.join(str(part) for part in error['loc']) or '<root>'}: {error['msg']}"
        for error in exc.errors()
    )


def make_release_graph_iri(release_id: str) -> str:
    return f"urn:seer:ontology:release:{release_id}"


def assert_valid_iri(value: str) -> str:
    if not _IRI_PATTERN.match(value):
        raise ValueError("invalid IRI")
    return value
