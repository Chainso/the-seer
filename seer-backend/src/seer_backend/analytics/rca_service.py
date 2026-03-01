"""Root-cause analysis orchestration and ranking services."""

from __future__ import annotations

import asyncio
import base64
import json
import math
import re
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any
from uuid import UUID, uuid4

from seer_backend.analytics.errors import (
    RootCauseDependencyUnavailableError,
    RootCauseNoDataError,
    RootCauseTraceHandleError,
    RootCauseValidationError,
)
from seer_backend.analytics.rca_models import (
    ExtractedRcaNeighborhood,
    InsightCondition,
    InsightEvidenceSummary,
    InsightResult,
    InsightScore,
    OutcomeDefinition,
    RcaEventRow,
    RcaFilterCondition,
    RcaObjectInstance,
    RcaObjectRow,
    RcaRelationRow,
    RootCauseAssistInterpretRequest,
    RootCauseAssistInterpretResponse,
    RootCauseAssistSetupRequest,
    RootCauseAssistSetupResponse,
    RootCauseEvidenceEvent,
    RootCauseEvidenceResponse,
    RootCauseEvidenceTrace,
    RootCauseRequest,
    RootCauseRunResponse,
    RootCauseSetupSuggestion,
)
from seer_backend.analytics.rca_repository import RootCauseRepository

_MISSING_VALUE = "__MISSING__"
_DURATION_PATTERN = re.compile(
    r"^P"
    r"(?:(?P<years>\d+(?:\.\d+)?)Y)?"
    r"(?:(?P<months>\d+(?:\.\d+)?)M)?"
    r"(?:(?P<weeks>\d+(?:\.\d+)?)W)?"
    r"(?:(?P<days>\d+(?:\.\d+)?)D)?"
    r"(?:T"
    r"(?:(?P<hours>\d+(?:\.\d+)?)H)?"
    r"(?:(?P<minutes>\d+(?:\.\d+)?)M)?"
    r"(?:(?P<seconds>\d+(?:\.\d+)?)S)?"
    r")?$"
)


@dataclass(slots=True)
class _AnchorFeatureRow:
    anchor: RcaObjectInstance
    anchor_key: str
    features: dict[str, str]
    outcome: int
    event_ids: list[UUID]


@dataclass(slots=True)
class _RuleScore:
    rule: tuple[tuple[str, str], ...]
    support: int
    positives: int
    coverage: float
    subgroup_rate: float
    baseline_rate: float
    lift: float
    wracc: float
    mutual_information: float | None


@dataclass(slots=True)
class _AnalysisContext:
    payload: RootCauseRequest
    rows: list[_AnchorFeatureRow]
    events_by_id: dict[UUID, RcaEventRow]
    relations_by_event: dict[UUID, list[RcaRelationRow]]
    baseline_rate: float
    positive_count: int
    feature_count: int
    warnings: list[str]


class RootCauseService:
    """Domain service for bounded RCA runs and evidence drill-down."""

    def __init__(
        self,
        *,
        repository: RootCauseRepository,
        max_events_default: int,
        max_relations_default: int,
        max_traces_per_insight_default: int,
    ) -> None:
        self._repository = repository
        self._max_events_default = max_events_default
        self._max_relations_default = max_relations_default
        self._max_traces_per_insight_default = max_traces_per_insight_default
        self._schema_ready = False
        self._schema_lock = asyncio.Lock()

    async def run(self, payload: RootCauseRequest) -> RootCauseRunResponse:
        await self._ensure_schema()
        context = await self._analyze(payload)

        if not context.rows:
            raise RootCauseNoDataError(
                "no anchor cohort remained after applying RCA filters; "
                "relax filters or widen time window"
            )

        insights = _rank_insights(
            context.rows,
            baseline_rate=context.baseline_rate,
            beam_width=payload.beam_width,
            max_rule_length=payload.max_rule_length,
            min_coverage_ratio=payload.min_coverage_ratio,
            mi_cardinality_threshold=payload.mi_cardinality_threshold,
            max_insights=payload.max_insights,
        )

        if not insights:
            context.warnings.append(
                "no statistically useful subgroup passed the configured coverage threshold"
            )

        response_insights: list[InsightResult] = []
        for rank, score in enumerate(insights, start=1):
            conditions = [
                InsightCondition(feature=feature, value=value) for feature, value in score.rule
            ]
            matched_rows = _match_rows(context.rows, score.rule)
            evidence = _build_evidence_summary(matched_rows, context.events_by_id)
            insight_id = f"insight-{rank}"
            handle = _encode_evidence_handle(
                {
                    "insight_id": insight_id,
                    "request": _serialize_request(payload),
                    "conditions": [
                        {"feature": feature, "value": value} for feature, value in score.rule
                    ],
                }
            )
            response_insights.append(
                InsightResult(
                    insight_id=insight_id,
                    rank=rank,
                    title=_rule_title(score.rule),
                    conditions=conditions,
                    score=InsightScore(
                        wracc=round(score.wracc, 6),
                        mutual_information=(
                            round(score.mutual_information, 6)
                            if score.mutual_information is not None
                            else None
                        ),
                        coverage=round(score.coverage, 6),
                        support=score.support,
                        positives=score.positives,
                        subgroup_rate=round(score.subgroup_rate, 6),
                        baseline_rate=round(score.baseline_rate, 6),
                        lift=round(score.lift, 6),
                    ),
                    evidence_handle=handle,
                    evidence=evidence,
                    caveat=(
                        "Association only: this subgroup is correlated with the outcome and "
                        "is not a causal proof."
                    ),
                )
            )

        return RootCauseRunResponse(
            run_id=str(uuid4()),
            anchor_object_type=payload.anchor_object_type,
            start_at=_ensure_utc(payload.start_at),
            end_at=_ensure_utc(payload.end_at),
            depth=payload.depth,
            outcome=payload.outcome,
            cohort_size=len(context.rows),
            positive_count=context.positive_count,
            baseline_rate=round(context.baseline_rate, 6),
            feature_count=context.feature_count,
            insights=response_insights,
            warnings=context.warnings,
            interpretation_caveat=(
                "Insights are ranked statistical associations with bounded evidence traces. "
                "Treat them as investigation leads."
            ),
        )

    async def evidence(self, *, handle: str, limit: int) -> RootCauseEvidenceResponse:
        await self._ensure_schema()
        payload = _decode_evidence_handle(handle)

        request_raw = payload.get("request")
        conditions_raw = payload.get("conditions")
        insight_id = payload.get("insight_id")
        if not isinstance(request_raw, dict) or not isinstance(conditions_raw, list):
            raise RootCauseTraceHandleError("root-cause evidence handle is malformed")
        if not isinstance(insight_id, str) or not insight_id:
            raise RootCauseTraceHandleError("root-cause evidence handle is missing insight_id")

        request = RootCauseRequest.model_validate(request_raw)
        rule: tuple[tuple[str, str], ...] = tuple(
            sorted(
                [
                    (str(item.get("feature", "")), str(item.get("value", "")))
                    for item in conditions_raw
                    if isinstance(item, dict)
                    and item.get("feature")
                    and item.get("value") is not None
                ],
                key=lambda pair: pair[0],
            )
        )
        if not rule:
            raise RootCauseTraceHandleError("root-cause evidence handle has no rule conditions")

        context = await self._analyze(request)
        matched_rows = _match_rows(context.rows, rule)

        capped_limit = max(1, min(limit, self._max_traces_per_insight_default))
        traces: list[RootCauseEvidenceTrace] = []
        for row in matched_rows[:capped_limit]:
            events = [
                context.events_by_id[event_id]
                for event_id in row.event_ids
                if event_id in context.events_by_id
            ]
            trace_events: list[RootCauseEvidenceEvent] = []
            for event in sorted(
                events, key=lambda item: (_ensure_utc(item.occurred_at), str(item.event_id))
            ):
                related_instances = sorted(
                    {
                        _instance_key(
                            RcaObjectInstance(
                                object_type=relation.object_type,
                                object_ref_hash=relation.object_ref_hash,
                                object_ref_canonical=relation.object_ref_canonical,
                            )
                        )
                        for relation in context.relations_by_event.get(event.event_id, [])
                    }
                )
                trace_events.append(
                    RootCauseEvidenceEvent(
                        event_id=event.event_id,
                        occurred_at=event.occurred_at,
                        event_type=event.event_type,
                        object_instances=related_instances,
                    )
                )

            traces.append(
                RootCauseEvidenceTrace(
                    anchor_key=row.anchor_key,
                    anchor_object_type=row.anchor.object_type,
                    anchor_object_ref_hash=row.anchor.object_ref_hash,
                    anchor_object_ref_canonical=row.anchor.object_ref_canonical,
                    outcome=bool(row.outcome),
                    events=trace_events,
                )
            )

        return RootCauseEvidenceResponse(
            handle=handle,
            insight_id=insight_id,
            matched_anchor_count=len(matched_rows),
            matched_positive_count=sum(row.outcome for row in matched_rows),
            traces=traces,
            truncated=len(matched_rows) > capped_limit,
        )

    async def assist_setup(
        self,
        payload: RootCauseAssistSetupRequest,
    ) -> RootCauseAssistSetupResponse:
        await self._ensure_schema()
        preview_request = RootCauseRequest(
            anchor_object_type=payload.anchor_object_type,
            start_at=payload.start_at,
            end_at=payload.end_at,
            depth=1,
            outcome=OutcomeDefinition(event_type="urn:seer:placeholder:outcome"),
            max_insights=5,
        )
        frames = await self._repository.extract_neighborhood(
            preview_request,
            max_events=min(self._max_events_default, 1_000),
            max_relations=min(self._max_relations_default, 10_000),
        )

        event_counts = Counter(event.event_type for event in frames.events)
        ranked_event_types = sorted(
            event_counts,
            key=lambda event_type: (
                0 if _looks_like_negative_outcome(event_type) else 1,
                -event_counts[event_type],
                event_type,
            ),
        )

        suggestions = [
            RootCauseSetupSuggestion(
                outcome=OutcomeDefinition(event_type=event_type),
                rationale=(
                    "Keyword and frequency heuristic from anchor-neighborhood events "
                    f"(observed {event_counts[event_type]} occurrences)."
                ),
            )
            for event_type in ranked_event_types[:3]
        ]

        notes = [
            "Start with depth=1 for fast interpretable runs; "
            "increase to depth=2 for supplier/context spillover.",
            "Keep outcomes run-scoped and binary (for example: event_type=order.delayed).",
            "RCA scores association only and should be validated with trace drill-down.",
        ]
        return RootCauseAssistSetupResponse(
            suggested_depth=1,
            suggestions=suggestions,
            notes=notes,
        )

    async def assist_interpret(
        self,
        payload: RootCauseAssistInterpretRequest,
    ) -> RootCauseAssistInterpretResponse:
        top = payload.insights[:3]
        if not top:
            return RootCauseAssistInterpretResponse(
                summary=(
                    "No insight rules were returned. Broaden the time window "
                    "or lower coverage floor."
                ),
                caveats=[
                    "No subgroup met current ranking thresholds, "
                    "so there is no reliable hypothesis list.",
                ],
                next_steps=[
                    "Widen time window and rerun with depth=1.",
                    "Confirm outcome definition captures the intended negative event.",
                ],
            )

        lines = [
            (
                f"#{item.rank} {item.title} -> WRAcc={item.score.wracc:.4f}, "
                f"lift={item.score.lift:.2f}, coverage={item.score.coverage:.2%}."
            )
            for item in top
        ]
        summary = (
            f"Baseline outcome rate is {payload.baseline_rate:.2%}. "
            "Top ranked hypotheses: " + " ".join(lines)
        )

        return RootCauseAssistInterpretResponse(
            summary=summary,
            caveats=[
                "Findings are associative and may include confounders.",
                "Use evidence traces to verify ordering and temporal plausibility before action.",
            ],
            next_steps=[
                "Open evidence traces for the top two insights and "
                "confirm repeated event patterns.",
                "Re-run with a narrower filter to test whether insight ordering remains stable.",
            ],
        )

    async def _analyze(self, payload: RootCauseRequest) -> _AnalysisContext:
        frames = await self._repository.extract_neighborhood(
            payload,
            max_events=self._max_events_default,
            max_relations=self._max_relations_default,
        )
        if not frames.anchors:
            raise RootCauseNoDataError(
                "no anchor objects were found for the requested anchor/time window"
            )

        rows, feature_count, events_by_id, relations_by_event, warnings = _lift_feature_rows(
            payload,
            frames,
        )
        if not rows:
            raise RootCauseNoDataError(
                "no anchor rows were generated from extracted neighborhood; "
                "widen scope or reduce filters"
            )

        positive_count = sum(row.outcome for row in rows)
        baseline_rate = positive_count / len(rows)

        if positive_count == 0:
            warnings.append(
                "outcome has zero positives in the selected cohort; "
                "WRAcc and lift will be non-informative"
            )
        elif positive_count == len(rows):
            warnings.append(
                "outcome is always true in the selected cohort; "
                "subgroup lift interpretation is limited"
            )

        return _AnalysisContext(
            payload=payload,
            rows=rows,
            events_by_id=events_by_id,
            relations_by_event=relations_by_event,
            baseline_rate=baseline_rate,
            positive_count=positive_count,
            feature_count=feature_count,
            warnings=warnings,
        )

    async def _ensure_schema(self) -> None:
        if self._schema_ready:
            return
        async with self._schema_lock:
            if self._schema_ready:
                return
            await self._repository.ensure_schema()
            self._schema_ready = True


class UnavailableRootCauseService:
    """Fallback service when RCA dependencies cannot initialize."""

    def __init__(self, reason: str) -> None:
        self.reason = reason

    async def run(self, payload: RootCauseRequest) -> RootCauseRunResponse:
        del payload
        raise RootCauseDependencyUnavailableError(self.reason)

    async def evidence(self, *, handle: str, limit: int) -> RootCauseEvidenceResponse:
        del handle, limit
        raise RootCauseDependencyUnavailableError(self.reason)

    async def assist_setup(
        self,
        payload: RootCauseAssistSetupRequest,
    ) -> RootCauseAssistSetupResponse:
        del payload
        raise RootCauseDependencyUnavailableError(self.reason)

    async def assist_interpret(
        self,
        payload: RootCauseAssistInterpretRequest,
    ) -> RootCauseAssistInterpretResponse:
        del payload
        raise RootCauseDependencyUnavailableError(self.reason)


def validate_rca_guardrails(
    *, max_events: int, max_relations: int, max_traces_per_insight: int
) -> None:
    if max_events <= 0:
        raise RootCauseValidationError("root_cause_max_events must be positive")
    if max_relations <= 0:
        raise RootCauseValidationError("root_cause_max_relations must be positive")
    if max_traces_per_insight <= 0:
        raise RootCauseValidationError("root_cause_max_traces_per_insight must be positive")


def _lift_feature_rows(
    payload: RootCauseRequest,
    frames: ExtractedRcaNeighborhood,
) -> tuple[
    list[_AnchorFeatureRow],
    int,
    dict[UUID, RcaEventRow],
    dict[UUID, list[RcaRelationRow]],
    list[str],
]:
    warnings: list[str] = []
    events_by_id = {event.event_id: event for event in frames.events}
    relations_by_event: dict[UUID, list[RcaRelationRow]] = defaultdict(list)
    events_by_instance: dict[RcaObjectInstance, set[UUID]] = defaultdict(set)
    instances_by_event: dict[UUID, set[RcaObjectInstance]] = defaultdict(set)

    for relation in frames.relations:
        if relation.event_id not in events_by_id:
            continue
        instance = RcaObjectInstance(
            object_type=relation.object_type,
            object_ref_hash=relation.object_ref_hash,
            object_ref_canonical=relation.object_ref_canonical,
        )
        relations_by_event[relation.event_id].append(relation)
        events_by_instance[instance].add(relation.event_id)
        instances_by_event[relation.event_id].add(instance)

    payloads_by_instance: dict[RcaObjectInstance, list[RcaObjectRow]] = defaultdict(list)
    for obj in frames.objects:
        instance = RcaObjectInstance(
            object_type=obj.object_type,
            object_ref_hash=obj.object_ref_hash,
            object_ref_canonical=obj.object_ref_canonical,
        )
        payloads_by_instance[instance].append(obj)

    for items in payloads_by_instance.values():
        items.sort(key=lambda item: (_ensure_utc(item.recorded_at), str(item.object_history_id)))

    rows: list[_AnchorFeatureRow] = []
    feature_names: set[str] = set()

    for anchor in frames.anchors:
        outcome, event_ids, instance_depth = _expand_anchor(
            anchor,
            payload=payload,
            events_by_instance=events_by_instance,
            instances_by_event=instances_by_event,
            events_by_id=events_by_id,
            relations_by_event=relations_by_event,
        )
        if not event_ids:
            continue

        features = _build_anchor_features(
            anchor,
            event_ids=event_ids,
            instance_depth=instance_depth,
            payloads_by_instance=payloads_by_instance,
            events_by_id=events_by_id,
        )
        if not _passes_filters(features, payload.filters):
            continue

        feature_names.update(features)
        rows.append(
            _AnchorFeatureRow(
                anchor=anchor,
                anchor_key=_instance_key(anchor),
                features=features,
                outcome=outcome,
                event_ids=sorted(
                    event_ids,
                    key=lambda event_id: (
                        _ensure_utc(events_by_id[event_id].occurred_at),
                        str(event_id),
                    ),
                ),
            )
        )

    if not rows:
        return [], 0, events_by_id, relations_by_event, warnings

    rows.sort(key=lambda row: row.anchor_key)
    for event_id in relations_by_event:
        relations_by_event[event_id].sort(
            key=lambda item: (
                item.object_type,
                item.object_ref_hash,
                item.object_ref_canonical,
                str(item.object_history_id),
            )
        )

    if payload.filters:
        filters_text = ", ".join(_filter_to_text(item) for item in payload.filters)
        warnings.append(
            f"cohort filters applied: {filters_text}"
        )

    return rows, len(feature_names), events_by_id, relations_by_event, warnings


def _expand_anchor(
    anchor: RcaObjectInstance,
    *,
    payload: RootCauseRequest,
    events_by_instance: dict[RcaObjectInstance, set[UUID]],
    instances_by_event: dict[UUID, set[RcaObjectInstance]],
    events_by_id: dict[UUID, RcaEventRow],
    relations_by_event: dict[UUID, list[RcaRelationRow]],
) -> tuple[int, set[UUID], dict[RcaObjectInstance, int]]:
    visited_instances: set[RcaObjectInstance] = {anchor}
    frontier: set[RcaObjectInstance] = {anchor}
    instance_depth: dict[RcaObjectInstance, int] = {anchor: 0}
    selected_event_ids: set[UUID] = set()

    for level in range(payload.depth):
        if not frontier:
            break

        level_event_ids: set[UUID] = set()
        for instance in frontier:
            level_event_ids.update(events_by_instance.get(instance, set()))

        if not level_event_ids:
            frontier = set()
            continue

        selected_event_ids.update(level_event_ids)

        next_frontier: set[RcaObjectInstance] = set()
        for event_id in level_event_ids:
            for instance in instances_by_event.get(event_id, set()):
                if instance in visited_instances:
                    continue
                visited_instances.add(instance)
                instance_depth[instance] = level + 1
                next_frontier.add(instance)
        frontier = next_frontier

    outcome = _evaluate_outcome(
        selected_event_ids,
        outcome=payload.outcome,
        events_by_id=events_by_id,
        relations_by_event=relations_by_event,
    )
    return outcome, selected_event_ids, instance_depth


def _evaluate_outcome(
    event_ids: set[UUID],
    *,
    outcome: OutcomeDefinition,
    events_by_id: dict[UUID, RcaEventRow],
    relations_by_event: dict[UUID, list[RcaRelationRow]],
) -> int:
    for event_id in event_ids:
        event = events_by_id.get(event_id)
        if event is None or event.event_type != outcome.event_type:
            continue
        if outcome.object_type is None:
            return 1
        if any(
            relation.object_type == outcome.object_type
            for relation in relations_by_event[event_id]
        ):
            return 1
    return 0


def _build_anchor_features(
    anchor: RcaObjectInstance,
    *,
    event_ids: set[UUID],
    instance_depth: dict[RcaObjectInstance, int],
    payloads_by_instance: dict[RcaObjectInstance, list[RcaObjectRow]],
    events_by_id: dict[UUID, RcaEventRow],
) -> dict[str, str]:
    features: dict[str, str] = {}

    object_type_counts: Counter[str] = Counter()
    for instance, depth in sorted(
        instance_depth.items(),
        key=lambda item: (
            item[1],
            item[0].object_type,
            item[0].object_ref_hash,
            item[0].object_ref_canonical,
        ),
    ):
        object_type_counts[instance.object_type] += 1
        latest_payload = _latest_payload(payloads_by_instance.get(instance, []))
        if latest_payload is None:
            continue

        flattened = _flatten_payload(latest_payload)
        if instance == anchor:
            for path, value in flattened:
                features[f"anchor.{path}"] = value

        for path, value in flattened:
            key = f"present.d{depth}.{instance.object_type}.{path}={value}"
            features[key] = "true"

    for object_type, count in sorted(object_type_counts.items()):
        features[f"object_type.count.{object_type}"] = _count_bucket(count)

    event_type_counts: Counter[str] = Counter()
    for event_id in sorted(event_ids, key=str):
        event = events_by_id.get(event_id)
        if event is None:
            continue
        event_type_counts[event.event_type] += 1

    for event_type, count in sorted(event_type_counts.items()):
        features[f"event.present.{event_type}"] = "true"
        features[f"event.count.{event_type}"] = _count_bucket(count)

    return features


def _latest_payload(items: list[RcaObjectRow]) -> dict[str, Any] | None:
    if not items:
        return None
    payload = items[-1].object_payload
    if not isinstance(payload, dict):
        return None
    return payload


def _flatten_payload(payload: dict[str, Any], prefix: str = "") -> list[tuple[str, str]]:
    flattened: list[tuple[str, str]] = []
    for key in sorted(payload):
        if key == "object_type":
            continue
        value = payload[key]
        path = f"{prefix}.{key}" if prefix else key
        if isinstance(value, dict):
            flattened.extend(_flatten_payload(value, prefix=path))
            continue
        normalized = _normalize_scalar(value)
        if normalized is None:
            continue
        flattened.append((path, normalized))
    return flattened


def _normalize_scalar(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, str):
        cleaned = value.strip()
        if not cleaned:
            return None
        return cleaned[:120]
    if isinstance(value, list):
        if not value:
            return None
        normalized_items = [
            item for item in (_normalize_scalar(item) for item in value[:6]) if item
        ]
        if not normalized_items:
            return None
        return "|".join(normalized_items)
    return str(value)[:120]


def _count_bucket(value: int) -> str:
    if value <= 1:
        return "1"
    if value == 2:
        return "2"
    if value == 3:
        return "3"
    return "4+"


_COUNT_BUCKET_ORDER = {"1": 1.0, "2": 2.0, "3": 3.0, "4+": 4.0}


def _as_comparable_number(value: str) -> float | None:
    cleaned = value.strip()
    if cleaned in _COUNT_BUCKET_ORDER:
        return _COUNT_BUCKET_ORDER[cleaned]
    try:
        return float(cleaned)
    except (TypeError, ValueError):
        return None


def _as_comparable_datetime(value: str) -> float | None:
    cleaned = value.strip()
    if not cleaned:
        return None
    normalized = cleaned.replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    else:
        parsed = parsed.astimezone(UTC)
    return parsed.timestamp()


def _as_comparable_duration(value: str) -> float | None:
    cleaned = value.strip().upper()
    if not cleaned:
        return None
    match = _DURATION_PATTERN.fullmatch(cleaned)
    if not match:
        return None
    years = float(match.group("years") or 0.0)
    months = float(match.group("months") or 0.0)
    weeks = float(match.group("weeks") or 0.0)
    days = float(match.group("days") or 0.0)
    hours = float(match.group("hours") or 0.0)
    minutes = float(match.group("minutes") or 0.0)
    seconds = float(match.group("seconds") or 0.0)
    return (
        years * 365.0 * 24.0 * 60.0 * 60.0
        + months * 30.0 * 24.0 * 60.0 * 60.0
        + weeks * 7.0 * 24.0 * 60.0 * 60.0
        + days * 24.0 * 60.0 * 60.0
        + hours * 60.0 * 60.0
        + minutes * 60.0
        + seconds
    )


def _as_comparable_scalar(value: str) -> tuple[str, float] | None:
    numeric = _as_comparable_number(value)
    if numeric is not None:
        return ("number", numeric)

    timestamp = _as_comparable_datetime(value)
    if timestamp is not None:
        return ("temporal", timestamp)

    duration = _as_comparable_duration(value)
    if duration is not None:
        return ("temporal", duration)

    return None


def _passes_filters(features: dict[str, str], filters: list[RcaFilterCondition]) -> bool:
    for condition in filters:
        current = features.get(condition.field)
        if current is None:
            return False
        if condition.op == "eq" and current != condition.value:
            return False
        if condition.op == "ne" and current == condition.value:
            return False
        if condition.op == "contains" and condition.value not in current:
            return False
        if condition.op in {"gt", "gte", "lt", "lte"}:
            current_value = _as_comparable_scalar(current)
            filter_value = _as_comparable_scalar(condition.value)
            if current_value is None or filter_value is None:
                return False
            if current_value[0] != filter_value[0]:
                return False
            current_number = current_value[1]
            filter_number = filter_value[1]
            if condition.op == "gt" and not current_number > filter_number:
                return False
            if condition.op == "gte" and not current_number >= filter_number:
                return False
            if condition.op == "lt" and not current_number < filter_number:
                return False
            if condition.op == "lte" and not current_number <= filter_number:
                return False
    return True


def _filter_to_text(condition: RcaFilterCondition) -> str:
    return f"{condition.field} {condition.op} {condition.value}"


def _rank_insights(
    rows: list[_AnchorFeatureRow],
    *,
    baseline_rate: float,
    beam_width: int,
    max_rule_length: int,
    min_coverage_ratio: float,
    mi_cardinality_threshold: int,
    max_insights: int,
) -> list[_RuleScore]:
    if not rows:
        return []

    conditions = _candidate_conditions(rows)
    if not conditions:
        return []

    min_support = max(1, math.ceil(len(rows) * min_coverage_ratio))
    mi_by_feature = _compute_mutual_information(rows, mi_cardinality_threshold)
    rule_scores: dict[tuple[tuple[str, str], ...], _RuleScore] = {}

    beam: list[_RuleScore] = []
    for condition in conditions:
        score = _score_rule(rows, (condition,), baseline_rate, min_support, mi_by_feature)
        if score is None:
            continue
        rule_scores[score.rule] = score
        beam.append(score)

    beam = _sort_scores(beam)[:beam_width]

    for _level in range(2, max_rule_length + 1):
        if not beam:
            break

        next_candidates: list[_RuleScore] = []
        seen_rules: set[tuple[tuple[str, str], ...]] = set()
        for base in beam:
            used_features = {feature for feature, _value in base.rule}
            for condition in conditions:
                feature, _value = condition
                if feature in used_features:
                    continue
                extended_rule = tuple(sorted((*base.rule, condition), key=lambda item: item[0]))
                if extended_rule in seen_rules or extended_rule in rule_scores:
                    continue
                seen_rules.add(extended_rule)
                score = _score_rule(rows, extended_rule, baseline_rate, min_support, mi_by_feature)
                if score is None:
                    continue
                rule_scores[score.rule] = score
                next_candidates.append(score)

        beam = _sort_scores(next_candidates)[:beam_width]

    ranked = [score for score in _sort_scores(rule_scores.values()) if score.wracc > 0]
    return ranked[:max_insights]


def _candidate_conditions(rows: list[_AnchorFeatureRow]) -> list[tuple[str, str]]:
    feature_names: set[str] = set()
    for row in rows:
        feature_names.update(row.features)

    values_by_feature: dict[str, set[str]] = defaultdict(set)
    for row in rows:
        for feature in feature_names:
            values_by_feature[feature].add(row.features.get(feature, _MISSING_VALUE))

    conditions: list[tuple[str, str]] = []
    for feature in sorted(values_by_feature):
        values = sorted(values_by_feature[feature])
        # Keep search-space bounded; high-cardinality features are captured via MI.
        if len(values) > 30:
            continue
        for value in values:
            if value == _MISSING_VALUE:
                continue
            conditions.append((feature, value))
    return conditions


def _score_rule(
    rows: list[_AnchorFeatureRow],
    rule: tuple[tuple[str, str], ...],
    baseline_rate: float,
    min_support: int,
    mi_by_feature: dict[str, float],
) -> _RuleScore | None:
    matched = _match_rows(rows, rule)
    support = len(matched)
    if support < min_support:
        return None

    positives = sum(row.outcome for row in matched)
    subgroup_rate = positives / support
    coverage = support / len(rows)
    wracc = coverage * (subgroup_rate - baseline_rate)
    lift = subgroup_rate / baseline_rate if baseline_rate > 0 else 0.0

    mi_values = [mi_by_feature[feature] for feature, _value in rule if feature in mi_by_feature]
    mutual_information = sum(mi_values) / len(mi_values) if mi_values else None

    return _RuleScore(
        rule=rule,
        support=support,
        positives=positives,
        coverage=coverage,
        subgroup_rate=subgroup_rate,
        baseline_rate=baseline_rate,
        lift=lift,
        wracc=wracc,
        mutual_information=mutual_information,
    )


def _sort_scores(scores: Any) -> list[_RuleScore]:
    return sorted(
        list(scores),
        key=lambda score: (
            -score.wracc,
            -(score.mutual_information if score.mutual_information is not None else -1.0),
            -score.coverage,
            -score.positives,
            _rule_signature(score.rule),
        ),
    )


def _match_rows(
    rows: list[_AnchorFeatureRow],
    rule: tuple[tuple[str, str], ...],
) -> list[_AnchorFeatureRow]:
    if not rule:
        return list(rows)
    return [
        row for row in rows if all(row.features.get(feature) == value for feature, value in rule)
    ]


def _compute_mutual_information(
    rows: list[_AnchorFeatureRow],
    threshold: int,
) -> dict[str, float]:
    feature_names: set[str] = set()
    for row in rows:
        feature_names.update(row.features)

    values_by_feature: dict[str, list[str]] = defaultdict(list)
    outcomes = [row.outcome for row in rows]

    for row in rows:
        for feature in feature_names:
            values_by_feature[feature].append(row.features.get(feature, _MISSING_VALUE))

    mi_by_feature: dict[str, float] = {}
    outcome_counts = Counter(outcomes)
    total = len(rows)

    for feature, values in values_by_feature.items():
        distinct_values = sorted(set(values))
        if len(distinct_values) < threshold:
            continue

        value_counts = Counter(values)
        joint_counts: Counter[tuple[str, int]] = Counter()
        for value, outcome in zip(values, outcomes, strict=False):
            joint_counts[(value, outcome)] += 1

        mi = 0.0
        for value in distinct_values:
            px = value_counts[value] / total
            if px == 0:
                continue
            for outcome in (0, 1):
                pxy = joint_counts[(value, outcome)] / total
                if pxy == 0:
                    continue
                py = outcome_counts[outcome] / total
                if py == 0:
                    continue
                mi += pxy * math.log2(pxy / (px * py))
        mi_by_feature[feature] = mi

    return mi_by_feature


def _build_evidence_summary(
    matched_rows: list[_AnchorFeatureRow],
    events_by_id: dict[UUID, RcaEventRow],
) -> InsightEvidenceSummary:
    event_counts: Counter[str] = Counter()
    for row in matched_rows:
        for event_id in row.event_ids:
            event = events_by_id.get(event_id)
            if event is None:
                continue
            event_counts[event.event_type] += 1

    top_event_types = [
        event_type
        for event_type, _count in sorted(
            event_counts.items(),
            key=lambda item: (-item[1], item[0]),
        )[:5]
    ]

    return InsightEvidenceSummary(
        matched_anchor_count=len(matched_rows),
        matched_positive_count=sum(row.outcome for row in matched_rows),
        sample_anchor_keys=[row.anchor_key for row in matched_rows[:5]],
        top_event_types=top_event_types,
    )


def _rule_title(rule: tuple[tuple[str, str], ...]) -> str:
    return " AND ".join(f"{feature}={value}" for feature, value in rule)


def _rule_signature(rule: tuple[tuple[str, str], ...]) -> str:
    return "|".join(f"{feature}={value}" for feature, value in rule)


def _instance_key(instance: RcaObjectInstance) -> str:
    return f"{instance.object_type}|{instance.object_ref_hash}|{instance.object_ref_canonical}"


def _serialize_request(payload: RootCauseRequest) -> dict[str, Any]:
    raw = payload.model_dump(mode="json")
    raw["start_at"] = _to_iso_utc(payload.start_at)
    raw["end_at"] = _to_iso_utc(payload.end_at)
    return raw


def _encode_evidence_handle(payload: dict[str, Any]) -> str:
    raw = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    return base64.urlsafe_b64encode(raw).decode("ascii")


def _decode_evidence_handle(handle: str) -> dict[str, Any]:
    try:
        decoded = base64.b64decode(handle.encode("ascii"), altchars=b"-_", validate=True)
    except Exception as exc:  # pragma: no cover - exercised by API tests
        raise RootCauseTraceHandleError("invalid root-cause evidence handle encoding") from exc
    try:
        payload = json.loads(decoded.decode("utf-8"))
    except json.JSONDecodeError as exc:
        raise RootCauseTraceHandleError("root-cause evidence handle is not valid JSON") from exc
    if not isinstance(payload, dict):
        raise RootCauseTraceHandleError("root-cause evidence handle payload must be an object")
    return payload


def _to_iso_utc(value: datetime) -> str:
    return _ensure_utc(value).isoformat().replace("+00:00", "Z")


def _ensure_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def _looks_like_negative_outcome(event_type: str) -> bool:
    lowered = event_type.lower()
    tokens = (
        "delay",
        "late",
        "fail",
        "error",
        "reject",
        "cancel",
        "fraud",
        "escalat",
    )
    return any(token in lowered for token in tokens)
