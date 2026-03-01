"""Process mining orchestration, transformation, and drill-down services."""

from __future__ import annotations

import asyncio
import base64
import json
import math
from collections import defaultdict
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any
from uuid import UUID, uuid4

from seer_backend.analytics.errors import (
    ProcessMiningDependencyUnavailableError,
    ProcessMiningError,
    ProcessMiningNoDataError,
    ProcessMiningTraceHandleError,
    ProcessMiningValidationError,
)
from seer_backend.analytics.models import (
    ExtractedOcdfgFrames,
    ExtractedProcessFrames,
    OcdfgBoundaryActivity,
    OcdfgEdge,
    OcdfgMiningRequest,
    OcdfgMiningResponse,
    OcdfgNode,
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


class OcdfgMiningWrapper:
    """pm4py-backed OC-DFG discovery wrapper."""

    def mine(
        self,
        frames: ExtractedOcdfgFrames,
    ) -> tuple[
        list[OcdfgNode],
        list[OcdfgEdge],
        list[OcdfgBoundaryActivity],
        list[OcdfgBoundaryActivity],
        list[str],
    ]:
        if _is_empty_frame(frames.events) or _is_empty_frame(frames.relations):
            return [], [], [], [], []

        ocel = _to_ocel(frames)
        ocdfg_result = _run_ocdfg_discovery(ocel)
        nodes = _normalize_ocdfg_nodes(ocdfg_result)
        edges = _normalize_ocdfg_edges(ocdfg_result)
        start_activities = _normalize_ocdfg_boundary_activities(
            ocdfg_result,
            field_name="start_activities",
            prefix="start",
        )
        end_activities = _normalize_ocdfg_boundary_activities(
            ocdfg_result,
            field_name="end_activities",
            prefix="end",
        )
        return nodes, edges, start_activities, end_activities, []


class ProcessMiningService:
    """Domain service for process mining and trace drill-down."""

    def __init__(
        self,
        *,
        repository: ProcessMiningRepository,
        miner: OcpnMiningWrapper,
        ocdfg_miner: OcdfgMiningWrapper | None = None,
        max_events_default: int,
        max_relations_default: int,
        max_traces_per_handle_default: int,
    ) -> None:
        self._repository = repository
        self._miner = miner
        self._ocdfg_miner = ocdfg_miner or OcdfgMiningWrapper()
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

    async def mine_ocdfg(self, payload: OcdfgMiningRequest) -> OcdfgMiningResponse:
        await self._ensure_schema()
        max_events = payload.max_events or self._max_events_default
        max_relations = payload.max_relations or self._max_relations_default

        frames = await self._repository.extract_ocdfg_frames(
            payload,
            max_events=max_events,
            max_relations=max_relations,
        )
        if _is_empty_frame(frames.events) or _is_empty_frame(frames.relations):
            raise ProcessMiningNoDataError(
                "no process-mining data found for the provided anchor/time window"
            )

        nodes, edges, start_activities, end_activities, warnings = self._ocdfg_miner.mine(frames)
        if not nodes and not edges and not start_activities and not end_activities:
            raise ProcessMiningNoDataError(
                "no process-mining data found for the provided anchor/time window"
            )

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
                        "event_type": node.activity,
                    },
                    "context": context,
                }
            )

        for edge in edges:
            edge.trace_handle = _encode_trace_handle(
                {
                    "selector": {
                        "type": "edge",
                        "source": edge.source_activity,
                        "target": edge.target_activity,
                        "object_type": edge.object_type,
                    },
                    "context": context,
                }
            )

        for item in start_activities:
            item.trace_handle = _encode_trace_handle(
                {
                    "selector": {
                        "type": "start",
                        "object_type": item.object_type,
                        "activity": item.activity,
                    },
                    "context": context,
                }
            )

        for item in end_activities:
            item.trace_handle = _encode_trace_handle(
                {
                    "selector": {
                        "type": "end",
                        "object_type": item.object_type,
                        "activity": item.activity,
                    },
                    "context": context,
                }
            )

        object_types = sorted(
            {
                *(edge.object_type for edge in edges),
                *(item.object_type for item in start_activities),
                *(item.object_type for item in end_activities),
            }
        )
        if anchor_object_type not in object_types:
            object_types = sorted({*object_types, anchor_object_type})

        return OcdfgMiningResponse(
            run_id=run_id,
            anchor_object_type=anchor_object_type,
            start_at=_ensure_utc(payload.start_at),
            end_at=_ensure_utc(payload.end_at),
            nodes=nodes,
            edges=edges,
            start_activities=start_activities,
            end_activities=end_activities,
            object_types=object_types,
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

    async def mine_ocdfg(self, payload: OcdfgMiningRequest) -> OcdfgMiningResponse:
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

        elif selector_type == "start":
            object_type = selector.get("object_type")
            activity = selector.get("activity")
            if (
                isinstance(object_type, str)
                and isinstance(activity, str)
                and object_type == info.object_type
            ):
                include = bool(event_types) and event_types[0] == activity

        elif selector_type == "end":
            object_type = selector.get("object_type")
            activity = selector.get("activity")
            if (
                isinstance(object_type, str)
                and isinstance(activity, str)
                and object_type == info.object_type
            ):
                include = bool(event_types) and event_types[-1] == activity

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


def _to_ocel(frames: ExtractedOcdfgFrames) -> Any:
    pd = _load_pandas_arrow_backend()
    ocel_cls = _load_pm4py_ocel_class()

    events = _normalize_arrow_backed_frame(
        pd,
        frames.events,
        required_columns=["ocel:eid", "ocel:activity", "ocel:timestamp"],
    )
    objects = _normalize_arrow_backed_frame(
        pd,
        frames.objects,
        required_columns=["ocel:oid", "ocel:type"],
    )
    relations = _normalize_arrow_backed_frame(
        pd,
        frames.relations,
        required_columns=["ocel:eid", "ocel:activity", "ocel:timestamp", "ocel:oid", "ocel:type"],
    )

    events["ocel:eid"] = events["ocel:eid"].astype(str)
    events["ocel:activity"] = events["ocel:activity"].astype(str)
    events["ocel:timestamp"] = pd.to_datetime(
        events["ocel:timestamp"].astype(str),
        utc=True,
        errors="coerce",
    )
    events = events.dropna(subset=["ocel:eid", "ocel:activity", "ocel:timestamp"])
    events = events.sort_values(["ocel:timestamp", "ocel:eid"], kind="mergesort").reset_index(
        drop=True
    )

    objects["ocel:oid"] = objects["ocel:oid"].astype(str)
    objects["ocel:type"] = objects["ocel:type"].astype(str)
    objects = objects.dropna(subset=["ocel:oid", "ocel:type"])
    objects = objects.drop_duplicates(subset=["ocel:oid", "ocel:type"], keep="first")
    objects = objects.sort_values(["ocel:type", "ocel:oid"], kind="mergesort").reset_index(
        drop=True
    )

    relations["ocel:eid"] = relations["ocel:eid"].astype(str)
    relations["ocel:activity"] = relations["ocel:activity"].astype(str)
    relations["ocel:oid"] = relations["ocel:oid"].astype(str)
    relations["ocel:type"] = relations["ocel:type"].astype(str)
    relations["ocel:timestamp"] = pd.to_datetime(
        relations["ocel:timestamp"].astype(str),
        utc=True,
        errors="coerce",
    )
    relations = relations.dropna(
        subset=["ocel:eid", "ocel:activity", "ocel:timestamp", "ocel:oid", "ocel:type"]
    )
    relations = relations.sort_values(
        ["ocel:timestamp", "ocel:eid", "ocel:type", "ocel:oid"],
        kind="mergesort",
    ).reset_index(drop=True)

    return ocel_cls(
        events=events.to_df(),
        objects=objects.to_df(),
        relations=relations.to_df(),
    )


def _run_ocdfg_discovery(ocel: Any) -> dict[str, Any]:
    apply_ocdfg = _load_pm4py_ocdfg_apply()
    try:
        output = apply_ocdfg(ocel)
    except Exception as exc:  # pragma: no cover - covered by API-level behavior
        raise ProcessMiningError(f"pm4py OC-DFG discovery failed: {exc}") from exc
    if not isinstance(output, dict):
        raise ProcessMiningError("pm4py OC-DFG discovery returned invalid payload")
    return output


def _normalize_arrow_backed_frame(
    pd: Any,
    frame: Any,
    *,
    required_columns: list[str],
) -> Any:
    if not hasattr(frame, "columns"):
        raise ProcessMiningError("OC-DFG extraction returned non-dataframe payload")
    normalized = frame.copy(deep=True)
    missing_columns = [name for name in required_columns if name not in normalized.columns]
    if missing_columns:
        raise ProcessMiningError(
            "OC-DFG extraction payload is missing required columns: "
            + ", ".join(sorted(missing_columns))
        )
    try:
        return normalized.convert_dtypes(dtype_backend="pyarrow")
    except Exception as exc:
        raise ProcessMiningDependencyUnavailableError(
            "chdb datastore pyarrow dtype backend is required for OC-DFG mining"
        ) from exc


def _is_empty_frame(frame: Any) -> bool:
    if frame is None:
        return True
    empty = getattr(frame, "empty", None)
    if isinstance(empty, bool):
        return empty
    return False


def _normalize_ocdfg_nodes(ocdfg_result: dict[str, Any]) -> list[OcdfgNode]:
    activities_indep = _as_mapping(ocdfg_result.get("activities_indep"))
    events_by_activity = _as_mapping(activities_indep.get("events"))
    activities = set(_as_string_iterable(ocdfg_result.get("activities")))
    activities.update(str(key) for key in events_by_activity)

    nodes: list[OcdfgNode] = []
    for activity in sorted(activities):
        count = _association_size(events_by_activity.get(activity))
        nodes.append(
            OcdfgNode(
                id=_ocdfg_node_id(activity),
                activity=activity,
                count=count,
                trace_handle="",
            )
        )
    return nodes


def _normalize_ocdfg_edges(ocdfg_result: dict[str, Any]) -> list[OcdfgEdge]:
    edges_raw = _as_mapping(ocdfg_result.get("edges"))
    edge_totals_by_type = _as_mapping(edges_raw.get("total_objects"))
    performance_raw = _as_mapping(ocdfg_result.get("edges_performance"))
    performance_by_type = _as_mapping(performance_raw.get("total_objects"))

    totals_per_object_type: dict[str, int] = {}
    for object_type, edge_map_raw in edge_totals_by_type.items():
        edge_map = _as_mapping(edge_map_raw)
        totals_per_object_type[str(object_type)] = sum(
            _association_size(associations) for associations in edge_map.values()
        )

    edges: list[OcdfgEdge] = []
    for object_type, edge_map_raw in sorted(
        edge_totals_by_type.items(),
        key=lambda item: str(item[0]),
    ):
        normalized_object_type = str(object_type)
        edge_map = _as_mapping(edge_map_raw)
        perf_map = _as_mapping(performance_by_type.get(object_type))
        total_for_type = totals_per_object_type.get(normalized_object_type, 0)
        normalized_pairs = sorted(_iter_edge_pairs(edge_map), key=lambda item: item[0])
        for (source, target), associations in normalized_pairs:
            count = _association_size(associations)
            share = _rounded_ratio(count, total_for_type)
            perf_values = _to_float_list(perf_map.get((source, target)))
            edges.append(
                OcdfgEdge(
                    id=_ocdfg_edge_id(source, target, normalized_object_type),
                    source=_ocdfg_node_id(source),
                    target=_ocdfg_node_id(target),
                    source_activity=source,
                    target_activity=target,
                    object_type=normalized_object_type,
                    count=count,
                    share=share,
                    p50_seconds=_percentile(perf_values, 0.50),
                    p95_seconds=_percentile(perf_values, 0.95),
                    trace_handle="",
                )
            )
    return edges


def _normalize_ocdfg_boundary_activities(
    ocdfg_result: dict[str, Any],
    *,
    field_name: str,
    prefix: str,
) -> list[OcdfgBoundaryActivity]:
    root = _as_mapping(ocdfg_result.get(field_name))
    total_objects = _as_mapping(root.get("total_objects"))
    items: list[OcdfgBoundaryActivity] = []
    for object_type, activity_map_raw in sorted(
        total_objects.items(),
        key=lambda item: str(item[0]),
    ):
        normalized_object_type = str(object_type)
        activity_map = _as_mapping(activity_map_raw)
        for activity, associations in sorted(activity_map.items(), key=lambda item: str(item[0])):
            normalized_activity = str(activity)
            items.append(
                OcdfgBoundaryActivity(
                    id=_ocdfg_boundary_id(prefix, normalized_object_type, normalized_activity),
                    object_type=normalized_object_type,
                    activity=normalized_activity,
                    count=_association_size(associations),
                    trace_handle="",
                )
            )
    return items


def _as_mapping(value: Any) -> dict[Any, Any]:
    if isinstance(value, dict):
        return value
    return {}


def _as_string_iterable(value: Any) -> list[str]:
    if isinstance(value, (list, set, tuple)):
        return [str(item) for item in value]
    return []


def _association_size(value: Any) -> int:
    if value is None:
        return 0
    if isinstance(value, dict):
        return len(value)
    if isinstance(value, (list, set, tuple)):
        return len(value)
    return 0


def _iter_edge_pairs(edge_map: dict[Any, Any]) -> list[tuple[tuple[str, str], Any]]:
    pairs: list[tuple[tuple[str, str], Any]] = []
    for raw_pair, associations in edge_map.items():
        if not (isinstance(raw_pair, tuple) and len(raw_pair) == 2):
            continue
        source = str(raw_pair[0])
        target = str(raw_pair[1])
        pairs.append(((source, target), associations))
    return pairs


def _to_float_list(values: Any) -> list[float]:
    if not isinstance(values, list):
        return []
    output: list[float] = []
    for item in values:
        try:
            output.append(float(item))
        except (TypeError, ValueError):
            continue
    output.sort()
    return output


def _percentile(values: list[float], q: float) -> float | None:
    if not values:
        return None
    if len(values) == 1:
        return round(values[0], 6)
    index = (len(values) - 1) * q
    lower = math.floor(index)
    upper = math.ceil(index)
    if lower == upper:
        return round(values[lower], 6)
    fraction = index - lower
    result = values[lower] + (values[upper] - values[lower]) * fraction
    return round(result, 6)


def _rounded_ratio(numerator: int, denominator: int) -> float:
    if denominator <= 0:
        return 0.0
    return round(float(numerator) / float(denominator), 6)


def _ocdfg_node_id(activity: str) -> str:
    return f"activity:{activity}"


def _ocdfg_edge_id(source: str, target: str, object_type: str) -> str:
    return f"ocdfg-edge:{object_type}:{source}->{target}"


def _ocdfg_boundary_id(prefix: str, object_type: str, activity: str) -> str:
    return f"{prefix}:{object_type}:{activity}"


def _load_pandas_arrow_backend() -> Any:
    try:
        from chdb import datastore as pd
    except ImportError as exc:
        raise ProcessMiningDependencyUnavailableError(
            "chdb datastore is required for OC-DFG mining"
        ) from exc
    return pd


def _load_pm4py_ocel_class() -> Any:
    try:
        from pm4py.objects.ocel.obj import OCEL
    except ImportError as exc:
        raise ProcessMiningDependencyUnavailableError(
            "pm4py is required for OC-DFG mining"
        ) from exc
    return OCEL


def _load_pm4py_ocdfg_apply() -> Any:
    try:
        from pm4py.algo.discovery.ocel.ocdfg import algorithm
    except ImportError as exc:
        raise ProcessMiningDependencyUnavailableError(
            "pm4py is required for OC-DFG mining"
        ) from exc
    return algorithm.apply


def _pm4py_available() -> bool:
    try:
        import pm4py  # noqa: F401
    except ImportError:
        return False
    return True
