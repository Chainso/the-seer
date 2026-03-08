"""Backend-owned assistant domain tool adapters."""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

from seer_backend.analytics.errors import (
    ProcessMiningDependencyUnavailableError,
    ProcessMiningError,
    ProcessMiningLimitExceededError,
    ProcessMiningNoDataError,
    ProcessMiningTraceHandleError,
    ProcessMiningValidationError,
    RootCauseDependencyUnavailableError,
    RootCauseError,
    RootCauseLimitExceededError,
    RootCauseNoDataError,
    RootCauseTraceHandleError,
    RootCauseValidationError,
)
from seer_backend.analytics.models import OcdfgMiningRequest, ProcessMiningRequest
from seer_backend.analytics.rca_models import (
    RootCauseAssistInterpretRequest,
    RootCauseAssistSetupRequest,
    RootCauseRequest,
)
from seer_backend.analytics.rca_service import RootCauseService, UnavailableRootCauseService
from seer_backend.analytics.service import ProcessMiningService, UnavailableProcessMiningService
from seer_backend.history.errors import HistoryDependencyUnavailableError, HistoryError
from seer_backend.history.models import LatestObjectsSearchRequest, ObjectPropertyFilter
from seer_backend.history.service import HistoryService, UnavailableHistoryService
from seer_backend.ontology.models import (
    CopilotArtifact,
    CopilotToolCall,
    CopilotToolResult,
)


@dataclass(frozen=True, slots=True)
class AssistantToolDefinition:
    permission_name: str
    function_name: str
    description: str
    parameters: dict[str, Any]

    @property
    def schema(self) -> dict[str, Any]:
        return {
            "type": "function",
            "function": {
                "name": self.function_name,
                "description": self.description,
                "parameters": self.parameters,
            },
        }


class _ProcessTraceRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    handle: str = Field(min_length=8)
    limit: int = Field(default=25, ge=1, le=500)


class _RootCauseEvidenceRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    handle: str = Field(min_length=12)
    limit: int = Field(default=10, ge=1, le=200)


class _ObjectTimelineToolRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    object_type: str = Field(min_length=1, max_length=160)
    object_ref_hash: int = Field(ge=0)
    start_at: datetime | None = None
    end_at: datetime | None = None
    limit: int = Field(default=200, ge=1, le=1000)


class _ObjectEventsToolRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    object_type: str = Field(min_length=1, max_length=160)
    object_ref_hash: int | None = Field(default=None, ge=0)
    object_ref_canonical: str | None = Field(default=None, min_length=2, max_length=2048)
    start_at: datetime | None = None
    end_at: datetime | None = None
    page: int = Field(default=0, ge=0)
    size: int = Field(default=50, ge=1, le=200)

    @model_validator(mode="after")
    def validate_identifier(self) -> _ObjectEventsToolRequest:
        if self.object_ref_hash is None and self.object_ref_canonical is None:
            raise ValueError(
                "object_events requires object_ref_hash or object_ref_canonical"
            )
        return self


class _HistoryRelationsToolRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    event_id: UUID | None = None
    object_type: str | None = Field(default=None, min_length=1, max_length=160)
    object_ref_hash: int | None = Field(default=None, ge=0)
    limit: int = Field(default=200, ge=1, le=1000)

    @model_validator(mode="after")
    def validate_selector(self) -> _HistoryRelationsToolRequest:
        if self.event_id is None and (
            self.object_type is None or self.object_ref_hash is None
        ):
            raise ValueError(
                "relations requires event_id or (object_type + object_ref_hash)"
            )
        return self


class _ProcessMineToolRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    analysis_kind: str = Field(default="ocdfg", min_length=1, max_length=20)
    anchor_object_type: str = Field(min_length=1, max_length=400)
    start_at: datetime
    end_at: datetime
    include_object_types: list[str] | None = None
    max_events: int | None = Field(default=None, ge=1, le=200_000)
    max_relations: int | None = Field(default=None, ge=1, le=500_000)
    max_traces_per_handle: int | None = Field(default=None, ge=1, le=500)

    @model_validator(mode="after")
    def validate_kind(self) -> _ProcessMineToolRequest:
        normalized = self.analysis_kind.strip().lower()
        if normalized not in {"ocdfg", "process"}:
            raise ValueError("analysis_kind must be 'ocdfg' or 'process'")
        self.analysis_kind = normalized
        return self

    def mining_payload(self) -> ProcessMiningRequest | OcdfgMiningRequest:
        payload = self.model_dump(mode="python")
        analysis_kind = payload.pop("analysis_kind")
        model = OcdfgMiningRequest if analysis_kind == "ocdfg" else ProcessMiningRequest
        return model.model_validate(payload)


class AssistantDomainToolAdapter:
    """Maps unlocked assistant skills to backend service tool handlers."""

    def __init__(
        self,
        *,
        process_service: ProcessMiningService | UnavailableProcessMiningService,
        root_cause_service: RootCauseService | UnavailableRootCauseService,
        history_service: HistoryService | UnavailableHistoryService,
    ) -> None:
        self._process_service = process_service
        self._root_cause_service = root_cause_service
        self._history_service = history_service
        definitions = (
            AssistantToolDefinition(
                permission_name="process.mine",
                function_name="process_mine",
                description=(
                    "Run process mining for an object type and time window. "
                    "Defaults to OC-DFG output and can also return the standard process view."
                ),
                parameters={
                    "type": "object",
                    "properties": {
                        "analysis_kind": {
                            "type": "string",
                            "enum": ["ocdfg", "process"],
                            "description": (
                                "Return OC-DFG output by default or the standard "
                                "process view."
                            ),
                        },
                        "anchor_object_type": {"type": "string"},
                        "start_at": {"type": "string", "format": "date-time"},
                        "end_at": {"type": "string", "format": "date-time"},
                        "include_object_types": {
                            "type": "array",
                            "items": {"type": "string"},
                        },
                        "max_events": {"type": "integer", "minimum": 1},
                        "max_relations": {"type": "integer", "minimum": 1},
                        "max_traces_per_handle": {"type": "integer", "minimum": 1},
                    },
                    "required": ["anchor_object_type", "start_at", "end_at"],
                    "additionalProperties": False,
                },
            ),
            AssistantToolDefinition(
                permission_name="process.traces",
                function_name="process_trace_drilldown",
                description="Fetch example traces behind one process node, edge, or path handle.",
                parameters={
                    "type": "object",
                    "properties": {
                        "handle": {"type": "string"},
                        "limit": {"type": "integer", "minimum": 1, "maximum": 500},
                    },
                    "required": ["handle"],
                    "additionalProperties": False,
                },
            ),
            AssistantToolDefinition(
                permission_name="root_cause.run",
                function_name="root_cause_run",
                description=(
                    "Run bounded root-cause analysis for one anchor object type "
                    "and outcome."
                ),
                parameters={
                    "type": "object",
                    "properties": {
                        "anchor_object_type": {"type": "string"},
                        "start_at": {"type": "string", "format": "date-time"},
                        "end_at": {"type": "string", "format": "date-time"},
                        "depth": {"type": "integer", "minimum": 1, "maximum": 3},
                        "outcome": {
                            "type": "object",
                            "properties": {
                                "kind": {
                                    "type": "string",
                                    "enum": ["event_type"],
                                    "description": "Outcome kind. Use event_type.",
                                },
                                "event_type": {
                                    "type": "string",
                                    "description": (
                                        "Undesirable outcome event type URI, for example "
                                        "urn:seer:test:order.delayed."
                                    ),
                                },
                                "object_type": {
                                    "type": "string",
                                    "description": (
                                        "Optional object type URI when the outcome should "
                                        "be scoped to one object family."
                                    ),
                                },
                            },
                            "required": ["event_type"],
                            "additionalProperties": False,
                        },
                        "filters": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "field": {"type": "string"},
                                    "op": {
                                        "type": "string",
                                        "enum": [
                                            "eq",
                                            "ne",
                                            "contains",
                                            "gt",
                                            "gte",
                                            "lt",
                                            "lte",
                                        ],
                                    },
                                    "value": {"type": "string"},
                                },
                                "required": ["field", "value"],
                                "additionalProperties": False,
                            },
                        },
                        "beam_width": {"type": "integer", "minimum": 1, "maximum": 50},
                        "max_rule_length": {"type": "integer", "minimum": 1, "maximum": 3},
                        "min_coverage_ratio": {
                            "type": "number",
                            "minimum": 0,
                            "maximum": 1,
                        },
                        "mi_cardinality_threshold": {
                            "type": "integer",
                            "minimum": 2,
                            "maximum": 500,
                        },
                        "max_insights": {"type": "integer", "minimum": 1, "maximum": 100},
                    },
                    "required": ["anchor_object_type", "start_at", "end_at", "outcome"],
                    "additionalProperties": False,
                },
            ),
            AssistantToolDefinition(
                permission_name="root_cause.evidence",
                function_name="root_cause_evidence",
                description="Fetch bounded evidence traces for one root-cause insight handle.",
                parameters={
                    "type": "object",
                    "properties": {
                        "handle": {"type": "string"},
                        "limit": {"type": "integer", "minimum": 1, "maximum": 200},
                    },
                    "required": ["handle"],
                    "additionalProperties": False,
                },
            ),
            AssistantToolDefinition(
                permission_name="root_cause.assist.setup",
                function_name="root_cause_assist_setup",
                description=(
                    "Suggest a bounded RCA outcome definition for an anchor object "
                    "type and window."
                ),
                parameters={
                    "type": "object",
                    "properties": {
                        "anchor_object_type": {"type": "string"},
                        "start_at": {"type": "string", "format": "date-time"},
                        "end_at": {"type": "string", "format": "date-time"},
                    },
                    "required": ["anchor_object_type", "start_at", "end_at"],
                    "additionalProperties": False,
                },
            ),
            AssistantToolDefinition(
                permission_name="root_cause.assist.interpret",
                function_name="root_cause_assist_interpret",
                description="Interpret ranked root-cause insights into a concise narrative.",
                parameters={
                    "type": "object",
                    "properties": {
                        "baseline_rate": {
                            "type": "number",
                            "minimum": 0,
                            "maximum": 1,
                        },
                        "insights": {"type": "array", "items": {"type": "object"}},
                    },
                    "required": ["baseline_rate", "insights"],
                    "additionalProperties": False,
                },
            ),
            AssistantToolDefinition(
                permission_name="history.object_timeline",
                function_name="history_object_timeline",
                description="Fetch the timeline of snapshots for one specific object instance.",
                parameters={
                    "type": "object",
                    "properties": {
                        "object_type": {"type": "string"},
                        "object_ref_hash": {"type": "integer", "minimum": 0},
                        "start_at": {"type": "string", "format": "date-time"},
                        "end_at": {"type": "string", "format": "date-time"},
                        "limit": {"type": "integer", "minimum": 1, "maximum": 1000},
                    },
                    "required": ["object_type", "object_ref_hash"],
                    "additionalProperties": False,
                },
            ),
            AssistantToolDefinition(
                permission_name="history.object_events",
                function_name="history_object_events",
                description="Fetch the events linked to one object instance.",
                parameters={
                    "type": "object",
                    "properties": {
                        "object_type": {"type": "string"},
                        "object_ref_hash": {"type": "integer", "minimum": 0},
                        "object_ref_canonical": {"type": "string"},
                        "start_at": {"type": "string", "format": "date-time"},
                        "end_at": {"type": "string", "format": "date-time"},
                        "page": {"type": "integer", "minimum": 0},
                        "size": {"type": "integer", "minimum": 1, "maximum": 200},
                    },
                    "required": ["object_type"],
                    "additionalProperties": False,
                },
            ),
            AssistantToolDefinition(
                permission_name="history.relations",
                function_name="history_relations",
                description="Fetch neighboring objects related to one event or object instance.",
                parameters={
                    "type": "object",
                    "properties": {
                        "event_id": {"type": "string", "format": "uuid"},
                        "object_type": {"type": "string"},
                        "object_ref_hash": {"type": "integer", "minimum": 0},
                        "limit": {"type": "integer", "minimum": 1, "maximum": 1000},
                    },
                    "additionalProperties": False,
                },
            ),
            AssistantToolDefinition(
                permission_name="history.latest_objects",
                function_name="history_latest_objects",
                description="Search the latest known object snapshots for one type and filter set.",
                parameters={
                    "type": "object",
                    "properties": {
                        "object_type": {"type": "string"},
                        "page": {"type": "integer", "minimum": 0},
                        "size": {"type": "integer", "minimum": 1, "maximum": 200},
                        "property_filters": {"type": "array", "items": {"type": "object"}},
                    },
                    "additionalProperties": False,
                },
            ),
        )
        self._definitions_by_permission = {
            definition.permission_name: definition for definition in definitions
        }
        self._definitions_by_function = {
            definition.function_name: definition for definition in definitions
        }

    def tool_schemas(self, enabled_permissions: set[str]) -> list[dict[str, Any]]:
        return [
            definition.schema
            for definition in self._definitions_by_permission.values()
            if definition.permission_name in enabled_permissions
        ]

    def supports_function(self, function_name: str) -> bool:
        return function_name in self._definitions_by_function

    async def execute_tool_call(self, tool_call: CopilotToolCall) -> CopilotToolResult:
        definition = self._definitions_by_function.get(tool_call.tool)
        if definition is None:
            return CopilotToolResult(
                tool=tool_call.tool,
                error=f"tool execution failed: unsupported assistant tool {tool_call.tool!r}",
            )

        try:
            if definition.function_name == "process_mine":
                request = _ProcessMineToolRequest.model_validate(tool_call.arguments)
                response = await self._execute_process_mine(request)
                return self._success(
                    definition=definition,
                    result=response["result"],
                    summary=response["summary"],
                    row_count=response["row_count"],
                    artifact=self._artifact_for_result(
                        definition=definition,
                        result=response["result"],
                        summary=response["summary"],
                    ),
                )
            if definition.function_name == "process_trace_drilldown":
                request = _ProcessTraceRequest.model_validate(tool_call.arguments)
                response = await self._process_service.trace_drilldown(
                    handle=request.handle,
                    limit=request.limit,
                )
                return self._success(
                    definition=definition,
                    result={"drilldown": response.model_dump(mode="json")},
                    summary=(
                        f"Process trace drilldown returned {len(response.traces)} traces "
                        f"for selector {response.selector_type}."
                    ),
                    row_count=len(response.traces),
                    truncated=response.truncated,
                )
            if definition.function_name == "root_cause_run":
                request = RootCauseRequest.model_validate(tool_call.arguments)
                response = await self._root_cause_service.run(request)
                return self._success(
                    definition=definition,
                    result={"run": response.model_dump(mode="json")},
                    summary=(
                        f"Root-cause analysis returned {len(response.insights)} insights "
                        f"for {response.anchor_object_type}."
                    ),
                    row_count=len(response.insights),
                    artifact=self._artifact_for_result(
                        definition=definition,
                        result={"run": response.model_dump(mode="json")},
                        summary=(
                            f"Root-cause analysis returned {len(response.insights)} insights "
                            f"for {response.anchor_object_type}."
                        ),
                    ),
                )
            if definition.function_name == "root_cause_evidence":
                request = _RootCauseEvidenceRequest.model_validate(tool_call.arguments)
                response = await self._root_cause_service.evidence(
                    handle=request.handle,
                    limit=request.limit,
                )
                return self._success(
                    definition=definition,
                    result={"evidence": response.model_dump(mode="json")},
                    summary=(
                        f"Root-cause evidence returned {len(response.traces)} traces "
                        f"for {response.insight_id}."
                    ),
                    row_count=len(response.traces),
                    truncated=response.truncated,
                )
            if definition.function_name == "root_cause_assist_setup":
                request = RootCauseAssistSetupRequest.model_validate(tool_call.arguments)
                response = await self._root_cause_service.assist_setup(request)
                return self._success(
                    definition=definition,
                    result={"setup": response.model_dump(mode="json")},
                    summary=(
                        f"Root-cause setup suggested {len(response.suggestions)} outcomes."
                    ),
                    row_count=len(response.suggestions),
                )
            if definition.function_name == "root_cause_assist_interpret":
                request = RootCauseAssistInterpretRequest.model_validate(tool_call.arguments)
                response = await self._root_cause_service.assist_interpret(request)
                return self._success(
                    definition=definition,
                    result={"interpretation": response.model_dump(mode="json")},
                    summary="Root-cause interpretation completed.",
                    row_count=len(response.next_steps),
                )
            if definition.function_name == "history_object_timeline":
                request = _ObjectTimelineToolRequest.model_validate(tool_call.arguments)
                response = await self._history_service.object_timeline(
                    object_type=request.object_type,
                    object_ref_hash=request.object_ref_hash,
                    start_at=request.start_at,
                    end_at=request.end_at,
                    limit=request.limit,
                )
                return self._success(
                    definition=definition,
                    result={"timeline": response.model_dump(mode="json")},
                    summary=(
                        f"Object timeline returned {len(response.items)} snapshots "
                        f"for {request.object_type}."
                    ),
                    row_count=len(response.items),
                    artifact=self._artifact_for_result(
                        definition=definition,
                        result={"timeline": response.model_dump(mode="json")},
                        summary=(
                            f"Object timeline returned {len(response.items)} snapshots "
                            f"for {request.object_type}."
                        ),
                    ),
                )
            if definition.function_name == "history_object_events":
                request = _ObjectEventsToolRequest.model_validate(tool_call.arguments)
                response = await self._history_service.object_events(
                    object_type=request.object_type,
                    object_ref_hash=request.object_ref_hash,
                    object_ref_canonical=request.object_ref_canonical,
                    start_at=request.start_at,
                    end_at=request.end_at,
                    page=request.page,
                    size=request.size,
                )
                return self._success(
                    definition=definition,
                    result={"events": response.model_dump(mode="json")},
                    summary=(
                        f"Object events returned {len(response.items)} items "
                        f"for {request.object_type}."
                    ),
                    row_count=len(response.items),
                    truncated=response.total > len(response.items),
                )
            if definition.function_name == "history_relations":
                request = _HistoryRelationsToolRequest.model_validate(tool_call.arguments)
                response = await self._history_service.relations(
                    event_id=request.event_id,
                    object_type=request.object_type,
                    object_ref_hash=request.object_ref_hash,
                    limit=request.limit,
                )
                return self._success(
                    definition=definition,
                    result={"relations": response.model_dump(mode="json")},
                    summary=f"History relations returned {len(response.items)} linked objects.",
                    row_count=len(response.items),
                )
            if definition.function_name == "history_latest_objects":
                request = LatestObjectsSearchRequest.model_validate(tool_call.arguments)
                response = await self._history_service.latest_objects(
                    object_type=request.object_type,
                    property_filters=[
                        ObjectPropertyFilter(key=item.key, op=item.op, value=item.value)
                        for item in request.property_filters
                    ],
                    page=request.page,
                    size=request.size,
                )
                return self._success(
                    definition=definition,
                    result={"latest_objects": response.model_dump(mode="json")},
                    summary=(
                        f"Latest object search returned {len(response.items)} objects "
                        f"from {response.total} total matches."
                    ),
                    row_count=len(response.items),
                    truncated=response.total > len(response.items),
                    artifact=self._artifact_for_result(
                        definition=definition,
                        result={"latest_objects": response.model_dump(mode="json")},
                        summary=(
                            f"Latest object search returned {len(response.items)} objects "
                            f"from {response.total} total matches."
                        ),
                    ),
                )
        except ValidationError as exc:
            return self._error(
                definition=definition,
                message=_format_validation_error(
                    definition=definition,
                    tool_arguments=tool_call.arguments,
                    exc=exc,
                ),
            )
        except (
            ProcessMiningValidationError,
            ProcessMiningLimitExceededError,
            ProcessMiningNoDataError,
            ProcessMiningTraceHandleError,
            ProcessMiningDependencyUnavailableError,
            ProcessMiningError,
            RootCauseValidationError,
            RootCauseLimitExceededError,
            RootCauseNoDataError,
            RootCauseTraceHandleError,
            RootCauseDependencyUnavailableError,
            RootCauseError,
            HistoryDependencyUnavailableError,
            HistoryError,
            ValueError,
        ) as exc:
            return self._error(definition=definition, message=f"tool execution failed: {exc}")

        return self._error(
            definition=definition,
            message=f"tool execution failed: no handler for assistant tool {tool_call.tool!r}",
        )
    async def _execute_process_mine(
        self,
        request: _ProcessMineToolRequest,
    ) -> dict[str, Any]:
        payload = request.mining_payload()
        if request.analysis_kind == "process":
            response = await self._process_service.mine(payload)
            return {
                "result": {
                    "analysis_kind": "process",
                    "run": response.model_dump(mode="json"),
                },
                "summary": (
                    f"Process mining returned {len(response.nodes)} nodes and "
                    f"{len(response.edges)} edges."
                ),
                "row_count": len(response.edges),
            }

        response = await self._process_service.mine_ocdfg(payload)
        return {
            "result": {
                "analysis_kind": "ocdfg",
                "run": response.model_dump(mode="json"),
            },
            "summary": (
                f"OC-DFG mining returned {len(response.nodes)} activities and "
                f"{len(response.edges)} edges."
            ),
            "row_count": len(response.edges),
        }

    def _success(
        self,
        *,
        definition: AssistantToolDefinition,
        result: dict[str, Any],
        summary: str,
        row_count: int = 0,
        truncated: bool = False,
        artifact: CopilotArtifact | None = None,
    ) -> CopilotToolResult:
        return CopilotToolResult(
            tool=definition.function_name,
            tool_permission=definition.permission_name,
            result=result,
            artifact=artifact,
            summary=summary,
            row_count=row_count,
            truncated=truncated,
        )

    def _error(
        self,
        *,
        definition: AssistantToolDefinition,
        message: str,
    ) -> CopilotToolResult:
        return CopilotToolResult(
            tool=definition.function_name,
            tool_permission=definition.permission_name,
            error=message,
        )

    def _artifact_for_result(
        self,
        *,
        definition: AssistantToolDefinition,
        result: dict[str, Any],
        summary: str,
    ) -> CopilotArtifact | None:
        function_name = definition.function_name

        if function_name == "process_mine":
            analysis_kind = result.get("analysis_kind")
            run = result.get("run")
            if isinstance(run, dict) and analysis_kind in {"ocdfg", "process"}:
                anchor_object_type = str(run.get("anchor_object_type") or "object").strip()
                suffix = "OC-DFG" if analysis_kind == "ocdfg" else "Process Map"
                return CopilotArtifact(
                    artifact_id=self._artifact_id(
                        definition=definition,
                        artifact_type=str(analysis_kind),
                        payload=result,
                    ),
                    artifact_type="ocdfg" if analysis_kind == "ocdfg" else "process",
                    title=f"{anchor_object_type} {suffix}",
                    summary=summary,
                    data=result,
                )

        if function_name == "root_cause_run":
            run = result.get("run")
            if isinstance(run, dict):
                anchor_object_type = str(run.get("anchor_object_type") or "object").strip()
                return CopilotArtifact(
                    artifact_id=self._artifact_id(
                        definition=definition,
                        artifact_type="rca",
                        payload=result,
                    ),
                    artifact_type="rca",
                    title=f"{anchor_object_type} Root Cause Analysis",
                    summary=summary,
                    data=result,
                )

        if function_name == "history_object_timeline":
            timeline = result.get("timeline")
            if isinstance(timeline, dict):
                object_type = str(timeline.get("object_type") or "object").strip()
                return CopilotArtifact(
                    artifact_id=self._artifact_id(
                        definition=definition,
                        artifact_type="object-timeline",
                        payload=result,
                    ),
                    artifact_type="object-timeline",
                    title=f"{object_type} Timeline",
                    summary=summary,
                    data=result,
                )

        if function_name == "history_latest_objects":
            latest_objects = result.get("latest_objects")
            if isinstance(latest_objects, dict):
                object_type = str(latest_objects.get("object_type") or "object").strip()
                return CopilotArtifact(
                    artifact_id=self._artifact_id(
                        definition=definition,
                        artifact_type="table",
                        payload=result,
                    ),
                    artifact_type="table",
                    title=f"{object_type} Object Table",
                    summary=summary,
                    data=result,
                )

        return None

    def _artifact_id(
        self,
        *,
        definition: AssistantToolDefinition,
        artifact_type: str,
        payload: dict[str, Any],
    ) -> str:
        digest = hashlib.sha1(
            json.dumps(payload, sort_keys=True, ensure_ascii=True).encode("utf-8")
        ).hexdigest()[:12]
        normalized_type = artifact_type.replace("_", "-")
        normalized_tool = definition.function_name.replace("_", "-")
        return f"{normalized_type}-{normalized_tool}-{digest}"


def _format_validation_error(
    *,
    definition: AssistantToolDefinition,
    tool_arguments: dict[str, Any],
    exc: ValidationError,
) -> str:
    first_error = exc.errors()[0] if exc.errors() else {}
    location = ".".join(str(part) for part in first_error.get("loc", ())) or "<root>"
    message = str(first_error.get("msg", "validation error"))
    received_arguments = json.dumps(tool_arguments, ensure_ascii=True, sort_keys=True)
    expected_hint = _expected_schema_hint(definition.parameters)
    return (
        f"tool validation failed at {location}: {message}. "
        f"Received arguments: {received_arguments}. {expected_hint}"
    )


def _expected_schema_hint(parameters: dict[str, Any]) -> str:
    required_fields = parameters.get("required")
    required_list = (
        [str(item) for item in required_fields if isinstance(item, str)]
        if isinstance(required_fields, list)
        else []
    )
    top_level_hint = (
        "Expected top-level fields: " + ", ".join(required_list) + "."
        if required_list
        else "Expected arguments to match the declared tool schema."
    )

    properties = parameters.get("properties")
    if not isinstance(properties, dict):
        return top_level_hint

    outcome_schema = properties.get("outcome")
    if not isinstance(outcome_schema, dict):
        return top_level_hint

    outcome_required = outcome_schema.get("required")
    outcome_required_list = (
        [str(item) for item in outcome_required if isinstance(item, str)]
        if isinstance(outcome_required, list)
        else []
    )
    if not outcome_required_list:
        return top_level_hint

    outcome_hint = (
        "Outcome shape: "
        '{"event_type":"<event-type-uri>","kind":"event_type","object_type":"<optional-object-type-uri>"}.'
    )
    return f"{top_level_hint} {outcome_hint}"
