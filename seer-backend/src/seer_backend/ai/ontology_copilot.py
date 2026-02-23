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
    format_copilot_output_validation_error,
    parse_copilot_structured_output,
)
from seer_backend.ontology.service import OntologyService, UnavailableOntologyService

_SYSTEM_PROMPT = """
You are Seer's ontology copilot.
Return only a single JSON object and no markdown.
Allowed response schemas:
1) direct answer:
{
  "mode": "direct_answer",
  "answer": "string",
  "evidence": [{"concept_iri": "string", "query": "string"}],
  "tool_call": null
}
2) single tool call:
{
  "mode": "tool_call",
  "answer": "string",
  "evidence": [{"concept_iri": "string", "query": "string"}],
  "tool_call": {
    "tool": "sparql_read_only_query",
    "query": "SELECT ... or ASK ..."
  }
}
Rules:
- Tool call count is at most one.
- SPARQL must be read-only SELECT or ASK.
- Do not emit INSERT, DELETE, LOAD, CLEAR, CREATE, DROP, COPY, MOVE, ADD.
- Do not emit FROM, GRAPH, SERVICE, WITH, or USING.
- If context is insufficient, return mode=direct_answer with a concise limitation note.
""".strip()


class CopilotModelRuntime(Protocol):
    """Abstract runtime for model completion in tests and production."""

    async def run_prompt(self, prompt: str) -> str: ...


class OpenAiChatCompletionsRuntime:
    """Executes OpenAI Chat Completions calls and returns raw JSON text."""

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

    async def run_prompt(self, prompt: str) -> str:
        try:
            response = await self._client.chat.completions.create(
                model=self._model,
                messages=[{"role": "user", "content": prompt}],
                temperature=0,
                response_format={"type": "json_object"},
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

        if not response.choices:
            raise OntologyError("OpenAI chat completion returned no choices")

        output_text = response.choices[0].message.content
        if not isinstance(output_text, str) or not output_text.strip():
            raise OntologyError("OpenAI chat completion returned empty content")
        return output_text.strip()


class OntologyCopilotService:
    """Copilot orchestration with model JSON output and read-only tool execution."""

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
        prompt = _build_prompt(
            question=question,
            conversation=conversation or [],
            current_release_id=current.release_id,
            context=context,
        )

        raw_output = await self._model_runtime.run_prompt(prompt)
        model_output = _parse_model_output(raw_output)

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


def _parse_model_output(raw_output: str) -> CopilotStructuredOutput:
    try:
        # Validate raw JSON parse before schema validation for clearer diagnostics.
        json.loads(raw_output)
    except json.JSONDecodeError as exc:
        raise OntologyError(f"Model output is not valid JSON: {exc}") from exc

    try:
        return parse_copilot_structured_output(raw_output)
    except ValidationError as exc:
        details = format_copilot_output_validation_error(exc)
        raise OntologyError(f"Model JSON failed schema validation: {details}") from exc


def _build_prompt(
    question: str,
    conversation: list[CopilotConversationMessage],
    current_release_id: str | None,
    context: str,
) -> str:
    conversation_lines = []
    for message in conversation:
        conversation_lines.append(f"{message.role.upper()}: {message.content}")
    conversation_lines.append(f"USER: {question}")
    full_conversation = "\n".join(conversation_lines)

    release_text = current_release_id or "none"
    return (
        f"{_SYSTEM_PROMPT}\n\n"
        f"Current ontology release: {release_text}\n\n"
        "Conversation context:\n"
        f"{full_conversation}\n\n"
        "Ontology and evidence context:\n"
        f"{context}\n"
    )


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
