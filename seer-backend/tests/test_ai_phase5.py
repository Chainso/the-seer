from __future__ import annotations

import asyncio
import json
import logging
import re
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import parse_qs, urlparse
from uuid import uuid4

from fastapi.testclient import TestClient

import seer_backend.ai.gateway as ai_gateway
import seer_backend.ai.ontology_copilot as ontology_copilot
from seer_backend.actions.repository import InMemoryActionsRepository
from seer_backend.actions.service import ActionsService
from seer_backend.ai.assistant_tools import AssistantDomainToolAdapter
from seer_backend.ai.gateway import GuidedInvestigationRequest
from seer_backend.ai.ontology_copilot import (
    CopilotActionExecutionContext,
    CopilotAnswerFinalEvent,
    CopilotAnswerStreamEvent,
    CopilotAssistantDeltaEvent,
    CopilotModelRuntime,
    CopilotToolStatusEvent,
    OntologyCopilotService,
)
from seer_backend.ai.skills import AssistantSkillRegistry
from seer_backend.analytics.models import ProcessMiningRequest
from seer_backend.analytics.rca_repository import InMemoryRootCauseRepository
from seer_backend.analytics.rca_service import RootCauseService, UnavailableRootCauseService
from seer_backend.analytics.repository import InMemoryProcessMiningRepository
from seer_backend.analytics.service import (
    OcpnMiningWrapper,
    ProcessMiningService,
    UnavailableProcessMiningService,
)
from seer_backend.history.canonicalization import canonicalize_object_ref, xxhash64_uint64
from seer_backend.history.repository import InMemoryHistoryRepository
from seer_backend.history.service import HistoryService, UnavailableHistoryService
from seer_backend.main import create_app
from seer_backend.ontology.errors import OntologyNotReadyError
from seer_backend.ontology.models import (
    CopilotChatResponse,
    CopilotConversationMessage,
    CopilotEvidence,
    CopilotStructuredOutput,
    CopilotToolCall,
    CopilotToolResult,
    CurrentReleasePointer,
    OntologyCurrentResponse,
    OntologySparqlQueryResponse,
)

FIXTURE_PATH = Path(__file__).parent / "fixtures" / "rca_phase4_orders.json"
ASSISTANT_SKILLS_ROOT = (
    Path(__file__).resolve().parents[1]
    / "src"
    / "seer_backend"
    / "ai"
    / "assistant_skills"
)
_ORDER_URI = "urn:seer:test:order"
_CHILD_ACTION_URI = "urn:seer:test:action.email_customer"
_OPENAI_INVALID_TOP_LEVEL_PARAMETER_KEYS = {"oneOf", "anyOf", "allOf", "enum", "not"}
_LONG_POLICY_BLOCK_ERROR = (
    "SPARQL update operations are not allowed because the assistant runtime only "
    "permits read-only SELECT or ASK queries against the ontology graph, and this "
    "request attempted to mutate data with INSERT DATA."
)
_LONG_NOT_READY_ERROR = (
    "Ontology release is still initializing and the current release graph has not "
    "finished loading into the read-only runtime yet, so exact query answers are "
    "temporarily unavailable."
)


def _to_uri_identifier(value: str) -> str:
    cleaned = value.strip()
    if "://" in cleaned or cleaned.startswith("urn:"):
        return cleaned
    token = re.sub(r"[^a-zA-Z0-9]+", "_", cleaned).strip("_").lower()
    return f"urn:seer:test:{token}" if token else "urn:seer:test:unknown"


def _normalize_event_payload(payload: dict[str, object]) -> dict[str, object]:
    normalized = dict(payload)
    event_type = normalized.get("event_type")
    if isinstance(event_type, str):
        normalized["event_type"] = _to_uri_identifier(event_type)

    updated_objects = normalized.get("updated_objects")
    if not isinstance(updated_objects, list):
        return normalized

    normalized_objects: list[dict[str, object]] = []
    for item in updated_objects:
        if not isinstance(item, dict):
            continue
        updated = dict(item)
        object_type = updated.get("object_type")
        if isinstance(object_type, str):
            uri = _to_uri_identifier(object_type)
            updated["object_type"] = uri
            payload_object = updated.get("object")
            if isinstance(payload_object, dict):
                payload_object_copy = dict(payload_object)
                payload_object_copy["object_type"] = uri
                updated["object"] = payload_object_copy
        normalized_objects.append(updated)
    normalized["updated_objects"] = normalized_objects
    return normalized


def _object_ref_hash(object_ref: dict[str, object]) -> int:
    return xxhash64_uint64(canonicalize_object_ref(object_ref))


def _assert_openai_function_tool_schema(schema: dict[str, object]) -> None:
    function = schema["function"]
    assert isinstance(function, dict)
    parameters = function["parameters"]
    assert isinstance(parameters, dict)
    assert parameters["type"] == "object"
    assert _OPENAI_INVALID_TOP_LEVEL_PARAMETER_KEYS.isdisjoint(parameters)


class StubOntologyCopilotService:
    async def answer(
        self,
        question: str,
        conversation: list[CopilotConversationMessage] | None = None,
        completion_conversation: list[dict[str, object]] | None = None,
        assistant_tool_adapter: object | None = None,
    ) -> CopilotChatResponse:
        del conversation, completion_conversation, assistant_tool_adapter
        return CopilotChatResponse(
            mode="direct_answer",
            answer=f"Ontology context for: {question}",
            evidence=[
                CopilotEvidence(
                    concept_iri="urn:seer:test:Order",
                    query="tool:list_concepts",
                )
            ],
            current_release_id="phase5-test-release",
            tool_call=None,
            tool_result=None,
            completion_messages_delta=[
                {
                    "role": "assistant",
                    "content": f"Ontology context for: {question}",
                }
            ],
        )

    async def answer_stream(
        self,
        question: str,
        conversation: list[CopilotConversationMessage] | None = None,
        completion_conversation: list[dict[str, object]] | None = None,
        assistant_tool_adapter: object | None = None,
    ) -> AsyncIterator[CopilotAnswerStreamEvent]:
        response = await self.answer(
            question,
            conversation=conversation,
            completion_conversation=completion_conversation,
            assistant_tool_adapter=assistant_tool_adapter,
        )
        yield CopilotAssistantDeltaEvent(text=response.answer)
        yield CopilotAnswerFinalEvent(response=response)


class StubOntologyCopilotWithPolicyBlock:
    async def answer(
        self,
        question: str,
        conversation: list[CopilotConversationMessage] | None = None,
        completion_conversation: list[dict[str, object]] | None = None,
        assistant_tool_adapter: object | None = None,
    ) -> CopilotChatResponse:
        del question, conversation, completion_conversation, assistant_tool_adapter
        return CopilotChatResponse(
            mode="direct_answer",
            answer="Blocked a mutating SPARQL attempt and continued with safe guidance.",
            evidence=[],
            current_release_id="phase5-test-release",
            tool_call=CopilotToolCall(
                tool="sparql_read_only_query",
                query="INSERT DATA { <urn:test:s> <urn:test:p> \"x\" . }",
                call_id="call_1",
            ),
            tool_result=CopilotToolResult(
                tool="sparql_read_only_query",
                query="INSERT DATA { <urn:test:s> <urn:test:p> \"x\" . }",
                error=_LONG_POLICY_BLOCK_ERROR,
            ),
            completion_messages_delta=[
                {
                    "role": "assistant",
                    "content": (
                        "Blocked a mutating SPARQL attempt and continued with safe "
                        "guidance."
                    ),
                }
            ],
        )

    async def answer_stream(
        self,
        question: str,
        conversation: list[CopilotConversationMessage] | None = None,
        completion_conversation: list[dict[str, object]] | None = None,
        assistant_tool_adapter: object | None = None,
    ) -> AsyncIterator[CopilotAnswerStreamEvent]:
        response = await self.answer(
            question,
            conversation=conversation,
            completion_conversation=completion_conversation,
            assistant_tool_adapter=assistant_tool_adapter,
        )
        if response.tool_call is not None:
            call_id = response.tool_call.call_id or "call_1"
            yield CopilotToolStatusEvent(
                status="started",
                tool=response.tool_call.tool,
                call_id=call_id,
                summary="Running read-only SPARQL query.",
                query_preview=response.tool_call.query,
            )
            yield CopilotToolStatusEvent(
                status="failed",
                tool=response.tool_call.tool,
                call_id=call_id,
                summary=f"Read-only SPARQL query failed: {_LONG_POLICY_BLOCK_ERROR}",
                query_preview=response.tool_call.query,
                error=response.tool_result.error if response.tool_result else None,
            )
        yield CopilotAssistantDeltaEvent(text=response.answer)
        yield CopilotAnswerFinalEvent(response=response)


class StubOntologyCopilotNotReady:
    async def answer(
        self,
        question: str,
        conversation: list[CopilotConversationMessage] | None = None,
        completion_conversation: list[dict[str, object]] | None = None,
        assistant_tool_adapter: object | None = None,
    ) -> CopilotChatResponse:
        del question, conversation, completion_conversation, assistant_tool_adapter
        raise OntologyNotReadyError(_LONG_NOT_READY_ERROR)

    async def answer_stream(
        self,
        question: str,
        conversation: list[CopilotConversationMessage] | None = None,
        completion_conversation: list[dict[str, object]] | None = None,
        assistant_tool_adapter: object | None = None,
    ) -> AsyncIterator[CopilotAnswerStreamEvent]:
        del question, conversation, completion_conversation, assistant_tool_adapter
        raise OntologyNotReadyError(_LONG_NOT_READY_ERROR)
        yield CopilotAssistantDeltaEvent(text="")


class _SkillAwareOntologyService:
    async def current(self) -> CurrentReleasePointer:
        return CurrentReleasePointer(
            release_id="phase5-test-release",
            graph_iri="urn:seer:test:graph",
            updated_at=datetime.now(tz=UTC),
        )

    async def copilot_seer_data_turtle(self) -> str:
        return ""

    async def run_read_only_query(self, query: str) -> OntologySparqlQueryResponse:
        del query
        return OntologySparqlQueryResponse(
            query_type="SELECT",
            bindings=[],
            graphs=["urn:seer:test:graph"],
        )


class _ManagedAgentActionOntologyService(_SkillAwareOntologyService):
    async def current(self) -> OntologyCurrentResponse:
        return OntologyCurrentResponse(
            release_id="phase5-test-release",
            current_graph_iri="urn:seer:test:graph",
            meta_graph_iri="urn:seer:test:meta",
            updated_at=datetime.now(tz=UTC),
        )

    async def run_read_only_query(self, query: str) -> OntologySparqlQueryResponse:
        if _CHILD_ACTION_URI in query and "prophet:acceptsInput" in query:
            return OntologySparqlQueryResponse(
                query_type="SELECT",
                bindings=[
                    {
                        "actionType": "urn:seer:test:Action",
                        "actionKind": "action",
                        "actionLabel": "Email customer",
                        "input": "urn:seer:test:action.email_customer:input",
                        "property": "urn:seer:test:action.email_customer:input#customer_id",
                        "fieldKey": "customer_id",
                        "minCardinality": "1",
                        "maxCardinality": "1",
                        "valueType": "http://prophet.platform/standard-types#string",
                        "valueTypeKind": "http://prophet.platform/ontology#BaseType",
                    }
                ],
                graphs=["urn:seer:test:graph"],
            )
        return await super().run_read_only_query(query)


class _LoadSkillThenAnswerRuntime(CopilotModelRuntime):
    def __init__(self) -> None:
        self.calls = 0

    async def run_messages(
        self,
        messages: list[dict[str, object]],
        tools: list[dict[str, object]] | None = None,
    ) -> CopilotStructuredOutput:
        del messages
        self.calls += 1
        if self.calls == 1:
            assert tools is not None
            tool_names = {tool["function"]["name"] for tool in tools}
            assert "sparql_read_only_query" in tool_names
            assert "load_skill" in tool_names
            assert "create_ontology_graph_artifact" in tool_names
            assert "present_canvas_artifact" in tool_names
            assert "update_canvas_artifact" in tool_names
            assert "close_canvas" in tool_names
            return CopilotStructuredOutput(
                mode="tool_call",
                answer="Loading process mining guidance.",
                evidence=[],
                tool_call=CopilotToolCall(
                    tool="load_skill",
                    skill_name="process-mining",
                    call_id="call_skill_1",
                ),
            )

        return CopilotStructuredOutput(
            mode="direct_answer",
            answer="Loaded process mining guidance and can mine OC-DFGs next.",
            evidence=[],
            tool_call=None,
        )


class _LoadSkillThenUseToolRuntime(CopilotModelRuntime):
    def __init__(
        self,
        *,
        skill_name: str,
        function_name: str,
        tool_arguments: dict[str, object],
        final_answer: str,
    ) -> None:
        self.skill_name = skill_name
        self.function_name = function_name
        self.tool_arguments = tool_arguments
        self.final_answer = final_answer
        self.calls = 0

    async def run_messages(
        self,
        messages: list[dict[str, object]],
        tools: list[dict[str, object]] | None = None,
    ) -> CopilotStructuredOutput:
        self.calls += 1
        assert tools is not None
        tool_names = {tool["function"]["name"] for tool in tools}

        if self.calls == 1:
            assert self.function_name not in tool_names
            return CopilotStructuredOutput(
                mode="tool_call",
                answer=f"Loading {self.skill_name} skill.",
                evidence=[],
                tool_call=CopilotToolCall(
                    tool="load_skill",
                    skill_name=self.skill_name,
                    call_id="call_skill_1",
                ),
            )

        if self.calls == 2:
            assert self.function_name in tool_names
            assert any(message.get("role") == "tool" for message in messages)
            return CopilotStructuredOutput(
                mode="tool_call",
                answer=f"Running {self.function_name}.",
                evidence=[],
                tool_call=CopilotToolCall(
                    tool=self.function_name,
                    arguments=self.tool_arguments,
                    call_id="call_domain_1",
                ),
            )

        assert self.calls == 3
        return CopilotStructuredOutput(
            mode="direct_answer",
            answer=self.final_answer,
            evidence=[],
            tool_call=None,
        )


class _UsePersistedProcessTraceRuntime(CopilotModelRuntime):
    def __init__(self) -> None:
        self.calls = 0

    async def run_messages(
        self,
        messages: list[dict[str, object]],
        tools: list[dict[str, object]] | None = None,
    ) -> CopilotStructuredOutput:
        self.calls += 1
        assert tools is not None
        tool_names = {tool["function"]["name"] for tool in tools}

        if self.calls == 1:
            assert "process_trace_drilldown" in tool_names
            handle = _extract_process_trace_handle_from_messages(messages)
            return CopilotStructuredOutput(
                mode="tool_call",
                answer="Fetching persisted process traces.",
                evidence=[],
                tool_call=CopilotToolCall(
                    tool="process_trace_drilldown",
                    arguments={"handle": handle, "limit": 2},
                    call_id="call_domain_2",
                ),
            )

        assert self.calls == 2
        return CopilotStructuredOutput(
            mode="direct_answer",
            answer="Fetched example traces from the persisted process mining result.",
            evidence=[],
            tool_call=None,
        )


class _CaptureMessagesRuntime(CopilotModelRuntime):
    def __init__(self) -> None:
        self.last_messages: list[dict[str, object]] | None = None

    async def run_messages(
        self,
        messages: list[dict[str, object]],
        tools: list[dict[str, object]] | None = None,
    ) -> CopilotStructuredOutput:
        del tools
        self.last_messages = messages
        return CopilotStructuredOutput(
            mode="direct_answer",
            answer="Captured messages.",
            evidence=[],
            tool_call=None,
        )


class _LoadDisallowedSkillRuntime(CopilotModelRuntime):
    def __init__(self) -> None:
        self.calls = 0

    async def run_messages(
        self,
        messages: list[dict[str, object]],
        tools: list[dict[str, object]] | None = None,
    ) -> CopilotStructuredOutput:
        del messages
        self.calls += 1
        assert tools is not None
        if self.calls == 1:
            return CopilotStructuredOutput(
                mode="tool_call",
                answer="Trying to load process mining.",
                evidence=[],
                tool_call=CopilotToolCall(
                    tool="load_skill",
                    skill_name="process-mining",
                    call_id="call_disallowed_skill_1",
                ),
            )
        assert self.calls == 2
        return CopilotStructuredOutput(
            mode="direct_answer",
            answer="The disallowed skill stayed blocked.",
            evidence=[],
            tool_call=None,
        )


class _ManagedAgentLoadActionRuntime(CopilotModelRuntime):
    def __init__(self) -> None:
        self.calls = 0

    async def run_messages(
        self,
        messages: list[dict[str, object]],
        tools: list[dict[str, object]] | None = None,
    ) -> CopilotStructuredOutput:
        self.calls += 1
        assert tools is not None
        tool_names = {tool["function"]["name"] for tool in tools}

        if self.calls == 1:
            assert "load_action" in tool_names
            return CopilotStructuredOutput(
                mode="tool_call",
                answer="Loading the email action.",
                evidence=[],
                tool_call=CopilotToolCall(
                    tool="load_action",
                    action_uri=_CHILD_ACTION_URI,
                    call_id="call_load_action_1",
                ),
            )

        loaded_tool_name = next(
            name for name in tool_names if name.startswith("invoke_action__")
        )
        if self.calls == 2:
            return CopilotStructuredOutput(
                mode="tool_call",
                answer="Submitting the child action.",
                evidence=[],
                tool_call=CopilotToolCall(
                    tool=loaded_tool_name,
                    arguments={"customer_id": "C-100"},
                    call_id="call_loaded_action_1",
                ),
            )

        assert self.calls == 3
        return CopilotStructuredOutput(
            mode="direct_answer",
            answer="Loaded and submitted the child action.",
            evidence=[],
            tool_call=None,
        )


class _ManagedAgentInvalidLoadActionRuntime(CopilotModelRuntime):
    def __init__(self) -> None:
        self.calls = 0

    async def run_messages(
        self,
        messages: list[dict[str, object]],
        tools: list[dict[str, object]] | None = None,
    ) -> CopilotStructuredOutput:
        del messages
        self.calls += 1
        assert tools is not None
        if self.calls == 1:
            return CopilotStructuredOutput(
                mode="tool_call",
                answer="Trying to load an action with a bad identifier.",
                evidence=[],
                tool_call=CopilotToolCall(
                    tool="load_action",
                    action_uri="create sales order",
                    call_id="call_bad_load_action_1",
                ),
            )

        assert self.calls == 2
        return CopilotStructuredOutput(
            mode="direct_answer",
            answer="The invalid action identifier was rejected as a tool error.",
            evidence=[],
            tool_call=None,
        )


class _ManagedAgentSelfLoadActionRuntime(CopilotModelRuntime):
    def __init__(self) -> None:
        self.calls = 0

    async def run_messages(
        self,
        messages: list[dict[str, object]],
        tools: list[dict[str, object]] | None = None,
    ) -> CopilotStructuredOutput:
        del messages
        self.calls += 1
        assert tools is not None
        if self.calls == 1:
            return CopilotStructuredOutput(
                mode="tool_call",
                answer="Trying to load the current managed agent action.",
                evidence=[],
                tool_call=CopilotToolCall(
                    tool="load_action",
                    action_uri="urn:seer:managed-agent:create_and_close_sales_order",
                    call_id="call_self_load_action_1",
                ),
            )

        assert self.calls == 2
        return CopilotStructuredOutput(
            mode="direct_answer",
            answer="The self-recursive load_action attempt was rejected as a tool error.",
            evidence=[],
            tool_call=None,
        )


class _LoadSkillMineAndPresentCanvasRuntime(CopilotModelRuntime):
    def __init__(self) -> None:
        self.calls = 0

    async def run_messages(
        self,
        messages: list[dict[str, object]],
        tools: list[dict[str, object]] | None = None,
    ) -> CopilotStructuredOutput:
        self.calls += 1
        assert tools is not None
        tool_names = {tool["function"]["name"] for tool in tools}

        if self.calls == 1:
            assert "load_skill" in tool_names
            assert "create_ontology_graph_artifact" in tool_names
            assert "present_canvas_artifact" in tool_names
            return CopilotStructuredOutput(
                mode="tool_call",
                answer="Loading process mining guidance.",
                evidence=[],
                tool_call=CopilotToolCall(
                    tool="load_skill",
                    skill_name="process-mining",
                    call_id="call_skill_canvas_1",
                ),
            )

        if self.calls == 2:
            assert "process_mine" in tool_names
            return CopilotStructuredOutput(
                mode="tool_call",
                answer="Running OC-DFG discovery.",
                evidence=[],
                tool_call=CopilotToolCall(
                    tool="process_mine",
                    arguments={
                        "anchor_object_type": _ORDER_URI,
                        "start_at": "2026-02-22T07:00:00Z",
                        "end_at": "2026-02-22T11:00:00Z",
                    },
                    call_id="call_process_canvas_1",
                ),
            )

        if self.calls == 3:
            artifact_id = _extract_artifact_id_from_messages(messages, tool_name="process_mine")
            return CopilotStructuredOutput(
                mode="tool_call",
                answer="Opening the OC-DFG in canvas.",
                evidence=[],
                tool_call=CopilotToolCall(
                    tool="present_canvas_artifact",
                    arguments={"artifact_id": artifact_id},
                    call_id="call_canvas_present_1",
                ),
            )

        assert self.calls == 4
        return CopilotStructuredOutput(
            mode="direct_answer",
            answer="I ran OC-DFG discovery and opened it in the assistant canvas.",
            evidence=[],
            tool_call=None,
        )


class _CreateOntologyArtifactAndPresentCanvasRuntime(CopilotModelRuntime):
    def __init__(self) -> None:
        self.calls = 0

    async def run_messages(
        self,
        messages: list[dict[str, object]],
        tools: list[dict[str, object]] | None = None,
    ) -> CopilotStructuredOutput:
        self.calls += 1
        assert tools is not None
        tool_names = {tool["function"]["name"] for tool in tools}

        if self.calls == 1:
            assert "create_ontology_graph_artifact" in tool_names
            assert "present_canvas_artifact" in tool_names
            return CopilotStructuredOutput(
                mode="tool_call",
                answer="Preparing a focused ontology explorer artifact.",
                evidence=[],
                tool_call=CopilotToolCall(
                    tool="create_ontology_graph_artifact",
                    arguments={
                        "focus_concept_uri": _ORDER_URI,
                        "initial_tab": "objects",
                        "visible_concept_uris": [
                            _ORDER_URI,
                            "urn:seer:test:state_pending",
                            "urn:seer:test:state_approved",
                        ],
                        "title": "Order ontology",
                    },
                    call_id="call_ontology_artifact_1",
                ),
            )

        if self.calls == 2:
            artifact_id = _extract_artifact_id_from_messages(
                messages,
                tool_name="create_ontology_graph_artifact",
            )
            return CopilotStructuredOutput(
                mode="tool_call",
                answer="Opening the ontology explorer in canvas.",
                evidence=[],
                tool_call=CopilotToolCall(
                    tool="present_canvas_artifact",
                    arguments={"artifact_id": artifact_id},
                    call_id="call_ontology_canvas_present_1",
                ),
            )

        assert self.calls == 3
        return CopilotStructuredOutput(
            mode="direct_answer",
            answer="I opened the shared ontology explorer focused on the order model.",
            evidence=[],
            tool_call=None,
        )


def _parse_sse_events(raw_stream: str) -> list[tuple[str, dict[str, object]]]:
    events: list[tuple[str, dict[str, object]]] = []
    event_name: str | None = None
    data_lines: list[str] = []

    for line in raw_stream.splitlines():
        if not line:
            if event_name is not None:
                payload_text = "\n".join(data_lines)
                payload = json.loads(payload_text) if payload_text else {}
                events.append((event_name, payload))
            event_name = None
            data_lines = []
            continue

        if line.startswith("event:"):
            event_name = line.partition(":")[2].strip()
            continue
        if line.startswith("data:"):
            data_lines.append(line.partition(":")[2].lstrip())

    return events


def build_client() -> TestClient:
    app = create_app()

    history_repo = InMemoryHistoryRepository()
    app.state.history_service = HistoryService(repository=history_repo)
    app.state.process_service = ProcessMiningService(
        repository=InMemoryProcessMiningRepository.from_phase2_history_repository(history_repo),
        miner=OcpnMiningWrapper(),
        max_events_default=10_000,
        max_relations_default=120_000,
        max_traces_per_handle_default=200,
    )
    app.state.root_cause_service = RootCauseService(
        repository=InMemoryRootCauseRepository.from_phase2_history_repository(history_repo),
        max_events_default=20_000,
        max_relations_default=120_000,
        max_traces_per_insight_default=50,
    )
    app.state.ontology_copilot_service = StubOntologyCopilotService()

    from seer_backend.api.ai import inject_ai_gateway_service

    inject_ai_gateway_service(app)
    return TestClient(app)


def build_client_with_copilot(copilot_service: object) -> TestClient:
    app = create_app()

    history_repo = InMemoryHistoryRepository()
    app.state.history_service = HistoryService(repository=history_repo)
    app.state.process_service = ProcessMiningService(
        repository=InMemoryProcessMiningRepository.from_phase2_history_repository(history_repo),
        miner=OcpnMiningWrapper(),
        max_events_default=10_000,
        max_relations_default=120_000,
        max_traces_per_handle_default=200,
    )
    app.state.root_cause_service = RootCauseService(
        repository=InMemoryRootCauseRepository.from_phase2_history_repository(history_repo),
        max_events_default=20_000,
        max_relations_default=120_000,
        max_traces_per_insight_default=50,
    )
    app.state.ontology_copilot_service = copilot_service

    from seer_backend.api.ai import inject_ai_gateway_service

    inject_ai_gateway_service(app)
    return TestClient(app)


def build_skill_runtime_client(runtime: CopilotModelRuntime) -> TestClient:
    copilot = OntologyCopilotService(
        _SkillAwareOntologyService(),
        model_runtime=runtime,
        skill_registry=AssistantSkillRegistry([str(ASSISTANT_SKILLS_ROOT)]),
    )
    return build_client_with_copilot(copilot)


def _fixture_order_object_ref() -> dict[str, object]:
    payloads = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
    for payload in payloads:
        normalized = _normalize_event_payload(payload)
        updated_objects = normalized.get("updated_objects")
        if not isinstance(updated_objects, list):
            continue
        for item in updated_objects:
            if not isinstance(item, dict):
                continue
            if item.get("object_type") != _ORDER_URI:
                continue
            object_ref = item.get("object_ref")
            if isinstance(object_ref, dict):
                return object_ref
    raise AssertionError("fixture dataset does not contain an Order object_ref")


def _extract_process_trace_handle_from_messages(
    messages: list[dict[str, object]],
) -> str:
    for message in reversed(messages):
        if message.get("role") != "tool":
            continue
        content = message.get("content")
        if not isinstance(content, str):
            continue
        parsed = json.loads(content)
        if parsed.get("tool_permission") != "process.mine":
            continue
        result = parsed.get("result")
        if not isinstance(result, dict):
            continue
        run = result.get("run")
        if not isinstance(run, dict):
            continue
        edges = run.get("edges")
        if isinstance(edges, list) and edges:
            first_edge = edges[0]
            if isinstance(first_edge, dict):
                handle = first_edge.get("trace_handle")
                if isinstance(handle, str) and handle:
                    return handle
    raise AssertionError("process mining tool result did not persist a trace handle")


def _extract_artifact_id_from_messages(
    messages: list[dict[str, object]],
    *,
    tool_name: str,
) -> str:
    for message in reversed(messages):
        if message.get("role") != "tool":
            continue
        content = message.get("content")
        if not isinstance(content, str):
            continue
        parsed = json.loads(content)
        if parsed.get("tool") != tool_name:
            continue
        artifact = parsed.get("artifact")
        if not isinstance(artifact, dict):
            continue
        artifact_id = artifact.get("artifact_id")
        if isinstance(artifact_id, str) and artifact_id:
            return artifact_id
    raise AssertionError(f"{tool_name} tool result did not persist an artifact id")


def seed_fixture_dataset(client: TestClient) -> None:
    payloads = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
    for payload in payloads:
        response = client.post(
            "/api/v1/history/events/ingest",
            json=_normalize_event_payload(payload),
        )
        assert response.status_code == 200, response.text


def test_ai_gateway_ontology_question_uses_informational_policy() -> None:
    client = build_client()

    response = client.post(
        "/api/v1/ai/ontology/question",
        json={
            "question": "What does the Order concept represent?",
            "conversation": [],
        },
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["module"] == "ontology"
    assert body["task"] == "question"
    assert body["response_policy"] == "informational"
    assert "ontology.query(read_only)" in body["tool_permissions"]
    assert body["evidence"]
    assert body["copilot"]["answer"].startswith("Ontology context")


def test_ai_gateway_process_interpretation_returns_analytical_caveats() -> None:
    client = build_client()
    seed_fixture_dataset(client)

    run = asyncio.run(
        client.app.state.process_service.mine(
            ProcessMiningRequest.model_validate(
                {
                    "anchor_object_type": _ORDER_URI,
                    "start_at": "2026-02-22T07:00:00Z",
                    "end_at": "2026-02-22T11:00:00Z",
                }
            )
        )
    )

    response = client.post(
        "/api/v1/ai/process/interpret",
        json={"run": run.model_dump(mode="json")},
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["module"] == "process"
    assert body["response_policy"] == "analytical"
    assert body["evidence"]
    assert body["caveats"]
    assert "process.mine" in body["tool_permissions"]


def test_guided_investigation_runs_ontology_to_process_to_root_cause() -> None:
    client = build_client()
    seed_fixture_dataset(client)

    payload = GuidedInvestigationRequest(
        question="Investigate why Orders become delayed in this window.",
        anchor_object_type=_ORDER_URI,
        start_at="2026-02-22T07:00:00Z",
        end_at="2026-02-22T11:00:00Z",
        depth=2,
    ).model_dump(mode="json")

    response = client.post("/api/v1/ai/guided-investigation", json=payload)

    assert response.status_code == 200, response.text
    body = response.json()

    assert body["ontology"]["response_policy"] == "informational"
    assert body["process_ai"]["response_policy"] == "analytical"
    assert body["root_cause_ai"]["response_policy"] == "analytical"
    assert body["process_run"]["run_id"]
    assert body["root_cause_run"]["run_id"]
    assert body["root_cause_run"]["insights"]


def test_ai_assistant_chat_returns_generic_envelope_and_thread_id() -> None:
    client = build_client()

    response = client.post(
        "/api/v1/ai/assistant/chat",
        json={
            "completion_messages": [
                {"role": "user", "content": "Summarize what this module does."},
            ],
            "context": {
                "route": "/inspector/insights",
                "module": "insights",
                "anchor_object_type": _ORDER_URI,
            },
            "thread_id": "thread-seeded-1",
        },
    )

    assert response.status_code == 200, response.text
    assert response.headers["content-type"].startswith("text/event-stream")
    events = _parse_sse_events(response.text)
    event_types = [event for event, _ in events]
    assert event_types[0] == "meta"
    assert "assistant_delta" in event_types
    assert event_types[-2] == "final"
    assert event_types[-1] == "done"

    meta = events[0][1]
    assert meta["module"] == "assistant"
    assert meta["task"] == "chat"
    assert meta["response_policy"] == "informational"
    assert meta["thread_id"] == "thread-seeded-1"
    assert "ontology.query(read_only)" in meta["tool_permissions"]

    deltas = [
        payload["text"]
        for event, payload in events
        if event == "assistant_delta"
    ]
    final = events[-2][1]
    assert "".join(deltas) == final["answer"]
    assert final["evidence"]
    assert len(final["completion_messages"]) >= 2
    assert final["completion_messages"][-1]["role"] == "assistant"
    assert "error" not in event_types


def test_ontology_copilot_service_defaults_to_assistant_workflow_prompt() -> None:
    runtime = _CaptureMessagesRuntime()
    copilot = OntologyCopilotService(
        _SkillAwareOntologyService(),
        model_runtime=runtime,
        skill_registry=AssistantSkillRegistry([str(ASSISTANT_SKILLS_ROOT)]),
    )

    response = asyncio.run(
        copilot.answer(
            "How is the ontology organized?",
            conversation=[],
        )
    )

    assert response.answer == "Captured messages."
    assert runtime.last_messages is not None
    system_messages = [
        str(message["content"])
        for message in runtime.last_messages
        if message.get("role") == "system"
    ]
    assert any(
        "You are Seer's conversational assistant." in message
        for message in system_messages
    )
    assert not any(
        "You are Seer's managed-agent execution copilot." in message
        for message in system_messages
    )


def test_ontology_copilot_service_supports_managed_agent_workflow_prompt_mode() -> None:
    runtime = _CaptureMessagesRuntime()
    copilot = OntologyCopilotService(
        _SkillAwareOntologyService(),
        model_runtime=runtime,
        skill_registry=AssistantSkillRegistry([str(ASSISTANT_SKILLS_ROOT)]),
    )

    response = asyncio.run(
        copilot.answer(
            "Complete the managed task accurately.",
            conversation=[],
            runtime_mode="managed_agent",
        )
    )

    assert response.answer == "Captured messages."
    assert runtime.last_messages is not None
    system_messages = [
        str(message["content"])
        for message in runtime.last_messages
        if message.get("role") == "system"
    ]
    assert any(
        "You are Seer's managed-agent execution copilot." in message
        for message in system_messages
    )
    assert any(
        "Never use `load_action` to load the current managed agent's own action URI."
        in message
        for message in system_messages
    )
    assert any(
        "Use the object-store and object-history skills when you need to inspect"
        in message
        for message in system_messages
    )
    assert any(
        "Use `load_action` when the ontology exposes an ordinary executable action"
        in message
        for message in system_messages
    )
    assert any(
        "Do not ask the user clarifying questions during execution."
        in message
        for message in system_messages
    )
    assert not any(
        "You are Seer's conversational assistant." in message
        for message in system_messages
    )


def test_ontology_copilot_service_allows_workflow_prompt_override() -> None:
    runtime = _CaptureMessagesRuntime()
    copilot = OntologyCopilotService(
        _SkillAwareOntologyService(),
        model_runtime=runtime,
        skill_registry=AssistantSkillRegistry([str(ASSISTANT_SKILLS_ROOT)]),
    )

    response = asyncio.run(
        copilot.answer(
            "Use the runtime override.",
            conversation=[],
            runtime_mode="managed_agent",
            workflow_system_prompt_override="Managed-agent override prompt.",
        )
    )

    assert response.answer == "Captured messages."
    assert runtime.last_messages is not None
    system_messages = [
        str(message["content"])
        for message in runtime.last_messages
        if message.get("role") == "system"
    ]
    assert "Managed-agent override prompt." in system_messages
    assert not any(
        "You are Seer's conversational assistant." in message
        for message in system_messages
    )
    assert not any(
        "You are Seer's managed-agent execution copilot." in message
        for message in system_messages
    )


def test_managed_agent_mode_limits_visible_skill_catalog() -> None:
    runtime = _CaptureMessagesRuntime()
    copilot = OntologyCopilotService(
        _SkillAwareOntologyService(),
        model_runtime=runtime,
        skill_registry=AssistantSkillRegistry([str(ASSISTANT_SKILLS_ROOT)]),
    )

    response = asyncio.run(
        copilot.answer(
            "Inspect the managed-agent skill catalog.",
            conversation=[],
            runtime_mode="managed_agent",
        )
    )

    assert response.answer == "Captured messages."
    assert runtime.last_messages is not None
    skill_catalog_message = next(
        str(message["content"])
        for message in runtime.last_messages
        if message.get("role") == "system"
        and "Available managed-agent skills:" in str(message.get("content"))
    )
    assert "deep-ontology" in skill_catalog_message
    assert "object-store" in skill_catalog_message
    assert "object-history" in skill_catalog_message
    assert "process-mining" not in skill_catalog_message
    assert "root-cause" not in skill_catalog_message


def test_managed_agent_mode_rejects_disallowed_skill_loads() -> None:
    copilot = OntologyCopilotService(
        _SkillAwareOntologyService(),
        model_runtime=_LoadDisallowedSkillRuntime(),
        skill_registry=AssistantSkillRegistry([str(ASSISTANT_SKILLS_ROOT)]),
    )

    response = asyncio.run(
        copilot.answer(
            "Try to load process mining.",
            conversation=[],
            runtime_mode="managed_agent",
        )
    )

    assert response.answer == "The disallowed skill stayed blocked."
    assert response.tool_result is not None
    assert response.tool_result.tool == "load_skill"
    assert "not available in this runtime" in (response.tool_result.error or "")


def test_managed_agent_mode_load_action_registers_callable_tool_and_submits_child_action() -> None:
    repository = InMemoryActionsRepository()
    actions_service = ActionsService(repository=repository)
    parent_execution_id = uuid4()
    copilot = OntologyCopilotService(
        _ManagedAgentActionOntologyService(),
        model_runtime=_ManagedAgentLoadActionRuntime(),
        skill_registry=AssistantSkillRegistry([str(ASSISTANT_SKILLS_ROOT)]),
    )

    response = asyncio.run(
        copilot.answer(
            "Load and invoke the customer email action.",
            conversation=[],
            runtime_mode="managed_agent",
            action_runtime=actions_service,
            action_execution_context=CopilotActionExecutionContext(
                user_id="managed-agent-user",
                parent_execution_id=parent_execution_id,
            ),
        )
    )

    assert response.answer == "Loaded and submitted the child action."
    assert response.tool_result is not None
    assert response.tool_result.tool.startswith("invoke_action__")
    submitted = response.tool_result.result
    assert isinstance(submitted, dict)
    assert submitted["action_uri"] == _CHILD_ACTION_URI
    assert submitted["parent_execution_id"] == str(parent_execution_id)
    assert submitted["status"] == "queued"
    child_actions = asyncio.run(
        actions_service.list_child_actions(parent_execution_id=parent_execution_id)
    )
    assert len(child_actions) == 1
    assert child_actions[0].action_uri == _CHILD_ACTION_URI
    assert child_actions[0].input_payload == {"customer_id": "C-100"}
    tool_messages = [
        message
        for message in response.completion_messages_delta
        if message.get("role") == "tool"
    ]
    assert len(tool_messages) == 2
    load_action_result = json.loads(tool_messages[0]["content"])
    assert load_action_result["tool"] == "load_action"
    assert load_action_result["action_uri"] == _CHILD_ACTION_URI
    assert load_action_result["loaded_action_tool_name"].startswith("invoke_action__")


def test_managed_agent_mode_invalid_load_action_fails_gracefully() -> None:
    repository = InMemoryActionsRepository()
    actions_service = ActionsService(repository=repository)
    copilot = OntologyCopilotService(
        _ManagedAgentActionOntologyService(),
        model_runtime=_ManagedAgentInvalidLoadActionRuntime(),
        skill_registry=AssistantSkillRegistry([str(ASSISTANT_SKILLS_ROOT)]),
    )

    response = asyncio.run(
        copilot.answer(
            "Try to load an action with a bad identifier.",
            conversation=[],
            runtime_mode="managed_agent",
            action_runtime=actions_service,
            action_execution_context=CopilotActionExecutionContext(
                user_id="managed-agent-user",
                parent_execution_id=uuid4(),
            ),
        )
    )

    assert response.answer == "The invalid action identifier was rejected as a tool error."
    assert response.tool_result is not None
    assert response.tool_result.tool == "load_action"
    assert "full absolute IRI" in (response.tool_result.error or "")


def test_managed_agent_mode_rejects_loading_current_managed_agent_action() -> None:
    repository = InMemoryActionsRepository()
    actions_service = ActionsService(repository=repository)
    copilot = OntologyCopilotService(
        _ManagedAgentActionOntologyService(),
        model_runtime=_ManagedAgentSelfLoadActionRuntime(),
        skill_registry=AssistantSkillRegistry([str(ASSISTANT_SKILLS_ROOT)]),
    )

    response = asyncio.run(
        copilot.answer(
            "Do not recurse into the current managed agent.",
            conversation=[],
            runtime_mode="managed_agent",
            action_runtime=actions_service,
            action_execution_context=CopilotActionExecutionContext(
                user_id="managed-agent-user",
                parent_execution_id=uuid4(),
                current_action_uri="urn:seer:managed-agent:create_and_close_sales_order",
            ),
        )
    )

    assert response.answer == (
        "The self-recursive load_action attempt was rejected as a tool error."
    )
    assert response.tool_result is not None
    assert response.tool_result.tool == "load_action"
    assert "cannot load the currently executing managed agent" in (
        response.tool_result.error or ""
    )


def test_ai_workbench_chat_streams_investigation_answer_and_linked_surfaces() -> None:
    client = build_client()
    seed_fixture_dataset(client)

    response = client.post(
        "/api/v1/ai/workbench/chat",
        json={
            "question": "Investigate why Orders become delayed in this window.",
            "context": {
                "route": "/assistant",
                "module": "workbench",
                "anchor_object_type": _ORDER_URI,
                "start_at": "2026-02-22T07:00:00Z",
                "end_at": "2026-02-22T11:00:00Z",
            },
            "thread_id": "workbench-thread-1",
            "investigation_id": "investigation-seeded-1",
            "depth": 2,
        },
    )

    assert response.status_code == 200, response.text
    assert response.headers["content-type"].startswith("text/event-stream")
    events = _parse_sse_events(response.text)
    event_types = [event for event, _ in events]
    assert event_types[0] == "meta"
    assert "investigation_status" in event_types
    assert event_types.count("linked_surface_hint") >= 4
    assert "assistant_delta" in event_types
    assert event_types[-2] == "final"
    assert event_types[-1] == "done"

    meta = events[0][1]
    assert meta["module"] == "workbench"
    assert meta["task"] == "chat"
    assert meta["turn_kind"] == "investigation_answer"
    assert meta["thread_id"] == "workbench-thread-1"
    assert meta["investigation_id"] == "investigation-seeded-1"
    assert "process.mine" in meta["tool_permissions"]

    final = events[-2][1]
    assert final["module"] == "workbench"
    assert final["turn_kind"] == "investigation_answer"
    assert final["thread_id"] == "workbench-thread-1"
    assert final["investigation_id"] == "investigation-seeded-1"
    assert final["answer_markdown"]
    assert ":::evidence" in final["answer_markdown"]
    assert ":::caveat" in final["answer_markdown"]
    assert ":::next-action" in final["answer_markdown"]
    assert ":::follow-up" in final["answer_markdown"]
    assert ":::linked-surface" in final["answer_markdown"]
    assert "suggestions, not established facts" in final["answer_markdown"]
    assert final["why_it_matters"]
    assert final["linked_surfaces"]
    assert final["follow_up_questions"]
    assert final["anchor_object_type"] == _ORDER_URI

    linked_by_kind = {
        item["kind"]: item
        for item in final["linked_surfaces"]
    }
    assert linked_by_kind["ontology"]["href"] == (
        "/ontology/overview?conceptUri=urn%3Aseer%3Atest%3AOrder"
    )
    history_link = urlparse(linked_by_kind["history"]["href"])
    history_query = parse_qs(history_link.query)
    assert history_link.path == "/inspector/history/object"
    assert history_query["object_type"] == [_ORDER_URI]
    assert history_query["object_ref_canonical"]
    assert history_query["object_ref_hash"]
    assert linked_by_kind["process"]["href"] == (
        "/inspector/insights?"
        "tab=process-mining&pm_model=urn%3Aseer%3Atest%3Aorder"
        "&pm_from=2026-02-22T07%3A00%3A00Z&pm_to=2026-02-22T11%3A00%3A00Z&pm_run=1"
    )
    assert linked_by_kind["root_cause"]["href"] == (
        "/inspector/insights?"
        "tab=process-insights&rca_anchor=urn%3Aseer%3Atest%3Aorder"
        "&rca_from=2026-02-22T07%3A00%3A00Z&rca_to=2026-02-22T11%3A00%3A00Z"
        "&rca_outcome=urn%3Aseer%3Atest%3Aorder_delayed&rca_run=1"
    )
    assert linked_by_kind["action_status"]["href"] == (
        "/ontology/actions?conceptUri=urn%3Aseer%3Atest%3AOrder"
    )
    assert "live action status deep link yet" in linked_by_kind["action_status"]["reason"].lower()
    assert "label=\"Open ontology exploration\"" in final["answer_markdown"]


def test_ai_workbench_chat_returns_clarifying_turn_without_scope() -> None:
    client = build_client()

    response = client.post(
        "/api/v1/ai/workbench/chat",
        json={
            "question": "Investigate delayed fulfillment for me.",
            "context": {
                "route": "/assistant",
                "module": "workbench",
            },
            "thread_id": "workbench-thread-clarify",
        },
    )

    assert response.status_code == 200, response.text
    events = _parse_sse_events(response.text)
    event_types = [event for event, _ in events]
    assert event_types[0] == "meta"
    assert event_types[1] == "investigation_status"
    assert event_types[-2] == "final"
    assert event_types[-1] == "done"

    meta = events[0][1]
    assert meta["module"] == "workbench"
    assert meta["turn_kind"] == "clarifying_question"
    assert meta["thread_id"] == "workbench-thread-clarify"

    final = events[-2][1]
    assert final["turn_kind"] == "clarifying_question"
    assert len(final["clarifying_questions"]) == 2
    assert {item["field"] for item in final["clarifying_questions"]} == {
        "anchor_object_type",
        "time_window",
    }
    assert "lock the scope" in final["answer_markdown"].lower()
    assert ":::follow-up" in final["answer_markdown"]
    assert ":::caveat" in final["answer_markdown"]


def test_ai_assistant_chat_logs_turn_lifecycle(caplog) -> None:
    client = build_client()

    with caplog.at_level(logging.INFO, logger="seer_backend.ai.assistant_turn"):
        response = client.post(
            "/api/v1/ai/assistant/chat",
            json={
                "completion_messages": [
                    {"role": "user", "content": "Summarize what this module does."},
                ],
                "context": {
                    "route": "/assistant",
                    "module": "assistant",
                    "anchor_object_type": _ORDER_URI,
                },
                "thread_id": "thread-logs-1",
            },
        )

    assert response.status_code == 200, response.text
    records = [
        record
        for record in caplog.records
        if record.name == "seer_backend.ai.assistant_turn"
    ]
    messages = [record.message for record in records]
    assert "assistant_turn_started" in messages
    assert "assistant_turn_response_started" in messages
    assert "assistant_turn_completed" in messages

    started = next(record for record in records if record.message == "assistant_turn_started")
    completed = next(record for record in records if record.message == "assistant_turn_completed")

    assert started.thread_id == "thread-logs-1"
    assert started.route == "/assistant"
    assert started.module_context == "assistant"
    assert started.prompt_preview == "Summarize what this module does."
    assert isinstance(started.turn_id, str) and started.turn_id

    assert completed.thread_id == "thread-logs-1"
    assert completed.turn_id == started.turn_id
    assert completed.answer_chars > 0
    assert completed.completion_message_count >= 2


def test_ai_assistant_chat_logs_tool_status_events(caplog) -> None:
    client = build_client_with_copilot(StubOntologyCopilotWithPolicyBlock())

    with caplog.at_level(logging.INFO, logger="seer_backend.ai.assistant_turn"):
        response = client.post(
            "/api/v1/ai/assistant/chat",
            json={
                "completion_messages": [
                    {"role": "user", "content": "Please run an ontology mutation query."},
                ],
                "thread_id": "thread-tools-1",
            },
        )

    assert response.status_code == 200, response.text
    tool_records = [
        record
        for record in caplog.records
        if record.name == "seer_backend.ai.assistant_turn"
        and record.message == "assistant_turn_tool_status"
    ]
    assert [record.status for record in tool_records] == ["started", "failed"]
    assert all(record.thread_id == "thread-tools-1" for record in tool_records)
    assert tool_records[0].tool == "sparql_read_only_query"
    assert tool_records[0].call_id == "call_1"
    assert tool_records[1].error == _LONG_POLICY_BLOCK_ERROR
    assert tool_records[1].summary.endswith(_LONG_POLICY_BLOCK_ERROR)
    assert len(tool_records[1].summary) > 160


def test_ai_assistant_chat_load_skill_updates_permissions_and_logs_tool_status(
    caplog,
    tmp_path: Path,
) -> None:
    skill_root = tmp_path / "skills"
    skill_dir = skill_root / "process-mining"
    skill_dir.mkdir(parents=True)
    (skill_dir / "SKILL.md").write_text(
        "\n".join(
            [
                "---",
                "name: process-mining",
                (
                    "description: Mine object-centric process flows when the user "
                    "asks about process behavior."
                ),
                "allowed-tools: process.mine process.traces",
                "---",
                "",
                "# Process Mining",
                "",
                "Use this skill for OC-DFG analysis and process flow questions.",
            ]
        ),
        encoding="utf-8",
    )
    copilot = OntologyCopilotService(
        _SkillAwareOntologyService(),
        model_runtime=_LoadSkillThenAnswerRuntime(),
        skill_registry=AssistantSkillRegistry([str(skill_root)]),
    )
    client = build_client_with_copilot(copilot)

    with caplog.at_level(logging.INFO, logger="seer_backend.ai.assistant_turn"):
        response = client.post(
            "/api/v1/ai/assistant/chat",
            json={
                "completion_messages": [
                    {"role": "user", "content": "Can you analyze the order flow?"},
                ],
                "thread_id": "thread-skill-1",
            },
        )

    assert response.status_code == 200, response.text
    events = _parse_sse_events(response.text)
    tool_status_events = [payload for event, payload in events if event == "tool_status"]
    assert [payload["status"] for payload in tool_status_events] == ["started", "completed"]
    assert tool_status_events[0]["tool"] == "load_skill"

    final_event = next(payload for event, payload in events if event == "final")
    assert "process.mine" in final_event["tool_permissions"]
    assert "process.traces" in final_event["tool_permissions"]
    tool_messages = [
        message
        for message in final_event["completion_messages"]
        if message["role"] == "tool"
    ]
    assert tool_messages
    loaded_skill = json.loads(tool_messages[0]["content"])
    assert loaded_skill["tool"] == "load_skill"
    assert loaded_skill["skill_name"] == "process-mining"
    assert loaded_skill["allowed_tools"] == ["process.mine", "process.traces"]
    assert "Process Mining" in loaded_skill["instructions_markdown"]

    tool_records = [
        record
        for record in caplog.records
        if record.name == "seer_backend.ai.assistant_turn"
        and record.message == "assistant_turn_tool_status"
    ]
    assert [record.status for record in tool_records] == ["started", "completed"]
    assert all(record.thread_id == "thread-skill-1" for record in tool_records)
    assert tool_records[0].tool == "load_skill"


def test_ai_assistant_chat_process_skill_unlocks_ocdfg_tool_and_persists_result() -> None:
    client = build_skill_runtime_client(
        _LoadSkillThenUseToolRuntime(
            skill_name="process-mining",
            function_name="process_mine",
            tool_arguments={
                "anchor_object_type": _ORDER_URI,
                "start_at": "2026-02-22T07:00:00Z",
                "end_at": "2026-02-22T11:00:00Z",
            },
            final_answer="I loaded process mining and ran OC-DFG discovery for orders.",
        )
    )
    seed_fixture_dataset(client)

    response = client.post(
        "/api/v1/ai/assistant/chat",
        json={
            "completion_messages": [
                {"role": "user", "content": "Show me the order flow as an OC-DFG."},
            ],
            "thread_id": "thread-process-skill-1",
        },
    )

    assert response.status_code == 200, response.text
    events = _parse_sse_events(response.text)
    tool_status_events = [payload for event, payload in events if event == "tool_status"]
    assert [payload["tool"] for payload in tool_status_events] == [
        "load_skill",
        "load_skill",
        "process_mine",
        "process_mine",
    ]

    final_event = next(payload for event, payload in events if event == "final")
    assert "process.mine" in final_event["tool_permissions"]
    tool_messages = [
        json.loads(message["content"])
        for message in final_event["completion_messages"]
        if message["role"] == "tool"
    ]
    assert tool_messages[0]["tool"] == "load_skill"
    assert tool_messages[1]["tool"] == "process_mine"
    assert tool_messages[1]["tool_permission"] == "process.mine"
    assert tool_messages[1]["result"]["analysis_kind"] == "ocdfg"
    assert tool_messages[1]["result"]["run"]["edges"]


def test_ai_assistant_chat_root_cause_skill_unlocks_run_tool_and_persists_result() -> None:
    client = build_skill_runtime_client(
        _LoadSkillThenUseToolRuntime(
            skill_name="root-cause",
            function_name="root_cause_run",
            tool_arguments={
                "anchor_object_type": _ORDER_URI,
                "start_at": "2026-02-22T07:00:00Z",
                "end_at": "2026-02-22T11:00:00Z",
                "outcome": {"event_type": _to_uri_identifier("order.delayed")},
            },
            final_answer="I loaded root cause analysis and ranked the delay drivers.",
        )
    )
    seed_fixture_dataset(client)

    response = client.post(
        "/api/v1/ai/assistant/chat",
        json={
            "completion_messages": [
                {"role": "user", "content": "Why are orders delayed in this window?"},
            ],
            "thread_id": "thread-root-cause-skill-1",
        },
    )

    assert response.status_code == 200, response.text
    events = _parse_sse_events(response.text)
    tool_status_events = [payload for event, payload in events if event == "tool_status"]
    assert [payload["tool"] for payload in tool_status_events] == [
        "load_skill",
        "load_skill",
        "root_cause_run",
        "root_cause_run",
    ]

    final_event = next(payload for event, payload in events if event == "final")
    assert "root_cause.run" in final_event["tool_permissions"]
    tool_messages = [
        json.loads(message["content"])
        for message in final_event["completion_messages"]
        if message["role"] == "tool"
    ]
    assert tool_messages[1]["tool"] == "root_cause_run"
    assert tool_messages[1]["tool_permission"] == "root_cause.run"
    assert tool_messages[1]["result"]["run"]["insights"]


def test_ai_assistant_chat_root_cause_validation_error_includes_path_and_input() -> None:
    client = build_skill_runtime_client(
        _LoadSkillThenUseToolRuntime(
            skill_name="root-cause",
            function_name="root_cause_run",
            tool_arguments={
                "anchor_object_type": _ORDER_URI,
                "start_at": "2026-02-22T07:00:00Z",
                "end_at": "2026-02-22T11:00:00Z",
                "outcome": {},
            },
            final_answer=(
                "The RCA tool call failed, so I need to clarify the missing "
                "outcome field."
            ),
        )
    )
    seed_fixture_dataset(client)

    response = client.post(
        "/api/v1/ai/assistant/chat",
        json={
            "completion_messages": [
                {"role": "user", "content": "Run root cause analysis on overdue invoices."},
            ],
            "thread_id": "thread-root-cause-skill-validation-1",
        },
    )

    assert response.status_code == 200, response.text
    final_event = next(
        payload for event, payload in _parse_sse_events(response.text) if event == "final"
    )
    tool_messages = [
        json.loads(message["content"])
        for message in final_event["completion_messages"]
        if message["role"] == "tool"
    ]
    root_cause_result = next(
        item for item in tool_messages if item["tool"] == "root_cause_run"
    )
    assert (
        root_cause_result["error"]
        == "tool validation failed at outcome.event_type: Field required. "
        'Received arguments: {"anchor_object_type": "urn:seer:test:order", '
        '"end_at": "2026-02-22T11:00:00Z", "outcome": {}, '
        '"start_at": "2026-02-22T07:00:00Z"}. '
        "Expected top-level fields: anchor_object_type, start_at, end_at, outcome. "
        'Outcome shape: {"event_type":"<event-type-uri>",'
        '"kind":"event_type","object_type":"<optional-object-type-uri>"}.'
    )


def test_assistant_domain_tool_schemas_are_fully_specified() -> None:
    adapter = AssistantDomainToolAdapter(
        process_service=UnavailableProcessMiningService("unavailable"),
        root_cause_service=UnavailableRootCauseService("unavailable"),
        history_service=UnavailableHistoryService("unavailable"),
    )

    schemas = {
        schema["function"]["name"]: schema["function"]
        for schema in adapter.tool_schemas(
            {
                "root_cause.run",
                "root_cause.assist.interpret",
                "history.object_events",
                "history.relations",
                "history.latest_objects",
            }
        )
    }

    root_cause_run = schemas["root_cause_run"]["parameters"]
    assert root_cause_run["properties"]["outcome"]["properties"]["event_type"]["type"] == "string"
    assert root_cause_run["properties"]["filters"]["items"]["properties"]["op"]["enum"] == [
        "eq",
        "ne",
        "contains",
        "gt",
        "gte",
        "lt",
        "lte",
    ]

    interpret = schemas["root_cause_assist_interpret"]["parameters"]
    insight_items = interpret["properties"]["insights"]["items"]
    assert insight_items["properties"]["score"]["properties"]["lift"]["type"] == "number"
    assert (
        insight_items["properties"]["evidence"]["properties"]["sample_anchor_keys"]["items"][
            "type"
        ]
        == "string"
    )
    assert insight_items["additionalProperties"] is False

    object_events = schemas["history_object_events"]["parameters"]
    assert object_events["required"] == ["object_type"]
    assert "anyOf" not in object_events
    assert schemas["history_object_events"]["description"].endswith(
        "`object_ref_canonical`."
    )

    relations = schemas["history_relations"]["parameters"]
    assert "anyOf" not in relations
    assert "either `event_id` or both `object_type` and `object_ref_hash`" in schemas[
        "history_relations"
    ]["description"]

    latest_objects = schemas["history_latest_objects"]["parameters"]
    assert latest_objects["properties"]["property_filters"]["items"] == {
        "type": "object",
        "properties": {
            "key": {"type": "string"},
            "op": {
                "type": "string",
                "enum": ["eq", "contains", "gt", "gte", "lt", "lte"],
            },
            "value": {"type": "string"},
        },
        "required": ["key", "op", "value"],
        "additionalProperties": False,
    }


def test_all_copilot_tool_schemas_are_openai_compatible() -> None:
    adapter = AssistantDomainToolAdapter(
        process_service=UnavailableProcessMiningService("unavailable"),
        root_cause_service=UnavailableRootCauseService("unavailable"),
        history_service=UnavailableHistoryService("unavailable"),
    )
    skill_registry = AssistantSkillRegistry([str(ASSISTANT_SKILLS_ROOT)])
    available_skills = skill_registry.discover()

    assistant_schemas = ontology_copilot._tool_schemas(
        conversation_messages=[
            {
                "role": "tool",
                "content": json.dumps(
                    {
                        "tool": "load_skill",
                        "skill_name": "object-history",
                        "allowed_tools": [
                            "history.object_events",
                            "history.relations",
                            "history.object_timeline",
                            "history.latest_objects",
                        ],
                    }
                ),
            }
        ],
        assistant_tool_adapter=adapter,
        action_runtime=None,
        available_skills=available_skills,
        runtime_mode="assistant",
    )

    managed_agent_schemas = ontology_copilot._tool_schemas(
        conversation_messages=[
            {
                "role": "tool",
                "content": json.dumps(
                    {
                        "tool": "load_action",
                        "action_uri": _CHILD_ACTION_URI,
                        "action_label": "Email Customer",
                        "loaded_action_tool_name": "invoke_action__email_customer__1234567890",
                        "loaded_action_parameters_schema": {
                            "type": "object",
                            "properties": {"customer_id": {"type": "string"}},
                            "required": ["customer_id"],
                            "anyOf": [{"required": ["customer_id"]}],
                            "additionalProperties": False,
                        },
                    }
                ),
            }
        ],
        assistant_tool_adapter=adapter,
        action_runtime=ActionsService(repository=InMemoryActionsRepository()),
        available_skills=available_skills,
        runtime_mode="managed_agent",
    )

    for schema in assistant_schemas + managed_agent_schemas:
        _assert_openai_function_tool_schema(schema)


def test_ai_assistant_chat_object_store_skill_unlocks_search_tool_and_persists_result() -> None:
    client = build_skill_runtime_client(
        _LoadSkillThenUseToolRuntime(
            skill_name="object-store",
            function_name="history_latest_objects",
            tool_arguments={
                "object_type": _ORDER_URI,
                "size": 5,
            },
            final_answer="I loaded the object store skill and searched the latest order snapshots.",
        )
    )
    seed_fixture_dataset(client)

    response = client.post(
        "/api/v1/ai/assistant/chat",
        json={
            "completion_messages": [
                {"role": "user", "content": "Find the latest order records for me."},
            ],
            "thread_id": "thread-object-store-skill-1",
        },
    )

    assert response.status_code == 200, response.text
    final_event = next(
        payload for event, payload in _parse_sse_events(response.text) if event == "final"
    )
    assert "history.latest_objects" in final_event["tool_permissions"]
    tool_messages = [
        json.loads(message["content"])
        for message in final_event["completion_messages"]
        if message["role"] == "tool"
    ]
    assert tool_messages[1]["tool"] == "history_latest_objects"
    assert tool_messages[1]["tool_permission"] == "history.latest_objects"
    assert tool_messages[1]["result"]["latest_objects"]["items"]


def test_ai_assistant_chat_object_history_skill_unlocks_timeline_tool_and_persists_result() -> None:
    client = build_skill_runtime_client(
        _LoadSkillThenUseToolRuntime(
            skill_name="object-history",
            function_name="history_object_timeline",
            tool_arguments={
                "object_type": _ORDER_URI,
                "object_ref_hash": _object_ref_hash({"tenant": "acme", "order_id": "O-100"}),
                "limit": 10,
            },
            final_answer="I loaded object history and inspected the order timeline.",
        )
    )
    seed_fixture_dataset(client)

    response = client.post(
        "/api/v1/ai/assistant/chat",
        json={
            "completion_messages": [
                {
                    "role": "user",
                    "content": "Show me the history of order O-100.",
                },
            ],
            "thread_id": "thread-object-history-skill-1",
        },
    )

    assert response.status_code == 200, response.text
    final_event = next(
        payload for event, payload in _parse_sse_events(response.text) if event == "final"
    )
    assert "history.object_timeline" in final_event["tool_permissions"]
    tool_messages = [
        json.loads(message["content"])
        for message in final_event["completion_messages"]
        if message["role"] == "tool"
    ]
    assert tool_messages[1]["tool"] == "history_object_timeline"
    assert tool_messages[1]["tool_permission"] == "history.object_timeline"
    assert len(tool_messages[1]["result"]["timeline"]["items"]) >= 2


def test_ai_assistant_chat_reuses_skill_permissions_from_persisted_completion_messages() -> None:
    first_client = build_skill_runtime_client(
        _LoadSkillThenUseToolRuntime(
            skill_name="process-mining",
            function_name="process_mine",
            tool_arguments={
                "anchor_object_type": _ORDER_URI,
                "start_at": "2026-02-22T07:00:00Z",
                "end_at": "2026-02-22T11:00:00Z",
            },
            final_answer="I loaded process mining and ran OC-DFG discovery for orders.",
        )
    )
    seed_fixture_dataset(first_client)
    first_response = first_client.post(
        "/api/v1/ai/assistant/chat",
        json={
            "completion_messages": [
                {"role": "user", "content": "Show me the order flow as an OC-DFG."},
            ],
            "thread_id": "thread-process-skill-2",
        },
    )
    assert first_response.status_code == 200, first_response.text
    first_events = _parse_sse_events(first_response.text)
    first_final = next(payload for event, payload in first_events if event == "final")

    second_client = build_skill_runtime_client(_UsePersistedProcessTraceRuntime())
    seed_fixture_dataset(second_client)
    second_response = second_client.post(
        "/api/v1/ai/assistant/chat",
        json={
            "completion_messages": [
                *first_final["completion_messages"],
                {"role": "user", "content": "Show me example traces behind that graph."},
            ],
            "thread_id": "thread-process-skill-2",
        },
    )

    assert second_response.status_code == 200, second_response.text
    second_events = _parse_sse_events(second_response.text)
    tool_status_events = [payload for event, payload in second_events if event == "tool_status"]
    assert [payload["tool"] for payload in tool_status_events] == [
        "process_trace_drilldown",
        "process_trace_drilldown",
    ]
    second_final = next(payload for event, payload in second_events if event == "final")
    assert "process.mine" in second_final["tool_permissions"]
    assert "process.traces" in second_final["tool_permissions"]
    tool_messages = [
        json.loads(message["content"])
        for message in second_final["completion_messages"]
        if message["role"] == "tool"
    ]
    assert tool_messages[-1]["tool_permission"] == "process.traces"
    assert tool_messages[-1]["result"]["drilldown"]["traces"]


def test_ai_assistant_chat_persists_artifact_and_canvas_tool_results() -> None:
    client = build_skill_runtime_client(_LoadSkillMineAndPresentCanvasRuntime())
    seed_fixture_dataset(client)

    response = client.post(
        "/api/v1/ai/assistant/chat",
        json={
            "completion_messages": [
                {"role": "user", "content": "Show me the order flow and open it beside the chat."},
            ],
            "thread_id": "thread-canvas-1",
        },
    )

    assert response.status_code == 200, response.text
    events = _parse_sse_events(response.text)
    tool_status_events = [payload for event, payload in events if event == "tool_status"]
    assert [payload["tool"] for payload in tool_status_events] == [
        "load_skill",
        "load_skill",
        "process_mine",
        "process_mine",
        "present_canvas_artifact",
        "present_canvas_artifact",
    ]

    final_event = next(payload for event, payload in events if event == "final")
    assert "assistant.canvas.present" in final_event["tool_permissions"]
    assert "assistant.canvas.update" in final_event["tool_permissions"]
    assert "assistant.canvas.close" in final_event["tool_permissions"]

    tool_messages = [
        json.loads(message["content"])
        for message in final_event["completion_messages"]
        if message["role"] == "tool"
    ]
    process_result = next(item for item in tool_messages if item["tool"] == "process_mine")
    assert process_result["artifact"]["artifact_type"] == "ocdfg"
    assert process_result["artifact"]["artifact_id"]

    canvas_result = next(
        item for item in tool_messages if item["tool"] == "present_canvas_artifact"
    )
    assert canvas_result["tool_permission"] == "assistant.canvas.present"
    assert canvas_result["canvas_action"]["action"] == "present"
    assert canvas_result["canvas_action"]["target"] == "split-right"
    assert (
        canvas_result["canvas_action"]["artifact_id"]
        == process_result["artifact"]["artifact_id"]
    )


def test_ai_assistant_chat_persists_ontology_artifact_and_canvas_tool_results() -> None:
    client = build_skill_runtime_client(_CreateOntologyArtifactAndPresentCanvasRuntime())
    seed_fixture_dataset(client)

    response = client.post(
        "/api/v1/ai/assistant/chat",
        json={
            "completion_messages": [
                {
                    "role": "user",
                    "content": "Open the order ontology beside the chat so I can inspect it.",
                },
            ],
            "thread_id": "thread-ontology-canvas-1",
        },
    )

    assert response.status_code == 200, response.text
    events = _parse_sse_events(response.text)
    tool_status_events = [payload for event, payload in events if event == "tool_status"]
    assert [payload["tool"] for payload in tool_status_events] == [
        "create_ontology_graph_artifact",
        "create_ontology_graph_artifact",
        "present_canvas_artifact",
        "present_canvas_artifact",
    ]

    final_event = next(payload for event, payload in events if event == "final")
    assert "assistant.canvas.present" in final_event["tool_permissions"]

    tool_messages = [
        json.loads(message["content"])
        for message in final_event["completion_messages"]
        if message["role"] == "tool"
    ]
    ontology_result = next(
        item for item in tool_messages if item["tool"] == "create_ontology_graph_artifact"
    )
    assert ontology_result["artifact"]["artifact_type"] == "ontology-graph"
    assert ontology_result["artifact"]["title"] == "Order ontology"
    assert ontology_result["artifact"]["data"]["focus_concept_uri"] == _ORDER_URI
    assert ontology_result["artifact"]["data"]["initial_tab"] == "objects"
    assert ontology_result["artifact"]["data"]["visible_concept_uris"] == [
        _ORDER_URI,
        "urn:seer:test:state_pending",
        "urn:seer:test:state_approved",
    ]

    canvas_result = next(
        item for item in tool_messages if item["tool"] == "present_canvas_artifact"
    )
    assert canvas_result["tool_permission"] == "assistant.canvas.present"
    assert canvas_result["canvas_action"]["action"] == "present"
    assert canvas_result["canvas_action"]["target"] == "split-right"
    assert (
        canvas_result["canvas_action"]["artifact_id"]
        == ontology_result["artifact"]["artifact_id"]
    )


def test_ai_assistant_chat_logs_failure(caplog) -> None:
    client = build_client_with_copilot(StubOntologyCopilotNotReady())

    with caplog.at_level(logging.INFO, logger="seer_backend.ai.assistant_turn"):
        response = client.post(
            "/api/v1/ai/assistant/chat",
            json={
                "completion_messages": [
                    {"role": "user", "content": "What is the latest ontology release?"},
                ],
                "thread_id": "thread-failure-1",
            },
        )

    assert response.status_code == 200, response.text
    failed = next(
        record
        for record in caplog.records
        if record.name == "seer_backend.ai.assistant_turn"
        and record.message == "assistant_turn_failed"
    )
    assert failed.thread_id == "thread-failure-1"
    assert failed.error_type == "OntologyNotReadyError"
    assert failed.error_message == _LONG_NOT_READY_ERROR


def test_ai_assistant_chat_rejects_legacy_messages_only_payload() -> None:
    client = build_client()

    response = client.post(
        "/api/v1/ai/assistant/chat",
        json={
            "messages": [
                {"role": "user", "content": "Summarize what this module does."},
            ]
        },
    )

    assert response.status_code == 422, response.text
    detail = response.json()["detail"]
    loc_entries = [
        entry.get("loc", ())
        for entry in detail
        if isinstance(entry, dict)
    ]
    assert any("completion_messages" in loc for loc in loc_entries)


def test_ai_assistant_chat_accepts_completions_format_messages() -> None:
    client = build_client()

    response = client.post(
        "/api/v1/ai/assistant/chat",
        json={
            "completion_messages": [
                {"role": "user", "content": "First question"},
                {"role": "assistant", "content": "First answer"},
                {"role": "tool", "tool_call_id": "call_1", "content": "{\"row_count\":1}"},
                {"role": "user", "content": "Second question"},
            ],
            "thread_id": "thread-completion-1",
        },
    )

    assert response.status_code == 200, response.text
    assert response.headers["content-type"].startswith("text/event-stream")
    events = _parse_sse_events(response.text)
    assert [event for event, _ in events][:2] == ["meta", "assistant_delta"]

    final_event = next(payload for event, payload in events if event == "final")
    assert final_event["thread_id"] == "thread-completion-1"
    assert final_event["answer"].startswith("Ontology context")
    assert len(final_event["completion_messages"]) >= 5
    assert final_event["completion_messages"][0]["role"] == "user"
    assert final_event["completion_messages"][-1]["role"] == "assistant"
    assert events[-1][0] == "done"


def test_ai_assistant_chat_sanitizes_tool_call_ids_but_keeps_tool_history() -> None:
    class CapturingCopilot:
        def __init__(self) -> None:
            self.captured_completion_conversation: list[dict[str, object]] | None = None

        async def answer(
            self,
            question: str,
            conversation: list[CopilotConversationMessage] | None = None,
            completion_conversation: list[dict[str, object]] | None = None,
            assistant_tool_adapter: object | None = None,
        ) -> CopilotChatResponse:
            del question, conversation, assistant_tool_adapter
            self.captured_completion_conversation = completion_conversation
            return CopilotChatResponse(
                mode="direct_answer",
                answer="Sanitized tool call id context.",
                evidence=[],
                current_release_id="phase5-test-release",
                tool_call=None,
                tool_result=None,
                completion_messages_delta=[
                    {"role": "assistant", "content": "Sanitized tool call id context."}
                ],
            )

        async def answer_stream(
            self,
            question: str,
            conversation: list[CopilotConversationMessage] | None = None,
            completion_conversation: list[dict[str, object]] | None = None,
            assistant_tool_adapter: object | None = None,
        ) -> AsyncIterator[CopilotAnswerStreamEvent]:
            response = await self.answer(
                question,
                conversation=conversation,
                completion_conversation=completion_conversation,
                assistant_tool_adapter=assistant_tool_adapter,
            )
            yield CopilotAssistantDeltaEvent(text=response.answer)
            yield CopilotAnswerFinalEvent(response=response)

    copilot = CapturingCopilot()
    client = build_client_with_copilot(copilot)

    long_id = "call_preserve_me__sig__" + ("x" * 512)
    response = client.post(
        "/api/v1/ai/assistant/chat",
        json={
            "completion_messages": [
                {"role": "user", "content": "First question"},
                {
                    "role": "assistant",
                    "content": "Tool run",
                    "tool_calls": [
                        {
                            "id": long_id,
                            "type": "function",
                            "function": {
                                "name": "sparql_read_only_query",
                                "arguments": "{\"query\":\"ASK WHERE { ?s ?p ?o }\"}",
                            },
                        }
                    ],
                },
                {"role": "tool", "tool_call_id": long_id, "content": "{\"row_count\":1}"},
                {"role": "user", "content": "Follow-up question"},
            ],
            "thread_id": "thread-sanitize-ids-1",
        },
    )

    assert response.status_code == 200, response.text
    events = _parse_sse_events(response.text)
    final_event = next(payload for event, payload in events if event == "final")

    captured = copilot.captured_completion_conversation
    assert captured is not None
    assert [item["role"] for item in captured] == ["user", "assistant", "tool"]
    assistant_tool_calls = captured[1].get("tool_calls")
    assert isinstance(assistant_tool_calls, list)
    assert assistant_tool_calls
    normalized_id = assistant_tool_calls[0]["id"]
    assert isinstance(normalized_id, str)
    assert normalized_id.startswith("call_")
    assert "__sig__" not in normalized_id
    assert len(normalized_id) <= 120
    assert captured[2]["tool_call_id"] == normalized_id

    completion_messages = final_event["completion_messages"]
    assert completion_messages[1]["tool_calls"][0]["id"] == normalized_id
    assert completion_messages[2]["tool_call_id"] == normalized_id


def test_ai_assistant_chat_includes_current_datetime_on_initial_turn(
    monkeypatch,
) -> None:
    fixed_now = datetime(2026, 3, 8, 9, 30, tzinfo=UTC)
    monkeypatch.setattr(ai_gateway, "_utc_now", lambda: fixed_now)

    class CapturingCopilot:
        def __init__(self) -> None:
            self.captured_question: str | None = None

        async def answer(
            self,
            question: str,
            conversation: list[CopilotConversationMessage] | None = None,
            completion_conversation: list[dict[str, object]] | None = None,
            assistant_tool_adapter: object | None = None,
        ) -> CopilotChatResponse:
            del conversation, completion_conversation, assistant_tool_adapter
            self.captured_question = question
            return CopilotChatResponse(
                mode="direct_answer",
                answer="Initial-turn datetime captured.",
                evidence=[],
                current_release_id="phase5-test-release",
                tool_call=None,
                tool_result=None,
                completion_messages_delta=[
                    {"role": "assistant", "content": "Initial-turn datetime captured."}
                ],
            )

        async def answer_stream(
            self,
            question: str,
            conversation: list[CopilotConversationMessage] | None = None,
            completion_conversation: list[dict[str, object]] | None = None,
            assistant_tool_adapter: object | None = None,
        ) -> AsyncIterator[CopilotAnswerStreamEvent]:
            response = await self.answer(
                question,
                conversation=conversation,
                completion_conversation=completion_conversation,
                assistant_tool_adapter=assistant_tool_adapter,
            )
            yield CopilotAssistantDeltaEvent(text=response.answer)
            yield CopilotAnswerFinalEvent(response=response)

    copilot = CapturingCopilot()
    client = build_client_with_copilot(copilot)

    response = client.post(
        "/api/v1/ai/assistant/chat",
        json={
            "completion_messages": [
                {"role": "user", "content": "Help me understand this ontology."},
            ],
            "thread_id": "thread-initial-datetime-1",
        },
    )

    assert response.status_code == 200, response.text
    assert copilot.captured_question == (
        "Context for this request:\n"
        "- conversation_start_time_utc=2026-03-08T09:30:00Z\n\n"
        "User request:\n"
        "Help me understand this ontology."
    )


def test_ai_assistant_chat_rejects_completion_messages_without_user_turn() -> None:
    client = build_client()

    response = client.post(
        "/api/v1/ai/assistant/chat",
        json={
            "completion_messages": [
                {"role": "assistant", "content": "No user turn is present."},
            ],
        },
    )

    assert response.status_code == 422, response.text
    detail = response.json()["detail"]
    messages = [entry.get("msg", "") for entry in detail if isinstance(entry, dict)]
    assert any(
        "completion_messages must include at least one user message" in message
        for message in messages
    )


def test_ai_assistant_chat_surfaces_read_only_policy_block_caveat() -> None:
    client = build_client_with_copilot(StubOntologyCopilotWithPolicyBlock())

    response = client.post(
        "/api/v1/ai/assistant/chat",
        json={
            "completion_messages": [
                {"role": "user", "content": "Please run an ontology mutation query."},
            ],
        },
    )

    assert response.status_code == 200, response.text
    events = _parse_sse_events(response.text)
    tool_status_events = [payload for event, payload in events if event == "tool_status"]
    assert [payload["status"] for payload in tool_status_events] == ["started", "failed"]
    assert tool_status_events[0]["call_id"] == "call_1"
    assert "running read-only sparql query" in str(tool_status_events[0]["summary"]).lower()
    assert "failed" in str(tool_status_events[1]["summary"]).lower()

    final_event = next(payload for event, payload in events if event == "final")
    assert final_event["module"] == "assistant"
    assert any(
        "read-only sparql policy blocked" in caveat.lower()
        for caveat in final_event["caveats"]
    )
    assert any(
        evidence["label"] == "Read-only SPARQL policy block"
        for evidence in final_event["evidence"]
    )


def test_ai_assistant_chat_streams_error_event_without_done_on_failure() -> None:
    client = build_client_with_copilot(StubOntologyCopilotNotReady())

    response = client.post(
        "/api/v1/ai/assistant/chat",
        json={
            "completion_messages": [
                {"role": "user", "content": "What is the latest ontology release?"},
            ]
        },
    )

    assert response.status_code == 200, response.text
    assert response.headers["content-type"].startswith("text/event-stream")
    events = _parse_sse_events(response.text)
    assert len(events) == 1
    assert events[0][0] == "error"
    assert not any(event_name == "done" for event_name, _ in events)
    assert events[0][1]["status_code"] == 409
    assert events[0][1]["code"] == "ontology_not_ready"
    assert "initializing" in str(events[0][1]["message"]).lower()
