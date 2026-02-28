"""Process mining request/response contracts and frame models."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

JsonObject = dict[str, Any]


class ProcessMiningRequest(BaseModel):
    """Input contract for object-centric process mining runs."""

    model_config = ConfigDict(extra="forbid")

    anchor_object_type: str = Field(min_length=1, max_length=160)
    anchor_object_type_uri: str | None = Field(default=None, min_length=1, max_length=400)
    start_at: datetime
    end_at: datetime
    include_object_types: list[str] | None = None
    include_object_type_uris: list[str] | None = None
    max_events: int | None = Field(default=None, ge=1, le=200_000)
    max_relations: int | None = Field(default=None, ge=1, le=500_000)
    max_traces_per_handle: int | None = Field(default=None, ge=1, le=500)

    @property
    def canonical_anchor_object_type(self) -> str:
        return self.anchor_object_type_uri or self.anchor_object_type

    @property
    def canonical_include_object_types(self) -> list[str] | None:
        return self.include_object_type_uris or self.include_object_types

    @field_validator("include_object_types", "include_object_type_uris")
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
            cleaned = item.strip()
            if not cleaned:
                raise ValueError("include_object_types must not contain blank values")
            if cleaned not in seen:
                normalized.append(cleaned)
                seen.add(cleaned)
        return normalized

    @model_validator(mode="after")
    def validate_time_window(self) -> ProcessMiningRequest:
        if self.start_at >= self.end_at:
            raise ValueError("start_at must be earlier than end_at")

        anchor_object_type = self.canonical_anchor_object_type
        include_object_types = self.canonical_include_object_types
        if include_object_types and anchor_object_type not in include_object_types:
            if self.include_object_type_uris is not None:
                self.include_object_type_uris = [
                    anchor_object_type,
                    *self.include_object_type_uris,
                ]
            else:
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
class Pm4pyObjectCentricInput:
    """Minimal object-centric payload shape for pm4py wrappers."""

    events: list[dict[str, Any]]
    objects: list[dict[str, Any]]
    relations: list[dict[str, Any]]
