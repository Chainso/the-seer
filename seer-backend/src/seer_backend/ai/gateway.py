"""Unified AI gateway orchestration and contracts for ontology/process/RCA workflows."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Literal
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field

from seer_backend.ai.ontology_copilot import OntologyCopilotService
from seer_backend.analytics.models import ProcessMiningRequest, ProcessMiningResponse
from seer_backend.analytics.rca_models import (
    InsightResult,
    OutcomeDefinition,
    RootCauseAssistInterpretRequest,
    RootCauseAssistInterpretResponse,
    RootCauseAssistSetupRequest,
    RootCauseAssistSetupResponse,
    RootCauseRequest,
    RootCauseRunResponse,
)
from seer_backend.analytics.rca_service import RootCauseService, UnavailableRootCauseService
from seer_backend.analytics.service import ProcessMiningService, UnavailableProcessMiningService
from seer_backend.ontology.models import CopilotChatResponse, CopilotConversationMessage


class AiEvidenceItem(BaseModel):
    """Structured evidence entry shared across AI module responses."""

    label: str
    detail: str
    uri: str | None = None


class AiAssistEnvelope(BaseModel):
    """Common AI response envelope with policy and permission metadata."""

    module: Literal["ontology", "process", "root_cause"]
    task: str
    response_policy: Literal["informational", "analytical"]
    tool_permissions: list[str] = Field(default_factory=list)
    summary: str
    evidence: list[AiEvidenceItem] = Field(default_factory=list)
    caveats: list[str] = Field(default_factory=list)
    next_actions: list[str] = Field(default_factory=list)


class AiOntologyQuestionRequest(BaseModel):
    """Ontology AI request contract routed through the unified gateway."""

    model_config = ConfigDict(extra="forbid")

    question: str = Field(min_length=3, max_length=1000)
    conversation: list[CopilotConversationMessage] = Field(default_factory=list)


class AiOntologyQuestionResponse(AiAssistEnvelope):
    module: Literal["ontology"] = "ontology"
    task: Literal["question"] = "question"
    copilot: CopilotChatResponse


class AiProcessInterpretRequest(BaseModel):
    """Process AI interpretation request routed through the unified gateway."""

    model_config = ConfigDict(extra="forbid")

    run: ProcessMiningResponse


class AiProcessInterpretResponse(AiAssistEnvelope):
    module: Literal["process"] = "process"
    task: Literal["interpret"] = "interpret"


class AiRootCauseSetupRequest(BaseModel):
    """Root-cause setup-assist request routed through the unified gateway."""

    model_config = ConfigDict(extra="forbid")

    anchor_object_type: str = Field(min_length=1, max_length=160)
    start_at: datetime
    end_at: datetime


class AiRootCauseSetupResponse(AiAssistEnvelope):
    module: Literal["root_cause"] = "root_cause"
    task: Literal["setup"] = "setup"
    setup: RootCauseAssistSetupResponse


class AiRootCauseInterpretRequest(BaseModel):
    """Root-cause interpretation request routed through the unified gateway."""

    model_config = ConfigDict(extra="forbid")

    baseline_rate: float = Field(ge=0.0, le=1.0)
    insights: list[InsightResult] = Field(default_factory=list)


class AiRootCauseInterpretResponse(AiAssistEnvelope):
    module: Literal["root_cause"] = "root_cause"
    task: Literal["interpret"] = "interpret"
    interpretation: RootCauseAssistInterpretResponse


class GuidedInvestigationRequest(BaseModel):
    """End-to-end guided investigation request (ontology -> process -> RCA)."""

    model_config = ConfigDict(extra="forbid")

    question: str = Field(min_length=3, max_length=1000)
    anchor_object_type: str = Field(min_length=1, max_length=160)
    start_at: datetime
    end_at: datetime
    depth: int = Field(default=1, ge=1, le=3)
    outcome_event_type: str | None = Field(default=None, min_length=1, max_length=200)


class GuidedInvestigationResponse(BaseModel):
    """Guided investigation output with module outputs and analysis artifacts."""

    investigation_id: str
    anchor_object_type: str
    start_at: datetime
    end_at: datetime
    ontology: AiOntologyQuestionResponse
    process_run: ProcessMiningResponse
    process_ai: AiProcessInterpretResponse
    root_cause_setup: AiRootCauseSetupResponse
    root_cause_run: RootCauseRunResponse
    root_cause_ai: AiRootCauseInterpretResponse


class AiGatewayService:
    """Single AI gateway with module-scoped permissions and policy enforcement."""

    def __init__(
        self,
        *,
        ontology_copilot_service: OntologyCopilotService,
        process_service: ProcessMiningService | UnavailableProcessMiningService,
        root_cause_service: RootCauseService | UnavailableRootCauseService,
    ) -> None:
        self._ontology_copilot_service = ontology_copilot_service
        self._process_service = process_service
        self._root_cause_service = root_cause_service

    async def ontology_question(
        self,
        payload: AiOntologyQuestionRequest,
    ) -> AiOntologyQuestionResponse:
        copilot = await self._ontology_copilot_service.answer(
            payload.question,
            conversation=payload.conversation,
        )

        evidence = [
            AiEvidenceItem(
                label="Concept reference",
                detail=f"{item.concept_iri} via {item.query}",
                uri=item.concept_iri,
            )
            for item in copilot.evidence
        ]
        caveats: list[str] = []

        if copilot.tool_result is not None:
            if copilot.tool_result.error:
                caveats.append(
                    "Tool execution failed; response may rely on incomplete ontology context."
                )
            else:
                result_detail = (
                    f"{copilot.tool_result.query_type} query returned "
                    f"{copilot.tool_result.row_count} rows"
                )
                if copilot.tool_result.truncated:
                    result_detail += " (truncated)"
                evidence.append(
                    AiEvidenceItem(
                        label="Read-only SPARQL tool result",
                        detail=result_detail,
                    )
                )

        if not evidence:
            caveats.append(
                "Informational response generated without explicit query evidence."
            )

        return AiOntologyQuestionResponse(
            response_policy="informational",
            tool_permissions=[
                "ontology.current",
                "ontology.concepts",
                "ontology.concept_detail",
                "ontology.query(read_only)",
            ],
            summary=copilot.answer,
            evidence=evidence,
            caveats=caveats,
            next_actions=[
                "Ask a follow-up concept-level question to narrow ontology scope.",
                "Open Process Explorer to validate behavior over event history.",
            ],
            copilot=copilot,
        )

    async def process_interpret(
        self,
        payload: AiProcessInterpretRequest,
    ) -> AiProcessInterpretResponse:
        run = payload.run

        top_node = max(
            run.nodes,
            key=lambda item: (item.frequency, item.label),
            default=None,
        )
        top_path = max(
            run.path_stats,
            key=lambda item: (item.count, item.path),
            default=None,
        )

        evidence: list[AiEvidenceItem] = []
        if top_node is not None:
            evidence.append(
                AiEvidenceItem(
                    label="Highest-frequency event node",
                    detail=f"{top_node.label} observed {top_node.frequency} times",
                )
            )
        if top_path is not None:
            evidence.append(
                AiEvidenceItem(
                    label="Top object path",
                    detail=(
                        f"{top_path.object_type}: {top_path.path} "
                        f"({top_path.count} traces)"
                    ),
                )
            )
        if run.warnings:
            evidence.append(
                AiEvidenceItem(
                    label="Run warnings",
                    detail=" | ".join(run.warnings),
                )
            )

        summary = (
            f"Process run {run.run_id} produced {len(run.nodes)} nodes, "
            f"{len(run.edges)} edges, and {len(run.path_stats)} path stats "
            f"for anchor '{run.anchor_object_type}'."
        )

        return AiProcessInterpretResponse(
            response_policy="analytical",
            tool_permissions=[
                "process.mine",
                "process.traces",
            ],
            summary=summary,
            evidence=evidence,
            caveats=[
                (
                    "Process mining output is descriptive and should be verified through "
                    "trace drill-down."
                ),
            ],
            next_actions=[
                "Inspect trace drill-down for the top path and top node.",
                "Use Root-Cause Lab with the same anchor/time window to test outcome hypotheses.",
            ],
        )

    async def root_cause_setup(
        self,
        payload: AiRootCauseSetupRequest,
    ) -> AiRootCauseSetupResponse:
        setup_request = RootCauseAssistSetupRequest(
            anchor_object_type=payload.anchor_object_type,
            start_at=payload.start_at,
            end_at=payload.end_at,
        )
        setup = await self._root_cause_service.assist_setup(setup_request)

        suggestion_text = (
            setup.suggestions[0].outcome.event_type
            if setup.suggestions
            else "no suggested outcome"
        )
        summary = (
            "Prepared RCA setup guidance with "
            f"suggested depth={setup.suggested_depth} and top outcome={suggestion_text}."
        )

        evidence = [
            AiEvidenceItem(
                label="Suggested outcome",
                detail=(
                    f"{item.outcome.event_type}: {item.rationale}"
                ),
            )
            for item in setup.suggestions
        ]

        return AiRootCauseSetupResponse(
            response_policy="analytical",
            tool_permissions=[
                "root_cause.run",
                "root_cause.evidence",
                "root_cause.assist.setup",
                "root_cause.assist.interpret",
            ],
            summary=summary,
            evidence=evidence,
            caveats=[
                (
                    "Setup suggestions are heuristic and should be validated against "
                    "business semantics."
                ),
            ],
            next_actions=setup.notes,
            setup=setup,
        )

    async def root_cause_interpret(
        self,
        payload: AiRootCauseInterpretRequest,
    ) -> AiRootCauseInterpretResponse:
        interpret_request = RootCauseAssistInterpretRequest(
            baseline_rate=payload.baseline_rate,
            insights=payload.insights,
        )
        interpretation = await self._root_cause_service.assist_interpret(interpret_request)

        evidence: list[AiEvidenceItem] = []
        if payload.insights:
            top = payload.insights[0]
            evidence.append(
                AiEvidenceItem(
                    label="Top-ranked subgroup",
                    detail=(
                        f"{top.title}; WRAcc={top.score.wracc:.4f}; "
                        f"Lift={top.score.lift:.2f}; Coverage={top.score.coverage:.2%}"
                    ),
                )
            )

        return AiRootCauseInterpretResponse(
            response_policy="analytical",
            tool_permissions=[
                "root_cause.run",
                "root_cause.evidence",
                "root_cause.assist.setup",
                "root_cause.assist.interpret",
            ],
            summary=interpretation.summary,
            evidence=evidence,
            caveats=interpretation.caveats,
            next_actions=interpretation.next_steps,
            interpretation=interpretation,
        )

    async def guided_investigation(
        self,
        payload: GuidedInvestigationRequest,
    ) -> GuidedInvestigationResponse:
        ontology = await self.ontology_question(
            AiOntologyQuestionRequest(
                question=payload.question,
                conversation=[],
            )
        )

        process_run = await self._process_service.mine(
            ProcessMiningRequest(
                anchor_object_type=payload.anchor_object_type,
                start_at=payload.start_at,
                end_at=payload.end_at,
            )
        )
        process_ai = await self.process_interpret(
            AiProcessInterpretRequest(run=process_run)
        )

        root_cause_setup = await self.root_cause_setup(
            AiRootCauseSetupRequest(
                anchor_object_type=payload.anchor_object_type,
                start_at=payload.start_at,
                end_at=payload.end_at,
            )
        )

        outcome = _pick_outcome_definition(
            setup=root_cause_setup.setup,
            process_run=process_run,
            override_event_type=payload.outcome_event_type,
        )

        root_cause_run = await self._root_cause_service.run(
            RootCauseRequest(
                anchor_object_type=payload.anchor_object_type,
                start_at=payload.start_at,
                end_at=payload.end_at,
                depth=payload.depth,
                outcome=outcome,
            )
        )
        root_cause_ai = await self.root_cause_interpret(
            AiRootCauseInterpretRequest(
                baseline_rate=root_cause_run.baseline_rate,
                insights=root_cause_run.insights,
            )
        )

        return GuidedInvestigationResponse(
            investigation_id=str(uuid4()),
            anchor_object_type=payload.anchor_object_type,
            start_at=_ensure_utc(payload.start_at),
            end_at=_ensure_utc(payload.end_at),
            ontology=ontology,
            process_run=process_run,
            process_ai=process_ai,
            root_cause_setup=root_cause_setup,
            root_cause_run=root_cause_run,
            root_cause_ai=root_cause_ai,
        )


def _pick_outcome_definition(
    *,
    setup: RootCauseAssistSetupResponse,
    process_run: ProcessMiningResponse,
    override_event_type: str | None,
) -> OutcomeDefinition:
    if override_event_type:
        return OutcomeDefinition(event_type=override_event_type)
    if setup.suggestions:
        return setup.suggestions[0].outcome

    fallback_event_type = "order.delayed"
    candidate = _find_negative_event_candidate(process_run)
    if candidate is not None:
        fallback_event_type = candidate
    return OutcomeDefinition(event_type=fallback_event_type)


def _find_negative_event_candidate(run: ProcessMiningResponse) -> str | None:
    keywords = ("delay", "late", "fail", "cancel", "reject")
    for keyword in keywords:
        for node in run.nodes:
            if keyword in node.label.lower():
                return node.label

    if run.path_stats:
        top_path = max(run.path_stats, key=lambda item: (item.count, item.path))
        parts = [part.strip() for part in top_path.path.split("->")]
        if parts:
            return parts[-1]
    return None


def _ensure_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)
