"""Read-only ontology copilot service and OpenAI runtime adapter."""

from __future__ import annotations

import asyncio
import json
import re
from typing import Any, Protocol

from openai import APIConnectionError, APIError, APITimeoutError, AsyncOpenAI
from pydantic import ValidationError

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

_SYSTEM_PROMPT = """
You are Seer's ontology copilot.
Rules:
- Use the available tool only for read-only SPARQL SELECT or ASK queries.
- Never propose or execute mutating SPARQL.
- Keep answers concise and grounded in ontology context.
- If context is insufficient, clearly state the limitation.
""".strip()

_SPARQL_READ_ONLY_TOOL_SCHEMA = {
    "type": "function",
    "function": {
        "name": "sparql_read_only_query",
        "description": (
            "Run a read-only SPARQL query against ontology data. "
            "Only SELECT or ASK queries are allowed."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Read-only SPARQL query text (SELECT or ASK only).",
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
        messages: list[dict[str, str]],
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
        messages: list[dict[str, str]],
    ) -> CopilotStructuredOutput:
        try:
            response = await self._client.chat.completions.create(
                model=self._model,
                messages=messages,
                stream=False,
                temperature=0,
                tools=[_SPARQL_READ_ONLY_TOOL_SCHEMA],
                tool_choice="auto",
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
    ) -> None:
        self._ontology_service = ontology_service
        self._model_runtime = model_runtime
        self._query_row_limit = query_row_limit

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
        )

        model_output = await self._model_runtime.run_messages(messages)

        tool_result: CopilotToolResult | None = None
        if model_output.mode == "tool_call" and model_output.tool_call is not None:
            tool_result = await self._execute_tool_call(model_output.tool_call)

        return CopilotChatResponse(
            mode=model_output.mode,
            answer=model_output.answer,
            evidence=model_output.evidence,
            current_release_id=current.release_id,
            tool_call=model_output.tool_call,
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
    text = payload.strip()
    if not text:
        return _direct_answer_output("")

    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        return _direct_answer_output(text)

    if isinstance(parsed, dict) and isinstance(parsed.get("choices"), list):
        choices = parsed["choices"]
        if choices:
            return _structured_output_from_choice(choices[0])

    if isinstance(parsed, dict):
        try:
            return CopilotStructuredOutput.model_validate(parsed)
        except ValidationError:
            answer = parsed.get("answer")
            if isinstance(answer, str):
                return _direct_answer_output(answer)

    if isinstance(parsed, str):
        return _direct_answer_output(parsed)

    return _direct_answer_output(text)


def _structured_output_from_choice(choice: Any) -> CopilotStructuredOutput:
    message = _extract_choice_message(choice)
    content = _extract_choice_message_content(choice).strip()

    query = _extract_tool_call_query_from_message(message)
    if query is not None:
        return CopilotStructuredOutput(
            mode="tool_call",
            answer=content or "Running read-only SPARQL query for ontology evidence.",
            evidence=[],
            tool_call=CopilotToolCall(tool="sparql_read_only_query", query=query),
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


def _extract_tool_call_query_from_message(message: Any) -> str | None:
    if message is None:
        return None

    tool_calls = getattr(message, "tool_calls", None)
    if tool_calls is None and isinstance(message, dict):
        tool_calls = message.get("tool_calls")
    if not isinstance(tool_calls, list) or not tool_calls:
        return None

    first_tool = tool_calls[0]
    function_payload = getattr(first_tool, "function", None)
    if function_payload is None and isinstance(first_tool, dict):
        function_payload = first_tool.get("function")
    if function_payload is None:
        return None

    function_name = getattr(function_payload, "name", None)
    if function_name is None and isinstance(function_payload, dict):
        function_name = function_payload.get("name")
    if function_name != "sparql_read_only_query":
        return None

    arguments: Any = getattr(function_payload, "arguments", None)
    if arguments is None and isinstance(function_payload, dict):
        arguments = function_payload.get("arguments")

    return _extract_tool_query_from_arguments(arguments)


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
) -> list[dict[str, str]]:
    release_text = current_release_id or "none"
    messages: list[dict[str, str]] = [
        {"role": "system", "content": _SYSTEM_PROMPT},
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
