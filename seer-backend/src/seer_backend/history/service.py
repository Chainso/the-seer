"""History ingestion and query orchestration."""

from __future__ import annotations

import asyncio
import math
from datetime import UTC, datetime
from uuid import UUID, uuid4

from seer_backend.history.canonicalization import canonicalize_object_ref, xxhash64_uint64
from seer_backend.history.errors import (
    DuplicateEventError,
    HistoryDependencyUnavailableError,
)
from seer_backend.history.models import (
    EventHistoryItem,
    EventHistoryRecord,
    EventIngestRequest,
    EventIngestResponse,
    EventObjectLinkRecord,
    EventObjectRelationItem,
    EventObjectRelationsResponse,
    EventTimelineResponse,
    IngestedObjectSummary,
    LatestObjectItem,
    LatestObjectsResponse,
    ObjectEventItem,
    ObjectEventsResponse,
    ObjectHistoryItem,
    ObjectHistoryRecord,
    ObjectPropertyFilter,
    ObjectTimelineResponse,
)
from seer_backend.history.repository import HistoryRepository


class HistoryService:
    """Domain service for immutable event/object/link history."""

    def __init__(self, repository: HistoryRepository) -> None:
        self._repository = repository
        self._schema_ready = False
        self._schema_lock = asyncio.Lock()

    async def ingest_event(self, payload: EventIngestRequest) -> EventIngestResponse:
        await self._ensure_schema()

        if await self._repository.event_exists(payload.event_id):
            raise DuplicateEventError(f"event_id '{payload.event_id}' already exists")

        occurred_at = _ensure_utc(payload.occurred_at)
        ingested_at = datetime.now(UTC)

        event_record = EventHistoryRecord(
            event_id=payload.event_id,
            occurred_at=occurred_at,
            event_type=payload.event_type,
            source=payload.source,
            payload=payload.payload,
            trace_id=payload.trace_id,
            attributes=payload.attributes,
            produced_by_execution_id=payload.produced_by_execution_id,
            ingested_at=ingested_at,
        )

        object_rows: list[ObjectHistoryRecord] = []
        link_rows: list[EventObjectLinkRecord] = []
        linked_objects: list[IngestedObjectSummary] = []

        for obj in payload.updated_objects or []:
            canonical = canonicalize_object_ref(obj.object_ref)
            object_ref_hash = xxhash64_uint64(canonical)
            object_history_id = uuid4()

            object_record = ObjectHistoryRecord(
                object_history_id=object_history_id,
                object_type=obj.object_type,
                object_ref=obj.object_ref,
                object_ref_canonical=canonical,
                object_ref_hash=object_ref_hash,
                object_payload=obj.object_payload,
                recorded_at=occurred_at,
                source_event_id=payload.event_id,
            )
            link_record = EventObjectLinkRecord(
                event_id=payload.event_id,
                object_history_id=object_history_id,
                object_type=obj.object_type,
                object_ref=obj.object_ref,
                object_ref_canonical=canonical,
                object_ref_hash=object_ref_hash,
                relation_role=obj.relation_role,
                linked_at=ingested_at,
            )

            object_rows.append(object_record)
            link_rows.append(link_record)
            linked_objects.append(
                IngestedObjectSummary(
                    object_history_id=object_history_id,
                    object_type=obj.object_type,
                    object_ref_canonical=canonical,
                    object_ref_hash=object_ref_hash,
                )
            )

        await self._repository.insert_event_history(event_record)
        if object_rows:
            await self._repository.insert_object_history_rows(object_rows)
            await self._repository.insert_event_object_links(link_rows)

        return EventIngestResponse(
            event_id=payload.event_id,
            ingested_at=ingested_at,
            object_snapshot_count=len(object_rows),
            link_count=len(link_rows),
            linked_objects=linked_objects,
        )

    async def event_timeline(
        self,
        *,
        start_at: datetime | None,
        end_at: datetime | None,
        event_type: str | None,
        limit: int,
    ) -> EventTimelineResponse:
        await self._ensure_schema()
        rows = await self._repository.fetch_events(
            start_at=_ensure_optional_utc(start_at),
            end_at=_ensure_optional_utc(end_at),
            event_type=event_type,
            limit=limit,
        )
        return EventTimelineResponse(
            items=[
                EventHistoryItem(
                    event_id=row.event_id,
                    occurred_at=row.occurred_at,
                    event_type=row.event_type,
                    source=row.source,
                    payload=row.payload,
                    trace_id=row.trace_id,
                    attributes=row.attributes,
                    produced_by_execution_id=row.produced_by_execution_id,
                    ingested_at=row.ingested_at,
                )
                for row in rows
            ]
        )

    async def object_timeline(
        self,
        *,
        object_type: str,
        object_ref_hash: int,
        start_at: datetime | None,
        end_at: datetime | None,
        limit: int,
    ) -> ObjectTimelineResponse:
        await self._ensure_schema()
        rows = await self._repository.fetch_object_timeline(
            object_type=object_type,
            object_ref_hash=object_ref_hash,
            start_at=_ensure_optional_utc(start_at),
            end_at=_ensure_optional_utc(end_at),
            limit=limit,
        )
        return ObjectTimelineResponse(
            items=[
                ObjectHistoryItem(
                    object_history_id=row.object_history_id,
                    object_type=row.object_type,
                    object_ref=row.object_ref,
                    object_ref_canonical=row.object_ref_canonical,
                    object_ref_hash=row.object_ref_hash,
                    object_payload=row.object_payload,
                    recorded_at=row.recorded_at,
                    source_event_id=row.source_event_id,
                )
                for row in rows
            ]
        )

    async def latest_objects(
        self,
        *,
        object_type: str | None,
        property_filters: list[ObjectPropertyFilter],
        page: int,
        size: int,
    ) -> LatestObjectsResponse:
        await self._ensure_schema()
        offset = page * size
        rows, total = await self._repository.fetch_latest_objects(
            object_type=object_type,
            property_filters=property_filters,
            limit=size,
            offset=offset,
        )
        return LatestObjectsResponse(
            items=[
                LatestObjectItem(
                    object_history_id=row.object_history_id,
                    object_type=row.object_type,
                    object_ref=row.object_ref,
                    object_ref_canonical=row.object_ref_canonical,
                    object_ref_hash=row.object_ref_hash,
                    object_payload=row.object_payload,
                    recorded_at=row.recorded_at,
                    source_event_id=row.source_event_id,
                )
                for row in rows
            ],
            page=page,
            size=size,
            total=total,
            total_pages=_total_pages(total, size),
        )

    async def object_events(
        self,
        *,
        object_type: str,
        object_ref_hash: int | None,
        object_ref_canonical: str | None,
        start_at: datetime | None,
        end_at: datetime | None,
        page: int,
        size: int,
    ) -> ObjectEventsResponse:
        await self._ensure_schema()
        offset = page * size
        rows, total = await self._repository.fetch_object_events(
            object_type=object_type,
            object_ref_hash=object_ref_hash,
            object_ref_canonical=object_ref_canonical,
            start_at=_ensure_optional_utc(start_at),
            end_at=_ensure_optional_utc(end_at),
            limit=size,
            offset=offset,
        )
        return ObjectEventsResponse(
            items=[
                ObjectEventItem(
                    event_id=row.event_id,
                    occurred_at=row.occurred_at,
                    event_type=row.event_type,
                    source=row.source,
                    trace_id=row.trace_id,
                    payload=row.payload,
                    attributes=row.attributes,
                    produced_by_execution_id=row.produced_by_execution_id,
                    relation_role=row.relation_role,
                    linked_at=row.linked_at,
                    object_history_id=row.object_history_id,
                    recorded_at=row.recorded_at,
                    object_payload=row.object_payload,
                )
                for row in rows
            ],
            page=page,
            size=size,
            total=total,
            total_pages=_total_pages(total, size),
        )

    async def relations(
        self,
        *,
        event_id: UUID | None,
        object_type: str | None,
        object_ref_hash: int | None,
        limit: int,
    ) -> EventObjectRelationsResponse:
        await self._ensure_schema()
        rows = await self._repository.fetch_relations(
            event_id=event_id,
            object_type=object_type,
            object_ref_hash=object_ref_hash,
            limit=limit,
        )
        return EventObjectRelationsResponse(
            items=[
                EventObjectRelationItem(
                    event_id=row.event_id,
                    object_history_id=row.object_history_id,
                    object_type=row.object_type,
                    object_ref=row.object_ref,
                    object_ref_canonical=row.object_ref_canonical,
                    object_ref_hash=row.object_ref_hash,
                    relation_role=row.relation_role,
                    linked_at=row.linked_at,
                    occurred_at=row.occurred_at,
                    event_type=row.event_type,
                    source=row.source,
                    produced_by_execution_id=row.produced_by_execution_id,
                    object_payload=row.object_payload,
                    recorded_at=row.recorded_at,
                )
                for row in rows
            ]
        )

    async def _ensure_schema(self) -> None:
        if self._schema_ready:
            return
        async with self._schema_lock:
            if self._schema_ready:
                return
            await self._repository.ensure_schema()
            self._schema_ready = True


class UnavailableHistoryService:
    """Fallback service when history dependencies are unavailable."""

    def __init__(self, reason: str) -> None:
        self.reason = reason

    async def ingest_event(self, payload: EventIngestRequest) -> EventIngestResponse:
        del payload
        raise HistoryDependencyUnavailableError(self.reason)

    async def event_timeline(
        self,
        *,
        start_at: datetime | None,
        end_at: datetime | None,
        event_type: str | None,
        limit: int,
    ) -> EventTimelineResponse:
        del start_at, end_at, event_type, limit
        raise HistoryDependencyUnavailableError(self.reason)

    async def object_timeline(
        self,
        *,
        object_type: str,
        object_ref_hash: int,
        start_at: datetime | None,
        end_at: datetime | None,
        limit: int,
    ) -> ObjectTimelineResponse:
        del object_type, object_ref_hash, start_at, end_at, limit
        raise HistoryDependencyUnavailableError(self.reason)

    async def relations(
        self,
        *,
        event_id: UUID | None,
        object_type: str | None,
        object_ref_hash: int | None,
        limit: int,
    ) -> EventObjectRelationsResponse:
        del event_id, object_type, object_ref_hash, limit
        raise HistoryDependencyUnavailableError(self.reason)

    async def latest_objects(
        self,
        *,
        object_type: str | None,
        property_filters: list[ObjectPropertyFilter],
        page: int,
        size: int,
    ) -> LatestObjectsResponse:
        del object_type, property_filters, page, size
        raise HistoryDependencyUnavailableError(self.reason)

    async def object_events(
        self,
        *,
        object_type: str,
        object_ref_hash: int | None,
        object_ref_canonical: str | None,
        start_at: datetime | None,
        end_at: datetime | None,
        page: int,
        size: int,
    ) -> ObjectEventsResponse:
        del object_type, object_ref_hash, object_ref_canonical, start_at, end_at, page, size
        raise HistoryDependencyUnavailableError(self.reason)


def _ensure_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def _ensure_optional_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return _ensure_utc(value)


def _total_pages(total: int, size: int) -> int:
    if total <= 0:
        return 0
    return int(math.ceil(total / size))
