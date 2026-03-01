"""Process mining orchestration, transformation, and drill-down services."""

from __future__ import annotations

import asyncio
import base64
import json
from collections import defaultdict
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any
from uuid import UUID, uuid4

from seer_backend.analytics.errors import (
    ProcessMiningDependencyUnavailableError,
    ProcessMiningNoDataError,
    ProcessMiningTraceHandleError,
    ProcessMiningValidationError,
)
from seer_backend.analytics.models import (
    ExtractedProcessFrames,
    Pm4pyObjectCentricInput,
    ProcessEventRow,
    ProcessMiningRequest,
    ProcessMiningResponse,
    ProcessModelEdge,
    ProcessModelNode,
    ProcessPathStat,
    ProcessRelationRow,
    ProcessTraceDrilldownResponse,
    ProcessTraceRecord,
)
from seer_backend.analytics.repository import ProcessMiningRepository


@dataclass(slots=True)
class _ObjectInstanceInfo:
    object_type: str
    object_ref_hash: int
    object_ref_canonical: str


@dataclass(slots=True)
class _ObjectCentricLog:
    events_by_id: dict[UUID, ProcessEventRow]
    object_instances: dict[str, _ObjectInstanceInfo]
    instance_sequences: dict[str, list[ProcessEventRow]]


class OcpnMiningWrapper:
    """Wrapper that prefers pm4py and falls back to deterministic mining."""

    def mine(
        self,
        log: _ObjectCentricLog,
        pm4py_payload: Pm4pyObjectCentricInput,
    ) -> tuple[list[ProcessModelNode], list[ProcessModelEdge], list[ProcessPathStat], list[str]]:
        warnings: list[str] = []
        if not _pm4py_available():
            warnings.append(
                "pm4py is not installed in this runtime; using deterministic MVP fallback miner"
            )

        node_counts: dict[str, int] = defaultdict(int)
        edge_counts: dict[tuple[str, str, str], int] = defaultdict(int)
        path_counts: dict[tuple[str, str], int] = defaultdict(int)

        del pm4py_payload  # reserved for pm4py integration when dependency is available

        for sequence_id in sorted(log.instance_sequences):
            sequence = log.instance_sequences[sequence_id]
            if not sequence:
                continue

            info = log.object_instances[sequence_id]
            event_types = [item.event_type for item in sequence]
            path = " -> ".join(event_types)
            path_counts[(info.object_type, path)] += 1

            for event in sequence:
                node_counts[event.event_type] += 1

            for index in range(len(event_types) - 1):
                source = event_types[index]
                target = event_types[index + 1]
                edge_counts[(source, target, info.object_type)] += 1

        nodes = [
            ProcessModelNode(
                id=_node_id(event_type),
                label=event_type,
                node_type="event",
                frequency=node_counts[event_type],
                trace_handle="",
            )
            for event_type in sorted(node_counts)
        ]

        edges = [
            ProcessModelEdge(
                id=_edge_id(source, target, object_type),
                source=_node_id(source),
                target=_node_id(target),
                object_type=object_type,
                count=edge_counts[(source, target, object_type)],
                trace_handle="",
            )
            for (source, target, object_type) in sorted(edge_counts)
        ]

        path_stats = [
            ProcessPathStat(
                object_type=object_type,
                path=path,
                count=path_counts[(object_type, path)],
                trace_handle="",
            )
            for (object_type, path) in sorted(path_counts)
        ]
        return nodes, edges, path_stats, warnings


class ProcessMiningService:
    """Domain service for process mining and trace drill-down."""

    def __init__(
        self,
        *,
        repository: ProcessMiningRepository,
        miner: OcpnMiningWrapper,
        max_events_default: int,
        max_relations_default: int,
        max_traces_per_handle_default: int,
    ) -> None:
        self._repository = repository
        self._miner = miner
        self._max_events_default = max_events_default
        self._max_relations_default = max_relations_default
        self._max_traces_per_handle_default = max_traces_per_handle_default
        self._schema_ready = False
        self._schema_lock = asyncio.Lock()

    async def mine(self, payload: ProcessMiningRequest) -> ProcessMiningResponse:
        await self._ensure_schema()
        max_events = payload.max_events or self._max_events_default
        max_relations = payload.max_relations or self._max_relations_default

        frames = await self._repository.extract_frames(
            payload,
            max_events=max_events,
            max_relations=max_relations,
        )
        if not frames.events or not frames.relations:
            raise ProcessMiningNoDataError(
                "no process-mining data found for the provided anchor/time window"
            )

        log = _build_object_centric_log(frames)
        pm4py_payload = _to_pm4py_input(frames)
        nodes, edges, path_stats, warnings = self._miner.mine(log, pm4py_payload)

        run_id = str(uuid4())
        anchor_object_type = payload.anchor_object_type
        include_object_types = payload.include_object_types or []
        context = {
            "anchor_object_type": anchor_object_type,
            "start_at": _to_iso_utc(payload.start_at),
            "end_at": _to_iso_utc(payload.end_at),
            "include_object_types": include_object_types,
        }

        for node in nodes:
            node.trace_handle = _encode_trace_handle(
                {
                    "selector": {
                        "type": "node",
                        "event_type": node.label,
                    },
                    "context": context,
                }
            )

        for edge in edges:
            source_label = edge.source.removeprefix("event:")
            target_label = edge.target.removeprefix("event:")
            edge.trace_handle = _encode_trace_handle(
                {
                    "selector": {
                        "type": "edge",
                        "source": source_label,
                        "target": target_label,
                        "object_type": edge.object_type,
                    },
                    "context": context,
                }
            )

        for stat in path_stats:
            stat.trace_handle = _encode_trace_handle(
                {
                    "selector": {
                        "type": "path",
                        "object_type": stat.object_type,
                        "path": stat.path,
                    },
                    "context": context,
                }
            )

        object_types = sorted({edge.object_type for edge in edges})
        if anchor_object_type not in object_types:
            object_types = sorted({*object_types, anchor_object_type})

        return ProcessMiningResponse(
            run_id=run_id,
            anchor_object_type=anchor_object_type,
            start_at=_ensure_utc(payload.start_at),
            end_at=_ensure_utc(payload.end_at),
            nodes=nodes,
            edges=edges,
            object_types=object_types,
            path_stats=path_stats,
            warnings=warnings,
        )

    async def trace_drilldown(
        self,
        *,
        handle: str,
        limit: int,
    ) -> ProcessTraceDrilldownResponse:
        await self._ensure_schema()
        payload = _decode_trace_handle(handle)

        selector = payload.get("selector")
        context = payload.get("context")
        if not isinstance(selector, dict) or not isinstance(context, dict):
            raise ProcessMiningTraceHandleError("trace handle payload is malformed")

        anchor_object_type = context.get("anchor_object_type")
        start_at = context.get("start_at")
        end_at = context.get("end_at")
        include_object_types = context.get("include_object_types")
        if not isinstance(anchor_object_type, str):
            raise ProcessMiningTraceHandleError("trace handle is missing anchor_object_type")
        if not isinstance(start_at, str) or not isinstance(end_at, str):
            raise ProcessMiningTraceHandleError("trace handle is missing time window")

        request = ProcessMiningRequest(
            anchor_object_type=anchor_object_type,
            start_at=_parse_iso_datetime(start_at),
            end_at=_parse_iso_datetime(end_at),
            include_object_types=(
                list(include_object_types)
                if isinstance(include_object_types, list)
                else None
            ),
            max_events=self._max_events_default,
            max_relations=self._max_relations_default,
        )
        frames = await self._repository.extract_frames(
            request,
            max_events=request.max_events or self._max_events_default,
            max_relations=request.max_relations or self._max_relations_default,
        )
        log = _build_object_centric_log(frames)
        traces = _filter_traces(log, selector)

        final_limit = max(1, min(limit, self._max_traces_per_handle_default))
        return ProcessTraceDrilldownResponse(
            handle=handle,
            selector_type=str(selector.get("type", "unknown")),
            traces=traces[:final_limit],
            matched_count=len(traces),
            truncated=len(traces) > final_limit,
        )

    async def _ensure_schema(self) -> None:
        if self._schema_ready:
            return
        async with self._schema_lock:
            if self._schema_ready:
                return
            await self._repository.ensure_schema()
            self._schema_ready = True


class UnavailableProcessMiningService:
    """Fallback when process mining dependencies cannot initialize."""

    def __init__(self, reason: str) -> None:
        self.reason = reason

    async def mine(self, payload: ProcessMiningRequest) -> ProcessMiningResponse:
        del payload
        raise ProcessMiningDependencyUnavailableError(self.reason)

    async def trace_drilldown(
        self,
        *,
        handle: str,
        limit: int,
    ) -> ProcessTraceDrilldownResponse:
        del handle, limit
        raise ProcessMiningDependencyUnavailableError(self.reason)


def validate_guardrails(*, max_events: int, max_relations: int) -> None:
    if max_events <= 0:
        raise ProcessMiningValidationError("max_events must be positive")
    if max_relations <= 0:
        raise ProcessMiningValidationError("max_relations must be positive")


def _build_object_centric_log(frames: ExtractedProcessFrames) -> _ObjectCentricLog:
    events_by_id = {row.event_id: row for row in frames.events}
    object_instances: dict[str, _ObjectInstanceInfo] = {}

    instance_event_map: dict[str, dict[UUID, ProcessEventRow]] = defaultdict(dict)
    for relation in frames.relations:
        event = events_by_id.get(relation.event_id)
        if event is None:
            continue
        instance_id = _object_instance_id(relation)
        object_instances.setdefault(
            instance_id,
            _ObjectInstanceInfo(
                object_type=relation.object_type,
                object_ref_hash=relation.object_ref_hash,
                object_ref_canonical=relation.object_ref_canonical,
            ),
        )
        instance_event_map[instance_id][event.event_id] = event

    instance_sequences: dict[str, list[ProcessEventRow]] = {}
    for instance_id, event_map in instance_event_map.items():
        ordered_events = sorted(
            event_map.values(),
            key=lambda row: (_ensure_utc(row.occurred_at), str(row.event_id)),
        )
        instance_sequences[instance_id] = ordered_events

    return _ObjectCentricLog(
        events_by_id=events_by_id,
        object_instances=object_instances,
        instance_sequences=instance_sequences,
    )


def _to_pm4py_input(frames: ExtractedProcessFrames) -> Pm4pyObjectCentricInput:
    events = [
        {
            "event_id": str(row.event_id),
            "activity": row.event_type,
            "timestamp": _to_iso_utc(row.occurred_at),
            "source": row.source,
            "trace_id": row.trace_id,
        }
        for row in frames.events
    ]
    objects = [
        {
            "object_id": f"{row.object_type}:{row.object_ref_hash}",
            "object_type": row.object_type,
            "object_ref_hash": row.object_ref_hash,
            "object_ref_canonical": row.object_ref_canonical,
            "object_ref": row.object_ref,
            "object_payload": row.object_payload,
        }
        for row in frames.objects
    ]
    relations = [
        {
            "event_id": str(row.event_id),
            "object_id": f"{row.object_type}:{row.object_ref_hash}",
            "object_type": row.object_type,
            "relation_role": row.relation_role,
        }
        for row in frames.relations
    ]
    return Pm4pyObjectCentricInput(events=events, objects=objects, relations=relations)


def _filter_traces(
    log: _ObjectCentricLog,
    selector: dict[str, Any],
) -> list[ProcessTraceRecord]:
    selector_type = selector.get("type")
    if not isinstance(selector_type, str):
        raise ProcessMiningTraceHandleError("trace selector type is missing")

    output: list[ProcessTraceRecord] = []
    for instance_id in sorted(log.instance_sequences):
        sequence = log.instance_sequences[instance_id]
        if not sequence:
            continue

        info = log.object_instances[instance_id]
        event_types = [item.event_type for item in sequence]
        include = False

        if selector_type == "node":
            event_type = selector.get("event_type")
            if isinstance(event_type, str) and event_type in event_types:
                include = True

        elif selector_type == "edge":
            source = selector.get("source")
            target = selector.get("target")
            object_type = selector.get("object_type")
            if (
                isinstance(source, str)
                and isinstance(target, str)
                and isinstance(object_type, str)
                and object_type == info.object_type
            ):
                include = any(
                    event_types[index] == source and event_types[index + 1] == target
                    for index in range(len(event_types) - 1)
                )

        elif selector_type == "path":
            object_type = selector.get("object_type")
            path = selector.get("path")
            if (
                isinstance(object_type, str)
                and isinstance(path, str)
                and object_type == info.object_type
            ):
                include = " -> ".join(event_types) == path

        else:
            raise ProcessMiningTraceHandleError(f"unsupported selector type '{selector_type}'")

        if not include:
            continue

        trace_ids = [row.trace_id for row in sequence if row.trace_id]
        output.append(
            ProcessTraceRecord(
                object_type=info.object_type,
                object_ref_hash=info.object_ref_hash,
                object_ref_canonical=info.object_ref_canonical,
                event_ids=[row.event_id for row in sequence],
                event_types=event_types,
                start_at=_ensure_utc(sequence[0].occurred_at),
                end_at=_ensure_utc(sequence[-1].occurred_at),
                trace_id=trace_ids[0] if trace_ids else None,
            )
        )

    output.sort(
        key=lambda row: (
            row.object_type,
            row.object_ref_hash,
            row.start_at,
            row.event_ids[0] if row.event_ids else UUID(int=0),
        )
    )
    return output


def _object_instance_id(relation: ProcessRelationRow) -> str:
    return f"{relation.object_type}:{relation.object_ref_hash}"


def _node_id(event_type: str) -> str:
    return f"event:{event_type}"


def _edge_id(source: str, target: str, object_type: str) -> str:
    return f"edge:{object_type}:{source}->{target}"


def _encode_trace_handle(payload: dict[str, Any]) -> str:
    raw = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _decode_trace_handle(handle: str) -> dict[str, Any]:
    if not handle:
        raise ProcessMiningTraceHandleError("trace handle is required")

    padded = handle + ("=" * ((4 - len(handle) % 4) % 4))
    try:
        decoded = base64.urlsafe_b64decode(padded.encode("ascii"))
        payload = json.loads(decoded.decode("utf-8"))
    except (ValueError, json.JSONDecodeError) as exc:
        raise ProcessMiningTraceHandleError("trace handle is invalid") from exc

    if not isinstance(payload, dict):
        raise ProcessMiningTraceHandleError("trace handle payload is invalid")
    return payload


def _to_iso_utc(value: datetime) -> str:
    normalized = _ensure_utc(value)
    return normalized.isoformat().replace("+00:00", "Z")


def _parse_iso_datetime(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return _ensure_utc(parsed)


def _ensure_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def _pm4py_available() -> bool:
    try:
        import pm4py  # noqa: F401
    except ImportError:
        return False
    return True
