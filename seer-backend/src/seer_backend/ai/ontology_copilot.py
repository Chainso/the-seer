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
_ONTOLOGY_INDEX_CACHE_KEY_EMPTY_RELEASE = "__none__"

_PROPHET_PREFIX = "prophet"
_STD_PREFIX = "std"
_PROPHET_NAMESPACE = "http://prophet.platform/ontology#"
_STD_NAMESPACE = "http://prophet.platform/standard-types#"
_LOCAL_ONTOLOGY_NAMESPACE_PREFIX = "http://prophet.platform/local/"
_BASE_CONCEPT_IRI_PREFIXES = (
    _PROPHET_NAMESPACE,
    _STD_NAMESPACE,
    "http://www.w3.org/",
)

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
2. Use the ontology index and ontology context messages first.
3. Decide whether a tool query is needed:
- Answer directly when context is already sufficient.
- Use the SPARQL tool when the user asks for exact relationships,
  counts, validation, or when context is ambiguous.
4. If using the tool, produce one high-quality query first and keep it bounded.
5. Return a concise answer that cites what you checked and any limits/uncertainty.

Tool planning and budget:
- Prefer batching independent checks in one round instead of serial loops.
- When tool evidence is needed, prefer 1 round of parallel tool invocation
  for all independent checks.
- Keep tool usage small: usually 1 round, at most 2 unless explicitly asked
  for exhaustive validation.
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
        self._base_ontology_turtle = base_ontology_turtle.strip()
        self._base_ontology_system_prompt = _build_base_ontology_system_prompt(
            base_ontology_turtle
        )
        self._base_prefix_map = _extract_prefix_map(base_ontology_turtle)
        self._ontology_index_cache: dict[str, str] = {}

    async def answer(
        self,
        question: str,
        conversation: list[CopilotConversationMessage] | None = None,
    ) -> CopilotChatResponse:
        current = await self._ontology_service.current()
        context = await self._build_context(question)
        ontology_index_markdown = await self._build_ontology_index_markdown(
            current_release_id=current.release_id
        )
        messages = _build_messages(
            question=question,
            conversation=conversation or [],
            current_release_id=current.release_id,
            context=context,
            base_ontology_system_prompt=self._base_ontology_system_prompt,
            ontology_index_markdown=ontology_index_markdown,
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
    ontology_index_markdown: str,
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
        {"role": "system", "content": ontology_index_markdown},
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


def _extract_prefix_map(turtle: str) -> dict[str, str]:
    prefixes: dict[str, str] = {}
    for alias, iri in _PREFIX_DECLARATION_PATTERN.findall(turtle):
        prefixes[alias] = iri
    return prefixes


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
