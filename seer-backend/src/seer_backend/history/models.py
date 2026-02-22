"""History request/response and persistence models."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

JsonObject = dict[str, Any]


class UpdatedObjectPayload(BaseModel):
    """Object snapshot emitted in event envelopes."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    object_type: str = Field(min_length=1, max_length=160)
    object_ref: JsonObject
    object_payload: JsonObject = Field(alias="object")
    relation_role: str | None = Field(default=None, max_length=120)

    @model_validator(mode="after")
    def validate_declared_object_type(self) -> UpdatedObjectPayload:
        payload_type = self.object_payload.get("object_type")
        if isinstance(payload_type, str) and payload_type != self.object_type:
            raise ValueError(
                "updated_objects.object_type must match updated_objects.object.object_type "
                "when payload type is provided"
            )
        return self


class EventIngestRequest(BaseModel):
    """Ingestion contract for event history persistence."""

    model_config = ConfigDict(extra="forbid")

    event_id: UUID
    occurred_at: datetime
    event_type: str = Field(min_length=1, max_length=200)
    source: str = Field(min_length=1, max_length=200)
    payload: JsonObject
    trace_id: str | None = Field(default=None, max_length=200)
    schema_version: str | None = Field(default=None, max_length=120)
    attributes: JsonObject | None = None
    updated_objects: list[UpdatedObjectPayload] | None = None


class IngestedObjectSummary(BaseModel):
    object_history_id: UUID
    object_type: str
    object_ref_canonical: str
    object_ref_hash: int


class EventIngestResponse(BaseModel):
    event_id: UUID
    ingested_at: datetime
    object_snapshot_count: int
    link_count: int
    linked_objects: list[IngestedObjectSummary] = Field(default_factory=list)


class EventHistoryItem(BaseModel):
    event_id: UUID
    occurred_at: datetime
    event_type: str
    source: str
    payload: JsonObject
    trace_id: str | None = None
    attributes: JsonObject | None = None
    ingested_at: datetime


class EventTimelineResponse(BaseModel):
    items: list[EventHistoryItem] = Field(default_factory=list)


class ObjectHistoryItem(BaseModel):
    object_history_id: UUID
    object_type: str
    object_ref: JsonObject
    object_ref_canonical: str
    object_ref_hash: int
    object_payload: JsonObject
    recorded_at: datetime
    source_event_id: UUID | None = None


class ObjectTimelineResponse(BaseModel):
    items: list[ObjectHistoryItem] = Field(default_factory=list)


class EventObjectRelationItem(BaseModel):
    event_id: UUID
    object_history_id: UUID
    object_type: str
    object_ref: JsonObject
    object_ref_canonical: str
    object_ref_hash: int
    relation_role: str | None = None
    linked_at: datetime
    occurred_at: datetime | None = None
    event_type: str | None = None
    source: str | None = None
    object_payload: JsonObject | None = None
    recorded_at: datetime | None = None


class EventObjectRelationsResponse(BaseModel):
    items: list[EventObjectRelationItem] = Field(default_factory=list)


@dataclass(slots=True)
class EventHistoryRecord:
    event_id: UUID
    occurred_at: datetime
    event_type: str
    source: str
    payload: JsonObject
    trace_id: str | None
    attributes: JsonObject | None
    ingested_at: datetime


@dataclass(slots=True)
class ObjectHistoryRecord:
    object_history_id: UUID
    object_type: str
    object_ref: JsonObject
    object_ref_canonical: str
    object_ref_hash: int
    object_payload: JsonObject
    recorded_at: datetime
    source_event_id: UUID | None


@dataclass(slots=True)
class EventObjectLinkRecord:
    event_id: UUID
    object_history_id: UUID
    object_type: str
    object_ref: JsonObject
    object_ref_canonical: str
    object_ref_hash: int
    relation_role: str | None
    linked_at: datetime


@dataclass(slots=True)
class EventObjectRelationRecord:
    event_id: UUID
    object_history_id: UUID
    object_type: str
    object_ref: JsonObject
    object_ref_canonical: str
    object_ref_hash: int
    relation_role: str | None
    linked_at: datetime
    occurred_at: datetime | None
    event_type: str | None
    source: str | None
    object_payload: JsonObject | None
    recorded_at: datetime | None
