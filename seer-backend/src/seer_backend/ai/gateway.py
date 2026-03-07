"""Unified AI gateway orchestration and contracts for ontology/process/RCA workflows."""

from __future__ import annotations

import hashlib
import json
import logging
import re
from collections.abc import AsyncIterator, Iterator
from datetime import UTC, datetime
from time import perf_counter
from typing import Any, Literal
from urllib.parse import urlencode
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, model_validator

from seer_backend.ai.assistant_tools import AssistantDomainToolAdapter
from seer_backend.ai.ontology_copilot import (
    CopilotAnswerFinalEvent,
    CopilotAssistantDeltaEvent,
    CopilotToolStatusEvent,
    OntologyCopilotService,
)
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
from seer_backend.history.service import HistoryService, UnavailableHistoryService
from seer_backend.ontology.models import CopilotChatResponse, CopilotConversationMessage
from seer_backend.ontology.service import OntologyService, UnavailableOntologyService

_TOOL_CALL_ID_MAX_LENGTH = 120
_ASSISTANT_TURN_LOGGER = logging.getLogger("seer_backend.ai.assistant_turn")


class AiEvidenceItem(BaseModel):
    """Structured evidence entry shared across AI module responses."""

    label: str
    detail: str
    uri: str | None = None


class AiAssistEnvelope(BaseModel):
    """Common AI response envelope with policy and permission metadata."""

    module: Literal["ontology", "process", "root_cause", "assistant", "workbench"]
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


class AiAssistantCompletionMessage(BaseModel):
    """OpenAI Chat Completions-style persisted message."""

    model_config = ConfigDict(extra="allow")

    role: Literal["system", "user", "assistant", "tool"]
    content: Any = None
    tool_calls: list[dict[str, Any]] = Field(default_factory=list)
    tool_call_id: str | None = None
    name: str | None = None


class AiAssistantContext(BaseModel):
    """Optional module and route context for generic assistant turns."""

    model_config = ConfigDict(extra="forbid")

    route: str | None = Field(default=None, max_length=200)
    module: str | None = Field(default=None, max_length=80)
    anchor_object_type: str | None = Field(default=None, max_length=160)
    start_at: datetime | None = None
    end_at: datetime | None = None
    concept_uris: list[str] = Field(default_factory=list)


class AiAssistantChatRequest(BaseModel):
    """Generic assistant request contract for route-independent chat."""

    model_config = ConfigDict(extra="forbid")

    completion_messages: list[AiAssistantCompletionMessage] = Field(max_length=400)
    context: AiAssistantContext | None = None
    thread_id: str | None = Field(default=None, min_length=1, max_length=120)

    @model_validator(mode="after")
    def validate_has_user_turn(self) -> AiAssistantChatRequest:
        has_completion_user = any(
            message.role == "user" for message in self.completion_messages
        )
        if not has_completion_user:
            raise ValueError(
                "completion_messages must include at least one user message"
            )
        return self


class AiAssistantChatResponse(AiAssistEnvelope):
    module: Literal["assistant"] = "assistant"
    task: Literal["chat"] = "chat"
    thread_id: str
    answer: str
    copilot: CopilotChatResponse
    completion_messages: list[dict[str, Any]] = Field(default_factory=list)


class AiWorkbenchLinkedSurface(BaseModel):
    """Typed handoff target for expert drill-down surfaces."""

    kind: Literal["ontology", "history", "process", "root_cause", "action_status"]
    label: str
    href: str
    reason: str


class AiWorkbenchClarifyingQuestion(BaseModel):
    """Prompt for missing investigation context."""

    field: Literal["anchor_object_type", "time_window"]
    prompt: str


class AiWorkbenchChatRequest(BaseModel):
    """Dedicated workbench request contract."""

    model_config = ConfigDict(extra="forbid")

    question: str = Field(min_length=3, max_length=1000)
    context: AiAssistantContext | None = None
    thread_id: str | None = Field(default=None, min_length=1, max_length=120)
    investigation_id: str | None = Field(default=None, min_length=1, max_length=120)
    depth: int = Field(default=1, ge=1, le=3)
    outcome_event_type: str | None = Field(default=None, min_length=1, max_length=200)


class AiWorkbenchChatResponse(AiAssistEnvelope):
    """Final workbench response contract for the dedicated workbench surface."""

    module: Literal["workbench"] = "workbench"
    task: Literal["chat"] = "chat"
    thread_id: str
    investigation_id: str
    turn_kind: Literal["investigation_answer", "clarifying_question"]
    answer_markdown: str
    why_it_matters: str
    follow_up_questions: list[str] = Field(default_factory=list)
    linked_surfaces: list[AiWorkbenchLinkedSurface] = Field(default_factory=list)
    clarifying_questions: list[AiWorkbenchClarifyingQuestion] = Field(default_factory=list)
    anchor_object_type: str | None = None
    start_at: datetime | None = None
    end_at: datetime | None = None


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
        ontology_service: OntologyService | UnavailableOntologyService,
        process_service: ProcessMiningService | UnavailableProcessMiningService,
        root_cause_service: RootCauseService | UnavailableRootCauseService,
        history_service: HistoryService | UnavailableHistoryService,
    ) -> None:
        self._ontology_copilot_service = ontology_copilot_service
        self._process_service = process_service
        self._root_cause_service = root_cause_service
        self._assistant_tool_adapter = AssistantDomainToolAdapter(
            ontology_service=ontology_service,
            process_service=process_service,
            root_cause_service=root_cause_service,
            history_service=history_service,
        )

    async def ontology_question(
        self,
        payload: AiOntologyQuestionRequest,
    ) -> AiOntologyQuestionResponse:
        copilot = await self._ontology_copilot_service.answer(
            payload.question,
            conversation=payload.conversation,
        )
        evidence, caveats = _build_copilot_evidence_and_caveats(copilot)

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

    async def assistant_chat(
        self,
        payload: AiAssistantChatRequest,
    ) -> AiAssistantChatResponse:
        async for event_name, event_payload in self.assistant_chat_stream(payload):
            if event_name == "final":
                return AiAssistantChatResponse.model_validate(event_payload)
        raise ValueError("assistant chat stream ended without final response")

    async def assistant_chat_stream(
        self,
        payload: AiAssistantChatRequest,
    ) -> AsyncIterator[tuple[str, dict[str, Any]]]:
        turn_started_at = perf_counter()
        (
            question,
            completion_conversation,
            completion_messages,
        ) = _to_copilot_turn(
            payload.completion_messages,
            payload.context,
        )
        thread_id = payload.thread_id or str(uuid4())
        turn_id = str(uuid4())
        prompt_text = _last_user_completion_message_text(payload.completion_messages)
        delta_chars = 0
        tool_event_count = 0
        first_delta_logged = False
        failure_logged = False

        _ASSISTANT_TURN_LOGGER.info(
            "assistant_turn_started",
            extra={
                **_assistant_turn_context_extra(
                    turn_id=turn_id,
                    thread_id=thread_id,
                    payload=payload,
                ),
                "completion_history_count": len(completion_conversation or []),
                "request_completion_message_count": len(completion_messages),
                "prompt_chars": len(prompt_text),
                "prompt_preview": _preview_text(prompt_text),
            },
        )

        try:
            copilot_stream = self._ontology_copilot_service.answer_stream(
                question,
                conversation=[],
                completion_conversation=completion_conversation,
                assistant_tool_adapter=self._assistant_tool_adapter,
            )
            stream_event: object
            try:
                stream_event = await anext(copilot_stream)
            except StopAsyncIteration as exc:
                failure_logged = True
                _ASSISTANT_TURN_LOGGER.warning(
                    "assistant_turn_failed",
                    extra={
                        **_assistant_turn_context_extra(
                            turn_id=turn_id,
                            thread_id=thread_id,
                            payload=payload,
                        ),
                        "duration_ms": _duration_ms(turn_started_at),
                        "delta_chars": delta_chars,
                        "tool_event_count": tool_event_count,
                        "error_type": "ValueError",
                        "error_message": "assistant chat stream ended without final response",
                    },
                )
                raise ValueError("assistant chat stream ended without final response") from exc

            yield (
                "meta",
                {
                    "thread_id": thread_id,
                    "module": "assistant",
                    "task": "chat",
                    "response_policy": "informational",
                    "tool_permissions": _assistant_tool_permissions(completion_messages),
                },
            )

            while True:
                if isinstance(stream_event, CopilotAssistantDeltaEvent):
                    for chunk in _iter_answer_chunks(stream_event.text):
                        delta_chars += len(chunk)
                        if not first_delta_logged and chunk:
                            first_delta_logged = True
                            _ASSISTANT_TURN_LOGGER.info(
                                "assistant_turn_response_started",
                                extra={
                                    **_assistant_turn_context_extra(
                                        turn_id=turn_id,
                                        thread_id=thread_id,
                                        payload=payload,
                                    ),
                                    "time_to_first_delta_ms": _duration_ms(turn_started_at),
                                    "delta_chars": delta_chars,
                                },
                            )
                        yield ("assistant_delta", {"text": chunk})
                elif isinstance(stream_event, CopilotToolStatusEvent):
                    tool_event_count += 1
                    _ASSISTANT_TURN_LOGGER.info(
                        "assistant_turn_tool_status",
                        extra={
                            **_assistant_turn_context_extra(
                                turn_id=turn_id,
                                thread_id=thread_id,
                                payload=payload,
                            ),
                            "tool_event_count": tool_event_count,
                            "tool": stream_event.tool,
                            "status": stream_event.status,
                            "call_id": stream_event.call_id,
                            "summary": _preview_text(stream_event.summary),
                            "query_type": stream_event.query_type,
                            "query_preview": _preview_text(stream_event.query_preview),
                            "row_count": stream_event.row_count,
                            "truncated": stream_event.truncated,
                            "error": _preview_text(stream_event.error),
                        },
                    )
                    yield (
                        "tool_status",
                        {
                            "status": stream_event.status,
                            "tool": stream_event.tool,
                            "call_id": stream_event.call_id,
                            "summary": stream_event.summary,
                            "query_preview": stream_event.query_preview,
                            "query_type": stream_event.query_type,
                            "row_count": stream_event.row_count,
                            "truncated": stream_event.truncated,
                            "error": stream_event.error,
                        },
                    )
                elif isinstance(stream_event, CopilotAnswerFinalEvent):
                    response = _build_assistant_chat_response(
                        payload=payload,
                        thread_id=thread_id,
                        copilot=stream_event.response,
                        completion_messages=completion_messages,
                    )
                    _ASSISTANT_TURN_LOGGER.info(
                        "assistant_turn_completed",
                        extra={
                            **_assistant_turn_context_extra(
                                turn_id=turn_id,
                                thread_id=thread_id,
                                payload=payload,
                            ),
                            "duration_ms": _duration_ms(turn_started_at),
                            "delta_chars": delta_chars,
                            "tool_event_count": tool_event_count,
                            "answer_chars": len(response.answer),
                            "answer_preview": _preview_text(response.answer),
                            "evidence_count": len(response.evidence),
                            "caveat_count": len(response.caveats),
                            "completion_message_count": len(response.completion_messages),
                        },
                    )
                    yield ("final", response.model_dump(mode="json"))
                    yield ("done", {"status": "ok"})
                    return

                try:
                    stream_event = await anext(copilot_stream)
                except StopAsyncIteration:
                    break

            failure_logged = True
            _ASSISTANT_TURN_LOGGER.warning(
                "assistant_turn_failed",
                extra={
                    **_assistant_turn_context_extra(
                        turn_id=turn_id,
                        thread_id=thread_id,
                        payload=payload,
                    ),
                    "duration_ms": _duration_ms(turn_started_at),
                    "delta_chars": delta_chars,
                    "tool_event_count": tool_event_count,
                    "error_type": "ValueError",
                    "error_message": "assistant chat stream ended without final response",
                },
            )
            raise ValueError("assistant chat stream ended without final response")
        except Exception as exc:
            if not failure_logged:
                _ASSISTANT_TURN_LOGGER.warning(
                    "assistant_turn_failed",
                    extra={
                        **_assistant_turn_context_extra(
                            turn_id=turn_id,
                            thread_id=thread_id,
                            payload=payload,
                        ),
                        "duration_ms": _duration_ms(turn_started_at),
                        "delta_chars": delta_chars,
                        "tool_event_count": tool_event_count,
                        "error_type": type(exc).__name__,
                        "error_message": _preview_text(str(exc)),
                    },
                )
            raise

    async def workbench_chat(
        self,
        payload: AiWorkbenchChatRequest,
    ) -> AiWorkbenchChatResponse:
        async for event_name, event_payload in self.workbench_chat_stream(payload):
            if event_name == "final":
                return AiWorkbenchChatResponse.model_validate(event_payload)
        raise ValueError("workbench chat stream ended without final response")

    async def workbench_chat_stream(
        self,
        payload: AiWorkbenchChatRequest,
    ) -> AsyncIterator[tuple[str, dict[str, Any]]]:
        thread_id = payload.thread_id or str(uuid4())
        investigation_id = payload.investigation_id or str(uuid4())

        anchor_object_type = payload.context.anchor_object_type if payload.context else None
        start_at = payload.context.start_at if payload.context else None
        end_at = payload.context.end_at if payload.context else None

        clarifying_questions = _build_workbench_clarifying_questions(
            anchor_object_type=anchor_object_type,
            start_at=start_at,
            end_at=end_at,
        )

        if clarifying_questions:
            response = _build_workbench_clarification_response(
                payload=payload,
                thread_id=thread_id,
                investigation_id=investigation_id,
                clarifying_questions=clarifying_questions,
            )
            yield (
                "meta",
                {
                    "thread_id": thread_id,
                    "investigation_id": investigation_id,
                    "module": "workbench",
                    "task": "chat",
                    "turn_kind": response.turn_kind,
                    "response_policy": response.response_policy,
                    "tool_permissions": response.tool_permissions,
                },
            )
            yield (
                "investigation_status",
                {
                    "status": "needs_clarification",
                    "message": "Need missing investigation context before running analysis.",
                },
            )
            for chunk in _iter_answer_chunks(response.answer_markdown):
                yield ("assistant_delta", {"text": chunk})
            yield ("final", response.model_dump(mode="json"))
            yield ("done", {"status": "ok"})
            return

        yield (
            "meta",
            {
                "thread_id": thread_id,
                "investigation_id": investigation_id,
                "module": "workbench",
                "task": "chat",
                "turn_kind": "investigation_answer",
                "response_policy": "analytical",
                "tool_permissions": _workbench_tool_permissions(),
            },
        )
        yield (
            "investigation_status",
            {
                "status": "resolving_context",
                "message": "Resolving investigation scope from workbench context.",
            },
        )
        yield (
            "investigation_status",
            {
                "status": "running_investigation",
                "message": "Running ontology, process, and root-cause investigation.",
            },
        )
        guided_response = await self.guided_investigation(
            GuidedInvestigationRequest(
                question=payload.question,
                anchor_object_type=anchor_object_type or "",
                start_at=start_at or datetime.now(UTC),
                end_at=end_at or datetime.now(UTC),
                depth=payload.depth,
                outcome_event_type=payload.outcome_event_type,
            )
        )
        yield (
            "investigation_status",
            {
                "status": "synthesizing_answer",
                "message": "Synthesizing workbench response.",
            },
        )
        response = _build_workbench_investigation_response(
            payload=payload,
            thread_id=thread_id,
            investigation_id=investigation_id,
            guided_response=guided_response,
        )
        for linked_surface in response.linked_surfaces:
            yield ("linked_surface_hint", linked_surface.model_dump(mode="json"))
        for chunk in _iter_answer_chunks(response.answer_markdown):
            yield ("assistant_delta", {"text": chunk})
        yield ("final", response.model_dump(mode="json"))
        yield ("done", {"status": "ok"})

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


def _build_assistant_chat_response(
    *,
    payload: AiAssistantChatRequest,
    thread_id: str,
    copilot: CopilotChatResponse,
    completion_messages: list[dict[str, Any]],
) -> AiAssistantChatResponse:
    evidence, caveats = _build_copilot_evidence_and_caveats(copilot)
    completion_messages_for_thread = _truncate_completion_messages(
        completion_messages + copilot.completion_messages_delta
    )

    if payload.context is not None:
        context_details = _format_context_details(payload.context)
        if context_details:
            evidence.append(
                AiEvidenceItem(
                    label="Request context",
                    detail=context_details,
                )
            )

    return AiAssistantChatResponse(
        response_policy="informational",
        tool_permissions=_assistant_tool_permissions(completion_messages_for_thread),
        summary=copilot.answer,
        answer=copilot.answer,
        evidence=evidence,
        caveats=caveats,
        next_actions=[
            "Ask a narrower follow-up scoped to one concept, process path, or outcome.",
            "Include object type and time window context for process/RCA guidance.",
        ],
        thread_id=thread_id,
        copilot=copilot,
        completion_messages=completion_messages_for_thread,
    )


def _assistant_tool_permissions(
    completion_messages: list[dict[str, Any]] | None = None,
) -> list[str]:
    permissions = [
        "assistant.context",
        "ontology.current",
        "ontology.concepts",
        "ontology.concept_detail",
        "ontology.query(read_only)",
    ]
    if not completion_messages:
        return permissions

    for tool_name in _assistant_loaded_skill_tools(completion_messages):
        if tool_name not in permissions:
            permissions.append(tool_name)
    return permissions


def _workbench_tool_permissions() -> list[str]:
    return [
        "workbench.context",
        "ontology.current",
        "ontology.concepts",
        "ontology.concept_detail",
        "ontology.query(read_only)",
        "process.mine",
        "process.traces",
        "root_cause.run",
        "root_cause.evidence",
        "root_cause.assist.setup",
        "root_cause.assist.interpret",
    ]


def _assistant_loaded_skill_tools(
    completion_messages: list[dict[str, Any]],
) -> list[str]:
    loaded_tools: list[str] = []
    for message in completion_messages:
        if not isinstance(message, dict) or message.get("role") != "tool":
            continue
        content = message.get("content")
        if not isinstance(content, str) or not content.strip():
            continue
        try:
            parsed = json.loads(content)
        except json.JSONDecodeError:
            continue
        if not isinstance(parsed, dict):
            continue
        if parsed.get("tool") != "load_skill" or parsed.get("error"):
            continue
        allowed_tools = parsed.get("allowed_tools")
        if not isinstance(allowed_tools, list):
            continue
        for tool_name in allowed_tools:
            if isinstance(tool_name, str) and tool_name not in loaded_tools:
                loaded_tools.append(tool_name)
    return loaded_tools


def _iter_answer_chunks(answer: str, chunk_size: int = 120) -> Iterator[str]:
    if not answer:
        yield ""
        return
    for index in range(0, len(answer), chunk_size):
        yield answer[index : index + chunk_size]


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


def _build_workbench_clarifying_questions(
    *,
    anchor_object_type: str | None,
    start_at: datetime | None,
    end_at: datetime | None,
) -> list[AiWorkbenchClarifyingQuestion]:
    questions: list[AiWorkbenchClarifyingQuestion] = []
    if not anchor_object_type:
        questions.append(
            AiWorkbenchClarifyingQuestion(
                field="anchor_object_type",
                prompt="Which business object should I anchor this investigation on?",
            )
        )
    if start_at is None or end_at is None:
        questions.append(
            AiWorkbenchClarifyingQuestion(
                field="time_window",
                prompt="What time window should I investigate?",
            )
        )
    return questions


def _build_workbench_clarification_response(
    *,
    payload: AiWorkbenchChatRequest,
    thread_id: str,
    investigation_id: str,
    clarifying_questions: list[AiWorkbenchClarifyingQuestion],
) -> AiWorkbenchChatResponse:
    next_actions = [question.prompt for question in clarifying_questions]
    answer_markdown = _join_markdown_sections(
        [
            payload.question.strip(),
            "I can investigate this once you lock the scope.",
            _render_semantic_block(
                "follow-up",
                _bullet_lines(next_actions),
            ),
            _render_semantic_block(
                "caveat",
                [
                    (
                        "I have not started analysis yet because missing scope would likely "
                        "produce misleading results."
                    )
                ],
            ),
        ]
    )

    return AiWorkbenchChatResponse(
        response_policy="informational",
        tool_permissions=_workbench_tool_permissions(),
        summary="Need more investigation context before running the workbench flow.",
        evidence=[],
        caveats=[
            "Workbench investigation requires both an anchor object type and a time window.",
        ],
        next_actions=next_actions,
        thread_id=thread_id,
        investigation_id=investigation_id,
        turn_kind="clarifying_question",
        answer_markdown=answer_markdown,
        why_it_matters=(
            "The workbench needs an anchor object and a time window before it can produce a "
            "trustworthy investigation."
        ),
        follow_up_questions=next_actions,
        clarifying_questions=clarifying_questions,
    )


def _build_workbench_investigation_response(
    *,
    payload: AiWorkbenchChatRequest,
    thread_id: str,
    investigation_id: str,
    guided_response: GuidedInvestigationResponse,
) -> AiWorkbenchChatResponse:
    evidence = (
        guided_response.ontology.evidence[:1]
        + guided_response.process_ai.evidence[:2]
        + guided_response.root_cause_ai.evidence[:2]
    )
    caveats = list(
        dict.fromkeys(
            guided_response.ontology.caveats
            + guided_response.process_ai.caveats
            + guided_response.root_cause_ai.caveats
        )
    )
    next_actions = list(
        dict.fromkeys(
            guided_response.process_ai.next_actions[:1]
            + guided_response.root_cause_ai.next_actions[:2]
        )
    )
    linked_surfaces = _build_workbench_linked_surfaces(guided_response)
    follow_up_questions = [
        "Do you want me to narrow this investigation to one subgroup or path?",
        "Should I compare this outcome against a different time window?",
    ]
    why_it_matters = (
        "The workbench combined ontology context, process evidence, and root-cause "
        "signals into one investigation result so you can decide whether to drill down "
        "or act next."
    )
    answer_markdown = _build_workbench_answer_markdown(
        ontology_summary=guided_response.ontology.summary,
        process_summary=guided_response.process_ai.summary,
        root_cause_summary=guided_response.root_cause_ai.summary,
        why_it_matters=why_it_matters,
        evidence=evidence,
        caveats=caveats,
        next_actions=next_actions,
        follow_up_questions=follow_up_questions,
        linked_surfaces=linked_surfaces,
    )

    return AiWorkbenchChatResponse(
        response_policy="analytical",
        tool_permissions=_workbench_tool_permissions(),
        summary=guided_response.root_cause_ai.summary,
        evidence=evidence,
        caveats=caveats,
        next_actions=next_actions,
        thread_id=thread_id,
        investigation_id=investigation_id,
        turn_kind="investigation_answer",
        answer_markdown=answer_markdown,
        why_it_matters=why_it_matters,
        follow_up_questions=follow_up_questions,
        linked_surfaces=linked_surfaces,
        anchor_object_type=guided_response.anchor_object_type,
        start_at=guided_response.start_at,
        end_at=guided_response.end_at,
    )


def _build_workbench_linked_surfaces(
    guided_response: GuidedInvestigationResponse,
) -> list[AiWorkbenchLinkedSurface]:
    anchor_object_type = guided_response.anchor_object_type
    ontology_uri = _first_non_empty_uri(
        [item.uri for item in guided_response.ontology.evidence],
        fallback=anchor_object_type,
    )
    start_at = _to_query_datetime(guided_response.start_at)
    end_at = _to_query_datetime(guided_response.end_at)
    history_target = _extract_history_target(guided_response)
    rca_outcome = guided_response.root_cause_run.outcome.event_type

    return [
        AiWorkbenchLinkedSurface(
            kind="ontology",
            label="Open ontology exploration",
            href=_build_query_href(
                "/ontology/overview",
                {"conceptUri": ontology_uri},
            ),
            reason="Verify the ontology concept that anchored this investigation.",
        ),
        AiWorkbenchLinkedSurface(
            kind="history",
            label=(
                "Inspect sample object history"
                if history_target is not None
                else "Open history inspection"
            ),
            href=(
                _build_query_href(
                    "/inspector/history/object",
                    {
                        "object_type": history_target["object_type"],
                        "object_ref_canonical": history_target["object_ref_canonical"],
                        "object_ref_hash": history_target["object_ref_hash"],
                    },
                )
                if history_target is not None
                else "/inspector/history"
            ),
            reason=(
                "Open the sampled anchor object's timeline and verify the sequence of events."
                if history_target is not None
                else (
                    "No single anchor object was reliable enough to preselect, so start in "
                    "History and choose the object instance you want to verify."
                )
            ),
        ),
        AiWorkbenchLinkedSurface(
            kind="process",
            label="Open process analysis",
            href=_build_query_href(
                "/inspector/insights",
                {
                    "tab": "process-mining",
                    "pm_model": anchor_object_type,
                    "pm_from": start_at,
                    "pm_to": end_at,
                    "pm_run": "1",
                },
            ),
            reason="Review process structure and dominant paths for this investigation window.",
        ),
        AiWorkbenchLinkedSurface(
            kind="root_cause",
            label="Open root-cause analysis",
            href=_build_query_href(
                "/inspector/insights",
                {
                    "tab": "process-insights",
                    "rca_anchor": anchor_object_type,
                    "rca_from": start_at,
                    "rca_to": end_at,
                    "rca_outcome": rca_outcome,
                    "rca_run": "1",
                },
            ),
            reason="Inspect the ranked RCA findings and their supporting evidence traces.",
        ),
        AiWorkbenchLinkedSurface(
            kind="action_status",
            label="Open action capabilities",
            href=_build_query_href(
                "/ontology/actions",
                {"conceptUri": ontology_uri},
            ),
            reason=(
                "There is no workbench-level live action status deep link yet, so hand off to "
                "the ontology actions tab to inspect related actions and workflows."
            ),
        ),
    ]


def _build_workbench_answer_markdown(
    *,
    ontology_summary: str,
    process_summary: str,
    root_cause_summary: str,
    why_it_matters: str,
    evidence: list[AiEvidenceItem],
    caveats: list[str],
    next_actions: list[str],
    follow_up_questions: list[str],
    linked_surfaces: list[AiWorkbenchLinkedSurface],
) -> str:
    investigation_sections = [
        root_cause_summary.strip(),
        why_it_matters.strip(),
        (
            "Supporting investigation notes: "
            f"{ontology_summary.strip()} {process_summary.strip()}"
        ).strip(),
    ]
    linked_surface_sections = [
        _render_semantic_block(
            "linked-surface",
            [
                surface.reason,
            ],
            attributes={
                "kind": surface.kind,
                "href": surface.href,
                "label": surface.label,
            },
        )
        for surface in linked_surfaces
    ]

    return _join_markdown_sections(
        [
            *investigation_sections,
            _render_semantic_block(
                "caveat",
                caveats,
            ),
            _render_semantic_block(
                "evidence",
                [
                    f"**{item.label}:** {item.detail}"
                    for item in evidence
                ],
            ),
            "Recommendations below are suggestions, not established facts.",
            _render_semantic_block(
                "next-action",
                _bullet_lines(next_actions),
            ),
            _render_semantic_block(
                "follow-up",
                _bullet_lines(follow_up_questions),
            ),
            *linked_surface_sections,
        ]
    )


def _render_semantic_block(
    block_name: str,
    lines: list[str],
    *,
    attributes: dict[str, str] | None = None,
) -> str:
    normalized_lines = [line.strip() for line in lines if line.strip()]
    if not normalized_lines:
        return ""

    attribute_text = ""
    if attributes:
        parts = [
            f'{key}="{_escape_semantic_block_attribute(value)}"'
            for key, value in attributes.items()
            if value.strip()
        ]
        if parts:
            attribute_text = " " + " ".join(parts)

    return "\n".join(
        [
            f":::{block_name}{attribute_text}",
            *normalized_lines,
            ":::",
        ]
    )


def _bullet_lines(items: list[str]) -> list[str]:
    return [f"- {item.strip()}" for item in items if item.strip()]


def _join_markdown_sections(sections: list[str]) -> str:
    return "\n\n".join(section for section in sections if section.strip())


def _escape_semantic_block_attribute(value: str) -> str:
    return value.replace("\\", "\\\\").replace('"', '\\"')


def _build_query_href(path: str, params: dict[str, str | int | None]) -> str:
    encoded = urlencode(
        [
            (key, str(value))
            for key, value in params.items()
            if value is not None and str(value).strip()
        ]
    )
    return f"{path}?{encoded}" if encoded else path


def _to_query_datetime(value: datetime) -> str:
    return _ensure_utc(value).isoformat().replace("+00:00", "Z")


def _first_non_empty_uri(values: list[str | None], *, fallback: str) -> str:
    for value in values:
        if value and value.strip():
            return value
    return fallback


def _extract_history_target(
    guided_response: GuidedInvestigationResponse,
) -> dict[str, str | int] | None:
    for insight in guided_response.root_cause_run.insights:
        for anchor_key in insight.evidence.sample_anchor_keys:
            target = _parse_anchor_key(anchor_key)
            if target is not None:
                return target
    return None


def _parse_anchor_key(anchor_key: str) -> dict[str, str | int] | None:
    object_type, separator, remainder = anchor_key.partition("|")
    if not separator:
        return None

    object_ref_hash, separator, object_ref_canonical = remainder.partition("|")
    if not separator or not object_type.strip() or not object_ref_canonical.strip():
        return None

    try:
        parsed_hash = int(object_ref_hash)
    except ValueError:
        return None

    return {
        "object_type": object_type,
        "object_ref_hash": parsed_hash,
        "object_ref_canonical": object_ref_canonical,
    }


def _build_copilot_evidence_and_caveats(
    copilot: CopilotChatResponse,
) -> tuple[list[AiEvidenceItem], list[str]]:
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
        if copilot.tool_result.tool == "load_skill":
            if copilot.tool_result.error:
                caveats.append(
                    "Assistant skill activation failed; response may rely on the "
                    "base assistant context only."
                )
            else:
                skill_name = copilot.tool_result.skill_name or "unknown"
                enabled_tools = (
                    ", ".join(copilot.tool_result.allowed_tools)
                    or "no additional tools"
                )
                evidence.append(
                    AiEvidenceItem(
                        label="Assistant skill loaded",
                        detail=f"{skill_name} enabled {enabled_tools}.",
                    )
                )
        elif copilot.tool_result.error:
            if copilot.tool_result.tool == "sparql_read_only_query":
                caveats.append(
                    "Tool execution failed; response may rely on incomplete ontology context."
                )
                lowered = copilot.tool_result.error.lower()
                if "not allowed" in lowered or "restricted" in lowered:
                    caveats.append(
                        "Read-only SPARQL policy blocked a mutating or dataset-scoped query."
                    )
                    evidence.append(
                        AiEvidenceItem(
                            label="Read-only SPARQL policy block",
                            detail=copilot.tool_result.error,
                        )
                    )
            else:
                caveats.append(
                    "Assistant domain tool execution failed; response may rely on partial evidence."
                )
        else:
            if copilot.tool_result.tool == "sparql_read_only_query":
                result_detail = (
                    f"{copilot.tool_result.query_type} query returned "
                    f"{copilot.tool_result.row_count} rows"
                )
                if copilot.tool_result.truncated:
                    result_detail += " (truncated)"
                label = "Read-only SPARQL tool result"
            else:
                result_detail = copilot.tool_result.summary or (
                    f"{copilot.tool_result.tool_permission or copilot.tool_result.tool} completed"
                )
                label = "Assistant domain tool result"
            evidence.append(
                AiEvidenceItem(
                    label=label,
                    detail=result_detail,
                )
            )

    if not evidence:
        caveats.append("Informational response generated without explicit query evidence.")

    return evidence, caveats


def _to_copilot_turn(
    completion_messages: list[AiAssistantCompletionMessage],
    context: AiAssistantContext | None,
) -> tuple[
    str,
    list[dict[str, Any]] | None,
    list[dict[str, Any]],
]:
    normalized_completion_messages = [
        item
        for item in (
            _completion_message_to_dict(message)
            for message in completion_messages
        )
        if item is not None
    ]
    last_user_index = max(
        (
            index
            for index, message in enumerate(normalized_completion_messages)
            if message.get("role") == "user"
        ),
        default=-1,
    )
    if last_user_index < 0:
        raise ValueError(
            "completion_messages must include at least one user message"
        )

    question = _message_content_to_text(
        normalized_completion_messages[last_user_index].get("content")
    )
    if not question:
        raise ValueError("last user completion message must include text content")
    if context is not None:
        context_lines = _context_lines(context)
        if context_lines:
            question = (
                "Context for this request:\n"
                + "\n".join(f"- {line}" for line in context_lines)
                + f"\n\nUser request:\n{question}"
            )

    return (
        question,
        normalized_completion_messages[:last_user_index],
        normalized_completion_messages[: last_user_index + 1],
    )


def _completion_message_to_dict(
    message: AiAssistantCompletionMessage,
) -> dict[str, Any] | None:
    data = message.model_dump(mode="json", exclude_none=True)
    role = data.get("role")
    if role == "system":
        # System prompts are backend-owned; ignore client-supplied system messages.
        return None
    tool_call_id = data.get("tool_call_id")
    if isinstance(tool_call_id, str) and tool_call_id.strip():
        data["tool_call_id"] = _normalize_tool_call_id(tool_call_id)
    tool_calls = data.get("tool_calls")
    if isinstance(tool_calls, list):
        data["tool_calls"] = _normalize_tool_calls(tool_calls)
    return data


def _normalize_tool_calls(tool_calls: list[Any]) -> list[dict[str, Any]]:
    normalized_calls: list[dict[str, Any]] = []
    for tool_call in tool_calls:
        if not isinstance(tool_call, dict):
            continue
        normalized_call = dict(tool_call)
        call_id = normalized_call.get("id")
        if isinstance(call_id, str) and call_id.strip():
            normalized_call["id"] = _normalize_tool_call_id(call_id)
        normalized_calls.append(normalized_call)
    return normalized_calls


def _normalize_tool_call_id(raw_call_id: str) -> str:
    normalized = raw_call_id.strip()
    if "__sig__" in normalized:
        normalized = normalized.split("__sig__", 1)[0]
    normalized = re.sub(r"[^A-Za-z0-9._:-]+", "_", normalized)
    normalized = normalized.strip("._:-_")
    if (
        normalized
        and len(normalized) <= _TOOL_CALL_ID_MAX_LENGTH
        and normalized.startswith("call")
    ):
        return normalized

    digest = hashlib.sha256(raw_call_id.encode("utf-8")).hexdigest()[:24]
    return f"call_{digest}"


def _message_content_to_text(content: Any) -> str:
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if isinstance(item, dict):
                text = item.get("text")
                if isinstance(text, str):
                    parts.append(text)
            else:
                text = getattr(item, "text", None)
                if isinstance(text, str):
                    parts.append(text)
        return "".join(parts).strip()
    return ""


def _truncate_completion_messages(
    messages: list[dict[str, Any]],
    max_messages: int = 400,
) -> list[dict[str, Any]]:
    if len(messages) <= max_messages:
        return messages
    return messages[-max_messages:]


def _assistant_turn_context_extra(
    *,
    turn_id: str,
    thread_id: str,
    payload: AiAssistantChatRequest,
) -> dict[str, Any]:
    context = payload.context
    return {
        "turn_id": turn_id,
        "thread_id": thread_id,
        "route": context.route if context else None,
        "module_context": context.module if context else None,
        "anchor_object_type": context.anchor_object_type if context else None,
        "concept_uri_count": len(context.concept_uris) if context else 0,
        "context_summary": _format_context_details(context) if context else "",
    }


def _last_user_completion_message_text(
    completion_messages: list[AiAssistantCompletionMessage],
) -> str:
    for message in reversed(completion_messages):
        if message.role != "user":
            continue
        text = _message_content_to_text(message.content)
        if text:
            return text
    return ""


def _preview_text(value: Any, limit: int = 160) -> str:
    if not isinstance(value, str):
        return ""
    normalized = " ".join(value.split()).strip()
    if len(normalized) <= limit:
        return normalized
    return f"{normalized[: limit - 3]}..."


def _duration_ms(started_at: float) -> int:
    return int((perf_counter() - started_at) * 1000)


def _context_lines(context: AiAssistantContext) -> list[str]:
    lines: list[str] = []
    if context.route:
        lines.append(f"route={context.route}")
    if context.module:
        lines.append(f"module={context.module}")
    if context.anchor_object_type:
        lines.append(f"anchor_object_type={context.anchor_object_type}")
    if context.start_at and context.end_at:
        lines.append(
            f"time_window={_ensure_utc(context.start_at).isoformat()}..{_ensure_utc(context.end_at).isoformat()}"
        )
    if context.concept_uris:
        uri_preview = ", ".join(context.concept_uris[:3])
        extra_count = len(context.concept_uris) - 3
        if extra_count > 0:
            uri_preview = f"{uri_preview} (+{extra_count} more)"
        lines.append(f"concept_uris={uri_preview}")
    return lines


def _format_context_details(context: AiAssistantContext) -> str:
    lines = _context_lines(context)
    return " | ".join(lines)
