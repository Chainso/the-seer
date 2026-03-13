"""Process mining request/response contracts and frame models."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any
from urllib.parse import urlparse
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

JsonObject = dict[str, Any]


class ProcessMiningRequest(BaseModel):
    """Input contract for object-centric process mining runs."""

    model_config = ConfigDict(extra="forbid")

    anchor_object_type: str = Field(min_length=1, max_length=400)
    start_at: datetime
    end_at: datetime
    include_object_types: list[str] | None = None
    max_events: int | None = Field(default=None, ge=1, le=200_000)
    max_relations: int | None = Field(default=None, ge=1, le=500_000)
    max_traces_per_handle: int | None = Field(default=None, ge=1, le=500)

    @field_validator("anchor_object_type")
    @classmethod
    def validate_anchor_object_type_uri(cls, value: str) -> str:
        return _validate_uri_identifier("anchor_object_type", value)

    @field_validator("include_object_types")
    @classmethod
    def validate_include_object_types(
        cls,
        value: list[str] | None,
    ) -> list[str] | None:
        if value is None:
            return None
        normalized: list[str] = []
        seen: set[str] = set()
        for item in value:
            cleaned = _validate_uri_identifier("include_object_types", item)
            if cleaned not in seen:
                normalized.append(cleaned)
                seen.add(cleaned)
        return normalized

    @model_validator(mode="after")
    def validate_time_window(self) -> ProcessMiningRequest:
        if self.start_at >= self.end_at:
            raise ValueError("start_at must be earlier than end_at")

        anchor_object_type = self.anchor_object_type
        include_object_types = self.include_object_types
        if include_object_types and anchor_object_type not in include_object_types:
            self.include_object_types = [anchor_object_type, *self.include_object_types]
        return self


class ProcessModelNode(BaseModel):
    id: str
    label: str
    node_type: str
    frequency: int = Field(ge=0)
    trace_handle: str


class ProcessModelEdge(BaseModel):
    id: str
    source: str
    target: str
    object_type: str
    count: int = Field(ge=0)
    trace_handle: str


class ProcessPathStat(BaseModel):
    object_type: str
    path: str
    count: int = Field(ge=0)
    trace_handle: str


class ProcessMiningResponse(BaseModel):
    run_id: str
    anchor_object_type: str
    start_at: datetime
    end_at: datetime
    nodes: list[ProcessModelNode] = Field(default_factory=list)
    edges: list[ProcessModelEdge] = Field(default_factory=list)
    object_types: list[str] = Field(default_factory=list)
    path_stats: list[ProcessPathStat] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class OcdfgMiningRequest(ProcessMiningRequest):
    """Input contract for OC-DFG process mining runs."""


class OcdfgNode(BaseModel):
    id: str
    activity: str
    count: int = Field(ge=0)
    event_count: int = Field(ge=0)
    unique_object_count: int = Field(ge=0)
    total_object_count: int = Field(ge=0)
    trace_handle: str


class OcdfgEdge(BaseModel):
    id: str
    source: str
    target: str
    source_activity: str
    target_activity: str
    object_type: str
    count: int = Field(ge=0)
    event_couple_count: int = Field(ge=0)
    unique_object_count: int = Field(ge=0)
    total_object_count: int = Field(ge=0)
    share: float = Field(ge=0.0, le=1.0)
    p50_seconds: float | None = Field(default=None, ge=0.0)
    p95_seconds: float | None = Field(default=None, ge=0.0)
    trace_handle: str


class OcdfgBoundaryActivity(BaseModel):
    id: str
    object_type: str
    activity: str
    count: int = Field(ge=0)
    event_count: int = Field(ge=0)
    unique_object_count: int = Field(ge=0)
    total_object_count: int = Field(ge=0)
    trace_handle: str


class OcdfgMiningResponse(BaseModel):
    run_id: str
    anchor_object_type: str
    start_at: datetime
    end_at: datetime
    nodes: list[OcdfgNode] = Field(default_factory=list)
    edges: list[OcdfgEdge] = Field(default_factory=list)
    start_activities: list[OcdfgBoundaryActivity] = Field(default_factory=list)
    end_activities: list[OcdfgBoundaryActivity] = Field(default_factory=list)
    object_types: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class ProcessTraceRecord(BaseModel):
    object_type: str
    object_ref_hash: int
    object_ref_canonical: str
    event_ids: list[UUID] = Field(default_factory=list)
    event_types: list[str] = Field(default_factory=list)
    start_at: datetime
    end_at: datetime
    trace_id: str | None = None


class ProcessTraceDrilldownResponse(BaseModel):
    handle: str
    selector_type: str
    traces: list[ProcessTraceRecord] = Field(default_factory=list)
    matched_count: int = Field(ge=0)
    truncated: bool


@dataclass(slots=True)
class ProcessEventRow:
    event_id: UUID
    occurred_at: datetime
    event_type: str
    source: str
    trace_id: str | None


@dataclass(slots=True)
class ProcessObjectRow:
    object_history_id: UUID
    object_type: str
    object_ref_hash: int
    object_ref_canonical: str
    object_ref: JsonObject
    object_payload: JsonObject | None


@dataclass(slots=True)
class ProcessRelationRow:
    event_id: UUID
    object_history_id: UUID
    object_type: str
    object_ref_hash: int
    object_ref_canonical: str
    relation_role: str | None


@dataclass(slots=True)
class ExtractedProcessFrames:
    events: list[ProcessEventRow]
    objects: list[ProcessObjectRow]
    relations: list[ProcessRelationRow]


@dataclass(slots=True)
class OcdfgNodeMetrics:
    activity: str
    event_count: int
    unique_object_count: int
    total_object_count: int


@dataclass(slots=True)
class OcdfgEdgeMetrics:
    object_type: str
    source_activity: str
    target_activity: str
    event_couple_count: int
    unique_object_count: int
    total_object_count: int
    p50_seconds: float | None
    p95_seconds: float | None


@dataclass(slots=True)
class OcdfgBoundaryMetrics:
    object_type: str
    activity: str
    event_count: int
    unique_object_count: int
    total_object_count: int


@dataclass(slots=True)
class OcdfgQueryResult:
    nodes: list[OcdfgNodeMetrics]
    edges: list[OcdfgEdgeMetrics]
    start_activities: list[OcdfgBoundaryMetrics]
    end_activities: list[OcdfgBoundaryMetrics]
def _validate_uri_identifier(field_name: str, value: str) -> str:
    cleaned = value.strip()
    if not cleaned:
        raise ValueError(f"{field_name} must not be blank")
    parsed = urlparse(cleaned)
    if not parsed.scheme or not (parsed.netloc or parsed.path):
        raise ValueError(f"{field_name} must be a URI identifier")
    return cleaned
