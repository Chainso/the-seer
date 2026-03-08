"""Read-only ontology copilot service and OpenAI runtime adapter."""

from __future__ import annotations

import asyncio
import hashlib
import json
import re
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Any, Literal, Protocol

from openai import APIConnectionError, APIError, APITimeoutError, AsyncOpenAI

from seer_backend.ai.assistant_tools import AssistantDomainToolAdapter
from seer_backend.ai.skills import (
    AssistantSkill,
    AssistantSkillError,
    AssistantSkillNotFoundError,
    AssistantSkillRegistry,
)
from seer_backend.ontology.errors import (
    OntologyDependencyUnavailableError,
    OntologyError,
    OntologyNotReadyError,
    OntologyReadOnlyViolationError,
)
from seer_backend.ontology.models import (
    CopilotArtifact,
    CopilotCanvasAction,
    CopilotChatResponse,
    CopilotConversationMessage,
    CopilotStructuredOutput,
    CopilotToolCall,
    CopilotToolResult,
    OntologySparqlQueryResponse,
)
from seer_backend.ontology.service import OntologyService, UnavailableOntologyService

_TOOL_CALL_MAX_ROUNDS = 6
_TOOL_CALL_MAX_TOTAL = 8
_ONTOLOGY_INDEX_CACHE_KEY_EMPTY_RELEASE = "__none__"
_OPENAI_TRANSIENT_MAX_RETRIES = 1
_OPENAI_RETRY_BACKOFF_SECONDS = 0.2
_TOOL_CALL_ID_MAX_LENGTH = 120

_PROPHET_PREFIX = "prophet"
_STD_PREFIX = "std"
_PROPHET_NAMESPACE = "http://prophet.platform/ontology#"
_STD_NAMESPACE = "http://prophet.platform/standard-types#"
_RDF_NAMESPACE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#"
_RDFS_NAMESPACE = "http://www.w3.org/2000/01/rdf-schema#"
_OWL_NAMESPACE = "http://www.w3.org/2002/07/owl#"
_XSD_NAMESPACE = "http://www.w3.org/2001/XMLSchema#"
_LOCAL_ONTOLOGY_NAMESPACE_PREFIX = "http://prophet.platform/local/"
_BASE_CONCEPT_IRI_PREFIXES = (
    _PROPHET_NAMESPACE,
    _STD_NAMESPACE,
    "http://www.w3.org/",
)
_SPARQL_STANDARD_PREFIXES = {
    _PROPHET_PREFIX: _PROPHET_NAMESPACE,
    _STD_PREFIX: _STD_NAMESPACE,
    "rdf": _RDF_NAMESPACE,
    "rdfs": _RDFS_NAMESPACE,
    "owl": _OWL_NAMESPACE,
    "xsd": _XSD_NAMESPACE,
}

_BASE_ONTOLOGY_SYSTEM_PROMPT_TEMPLATE = """
Authoritative Prophet base ontology (verbatim Turtle).
Treat this as immutable metamodel context.

{base_ontology_turtle}
""".strip()

_COPILOT_WORKFLOW_SYSTEM_PROMPT = """
You are Seer's conversational assistant.

Your job:
- Start with ontology-grounded help using the provided context and tool evidence.
- Stay conversational and concise.
- Use `load_skill` when the user asks for a deeper capability that is listed in the
  available skill catalog.
- Keep the same conversation thread even after skills are loaded.

Workflow for each turn:
1. Read the user question and prior conversation.
2. Use the ontology index, ontology context, and any previously loaded skill
   instructions first.
3. Decide whether a tool query or skill activation is needed:
- Answer directly when context is already sufficient.
- Use `load_skill` when a listed skill clearly matches the user's request and would
  expand your available instructions or tools.
- Use the SPARQL tool when the user asks for exact relationships,
  counts, validation, or when context is ambiguous.
- When a domain tool returns a useful artifact, use the canvas tools to present it
  only if seeing it beside the conversation would materially help the user.
4. If using a tool, produce one high-quality call first and keep it bounded.
5. Return a concise answer that cites what you checked and any limits/uncertainty.

Tool planning and budget:
- Prefer batching independent checks in one round instead of serial loops.
- When tool evidence is needed, prefer 1 round of parallel tool invocation
  for all independent checks.
- Keep tool usage small: usually 1 round, at most 2 unless explicitly asked
  for exhaustive validation.
- If evidence is still incomplete after limited queries, stop and explain what is missing.
- Load only the smallest relevant skill set; do not load every skill speculatively.

SPARQL query rules:
- Allowed query forms: SELECT or ASK only.
- Never use mutating operations (INSERT, DELETE, LOAD, CLEAR, CREATE, DROP, COPY, MOVE, ADD).
- Never use dataset-scoping clauses (FROM, GRAPH, SERVICE, WITH, USING).
- Prefer explicit variables over SELECT *.
- Prefer ASK for yes/no validation questions.
- For SELECT queries, include ORDER BY when it improves determinism.
- Include LIMIT unless the user explicitly needs full coverage or the query is an aggregate.
- Use explicit prefixes whenever possible:
  PREFIX prophet: <http://prophet.platform/ontology#>
  PREFIX std: <http://prophet.platform/standard-types#>
  PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
  PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
  PREFIX owl: <http://www.w3.org/2002/07/owl#>
  PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>

Answer style:
- Be concise and concrete.
- Distinguish between facts from ontology/tool evidence vs inference.
- If evidence is insufficient, say exactly what is missing.
- Do not include raw URIs/IRIs in user-facing answers unless the user explicitly asks for them.
- Prefer human-readable concept names and qnames over full URIs.
- Return markdown only (no JSON wrappers).
- Use short sections only when they improve readability.

Good SPARQL examples (from Prophet Turtle demos):

Example A: support-local object properties
PREFIX prophet: <http://prophet.platform/ontology#>
PREFIX support_local: <http://prophet.platform/local/support_local#>
SELECT ?fieldKey ?valueType
WHERE {
  support_local:obj_ticket prophet:hasProperty ?property .
  ?property prophet:fieldKey ?fieldKey ;
            prophet:valueType ?valueType .
}
ORDER BY ?fieldKey
LIMIT 50

Example B: support-local trigger wiring check
PREFIX prophet: <http://prophet.platform/ontology#>
PREFIX support_local: <http://prophet.platform/local/support_local#>
ASK WHERE {
  support_local:trg_on_ticket_created
    prophet:listensTo support_local:sig_ticket_created ;
    prophet:invokes support_local:act_triage_ticket .
}

Example C: small-business SalesOrder transitions
PREFIX prophet: <http://prophet.platform/ontology#>
PREFIX artisan_bakery_local: <http://prophet.platform/local/artisan_bakery_local#>
SELECT ?transition ?fromName ?toName
WHERE {
  ?transition a prophet:Transition ;
              prophet:transitionOf artisan_bakery_local:obj_sales_order ;
              prophet:fromState ?fromState ;
              prophet:toState ?toState .
  ?fromState prophet:name ?fromName .
  ?toState prophet:name ?toName .
}
ORDER BY ?transition
LIMIT 25

Example D: object reference fields and their target object model
PREFIX prophet: <http://prophet.platform/ontology#>
SELECT ?property ?fieldKey ?targetObject
WHERE {
  ?property a prophet:PropertyDefinition ;
            prophet:fieldKey ?fieldKey ;
            prophet:valueType ?valueType .
  ?valueType a prophet:ObjectReference ;
             prophet:referencesObjectModel ?targetObject .
}
ORDER BY ?fieldKey
LIMIT 100
""".strip()

_PREFIX_DECLARATION_PATTERN = re.compile(
    r"^@prefix\s+([A-Za-z_][\w-]*):\s*<([^>]+)>\s*\.$",
    re.MULTILINE,
)
_SPARQL_PREFIX_DECLARATION_PATTERN = re.compile(
    r"^\s*PREFIX\s+([A-Za-z_][\w-]*)\s*:\s*<[^>]+>\s*$",
    re.IGNORECASE | re.MULTILINE,
)

_ONTOLOGY_INDEX_TOP_LEVEL_CONCEPTS_QUERY = """
PREFIX prophet: <http://prophet.platform/ontology#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
SELECT DISTINCT ?concept ?category ?label
WHERE {
  VALUES ?categoryIri {
    prophet:ObjectModel
    prophet:Action
    prophet:Process
    prophet:Workflow
    prophet:Event
    prophet:Signal
    prophet:Transition
    prophet:EventTrigger
    prophet:LocalOntology
  }
  ?concept a ?categoryIri .
  OPTIONAL { ?concept prophet:name ?prophetName . }
  OPTIONAL { ?concept rdfs:label ?rdfsLabel . }
  BIND(
    COALESCE(STR(?prophetName), STR(?rdfsLabel), REPLACE(STR(?concept), "^.*[#/]", ""))
    AS ?label
  )
  BIND(REPLACE(STR(?categoryIri), "^.*[#/]", "") AS ?category)
}
ORDER BY ?category ?concept
LIMIT 5000
""".strip()

_ONTOLOGY_INDEX_LOCAL_ONTOLOGIES_QUERY = """
PREFIX prophet: <http://prophet.platform/ontology#>
SELECT DISTINCT ?ontology ?name ?description
WHERE {
  ?ontology a prophet:LocalOntology .
  OPTIONAL { ?ontology prophet:name ?name . }
  OPTIONAL { ?ontology prophet:description ?description . }
}
ORDER BY ?ontology
LIMIT 500
""".strip()

_ONTOLOGY_INDEX_UNAVAILABLE_MARKDOWN = """
# Prefixes / Local Ontologies
- unavailable | unavailable | unavailable | Ontology index unavailable for this turn.

# Concepts
- unavailable | unavailable | Ontology index unavailable for this turn.

---
""".strip()

_SPARQL_READ_ONLY_TOOL_SCHEMA = {
    "type": "function",
    "function": {
        "name": "sparql_read_only_query",
        "description": (
            "Execute one read-only SPARQL query against the current ontology graph. "
            "Use this when ontology context is insufficient and exact evidence is needed. "
            "Allowed: SELECT or ASK only. Disallowed: INSERT/DELETE/LOAD/CLEAR/CREATE/DROP/"
            "COPY/MOVE/ADD and FROM/GRAPH/SERVICE/WITH/USING clauses. "
            "Prefer explicit variables and bounded SELECT queries with ORDER BY/LIMIT."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": (
                        "SPARQL query text. Must be read-only (SELECT or ASK only). "
                        "Include PREFIX declarations and bound result size with LIMIT "
                        "for non-aggregate SELECT queries."
                    ),
                }
            },
            "required": ["query"],
            "additionalProperties": False,
        },
    },
}

_LOAD_SKILL_TOOL_SCHEMA = {
    "type": "function",
    "function": {
        "name": "load_skill",
        "description": (
            "Load one assistant skill by name to expand Seer's instructions and "
            "allowed tools for the current conversation. Use only when the user "
            "request clearly matches the skill catalog."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "skill_name": {
                    "type": "string",
                    "description": "Exact skill name from the available skill catalog.",
                }
            },
            "required": ["skill_name"],
            "additionalProperties": False,
        },
    },
}

_CREATE_ONTOLOGY_GRAPH_ARTIFACT_TOOL_SCHEMA = {
    "type": "function",
    "function": {
        "name": "create_ontology_graph_artifact",
        "description": (
            "Create a lightweight ontology explorer artifact for the assistant canvas. "
            "Use this when the user would benefit from inspecting a focused ontology "
            "concept neighborhood in the shared ontology graph surface."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "focus_concept_uri": {
                    "type": "string",
                    "description": "Full ontology concept URI to focus in the graph explorer.",
                },
                "initial_tab": {
                    "type": "string",
                    "enum": ["overview", "objects", "actions", "events", "triggers"],
                    "description": "Optional ontology explorer tab to open first.",
                },
                "title": {
                    "type": "string",
                    "description": "Optional artifact title override for the canvas.",
                },
                "summary": {
                    "type": "string",
                    "description": "Optional short summary for the canvas artifact.",
                },
            },
            "required": ["focus_concept_uri"],
            "additionalProperties": False,
        },
    },
}

_PRESENT_CANVAS_ARTIFACT_TOOL_SCHEMA = {
    "type": "function",
    "function": {
        "name": "present_canvas_artifact",
        "description": (
            "Present one previously created artifact in the assistant canvas on the "
            "right side of the conversation."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "artifact_id": {
                    "type": "string",
                    "description": "Artifact id returned by a previous assistant tool result.",
                },
                "target": {
                    "type": "string",
                    "enum": ["split-right"],
                    "description": "Canvas target slot.",
                },
                "title": {
                    "type": "string",
                    "description": "Optional canvas title override.",
                },
            },
            "required": ["artifact_id"],
            "additionalProperties": False,
        },
    },
}

_UPDATE_CANVAS_ARTIFACT_TOOL_SCHEMA = {
    "type": "function",
    "function": {
        "name": "update_canvas_artifact",
        "description": (
            "Replace or refresh the artifact currently shown in the assistant canvas."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "artifact_id": {
                    "type": "string",
                    "description": "Artifact id returned by a previous assistant tool result.",
                },
                "target": {
                    "type": "string",
                    "enum": ["split-right"],
                    "description": "Canvas target slot.",
                },
                "title": {
                    "type": "string",
                    "description": "Optional canvas title override.",
                },
            },
            "required": ["artifact_id"],
            "additionalProperties": False,
        },
    },
}

_CLOSE_CANVAS_TOOL_SCHEMA = {
    "type": "function",
    "function": {
        "name": "close_canvas",
        "description": "Close the assistant canvas and return to conversation-only mode.",
        "parameters": {
            "type": "object",
            "properties": {
                "target": {
                    "type": "string",
                    "enum": ["split-right"],
                    "description": "Canvas target slot.",
                }
            },
            "additionalProperties": False,
        },
    },
}


@dataclass(slots=True)
class CopilotAssistantDeltaEvent:
    text: str


@dataclass(slots=True)
class CopilotToolStatusEvent:
    status: Literal["started", "completed", "failed"]
    tool: str
    call_id: str
    summary: str
    query_preview: str | None = None
    query_type: Literal["SELECT", "ASK"] | None = None
    row_count: int | None = None
    truncated: bool | None = None
    error: str | None = None


@dataclass(slots=True)
class CopilotAnswerFinalEvent:
    response: CopilotChatResponse


CopilotAnswerStreamEvent = (
    CopilotAssistantDeltaEvent | CopilotToolStatusEvent | CopilotAnswerFinalEvent
)


class CopilotModelRuntime(Protocol):
    """Abstract runtime for model completion in tests and production."""

    async def run_messages(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
    ) -> CopilotStructuredOutput: ...


class OpenAiChatCompletionsRuntime:
    """Executes OpenAI Chat Completions calls and returns structured copilot output."""

    def __init__(
        self,
        *,
        base_url: str,
        model: str,
        api_key: str | None,
        timeout_seconds: float = 45.0,
        client: Any | None = None,
    ) -> None:
        self._model = model
        self._timeout_seconds = timeout_seconds
        self._client = client or AsyncOpenAI(
            base_url=_normalize_openai_base_url(base_url),
            api_key=api_key or "not-needed",
            timeout=timeout_seconds,
        )

    async def run_messages(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
    ) -> CopilotStructuredOutput:
        for attempt in range(_OPENAI_TRANSIENT_MAX_RETRIES + 1):
            try:
                response = await self._client.chat.completions.create(
                    model=self._model,
                    messages=messages,
                    stream=False,
                    temperature=0,
                    tools=tools or [_SPARQL_READ_ONLY_TOOL_SCHEMA, _LOAD_SKILL_TOOL_SCHEMA],
                    tool_choice="auto",
                    parallel_tool_calls=True,
                )
                break
            except APIConnectionError as exc:
                raise OntologyDependencyUnavailableError(
                    f"OpenAI endpoint is unavailable: {exc}"
                ) from exc
            except APITimeoutError as exc:
                raise OntologyError(
                    f"OpenAI request timed out after {self._timeout_seconds:.1f}s"
                ) from exc
            except APIError as exc:
                if (
                    attempt < _OPENAI_TRANSIENT_MAX_RETRIES
                    and _is_retryable_openai_api_error(exc)
                ):
                    await asyncio.sleep(_OPENAI_RETRY_BACKOFF_SECONDS * (attempt + 1))
                    continue
                raise OntologyError(f"OpenAI chat completion failed: {exc}") from exc

        return _to_structured_output(response)


def _normalize_openai_base_url(base_url: str) -> str:
    normalized = base_url.strip().rstrip("/")
    if normalized.endswith("/chat/completions"):
        return normalized[: -len("/chat/completions")]
    return normalized


class OntologyCopilotService:
    """Copilot orchestration with native tool-calling and read-only tool execution."""

    def __init__(
        self,
        ontology_service: OntologyService | UnavailableOntologyService,
        model_runtime: CopilotModelRuntime,
        query_row_limit: int = 100,
        base_ontology_turtle: str = "",
        skill_registry: AssistantSkillRegistry | None = None,
    ) -> None:
        self._ontology_service = ontology_service
        self._model_runtime = model_runtime
        self._query_row_limit = query_row_limit
        self._base_ontology_turtle = base_ontology_turtle.strip()
        self._base_ontology_system_prompt = _build_base_ontology_system_prompt(
            base_ontology_turtle
        )
        self._base_prefix_map = _extract_prefix_map(base_ontology_turtle)
        self._ontology_index_cache: dict[str, str] = {}
        self._skill_registry = skill_registry or AssistantSkillRegistry(())

    async def answer(
        self,
        question: str,
        conversation: list[CopilotConversationMessage] | None = None,
        completion_conversation: list[dict[str, Any]] | None = None,
        assistant_tool_adapter: AssistantDomainToolAdapter | None = None,
    ) -> CopilotChatResponse:
        async for event in self.answer_stream(
            question,
            conversation=conversation,
            completion_conversation=completion_conversation,
            assistant_tool_adapter=assistant_tool_adapter,
        ):
            if isinstance(event, CopilotAnswerFinalEvent):
                return event.response
        raise OntologyError("copilot stream ended without a final response")

    async def answer_stream(
        self,
        question: str,
        conversation: list[CopilotConversationMessage] | None = None,
        completion_conversation: list[dict[str, Any]] | None = None,
        assistant_tool_adapter: AssistantDomainToolAdapter | None = None,
    ) -> AsyncIterator[CopilotAnswerStreamEvent]:
        current = await self._ontology_service.current()
        ontology_index_markdown = await self._build_ontology_index_markdown(
            current_release_id=current.release_id
        )
        available_skills = self._discover_available_skills()
        conversation_messages = _normalize_completion_conversation(completion_conversation)
        if conversation_messages is None:
            conversation_messages = [
                {"role": message.role, "content": message.content}
                for message in (conversation or [])
            ]
        messages = _build_messages(
            question=question,
            conversation_messages=conversation_messages,
            current_release_id=current.release_id,
            base_ontology_system_prompt=self._base_ontology_system_prompt,
            ontology_index_markdown=ontology_index_markdown,
            available_skills=available_skills,
        )

        tool_result: CopilotToolResult | None = None
        tool_call: CopilotToolCall | None = None
        answer_text = ""
        total_tool_calls = 0
        completion_messages_delta: list[dict[str, Any]] = []

        for round_index in range(_TOOL_CALL_MAX_ROUNDS):
            model_output = await self._model_runtime.run_messages(
                messages,
                tools=_tool_schemas(
                    conversation_messages=messages,
                    assistant_tool_adapter=assistant_tool_adapter,
                ),
            )
            answer_text = model_output.answer
            requested_calls = _requested_tool_calls(model_output)
            if not requested_calls:
                completion_messages_delta.append(
                    {"role": "assistant", "content": answer_text}
                )
                yield CopilotAssistantDeltaEvent(text=answer_text)
                yield CopilotAnswerFinalEvent(
                    response=CopilotChatResponse(
                        mode="direct_answer",
                        answer=answer_text,
                        evidence=model_output.evidence,
                        current_release_id=current.release_id,
                        tool_call=tool_call,
                        tool_result=tool_result,
                        completion_messages_delta=completion_messages_delta,
                    )
                )
                return

            remaining_budget = _TOOL_CALL_MAX_TOTAL - total_tool_calls
            if remaining_budget <= 0:
                break

            bounded_calls = requested_calls[:remaining_budget]
            resolved_calls: list[CopilotToolCall] = []
            for call_index, requested_call in enumerate(bounded_calls):
                if requested_call.call_id:
                    resolved_calls.append(requested_call)
                    continue
                resolved_calls.append(
                    requested_call.model_copy(
                        update={"call_id": f"call_auto_{round_index}_{call_index}"}
                    )
                )

            for resolved_call in resolved_calls:
                yield _tool_status_started_event(resolved_call)

            tool_results = await asyncio.gather(
                *(
                    self._execute_tool_call(
                        resolved_call,
                        assistant_tool_adapter=assistant_tool_adapter,
                        conversation_messages=messages,
                    )
                    for resolved_call in resolved_calls
                )
            )
            total_tool_calls += len(resolved_calls)

            for call_index, (resolved_call, resolved_result) in enumerate(
                zip(resolved_calls, tool_results, strict=False)
            ):
                tool_call = resolved_call
                tool_result = resolved_result
                assistant_message, tool_message = _build_tool_result_messages(
                    assistant_content=answer_text if call_index == 0 else "",
                    tool_call=resolved_call,
                    tool_result=resolved_result,
                )
                messages.append(assistant_message)
                messages.append(tool_message)
                completion_messages_delta.append(assistant_message)
                completion_messages_delta.append(tool_message)
                yield _tool_status_completed_event(
                    tool_call=resolved_call,
                    tool_result=resolved_result,
                )

        fallback_answer = _summarize_tool_result(tool_result)
        completion_messages_delta.append({"role": "assistant", "content": fallback_answer})
        yield CopilotAssistantDeltaEvent(text=fallback_answer)
        yield CopilotAnswerFinalEvent(
            response=CopilotChatResponse(
                mode="direct_answer",
                answer=fallback_answer,
                evidence=[],
                current_release_id=current.release_id,
                tool_call=tool_call,
                tool_result=tool_result,
                completion_messages_delta=completion_messages_delta,
            )
        )
        return

    async def _build_ontology_index_markdown(self, current_release_id: str | None) -> str:
        cache_key = current_release_id or _ONTOLOGY_INDEX_CACHE_KEY_EMPTY_RELEASE
        cached = self._ontology_index_cache.get(cache_key)
        if cached is not None:
            return cached

        prefix_map = dict(self._base_prefix_map)
        if _PROPHET_PREFIX not in prefix_map:
            prefix_map[_PROPHET_PREFIX] = _PROPHET_NAMESPACE
        if _STD_PREFIX not in prefix_map:
            prefix_map[_STD_PREFIX] = _STD_NAMESPACE

        concept_entries: list[tuple[str, str, str]] = []
        local_ontology_by_prefix: dict[str, tuple[str, str]] = {}

        try:
            top_level_result, local_ontology_result = await asyncio.gather(
                self._ontology_service.run_read_only_query(
                    _ONTOLOGY_INDEX_TOP_LEVEL_CONCEPTS_QUERY
                ),
                self._ontology_service.run_read_only_query(
                    _ONTOLOGY_INDEX_LOCAL_ONTOLOGIES_QUERY
                ),
            )
        except (
            OntologyDependencyUnavailableError,
            OntologyNotReadyError,
            OntologyReadOnlyViolationError,
            OntologyError,
        ):
            self._ontology_index_cache[cache_key] = _ONTOLOGY_INDEX_UNAVAILABLE_MARKDOWN
            return _ONTOLOGY_INDEX_UNAVAILABLE_MARKDOWN

        for row in top_level_result.bindings:
            concept_iri = row.get("concept")
            if not concept_iri:
                continue
            if _is_base_concept_iri(concept_iri):
                continue
            _ensure_prefix_for_iri(prefix_map, concept_iri)
            qname = _iri_to_qname(concept_iri, prefix_map)
            category = row.get("category", "Concept")
            label = row.get("label", qname)
            concept_entries.append((category, qname, label))

        for row in local_ontology_result.bindings:
            ontology_iri = row.get("ontology")
            if not ontology_iri:
                continue
            _ensure_prefix_for_iri(prefix_map, ontology_iri)
            ontology_qname = _iri_to_qname(ontology_iri, prefix_map)
            prefix = ontology_qname.split(":", 1)[0] if ":" in ontology_qname else ""
            if not prefix:
                continue
            name = row.get("name", "").strip()
            description = row.get("description", "").strip()
            if prefix not in local_ontology_by_prefix:
                local_ontology_by_prefix[prefix] = (name, description)
                continue
            existing_name, existing_description = local_ontology_by_prefix[prefix]
            merged_name = existing_name or name
            merged_description = existing_description or description
            local_ontology_by_prefix[prefix] = (merged_name, merged_description)

        markdown = _format_ontology_index_markdown(
            concept_entries=concept_entries,
            prefix_map=prefix_map,
            local_ontology_by_prefix=local_ontology_by_prefix,
        )
        self._ontology_index_cache[cache_key] = markdown
        return markdown

    def _discover_available_skills(self) -> dict[str, AssistantSkill]:
        try:
            return self._skill_registry.discover()
        except AssistantSkillError:
            return {}

    async def _execute_tool_call(
        self,
        tool_call: CopilotToolCall,
        *,
        assistant_tool_adapter: AssistantDomainToolAdapter | None = None,
        conversation_messages: list[dict[str, Any]] | None = None,
    ) -> CopilotToolResult:
        if tool_call.tool == "load_skill":
            return self._execute_load_skill_call(tool_call)
        if tool_call.tool == "create_ontology_graph_artifact":
            return _execute_create_ontology_graph_artifact_call(tool_call)
        if tool_call.tool in {
            "present_canvas_artifact",
            "update_canvas_artifact",
            "close_canvas",
        }:
            return _execute_canvas_tool_call(
                tool_call,
                conversation_messages=conversation_messages or [],
            )
        if tool_call.tool != "sparql_read_only_query":
            if assistant_tool_adapter is None:
                return CopilotToolResult(
                    tool=tool_call.tool,
                    error=(
                        "tool execution failed: assistant domain tools are unavailable "
                        "for this request"
                    ),
                )
            return await assistant_tool_adapter.execute_tool_call(tool_call)

        if not tool_call.query:
            return CopilotToolResult(
                tool=tool_call.tool,
                query=None,
                error="tool execution failed: missing SPARQL query",
            )
        query_text = _inject_missing_standard_prefixes(tool_call.query.strip())
        executed_tool_call = tool_call.model_copy(update={"query": query_text})
        try:
            query_response = await self._ontology_service.run_read_only_query(query_text)
        except OntologyReadOnlyViolationError as exc:
            return CopilotToolResult(
                tool=tool_call.tool,
                query=query_text,
                error=str(exc),
            )
        except (
            OntologyError,
            OntologyNotReadyError,
            OntologyDependencyUnavailableError,
        ) as exc:
            return CopilotToolResult(
                tool=tool_call.tool,
                query=query_text,
                error=f"tool execution failed: {exc}",
            )

        return _to_tool_result(
            query_response,
            tool_call=executed_tool_call,
            row_limit=self._query_row_limit,
        )

    def _execute_load_skill_call(self, tool_call: CopilotToolCall) -> CopilotToolResult:
        skill_name = (tool_call.skill_name or "").strip()
        if not skill_name:
            return CopilotToolResult(
                tool="load_skill",
                skill_name=None,
                error="tool execution failed: missing skill_name",
            )

        try:
            skill = self._skill_registry.get(skill_name)
        except AssistantSkillNotFoundError as exc:
            return CopilotToolResult(
                tool="load_skill",
                skill_name=skill_name,
                error=f"tool execution failed: {exc}",
            )
        except AssistantSkillError as exc:
            return CopilotToolResult(
                tool="load_skill",
                skill_name=skill_name,
                error=f"tool execution failed: {exc}",
            )

        return CopilotToolResult(
            tool="load_skill",
            skill_name=skill.name,
            skill_description=skill.description,
            instructions_markdown=skill.instructions_markdown,
            allowed_tools=list(skill.allowed_tools),
            loaded_skill_names=[skill.name],
            row_count=1,
            truncated=False,
        )


def _to_structured_output(response: Any) -> CopilotStructuredOutput:
    if isinstance(response, str):
        return _structured_output_from_string_payload(response)

    choices = getattr(response, "choices", None)
    if choices is None and isinstance(response, dict):
        choices = response.get("choices")
    if not isinstance(choices, list) or not choices:
        raise OntologyError("OpenAI chat completion returned no choices")

    return _structured_output_from_choice(choices[0])


def _structured_output_from_string_payload(payload: str) -> CopilotStructuredOutput:
    # Legacy structured JSON mode is deprecated under Chat Completions.
    # String payloads are treated as direct assistant answers.
    return _direct_answer_output(payload.strip())


def _structured_output_from_choice(choice: Any) -> CopilotStructuredOutput:
    message = _extract_choice_message(choice)
    content = _extract_choice_message_content(choice).strip()

    tool_calls = _extract_tool_calls_from_message(message)
    if tool_calls:
        return CopilotStructuredOutput(
            mode="tool_call",
            answer=content or "Running read-only SPARQL query for ontology evidence.",
            evidence=[],
            tool_call=tool_calls[0],
            tool_calls=tool_calls,
        )

    return _direct_answer_output(content)


def _extract_choice_message(choice: Any) -> Any:
    message = getattr(choice, "message", None)
    if message is None and isinstance(choice, dict):
        message = choice.get("message")
    return message


def _extract_choice_message_content(choice: Any) -> str:
    message = _extract_choice_message(choice)
    if message is None:
        return ""

    content = getattr(message, "content", None)
    if content is None and isinstance(message, dict):
        content = message.get("content")
    return _normalize_content(content)


def _normalize_content(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if isinstance(item, dict):
                text_value = item.get("text")
                if isinstance(text_value, str):
                    parts.append(text_value)
            else:
                text_attr = getattr(item, "text", None)
                if isinstance(text_attr, str):
                    parts.append(text_attr)
        return "".join(parts)
    return ""


def _extract_tool_calls_from_message(message: Any) -> list[CopilotToolCall]:
    if message is None:
        return []

    tool_calls = getattr(message, "tool_calls", None)
    if tool_calls is None and isinstance(message, dict):
        tool_calls = message.get("tool_calls")
    if not isinstance(tool_calls, list) or not tool_calls:
        return []

    parsed_calls: list[CopilotToolCall] = []
    for tool in tool_calls:
        function_payload = getattr(tool, "function", None)
        if function_payload is None and isinstance(tool, dict):
            function_payload = tool.get("function")
        if function_payload is None:
            continue

        function_name = getattr(function_payload, "name", None)
        if function_name is None and isinstance(function_payload, dict):
            function_name = function_payload.get("name")
        arguments: Any = getattr(function_payload, "arguments", None)
        if arguments is None and isinstance(function_payload, dict):
            arguments = function_payload.get("arguments")
        parsed_arguments = _parse_tool_arguments(arguments)
        query: str | None = None
        skill_name: str | None = None
        if function_name == "sparql_read_only_query":
            query = _extract_tool_query_from_arguments(arguments)
            if query is None:
                continue
        elif function_name == "load_skill":
            skill_name = _extract_tool_skill_name_from_arguments(arguments)
            if skill_name is None:
                continue

        call_id = getattr(tool, "id", None)
        if call_id is None and isinstance(tool, dict):
            call_id = tool.get("id")
        if isinstance(call_id, str) and call_id.strip():
            call_id = _normalize_tool_call_id(call_id)
        else:
            call_id = None

        raw_tool_call = _tool_call_to_raw_dict(tool, function_payload)
        if call_id is not None:
            raw_tool_call["id"] = call_id

        parsed_calls.append(
            CopilotToolCall(
                tool=function_name,
                arguments=parsed_arguments,
                query=query,
                skill_name=skill_name,
                call_id=call_id,
                raw_tool_call=raw_tool_call,
            )
        )

    return parsed_calls


def _tool_call_to_raw_dict(tool: Any, function_payload: Any) -> dict[str, Any]:
    raw_tool_call = _model_to_dict(tool)
    raw_function = _model_to_dict(function_payload)

    if not raw_tool_call:
        raw_tool_call = {}
    if not raw_function:
        raw_function = {}

    call_id = getattr(tool, "id", None)
    if call_id is None and isinstance(tool, dict):
        call_id = tool.get("id")
    if call_id is not None:
        raw_tool_call["id"] = call_id

    call_type = getattr(tool, "type", None)
    if call_type is None and isinstance(tool, dict):
        call_type = tool.get("type")
    raw_tool_call["type"] = call_type or "function"

    function_name = getattr(function_payload, "name", None)
    if function_name is None and isinstance(function_payload, dict):
        function_name = function_payload.get("name")
    if function_name is not None:
        raw_function["name"] = function_name

    arguments = getattr(function_payload, "arguments", None)
    if arguments is None and isinstance(function_payload, dict):
        arguments = function_payload.get("arguments")
    if arguments is not None:
        raw_function["arguments"] = arguments

    raw_tool_call["function"] = raw_function
    return raw_tool_call


def _extract_tool_skill_name_from_arguments(arguments: Any) -> str | None:
    parsed = _parse_tool_arguments(arguments)
    skill_name = parsed.get("skill_name")
    if isinstance(skill_name, str) and skill_name.strip():
        return skill_name.strip()
    return None


def _parse_tool_arguments(arguments: Any) -> dict[str, Any]:
    if isinstance(arguments, str):
        try:
            parsed = json.loads(arguments)
        except json.JSONDecodeError:
            return {}
    elif isinstance(arguments, dict):
        parsed = arguments
    else:
        return {}
    if isinstance(parsed, dict):
        return parsed
    return {}


def _model_to_dict(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return dict(value)
    model_dump = getattr(value, "model_dump", None)
    if callable(model_dump):
        dumped = model_dump(exclude_none=True)
        if isinstance(dumped, dict):
            return dumped
    return {}


def _extract_tool_query_from_arguments(arguments: Any) -> str | None:
    parsed = _parse_tool_arguments(arguments)
    query = parsed.get("query")
    if isinstance(query, str) and query.strip():
        return query.strip()
    if isinstance(arguments, str):
        text = arguments.strip()
        return text if len(text) >= 3 else None
    return None


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


def _is_retryable_openai_api_error(exc: APIError) -> bool:
    message = str(exc).lower()
    return "error in input stream" in message


def _direct_answer_output(answer: str) -> CopilotStructuredOutput:
    normalized = answer.strip() or "I do not have enough ontology context to answer."
    return CopilotStructuredOutput(
        mode="direct_answer",
        answer=normalized,
        evidence=[],
        tool_call=None,
    )


def _build_messages(
    question: str,
    conversation_messages: list[dict[str, Any]],
    current_release_id: str | None,
    base_ontology_system_prompt: str,
    ontology_index_markdown: str,
    available_skills: dict[str, AssistantSkill],
) -> list[dict[str, Any]]:
    release_text = current_release_id or "none"
    messages: list[dict[str, Any]] = [
        {"role": "system", "content": base_ontology_system_prompt},
        {"role": "system", "content": _COPILOT_WORKFLOW_SYSTEM_PROMPT},
        {
            "role": "system",
            "content": f"Current ontology release: {release_text}",
        },
        {"role": "system", "content": ontology_index_markdown},
        {"role": "system", "content": _build_skill_catalog_markdown(available_skills)},
    ]
    for message in conversation_messages:
        messages.append(message)
    messages.append({"role": "user", "content": question})
    return messages


def _to_tool_result(
    query_response: OntologySparqlQueryResponse,
    tool_call: CopilotToolCall,
    row_limit: int,
) -> CopilotToolResult:
    if query_response.query_type == "ASK":
        return CopilotToolResult(
            tool=tool_call.tool,
            query=tool_call.query,
            query_type="ASK",
            ask_result=query_response.ask_result,
            row_count=1,
            truncated=False,
            graphs=query_response.graphs,
        )

    rows = query_response.bindings
    row_count = len(rows)
    limited_rows = rows[:row_limit]
    truncated = row_count > row_limit
    variables = _infer_variables(limited_rows, rows)
    return CopilotToolResult(
        tool=tool_call.tool,
        query=tool_call.query,
        query_type="SELECT",
        variables=variables,
        rows=limited_rows,
        row_count=row_count,
        truncated=truncated,
        graphs=query_response.graphs,
    )


def _tool_schemas(
    *,
    conversation_messages: list[dict[str, Any]],
    assistant_tool_adapter: AssistantDomainToolAdapter | None = None,
) -> list[dict[str, Any]]:
    schemas = [
        _SPARQL_READ_ONLY_TOOL_SCHEMA,
        _LOAD_SKILL_TOOL_SCHEMA,
        _CREATE_ONTOLOGY_GRAPH_ARTIFACT_TOOL_SCHEMA,
        _PRESENT_CANVAS_ARTIFACT_TOOL_SCHEMA,
        _UPDATE_CANVAS_ARTIFACT_TOOL_SCHEMA,
        _CLOSE_CANVAS_TOOL_SCHEMA,
    ]
    if assistant_tool_adapter is None:
        return schemas

    enabled_permissions = _loaded_skill_tool_permissions(conversation_messages)
    schemas.extend(assistant_tool_adapter.tool_schemas(enabled_permissions))
    return schemas


def _build_skill_catalog_markdown(available_skills: dict[str, AssistantSkill]) -> str:
    lines = [
        "Available assistant skills:",
        (
            "Use `load_skill` with the exact skill name when the user's request "
            "clearly matches one skill."
        ),
    ]
    if not available_skills:
        lines.append("- none")
        return "\n".join(lines)

    for skill in sorted(available_skills.values(), key=lambda item: item.name):
        description = skill.description or "No description provided."
        lines.append(f"- {skill.name}: {description}")
    return "\n".join(lines)


def _loaded_skill_tool_permissions(
    conversation_messages: list[dict[str, Any]],
) -> set[str]:
    enabled: set[str] = set()
    for message in conversation_messages:
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
            if isinstance(tool_name, str) and tool_name:
                enabled.add(tool_name)
    return enabled


def _execute_canvas_tool_call(
    tool_call: CopilotToolCall,
    *,
    conversation_messages: list[dict[str, Any]],
) -> CopilotToolResult:
    arguments = dict(tool_call.arguments)
    target = arguments.get("target") or "split-right"
    if target != "split-right":
        return CopilotToolResult(
            tool=tool_call.tool,
            error=f"tool validation failed: unsupported canvas target {target!r}",
        )

    if tool_call.tool == "close_canvas":
        return CopilotToolResult(
            tool=tool_call.tool,
            tool_permission="assistant.canvas.close",
            canvas_action=CopilotCanvasAction(action="close", target="split-right"),
            summary="Closed the assistant canvas.",
            row_count=1,
            truncated=False,
        )

    artifact_id = arguments.get("artifact_id")
    if not isinstance(artifact_id, str) or not artifact_id.strip():
        return CopilotToolResult(
            tool=tool_call.tool,
            error="tool validation failed: artifact_id is required",
        )
    artifact_id = artifact_id.strip()
    artifacts = _artifacts_by_id(conversation_messages)
    artifact = artifacts.get(artifact_id)
    if artifact is None:
        return CopilotToolResult(
            tool=tool_call.tool,
            error=f"tool execution failed: artifact {artifact_id!r} is unavailable",
        )

    action = "present" if tool_call.tool == "present_canvas_artifact" else "update"
    title = arguments.get("title")
    return CopilotToolResult(
        tool=tool_call.tool,
        tool_permission=f"assistant.canvas.{action}",
        canvas_action=CopilotCanvasAction(
            action=action,
            target="split-right",
            artifact_id=str(artifact.get("artifact_id") or artifact_id),
            title=(
                title
                if isinstance(title, str) and title.strip()
                else str(artifact.get("title") or artifact_id)
            ),
        ),
        summary=(
            f"{'Presented' if action == 'present' else 'Updated'} canvas artifact "
            f"{str(artifact.get('title') or artifact_id)}."
        ),
        row_count=1,
        truncated=False,
    )


def _execute_create_ontology_graph_artifact_call(
    tool_call: CopilotToolCall,
) -> CopilotToolResult:
    arguments = dict(tool_call.arguments)
    focus_concept_uri = arguments.get("focus_concept_uri")
    if not isinstance(focus_concept_uri, str) or not focus_concept_uri.strip():
        return CopilotToolResult(
            tool=tool_call.tool,
            error="tool validation failed: focus_concept_uri is required",
        )

    initial_tab = arguments.get("initial_tab")
    if initial_tab is not None and (
        not isinstance(initial_tab, str)
        or initial_tab not in {"overview", "objects", "actions", "events", "triggers"}
    ):
        return CopilotToolResult(
            tool=tool_call.tool,
            error=(
                "tool validation failed: initial_tab must be one of "
                "'overview', 'objects', 'actions', 'events', or 'triggers'"
            ),
        )

    title = arguments.get("title")
    summary = arguments.get("summary")
    normalized_focus_uri = focus_concept_uri.strip()
    artifact_title = (
        title.strip()
        if isinstance(title, str) and title.strip()
        else "Ontology graph"
    )
    artifact_summary = (
        summary.strip()
        if isinstance(summary, str) and summary.strip()
        else (
            "Inspect the shared ontology explorer with a focused concept neighborhood."
        )
    )
    artifact_id = _build_ontology_graph_artifact_id(
        normalized_focus_uri,
        initial_tab if isinstance(initial_tab, str) else None,
    )

    return CopilotToolResult(
        tool=tool_call.tool,
        artifact=CopilotArtifact(
            artifact_id=artifact_id,
            artifact_type="ontology-graph",
            title=artifact_title,
            summary=artifact_summary,
            data={
                "focus_concept_uri": normalized_focus_uri,
                **(
                    {"initial_tab": initial_tab}
                    if isinstance(initial_tab, str)
                    else {}
                ),
            },
        ),
        summary=f"Created ontology graph artifact {artifact_title}.",
        row_count=1,
        truncated=False,
    )


def _build_ontology_graph_artifact_id(
    focus_concept_uri: str,
    initial_tab: str | None,
) -> str:
    digest_source = f"{focus_concept_uri}|{initial_tab or ''}"
    digest = hashlib.sha256(digest_source.encode("utf-8")).hexdigest()[:16]
    return f"ontology_graph_{digest}"


def _artifacts_by_id(
    conversation_messages: list[dict[str, Any]],
) -> dict[str, dict[str, Any]]:
    artifacts: dict[str, dict[str, Any]] = {}
    for message in conversation_messages:
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
        artifact = parsed.get("artifact")
        if not isinstance(artifact, dict):
            continue
        artifact_id = artifact.get("artifact_id")
        if isinstance(artifact_id, str) and artifact_id:
            artifacts[artifact_id] = artifact
    return artifacts


def _infer_variables(
    limited_rows: list[dict[str, str]],
    full_rows: list[dict[str, str]],
) -> list[str]:
    ordered: list[str] = []
    for row in limited_rows + full_rows:
        for key in row:
            if key not in ordered:
                ordered.append(key)
    return ordered


def _extract_prefix_map(turtle: str) -> dict[str, str]:
    prefixes: dict[str, str] = {}
    for alias, iri in _PREFIX_DECLARATION_PATTERN.findall(turtle):
        prefixes[alias] = iri
    return prefixes


def _inject_missing_standard_prefixes(query: str) -> str:
    if not query:
        return query

    declared = {
        alias.lower()
        for alias in _SPARQL_PREFIX_DECLARATION_PATTERN.findall(query)
    }
    missing_lines: list[str] = []
    for alias, namespace in _SPARQL_STANDARD_PREFIXES.items():
        if alias in declared:
            continue
        if _query_references_prefix(query, alias):
            missing_lines.append(f"PREFIX {alias}: <{namespace}>")
    if not missing_lines:
        return query
    return "\n".join([*missing_lines, query])


def _query_references_prefix(query: str, alias: str) -> bool:
    pattern = re.compile(rf"(?<![A-Za-z0-9_]){re.escape(alias)}:[A-Za-z_]")
    return pattern.search(query) is not None


def _normalize_completion_conversation(
    completion_conversation: list[dict[str, Any]] | None,
) -> list[dict[str, Any]] | None:
    if completion_conversation is None:
        return None

    normalized: list[dict[str, Any]] = []
    for message in completion_conversation:
        if not isinstance(message, dict):
            continue
        role = message.get("role")
        if role not in {"user", "assistant", "tool"}:
            continue
        sanitized: dict[str, Any] = {"role": role}
        if "content" in message:
            sanitized["content"] = message["content"]
        if "name" in message:
            sanitized["name"] = message["name"]
        tool_call_id = message.get("tool_call_id")
        if isinstance(tool_call_id, str) and tool_call_id.strip():
            sanitized["tool_call_id"] = _normalize_tool_call_id(tool_call_id)
        tool_calls = message.get("tool_calls")
        if isinstance(tool_calls, list):
            sanitized["tool_calls"] = _normalize_tool_calls(tool_calls)
        normalized.append(sanitized)
    return normalized


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


def _is_base_concept_iri(concept_iri: str) -> bool:
    return any(concept_iri.startswith(prefix) for prefix in _BASE_CONCEPT_IRI_PREFIXES)


def _ensure_prefix_for_iri(prefix_map: dict[str, str], iri: str) -> None:
    namespace, _ = _split_namespace_and_local_name(iri)
    if not namespace:
        return
    for existing_namespace in prefix_map.values():
        if existing_namespace == namespace:
            return

    alias = _infer_prefix_alias(namespace)
    alias = _dedupe_prefix_alias(alias, prefix_map)
    prefix_map[alias] = namespace


def _split_namespace_and_local_name(iri: str) -> tuple[str, str]:
    hash_index = iri.rfind("#")
    if 0 <= hash_index < len(iri) - 1:
        return iri[: hash_index + 1], iri[hash_index + 1 :]

    slash_index = iri.rfind("/")
    if 0 <= slash_index < len(iri) - 1:
        return iri[: slash_index + 1], iri[slash_index + 1 :]

    return "", iri


def _infer_prefix_alias(namespace: str) -> str:
    if namespace == _PROPHET_NAMESPACE:
        return _PROPHET_PREFIX
    if namespace == _STD_NAMESPACE:
        return _STD_PREFIX
    if namespace.startswith(_LOCAL_ONTOLOGY_NAMESPACE_PREFIX) and namespace.endswith("#"):
        remainder = namespace[len(_LOCAL_ONTOLOGY_NAMESPACE_PREFIX) : -1]
        normalized = _normalize_prefix_token(remainder)
        if normalized:
            return normalized
    return _normalize_prefix_token(namespace) or "ns"


def _normalize_prefix_token(value: str) -> str:
    lowered = value.lower()
    lowered = re.sub(r"[^a-z0-9_]+", "_", lowered)
    lowered = lowered.strip("_")
    if not lowered:
        return ""
    if lowered[0].isdigit():
        lowered = f"ns_{lowered}"
    return lowered


def _dedupe_prefix_alias(alias: str, prefix_map: dict[str, str]) -> str:
    if alias not in prefix_map:
        return alias
    suffix = 2
    candidate = f"{alias}_{suffix}"
    while candidate in prefix_map:
        suffix += 1
        candidate = f"{alias}_{suffix}"
    return candidate


def _iri_to_qname(iri: str, prefix_map: dict[str, str]) -> str:
    for alias, namespace in sorted(prefix_map.items(), key=lambda item: len(item[1]), reverse=True):
        if not iri.startswith(namespace):
            continue
        local_name = iri[len(namespace) :]
        if local_name:
            return f"{alias}:{local_name}"
    return iri


def _format_ontology_index_markdown(
    *,
    concept_entries: list[tuple[str, str, str]],
    prefix_map: dict[str, str],
    local_ontology_by_prefix: dict[str, tuple[str, str]],
) -> str:
    deduped_concepts: list[tuple[str, str, str]] = []
    seen_concepts: set[tuple[str, str, str]] = set()
    used_prefixes: set[str] = set()
    for category, qname, label in concept_entries:
        normalized = (category.strip() or "Concept", qname.strip(), label.strip() or qname.strip())
        if not normalized[1]:
            continue
        if normalized in seen_concepts:
            continue
        seen_concepts.add(normalized)
        deduped_concepts.append(normalized)
        if ":" in normalized[1]:
            used_prefixes.add(normalized[1].split(":", 1)[0])

    used_prefixes.update(local_ontology_by_prefix.keys())
    used_prefixes.update({_PROPHET_PREFIX, _STD_PREFIX})

    prefix_lines: list[str] = []
    for prefix in sorted(used_prefixes):
        base_uri = prefix_map.get(prefix)
        if not base_uri:
            continue
        ontology_name = "-"
        ontology_description = "-"
        if prefix in local_ontology_by_prefix:
            name, description = local_ontology_by_prefix[prefix]
            ontology_name = name or "-"
            ontology_description = description or "-"
        elif prefix == _PROPHET_PREFIX:
            ontology_name = "Prophet Base Ontology"
            ontology_description = "Prophet metamodel concepts and predicates."
        elif prefix == _STD_PREFIX:
            ontology_name = "Prophet Standard Types"
            ontology_description = "Standard scalar and value types used by local ontologies."
        prefix_lines.append(
            f"- {prefix} | {base_uri} | {ontology_name} | {ontology_description}"
        )

    concept_lines: list[str] = []
    for category, qname, label in sorted(
        deduped_concepts,
        key=lambda item: (item[0].lower(), item[1].lower()),
    ):
        concept_lines.append(f"- {category} | {qname} | {label}")

    if not prefix_lines:
        prefix_lines = ["- none | none | none | No prefix metadata available."]
    if not concept_lines:
        concept_lines = ["- none | none | No concept metadata available."]

    return "\n".join(
        [
            "# Prefixes / Local Ontologies",
            *prefix_lines,
            "",
            "# Concepts",
            *concept_lines,
            "",
            "---",
        ]
    )


def _build_base_ontology_system_prompt(base_ontology_turtle: str) -> str:
    ontology_text = base_ontology_turtle.strip()
    if not ontology_text:
        ontology_text = (
            "Base ontology text unavailable. Continue with provided context and tool evidence."
        )
    return _BASE_ONTOLOGY_SYSTEM_PROMPT_TEMPLATE.format(base_ontology_turtle=ontology_text)


def _requested_tool_calls(model_output: CopilotStructuredOutput) -> list[CopilotToolCall]:
    if model_output.mode != "tool_call":
        return []
    if model_output.tool_calls:
        return model_output.tool_calls
    if model_output.tool_call is not None:
        return [model_output.tool_call]
    return []


def _build_tool_result_messages(
    *,
    assistant_content: str,
    tool_call: CopilotToolCall,
    tool_result: CopilotToolResult,
) -> tuple[dict[str, Any], dict[str, Any]]:
    if not tool_call.call_id:
        raise ValueError("tool_call.call_id is required when building tool result messages")

    raw_tool_call = dict(tool_call.raw_tool_call or {})
    raw_function = dict(raw_tool_call.get("function", {}))
    raw_tool_call["id"] = tool_call.call_id
    raw_tool_call["type"] = raw_tool_call.get("type") or "function"
    raw_function["name"] = raw_function.get("name") or tool_call.tool
    raw_function["arguments"] = json.dumps(
        _tool_call_arguments(tool_call),
        ensure_ascii=True,
    )
    raw_tool_call["function"] = raw_function

    assistant_message: dict[str, Any] = {
        "role": "assistant",
        "content": assistant_content,
        "tool_calls": [raw_tool_call],
    }
    tool_message: dict[str, Any] = {
        "role": "tool",
        "tool_call_id": tool_call.call_id,
        "content": json.dumps(tool_result.model_dump(mode="json"), ensure_ascii=True),
    }
    return assistant_message, tool_message


def _tool_call_arguments(tool_call: CopilotToolCall) -> dict[str, Any]:
    if tool_call.tool == "load_skill":
        return {"skill_name": tool_call.skill_name}
    if tool_call.tool == "sparql_read_only_query":
        return {"query": tool_call.query}
    return dict(tool_call.arguments)


def _tool_status_started_event(tool_call: CopilotToolCall) -> CopilotToolStatusEvent:
    if tool_call.tool == "load_skill":
        skill_name = tool_call.skill_name or "unknown"
        return CopilotToolStatusEvent(
            status="started",
            tool=tool_call.tool,
            call_id=tool_call.call_id or "call_unknown",
            summary=f"Loading assistant skill {skill_name}.",
        )
    if tool_call.tool == "sparql_read_only_query":
        return CopilotToolStatusEvent(
            status="started",
            tool=tool_call.tool,
            call_id=tool_call.call_id or "call_unknown",
            summary="Running read-only SPARQL query.",
            query_preview=_query_preview(tool_call.query or ""),
        )
    if tool_call.tool in {"present_canvas_artifact", "update_canvas_artifact", "close_canvas"}:
        verb = {
            "present_canvas_artifact": "Presenting an artifact in",
            "update_canvas_artifact": "Updating",
            "close_canvas": "Closing",
        }[tool_call.tool]
        return CopilotToolStatusEvent(
            status="started",
            tool=tool_call.tool,
            call_id=tool_call.call_id or "call_unknown",
            summary=f"{verb} the assistant canvas.",
        )
    return CopilotToolStatusEvent(
        status="started",
        tool=tool_call.tool,
        call_id=tool_call.call_id or "call_unknown",
        summary=f"Running assistant tool {tool_call.tool}.",
    )


def _tool_status_completed_event(
    *,
    tool_call: CopilotToolCall,
    tool_result: CopilotToolResult,
) -> CopilotToolStatusEvent:
    status: Literal["completed", "failed"] = (
        "failed" if tool_result.error else "completed"
    )
    return CopilotToolStatusEvent(
        status=status,
        tool=tool_call.tool,
        call_id=tool_call.call_id or "call_unknown",
        summary=_tool_status_summary(tool_result),
        query_preview=_query_preview(tool_call.query or "") if tool_call.query else None,
        query_type=tool_result.query_type,
        row_count=tool_result.row_count,
        truncated=tool_result.truncated,
        error=tool_result.error,
    )


def _tool_status_summary(tool_result: CopilotToolResult) -> str:
    if tool_result.tool == "load_skill":
        if tool_result.error:
            return f"Assistant skill load failed: {tool_result.error}"
        skill_name = tool_result.skill_name or "unknown"
        enabled = (
            ", ".join(tool_result.allowed_tools)
            if tool_result.allowed_tools
            else "no additional tools"
        )
        return f"Loaded assistant skill {skill_name}. Enabled {enabled}."
    if tool_result.tool == "sparql_read_only_query" and tool_result.error:
        return f"Read-only SPARQL query failed: {tool_result.error}"
    if tool_result.tool == "sparql_read_only_query" and tool_result.query_type == "ASK":
        if tool_result.ask_result is None:
            return "Read-only ASK query completed without a boolean result."
        return (
            "Read-only ASK query completed with result "
            f"{str(tool_result.ask_result).lower()}."
        )
    if tool_result.tool == "sparql_read_only_query" and tool_result.query_type == "SELECT":
        truncated_suffix = " (truncated)" if tool_result.truncated else ""
        return (
            "Read-only SELECT query completed with "
            f"{tool_result.row_count} rows{truncated_suffix}."
        )
    if tool_result.canvas_action is not None:
        if tool_result.error:
            return f"Canvas action failed: {tool_result.error}"
        title = (
            tool_result.canvas_action.title
            or tool_result.canvas_action.artifact_id
            or "artifact"
        )
        if tool_result.canvas_action.action == "close":
            return "Closed the assistant canvas."
        if tool_result.canvas_action.action == "update":
            return f"Updated the assistant canvas with {title}."
        return f"Presented {title} in the assistant canvas."
    if tool_result.error:
        return f"Assistant tool {tool_result.tool} failed: {tool_result.error}"
    if tool_result.summary:
        return tool_result.summary
    return f"Assistant tool {tool_result.tool} completed."


def _query_preview(query: str, max_len: int = 160) -> str:
    compact = " ".join(query.split())
    if len(compact) <= max_len:
        return compact
    return f"{compact[: max_len - 3]}..."


def _summarize_tool_result(tool_result: CopilotToolResult | None) -> str:
    if tool_result is None:
        return (
            "I could not finalize a model response after tool execution, "
            "but no tool result was available."
        )
    if tool_result.tool == "load_skill":
        if tool_result.error:
            return f"I tried to load an assistant skill, but it failed: {tool_result.error}"
        skill_name = tool_result.skill_name or "the requested skill"
        return (
            f"I loaded {skill_name}, but the model did not produce a final answer after "
            "skill activation."
        )
    if tool_result.tool == "sparql_read_only_query" and tool_result.error:
        return f"I ran a read-only SPARQL query, but it failed: {tool_result.error}"

    if tool_result.tool == "sparql_read_only_query" and tool_result.query_type == "ASK":
        if tool_result.ask_result is None:
            return "I ran a read-only ASK query, but the boolean result was unavailable."
        return (
            "I ran a read-only ASK query and the result is "
            f"{str(tool_result.ask_result).lower()}."
        )

    if tool_result.tool == "sparql_read_only_query" and tool_result.query_type == "SELECT":
        truncated_suffix = " (truncated)" if tool_result.truncated else ""
        return (
            "I ran a read-only SELECT query and found "
            f"{tool_result.row_count} rows{truncated_suffix}."
        )

    if tool_result.canvas_action is not None:
        if tool_result.error:
            return f"I tried to update the assistant canvas, but it failed: {tool_result.error}"
        title = (
            tool_result.canvas_action.title
            or tool_result.canvas_action.artifact_id
            or "the artifact"
        )
        if tool_result.canvas_action.action == "close":
            return "I closed the assistant canvas."
        if tool_result.canvas_action.action == "update":
            return f"I updated the assistant canvas with {title}."
        return f"I presented {title} in the assistant canvas."

    if tool_result.error:
        return f"I ran assistant tool {tool_result.tool}, but it failed: {tool_result.error}"
    if tool_result.summary:
        return tool_result.summary
    return f"I ran assistant tool {tool_result.tool} and returned the structured results."
