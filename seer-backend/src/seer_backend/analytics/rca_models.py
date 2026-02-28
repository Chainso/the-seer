"""Root-cause analysis request/response contracts and extraction frame models."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

JsonObject = dict[str, Any]


class OutcomeDefinition(BaseModel):
    """Run-scoped binary outcome definition for RCA."""

    model_config = ConfigDict(extra="forbid")

    kind: Literal["event_type"] = "event_type"
    event_type: str = Field(min_length=1, max_length=200)
    object_type: str | None = Field(default=None, min_length=1, max_length=160)


class RcaFilterCondition(BaseModel):
    """Optional cohort filter condition applied to lifted anchor features."""

    model_config = ConfigDict(extra="forbid")

    field: str = Field(min_length=1, max_length=240)
    op: Literal["eq", "ne", "contains", "gt", "gte", "lt", "lte"] = "eq"
    value: str = Field(min_length=1, max_length=300)

    @field_validator("field", "value")
    @classmethod
    def strip_values(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("filter field/value must not be blank")
        return cleaned


class RootCauseRequest(BaseModel):
    """Input contract for root-cause analysis runs."""

    model_config = ConfigDict(extra="forbid")

    anchor_object_type: str = Field(min_length=1, max_length=160)
    start_at: datetime
    end_at: datetime
    depth: int = Field(default=1, ge=1, le=3)
    outcome: OutcomeDefinition
    filters: list[RcaFilterCondition] = Field(default_factory=list)
    beam_width: int = Field(default=20, ge=1, le=50)
    max_rule_length: int = Field(default=3, ge=1, le=3)
    min_coverage_ratio: float = Field(default=0.02, ge=0.0, le=1.0)
    mi_cardinality_threshold: int = Field(default=8, ge=2, le=500)
    max_insights: int = Field(default=25, ge=1, le=100)

    @model_validator(mode="after")
    def validate_time_window(self) -> RootCauseRequest:
        if self.start_at >= self.end_at:
            raise ValueError("start_at must be earlier than end_at")
        return self


class InsightCondition(BaseModel):
    feature: str
    op: Literal["eq"] = "eq"
    value: str


class InsightScore(BaseModel):
    wracc: float
    mutual_information: float | None = None
    coverage: float
    support: int
    positives: int
    subgroup_rate: float
    baseline_rate: float
    lift: float


class InsightEvidenceSummary(BaseModel):
    matched_anchor_count: int
    matched_positive_count: int
    sample_anchor_keys: list[str] = Field(default_factory=list)
    top_event_types: list[str] = Field(default_factory=list)


class InsightResult(BaseModel):
    insight_id: str
    rank: int
    title: str
    conditions: list[InsightCondition] = Field(default_factory=list)
    score: InsightScore
    evidence_handle: str
    evidence: InsightEvidenceSummary
    caveat: str


class RootCauseRunResponse(BaseModel):
    run_id: str
    anchor_object_type: str
    start_at: datetime
    end_at: datetime
    depth: int
    outcome: OutcomeDefinition
    cohort_size: int
    positive_count: int
    baseline_rate: float
    feature_count: int
    insights: list[InsightResult] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    interpretation_caveat: str


class RootCauseEvidenceEvent(BaseModel):
    event_id: UUID
    occurred_at: datetime
    event_type: str
    object_instances: list[str] = Field(default_factory=list)


class RootCauseEvidenceTrace(BaseModel):
    anchor_key: str
    anchor_object_type: str
    anchor_object_ref_hash: int
    anchor_object_ref_canonical: str
    outcome: bool
    events: list[RootCauseEvidenceEvent] = Field(default_factory=list)


class RootCauseEvidenceResponse(BaseModel):
    handle: str
    insight_id: str
    matched_anchor_count: int
    matched_positive_count: int
    traces: list[RootCauseEvidenceTrace] = Field(default_factory=list)
    truncated: bool


class RootCauseAssistSetupRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    anchor_object_type: str = Field(min_length=1, max_length=160)
    start_at: datetime
    end_at: datetime

    @model_validator(mode="after")
    def validate_window(self) -> RootCauseAssistSetupRequest:
        if self.start_at >= self.end_at:
            raise ValueError("start_at must be earlier than end_at")
        return self


class RootCauseSetupSuggestion(BaseModel):
    outcome: OutcomeDefinition
    rationale: str


class RootCauseAssistSetupResponse(BaseModel):
    suggested_depth: int
    suggestions: list[RootCauseSetupSuggestion] = Field(default_factory=list)
    notes: list[str] = Field(default_factory=list)


class RootCauseAssistInterpretRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    baseline_rate: float = Field(ge=0.0, le=1.0)
    insights: list[InsightResult] = Field(default_factory=list)


class RootCauseAssistInterpretResponse(BaseModel):
    summary: str
    caveats: list[str] = Field(default_factory=list)
    next_steps: list[str] = Field(default_factory=list)


@dataclass(slots=True, frozen=True)
class RcaObjectInstance:
    object_type: str
    object_ref_hash: int
    object_ref_canonical: str


@dataclass(slots=True)
class RcaEventRow:
    event_id: UUID
    occurred_at: datetime
    event_type: str
    source: str
    trace_id: str | None


@dataclass(slots=True)
class RcaObjectRow:
    object_history_id: UUID
    object_type: str
    object_ref_hash: int
    object_ref_canonical: str
    object_payload: JsonObject | None
    recorded_at: datetime


@dataclass(slots=True)
class RcaRelationRow:
    event_id: UUID
    object_history_id: UUID
    object_type: str
    object_ref_hash: int
    object_ref_canonical: str
    relation_role: str | None


@dataclass(slots=True)
class ExtractedRcaNeighborhood:
    anchors: list[RcaObjectInstance]
    events: list[RcaEventRow]
    objects: list[RcaObjectRow]
    relations: list[RcaRelationRow]
