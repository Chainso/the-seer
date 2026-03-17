"""Catalog API response models."""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field


class CatalogConceptLink(BaseModel):
    catalog_key: str
    name: str


class CatalogObjectListItem(BaseModel):
    catalog_key: str
    name: str
    description: str | None = None
    action_count: int
    event_count: int


class CatalogActionListItem(BaseModel):
    catalog_key: str
    name: str
    description: str | None = None
    object_count: int
    trigger_count: int


class CatalogEventListItem(BaseModel):
    catalog_key: str
    name: str
    description: str | None = None
    object_count: int
    trigger_count: int


class CatalogTriggerListItem(BaseModel):
    catalog_key: str
    name: str
    description: str | None = None
    event_count: int
    action_count: int


class CatalogObjectListResponse(BaseModel):
    items: list[CatalogObjectListItem] = Field(default_factory=list)


class CatalogActionListResponse(BaseModel):
    items: list[CatalogActionListItem] = Field(default_factory=list)


class CatalogEventListResponse(BaseModel):
    items: list[CatalogEventListItem] = Field(default_factory=list)


class CatalogTriggerListResponse(BaseModel):
    items: list[CatalogTriggerListItem] = Field(default_factory=list)


class CatalogObjectDetailResponse(BaseModel):
    catalog_key: str
    name: str
    description: str | None = None
    documentation: str | None = None
    object_type_uri: str
    actions: list[CatalogConceptLink] = Field(default_factory=list)
    events: list[CatalogConceptLink] = Field(default_factory=list)
    triggers: list[CatalogConceptLink] = Field(default_factory=list)


class CatalogActionDetailResponse(BaseModel):
    catalog_key: str
    name: str
    description: str | None = None
    documentation: str | None = None
    objects: list[CatalogConceptLink] = Field(default_factory=list)
    events: list[CatalogConceptLink] = Field(default_factory=list)
    triggers: list[CatalogConceptLink] = Field(default_factory=list)


class CatalogEventDetailResponse(BaseModel):
    catalog_key: str
    name: str
    description: str | None = None
    documentation: str | None = None
    objects: list[CatalogConceptLink] = Field(default_factory=list)
    actions: list[CatalogConceptLink] = Field(default_factory=list)
    triggers: list[CatalogConceptLink] = Field(default_factory=list)


class CatalogTriggerDetailResponse(BaseModel):
    catalog_key: str
    name: str
    description: str | None = None
    documentation: str | None = None
    events: list[CatalogConceptLink] = Field(default_factory=list)
    actions: list[CatalogConceptLink] = Field(default_factory=list)
    objects: list[CatalogConceptLink] = Field(default_factory=list)


class CatalogObjectInstanceItem(BaseModel):
    instance_id: UUID
    recorded_at: datetime
    source_event_id: UUID | None = None
    reference: dict[str, Any]
    data: dict[str, Any]


class CatalogObjectInstancesResponse(BaseModel):
    catalog_key: str
    name: str
    page: int
    size: int
    total: int
    total_pages: int
    instances: list[CatalogObjectInstanceItem] = Field(default_factory=list)


class CatalogActionRunItem(BaseModel):
    run_id: UUID
    status: str
    submitted_at: datetime
    updated_at: datetime
    completed_at: datetime | None = None
    attempt_count: int
    last_error_code: str | None = None
    last_error_detail: str | None = None


class CatalogActionRunsResponse(BaseModel):
    catalog_key: str
    name: str
    page: int
    size: int
    total: int
    runs: list[CatalogActionRunItem] = Field(default_factory=list)


class CatalogEventOccurrenceItem(BaseModel):
    event_id: UUID
    occurred_at: datetime
    source: str
    trace_id: str | None = None
    produced_by_execution_id: UUID | None = None
    payload: dict[str, Any]


class CatalogEventOccurrencesResponse(BaseModel):
    catalog_key: str
    name: str
    limit: int
    occurrences: list[CatalogEventOccurrenceItem] = Field(default_factory=list)


class CatalogTriggerFiringItem(BaseModel):
    event_id: UUID
    occurred_at: datetime
    source: str
    trace_id: str | None = None
    payload: dict[str, Any]


class CatalogTriggerFiringsResponse(BaseModel):
    catalog_key: str
    name: str
    event: CatalogConceptLink | None = None
    action: CatalogConceptLink | None = None
    limit: int
    firings: list[CatalogTriggerFiringItem] = Field(default_factory=list)
