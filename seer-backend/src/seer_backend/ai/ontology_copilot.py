"""Read-only ontology copilot service and OpenAI runtime adapter."""

from __future__ import annotations

import asyncio
import json
import re
from typing import Any, Protocol

from openai import APIConnectionError, APIError, APITimeoutError, AsyncOpenAI

from seer_backend.ontology.errors import (
    OntologyDependencyUnavailableError,
    OntologyError,
    OntologyNotReadyError,
    OntologyReadOnlyViolationError,
)
from seer_backend.ontology.models import (
    CopilotChatResponse,
    CopilotConversationMessage,
    CopilotStructuredOutput,
    CopilotToolCall,
    CopilotToolResult,
    OntologyConceptDetail,
    OntologyConceptSummary,
    OntologySparqlQueryResponse,
)
from seer_backend.ontology.service import OntologyService, UnavailableOntologyService

_TOOL_CALL_MAX_ROUNDS = 6
_TOOL_CALL_MAX_TOTAL = 8

_BASE_ONTOLOGY_SYSTEM_PROMPT_TEMPLATE = """
Authoritative Prophet base ontology (verbatim Turtle).
Treat this as immutable metamodel context.

{base_ontology_turtle}
""".strip()

_COPILOT_WORKFLOW_SYSTEM_PROMPT = """
You are Seer's ontology copilot.

Your job:
- Help users understand Prophet-modeled ontology semantics and relationships.
- Stay grounded in the provided ontology context and tool evidence.
- Use only read-only ontology analysis.

Workflow for each turn:
1. Read the user question and prior conversation.
2. Use the ontology context message first (current release + concept/detail snippets).
3. Decide whether a tool query is needed:
- Answer directly when context is already sufficient.
- Use the SPARQL tool when the user asks for exact relationships,
  counts, validation, or when context is ambiguous.
4. If using the tool, produce one high-quality query first and keep it bounded.
5. Return a concise answer that cites what you checked and any limits/uncertainty.

Tool planning and budget:
- Prefer batching independent checks in one round instead of serial loops.
- Keep tool usage small: usually 1 round, at most 2 unless explicitly asked for exhaustive validation.
- If evidence is still incomplete after limited queries, stop and explain what is missing.

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

Answer style:
- Be concise and concrete.
- Distinguish between facts from ontology/tool evidence vs inference.
- If evidence is insufficient, say exactly what is missing.
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


class CopilotModelRuntime(Protocol):
    """Abstract runtime for model completion in tests and production."""

    async def run_messages(
        self,
        messages: list[dict[str, Any]],
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
            base_url=base_url.rstrip("/"),
            api_key=api_key or "not-needed",
            timeout=timeout_seconds,
        )

    async def run_messages(
        self,
        messages: list[dict[str, Any]],
    ) -> CopilotStructuredOutput:
        try:
            response = await self._client.chat.completions.create(
                model=self._model,
                messages=messages,
                stream=False,
                temperature=0,
                tools=[_SPARQL_READ_ONLY_TOOL_SCHEMA],
                tool_choice="auto",
                parallel_tool_calls=True,
            )
        except APIConnectionError as exc:
            raise OntologyDependencyUnavailableError(
                f"OpenAI endpoint is unavailable: {exc}"
            ) from exc
        except APITimeoutError as exc:
            raise OntologyError(
                f"OpenAI request timed out after {self._timeout_seconds:.1f}s"
            ) from exc
        except APIError as exc:
            raise OntologyError(f"OpenAI chat completion failed: {exc}") from exc

        return _to_structured_output(response)


class OntologyCopilotService:
    """Copilot orchestration with native tool-calling and read-only tool execution."""

    def __init__(
        self,
        ontology_service: OntologyService | UnavailableOntologyService,
        model_runtime: CopilotModelRuntime,
        query_row_limit: int = 100,
        base_ontology_turtle: str = "",
    ) -> None:
        self._ontology_service = ontology_service
        self._model_runtime = model_runtime
        self._query_row_limit = query_row_limit
        self._base_ontology_system_prompt = _build_base_ontology_system_prompt(
            base_ontology_turtle
        )

    async def answer(
        self,
        question: str,
        conversation: list[CopilotConversationMessage] | None = None,
    ) -> CopilotChatResponse:
        current = await self._ontology_service.current()
        context = await self._build_context(question)
        messages = _build_messages(
            question=question,
            conversation=conversation or [],
            current_release_id=current.release_id,
            context=context,
            base_ontology_system_prompt=self._base_ontology_system_prompt,
        )

        tool_result: CopilotToolResult | None = None
        tool_call: CopilotToolCall | None = None
        answer_text = ""
        total_tool_calls = 0

        for round_index in range(_TOOL_CALL_MAX_ROUNDS):
            model_output = await self._model_runtime.run_messages(messages)
            answer_text = model_output.answer
            requested_calls = _requested_tool_calls(model_output)
            if not requested_calls:
                return CopilotChatResponse(
                    mode="direct_answer",
                    answer=answer_text,
                    evidence=model_output.evidence,
                    current_release_id=current.release_id,
                    tool_call=tool_call,
                    tool_result=tool_result,
                )

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

            tool_results = await asyncio.gather(
                *(self._execute_tool_call(resolved_call) for resolved_call in resolved_calls)
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

        return CopilotChatResponse(
            mode="direct_answer",
            answer=_summarize_tool_result(tool_result),
            evidence=[],
            current_release_id=current.release_id,
            tool_call=tool_call,
            tool_result=tool_result,
        )

    async def _build_context(self, question: str) -> str:
        concepts = await self._find_candidate_concepts(question)
        detail_tasks = [
            self._ontology_service.concept_detail(concept.iri)
            for concept in concepts[:3]
        ]
        details = await asyncio.gather(*detail_tasks) if detail_tasks else []
        return _format_context_lines(concepts=concepts, details=details)

    async def _find_candidate_concepts(self, question: str) -> list[OntologyConceptSummary]:
        direct_hits = await self._ontology_service.list_concepts(search=question, limit=8)
        if direct_hits:
            return direct_hits

        tokens = _tokenize(question)
        for token in tokens:
            token_hits = await self._ontology_service.list_concepts(search=token, limit=8)
            if token_hits:
                return token_hits
        return []

    async def _execute_tool_call(self, tool_call: CopilotToolCall) -> CopilotToolResult:
        query_text = tool_call.query.strip()
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
            tool_call=tool_call,
            row_limit=self._query_row_limit,
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
        if function_name != "sparql_read_only_query":
            continue

        arguments: Any = getattr(function_payload, "arguments", None)
        if arguments is None and isinstance(function_payload, dict):
            arguments = function_payload.get("arguments")
        query = _extract_tool_query_from_arguments(arguments)
        if query is None:
            continue

        call_id = getattr(tool, "id", None)
        if call_id is None and isinstance(tool, dict):
            call_id = tool.get("id")
        if not isinstance(call_id, str) or not call_id.strip():
            call_id = None

        parsed_calls.append(
            CopilotToolCall(
                tool="sparql_read_only_query",
                query=query,
                call_id=call_id,
            )
        )

    return parsed_calls


def _extract_tool_query_from_arguments(arguments: Any) -> str | None:
    if isinstance(arguments, dict):
        query = arguments.get("query")
        if isinstance(query, str) and query.strip():
            return query.strip()
        return None

    if not isinstance(arguments, str):
        return None

    text = arguments.strip()
    if not text:
        return None

    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        return text if len(text) >= 3 else None

    if isinstance(parsed, dict):
        query = parsed.get("query")
        if isinstance(query, str) and query.strip():
            return query.strip()

    return None


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
    conversation: list[CopilotConversationMessage],
    current_release_id: str | None,
    context: str,
    base_ontology_system_prompt: str,
) -> list[dict[str, Any]]:
    release_text = current_release_id or "none"
    messages: list[dict[str, Any]] = [
        {"role": "system", "content": base_ontology_system_prompt},
        {"role": "system", "content": _COPILOT_WORKFLOW_SYSTEM_PROMPT},
        {
            "role": "system",
            "content": (
                f"Current ontology release: {release_text}\n\n"
                "Ontology and evidence context:\n"
                f"{context}"
            ),
        },
    ]
    for message in conversation:
        messages.append({"role": message.role, "content": message.content})
    messages.append({"role": "user", "content": question})
    return messages


def _format_context_lines(
    concepts: list[OntologyConceptSummary],
    details: list[OntologyConceptDetail],
) -> str:
    if not concepts:
        return "No concept matches were found for the conversation terms."

    summary_lines = []
    for concept in concepts[:8]:
        summary_lines.append(
            f"- Concept: {concept.label} | IRI: {concept.iri} | Category: {concept.category}"
        )

    detail_lines = []
    for detail in details[:3]:
        detail_lines.append(
            f"- Detail: {detail.label} ({detail.iri}) | "
            f"outgoing={', '.join(detail.outgoing_relations[:6]) or 'none'} | "
            f"incoming={', '.join(detail.incoming_relations[:6]) or 'none'}"
        )

    return "\n".join(summary_lines + detail_lines)


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


def _tokenize(value: str) -> list[str]:
    tokens = [token.lower() for token in re.findall(r"[A-Za-z0-9_:-]{3,}", value)]
    return tokens[:5]


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

    assistant_message: dict[str, Any] = {
        "role": "assistant",
        "content": assistant_content,
        "tool_calls": [
            {
                "id": tool_call.call_id,
                "type": "function",
                "function": {
                    "name": tool_call.tool,
                    "arguments": json.dumps({"query": tool_call.query}, ensure_ascii=True),
                },
            }
        ],
    }
    tool_message: dict[str, Any] = {
        "role": "tool",
        "tool_call_id": tool_call.call_id,
        "content": json.dumps(tool_result.model_dump(mode="json"), ensure_ascii=True),
    }
    return assistant_message, tool_message


def _summarize_tool_result(tool_result: CopilotToolResult | None) -> str:
    if tool_result is None:
        return (
            "I could not finalize a model response after tool execution, "
            "but no tool result was available."
        )
    if tool_result.error:
        return f"I ran a read-only SPARQL query, but it failed: {tool_result.error}"

    if tool_result.query_type == "ASK":
        if tool_result.ask_result is None:
            return "I ran a read-only ASK query, but the boolean result was unavailable."
        return (
            "I ran a read-only ASK query and the result is "
            f"{str(tool_result.ask_result).lower()}."
        )

    if tool_result.query_type == "SELECT":
        truncated_suffix = " (truncated)" if tool_result.truncated else ""
        return (
            "I ran a read-only SELECT query and found "
            f"{tool_result.row_count} rows{truncated_suffix}."
        )

    return "I ran a read-only SPARQL query and returned the structured results."
