from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient
from openai import APIError

import seer_backend.ai.ontology_copilot as ontology_copilot

pytest.importorskip("rdflib")
pytest.importorskip("pyshacl")

from seer_backend.ai.ontology_copilot import (
    CopilotModelRuntime,
    OntologyCopilotService,
    OpenAiChatCompletionsRuntime,
)
from seer_backend.ai.skills import AssistantSkillCollisionError, AssistantSkillRegistry
from seer_backend.api.ontology import build_ontology_services
from seer_backend.config.settings import Settings
from seer_backend.main import create_app
from seer_backend.ontology.errors import OntologyDependencyUnavailableError, OntologyError
from seer_backend.ontology.models import CopilotStructuredOutput, CopilotToolCall
from seer_backend.ontology.repository import InMemoryOntologyRepository
from seer_backend.ontology.service import OntologyService, UnavailableOntologyService
from seer_backend.ontology.validation import ShaclValidator

REPO_ROOT = Path(__file__).resolve().parents[2]
VALID_FIXTURE = (
    REPO_ROOT
    / "prophet"
    / "examples"
    / "turtle"
    / "prophet_example_turtle_minimal"
    / "gen"
    / "turtle"
    / "ontology.ttl"
)
INVALID_FIXTURE = Path(__file__).resolve().parent / "fixtures" / "ontology_invalid_missing_name.ttl"
PROPHET_METAMODEL = REPO_ROOT / "prophet" / "prophet.ttl"


class FakeModelRuntime(CopilotModelRuntime):
    def __init__(self, output: CopilotStructuredOutput) -> None:
        self.output = output
        self.messages: list[list[dict[str, Any]]] = []
        self.tools: list[list[dict[str, Any]] | None] = []

    async def run_messages(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
    ) -> CopilotStructuredOutput:
        self.messages.append(messages)
        self.tools.append(tools)
        return self.output


def _build_client_with_runtime(model_runtime: CopilotModelRuntime) -> TestClient:
    settings = Settings(prophet_metamodel_path=str(PROPHET_METAMODEL))
    app = create_app(settings=settings)

    repository = InMemoryOntologyRepository()
    validator = ShaclValidator(str(PROPHET_METAMODEL))
    ontology_service = OntologyService(repository=repository, validator=validator)
    app.state.ontology_service = ontology_service
    app.state.ontology_copilot_service = OntologyCopilotService(
        ontology_service=ontology_service,
        model_runtime=model_runtime,
        query_row_limit=5,
        base_ontology_turtle=PROPHET_METAMODEL.read_text(encoding="utf-8"),
    )
    return TestClient(app)


def build_client(model_output: CopilotStructuredOutput) -> TestClient:
    return _build_client_with_runtime(FakeModelRuntime(model_output))


@pytest.fixture
def client() -> TestClient:
    output = CopilotStructuredOutput(
        mode="direct_answer",
        answer="Ticket is an object model in the ontology.",
        evidence=[
            {
                "concept_iri": "http://prophet.platform/local/support_local#Ticket",
                "query": "tool:list_concepts",
            }
        ],
        tool_call=None,
    )
    return build_client(output)


def _valid_turtle() -> str:
    return VALID_FIXTURE.read_text(encoding="utf-8")


def _invalid_turtle() -> str:
    return INVALID_FIXTURE.read_text(encoding="utf-8")


def _ingest_success(client: TestClient, release_id: str) -> None:
    response = client.post(
        "/api/v1/ontology/ingest",
        json={"release_id": release_id, "turtle": _valid_turtle()},
    )
    assert response.status_code == 200, response.text


def test_openai_runtime_uses_chat_completions_json_contract() -> None:
    captured: dict[str, object] = {}

    class FakeCompletions:
        async def create(self, **kwargs: object) -> object:
            captured["kwargs"] = kwargs
            return type(
                "FakeResponse",
                (),
                {
                    "choices": [
                        type(
                            "FakeChoice",
                            (),
                            {
                                "message": type(
                                    "FakeMessage",
                                    (),
                                    {"content": "Ticket is an object model in the ontology."},
                                )()
                            },
                        )()
                    ]
                },
            )()

    class FakeClient:
        chat = type("FakeChat", (), {"completions": FakeCompletions()})()

    runtime = OpenAiChatCompletionsRuntime(
        base_url="http://localhost:8787/v1",
        model="local-model",
        api_key="test-key",
        timeout_seconds=12.0,
        client=FakeClient(),
    )
    output = asyncio.run(
        runtime.run_messages([{"role": "user", "content": "Explain Ticket"}])
    )

    assert output.mode == "direct_answer"
    assert output.answer == "Ticket is an object model in the ontology."
    assert output.tool_call is None
    kwargs = captured["kwargs"]
    assert isinstance(kwargs, dict)
    assert kwargs["model"] == "local-model"
    assert kwargs["temperature"] == 0
    assert kwargs["stream"] is False
    assert kwargs["tool_choice"] == "auto"
    assert kwargs["parallel_tool_calls"] is True
    assert isinstance(kwargs["tools"], list)
    assert {tool["function"]["name"] for tool in kwargs["tools"]} == {
        "sparql_read_only_query",
        "load_skill",
    }
    assert kwargs["messages"] == [{"role": "user", "content": "Explain Ticket"}]


def test_openai_runtime_accepts_full_chat_completions_endpoint(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict[str, object] = {}

    class FakeAsyncOpenAI:
        def __init__(self, *, base_url: str, api_key: str, timeout: float) -> None:
            captured["base_url"] = base_url
            captured["api_key"] = api_key
            captured["timeout"] = timeout
            self.chat = type("FakeChat", (), {"completions": object()})()

    monkeypatch.setattr(ontology_copilot, "AsyncOpenAI", FakeAsyncOpenAI)

    OpenAiChatCompletionsRuntime(
        base_url="https://opencode.ai/zen/v1/chat/completions",
        model="local-model",
        api_key="test-key",
        timeout_seconds=12.0,
    )

    assert captured == {
        "base_url": "https://opencode.ai/zen/v1",
        "api_key": "test-key",
        "timeout": 12.0,
    }


def test_openai_runtime_supports_native_tool_call_response() -> None:
    class FakeCompletions:
        async def create(self, **kwargs: object) -> object:
            del kwargs
            return {
                "choices": [
                    {
                        "message": {
                            "content": "",
                            "tool_calls": [
                                {
                                    "id": "call_1",
                                    "thought_signature": "sig_123",
                                    "function": {
                                        "name": "sparql_read_only_query",
                                        "arguments": json.dumps(
                                            {"query": "SELECT ?s WHERE { ?s ?p ?o }"}
                                        ),
                                    }
                                }
                            ],
                        }
                    }
                ]
            }

    class FakeClient:
        chat = type("FakeChat", (), {"completions": FakeCompletions()})()

    runtime = OpenAiChatCompletionsRuntime(
        base_url="http://localhost:8787/v1",
        model="local-model",
        api_key="test-key",
        timeout_seconds=12.0,
        client=FakeClient(),
    )
    output = asyncio.run(
        runtime.run_messages([{"role": "user", "content": "Explain Ticket"}])
    )
    assert output.mode == "tool_call"
    assert output.tool_call is not None
    assert output.tool_call.tool == "sparql_read_only_query"
    assert output.tool_call.query == "SELECT ?s WHERE { ?s ?p ?o }"
    assert output.tool_call.call_id == "call_1"
    assert output.tool_call.raw_tool_call is not None
    assert output.tool_call.raw_tool_call["thought_signature"] == "sig_123"


def test_openai_runtime_collects_multiple_tool_calls() -> None:
    class FakeCompletions:
        async def create(self, **kwargs: object) -> object:
            del kwargs
            return {
                "choices": [
                    {
                        "message": {
                            "content": "",
                            "tool_calls": [
                                {
                                    "id": "call_1",
                                    "function": {
                                        "name": "sparql_read_only_query",
                                        "arguments": json.dumps(
                                            {"query": "ASK WHERE { ?s ?p ?o }"}
                                        ),
                                    },
                                },
                                {
                                    "id": "call_2",
                                    "function": {
                                        "name": "sparql_read_only_query",
                                        "arguments": json.dumps(
                                            {"query": "SELECT ?s WHERE { ?s ?p ?o } LIMIT 5"}
                                        ),
                                    },
                                },
                            ],
                        }
                    }
                ]
            }

    class FakeClient:
        chat = type("FakeChat", (), {"completions": FakeCompletions()})()

    runtime = OpenAiChatCompletionsRuntime(
        base_url="http://localhost:8787/v1",
        model="local-model",
        api_key="test-key",
        timeout_seconds=12.0,
        client=FakeClient(),
    )
    output = asyncio.run(
        runtime.run_messages([{"role": "user", "content": "Explain Ticket"}])
    )
    assert output.mode == "tool_call"
    assert output.tool_call is not None
    assert output.tool_call.call_id == "call_1"
    assert len(output.tool_calls) == 2
    assert output.tool_calls[1].call_id == "call_2"


def test_openai_runtime_supports_load_skill_tool_call_response() -> None:
    class FakeCompletions:
        async def create(self, **kwargs: object) -> object:
            del kwargs
            return {
                "choices": [
                    {
                        "message": {
                            "content": "",
                            "tool_calls": [
                                {
                                    "id": "call_skill_1",
                                    "function": {
                                        "name": "load_skill",
                                        "arguments": json.dumps(
                                            {"skill_name": "process-mining"}
                                        ),
                                    },
                                }
                            ],
                        }
                    }
                ]
            }

    class FakeClient:
        chat = type("FakeChat", (), {"completions": FakeCompletions()})()

    runtime = OpenAiChatCompletionsRuntime(
        base_url="http://localhost:8787/v1",
        model="local-model",
        api_key="test-key",
        timeout_seconds=12.0,
        client=FakeClient(),
    )
    output = asyncio.run(
        runtime.run_messages([{"role": "user", "content": "Analyze delayed orders"}])
    )

    assert output.mode == "tool_call"
    assert output.tool_call is not None
    assert output.tool_call.tool == "load_skill"
    assert output.tool_call.skill_name == "process-mining"
    assert output.tool_call.call_id == "call_skill_1"


def test_skill_registry_discovers_allowed_tools_and_detects_collisions(
    tmp_path: Path,
) -> None:
    skill_root_a = tmp_path / "skills-a"
    skill_root_b = tmp_path / "skills-b"
    skill_root_a.mkdir()
    skill_root_b.mkdir()

    (skill_root_a / "process-mining").mkdir()
    (skill_root_a / "process-mining" / "SKILL.md").write_text(
        "\n".join(
            [
                "---",
                "name: process-mining",
                "description: Mine OC-DFGs when the user asks to inspect process flow.",
                "allowed-tools: process.mine process.traces",
                "---",
                "",
                "# Process Mining",
                "",
                "Use this skill for process investigations.",
            ]
        ),
        encoding="utf-8",
    )

    registry = AssistantSkillRegistry([str(skill_root_a)])
    discovered = registry.discover()
    assert discovered["process-mining"].allowed_tools == (
        "process.mine",
        "process.traces",
    )

    (skill_root_b / "process-mining").mkdir()
    (skill_root_b / "process-mining" / "SKILL.md").write_text(
        "\n".join(
            [
                "---",
                "name: process-mining",
                "description: Duplicate collision fixture.",
                "---",
                "",
                "# Duplicate",
            ]
        ),
        encoding="utf-8",
    )

    with pytest.raises(AssistantSkillCollisionError):
        AssistantSkillRegistry([str(skill_root_a), str(skill_root_b)]).discover()


def test_openai_runtime_normalizes_long_provider_tool_call_ids() -> None:
    long_id = "call_abc123__sig__" + ("x" * 4096)

    class FakeCompletions:
        async def create(self, **kwargs: object) -> object:
            del kwargs
            return {
                "choices": [
                    {
                        "message": {
                            "content": "",
                            "tool_calls": [
                                {
                                    "id": long_id,
                                    "function": {
                                        "name": "sparql_read_only_query",
                                        "arguments": json.dumps(
                                            {"query": "ASK WHERE { ?s ?p ?o }"}
                                        ),
                                    },
                                }
                            ],
                        }
                    }
                ]
            }

    class FakeClient:
        chat = type("FakeChat", (), {"completions": FakeCompletions()})()

    runtime = OpenAiChatCompletionsRuntime(
        base_url="http://localhost:8787/v1",
        model="local-model",
        api_key="test-key",
        timeout_seconds=12.0,
        client=FakeClient(),
    )
    output = asyncio.run(
        runtime.run_messages([{"role": "user", "content": "Explain Ticket"}])
    )

    assert output.mode == "tool_call"
    assert output.tool_call is not None
    assert output.tool_call.call_id is not None
    assert len(output.tool_call.call_id) <= 120
    assert "__sig__" not in output.tool_call.call_id
    assert output.tool_call.call_id.startswith("call_")


def test_openai_runtime_retries_transient_input_stream_error() -> None:
    class FakeCompletions:
        def __init__(self) -> None:
            self.calls = 0

        async def create(self, **kwargs: object) -> object:
            del kwargs
            self.calls += 1
            if self.calls == 1:
                raise APIError(
                    "Error in input stream",
                    request=httpx.Request("POST", "http://localhost:8787/v1/chat/completions"),
                    body=None,
                )
            return {
                "choices": [
                    {
                        "message": {
                            "content": "Recovered answer after transient stream parsing failure."
                        }
                    }
                ]
            }

    completions = FakeCompletions()

    class FakeClient:
        chat = type("FakeChat", (), {"completions": completions})()

    runtime = OpenAiChatCompletionsRuntime(
        base_url="http://localhost:8787/v1",
        model="local-model",
        api_key="test-key",
        timeout_seconds=12.0,
        client=FakeClient(),
    )
    output = asyncio.run(
        runtime.run_messages([{"role": "user", "content": "Explain Ticket"}])
    )

    assert output.mode == "direct_answer"
    assert output.answer == "Recovered answer after transient stream parsing failure."
    assert completions.calls == 2


def test_openai_runtime_raises_after_transient_retry_exhausted() -> None:
    class FakeCompletions:
        def __init__(self) -> None:
            self.calls = 0

        async def create(self, **kwargs: object) -> object:
            del kwargs
            self.calls += 1
            raise APIError(
                "Error in input stream",
                request=httpx.Request("POST", "http://localhost:8787/v1/chat/completions"),
                body=None,
            )

    completions = FakeCompletions()

    class FakeClient:
        chat = type("FakeChat", (), {"completions": completions})()

    runtime = OpenAiChatCompletionsRuntime(
        base_url="http://localhost:8787/v1",
        model="local-model",
        api_key="test-key",
        timeout_seconds=12.0,
        client=FakeClient(),
    )

    with pytest.raises(OntologyError, match="OpenAI chat completion failed: Error in input stream"):
        asyncio.run(runtime.run_messages([{"role": "user", "content": "Explain Ticket"}]))

    assert completions.calls == 2


def test_copilot_preserves_provider_tool_call_fields_in_completion_messages_delta() -> None:
    class ToolThenAnswerRuntime(CopilotModelRuntime):
        def __init__(self) -> None:
            self.calls = 0

        async def run_messages(
            self,
            messages: list[dict[str, Any]],
            tools: list[dict[str, Any]] | None = None,
        ) -> CopilotStructuredOutput:
            del messages, tools
            self.calls += 1
            if self.calls == 1:
                return CopilotStructuredOutput(
                    mode="tool_call",
                    answer="Checking ontology evidence.",
                    evidence=[],
                    tool_call=CopilotToolCall(
                        tool="sparql_read_only_query",
                        query="ASK WHERE { ?s ?p ?o }",
                        call_id="call_1",
                        raw_tool_call={
                            "id": "call_1",
                            "type": "function",
                            "thought_signature": "sig_abc123",
                            "function": {
                                "name": "sparql_read_only_query",
                                "arguments": json.dumps(
                                    {"query": "ASK WHERE { ?s ?p ?o }"},
                                    ensure_ascii=True,
                                ),
                            },
                        },
                    ),
                    tool_calls=[
                        CopilotToolCall(
                            tool="sparql_read_only_query",
                            query="ASK WHERE { ?s ?p ?o }",
                            call_id="call_1",
                            raw_tool_call={
                                "id": "call_1",
                                "type": "function",
                                "thought_signature": "sig_abc123",
                                "function": {
                                    "name": "sparql_read_only_query",
                                    "arguments": json.dumps(
                                        {"query": "ASK WHERE { ?s ?p ?o }"},
                                        ensure_ascii=True,
                                    ),
                                },
                            },
                        )
                    ],
                )
            return CopilotStructuredOutput(
                mode="direct_answer",
                answer="Ticket exists in the ontology.",
                evidence=[],
                tool_call=None,
            )

    client = _build_client_with_runtime(ToolThenAnswerRuntime())
    _ingest_success(client, release_id="phase1-preserve-provider-tool-fields")

    response = client.post(
        "/api/v1/ontology/copilot",
        json={"question": "What is Ticket?", "conversation": []},
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["answer"] == "Ticket exists in the ontology."
    assistant_tool_call = body["completion_messages_delta"][0]["tool_calls"][0]
    assert assistant_tool_call["thought_signature"] == "sig_abc123"
    assert assistant_tool_call["function"]["name"] == "sparql_read_only_query"


def test_build_services_keeps_ontology_available_when_openai_unconfigured() -> None:
    settings = Settings(
        prophet_metamodel_path=str(PROPHET_METAMODEL),
        openai_base_url="",
        openai_model="",
    )
    ontology_service, _ = build_ontology_services(settings)
    assert not isinstance(ontology_service, UnavailableOntologyService)


def test_copilot_returns_503_when_model_runtime_is_unavailable() -> None:
    class UnavailableRuntime(CopilotModelRuntime):
        async def run_messages(
            self,
            messages: list[dict[str, Any]],
            tools: list[dict[str, Any]] | None = None,
        ) -> CopilotStructuredOutput:
            del messages, tools
            raise OntologyDependencyUnavailableError("OpenAI endpoint is unavailable")

    client = _build_client_with_runtime(UnavailableRuntime())
    _ingest_success(client, release_id="phase1-copilot-runtime-unavailable")

    response = client.post(
        "/api/v1/ontology/copilot",
        json={"question": "What is Ticket?", "conversation": []},
    )

    assert response.status_code == 503
    assert "unavailable" in response.json()["detail"].lower()


def test_copilot_builds_system_and_conversation_messages() -> None:
    runtime = FakeModelRuntime(
        CopilotStructuredOutput(
            mode="direct_answer",
            answer="ok",
            evidence=[],
            tool_call=None,
        )
    )
    client = _build_client_with_runtime(runtime)
    _ingest_success(client, release_id="phase1-message-roles")

    response = client.post(
        "/api/v1/ontology/copilot",
        json={
            "question": "What is Ticket?",
            "conversation": [
                {"role": "user", "content": "First question"},
                {"role": "assistant", "content": "First answer"},
            ],
        },
    )

    assert response.status_code == 200
    assert runtime.messages
    latest = runtime.messages[-1]
    assert latest[0]["role"] == "system"
    assert "http://prophet.platform/ontology#" in latest[0]["content"]
    assert latest[1]["role"] == "system"
    assert "Workflow for each turn" in latest[1]["content"]
    assert latest[2]["role"] == "system"
    assert latest[3]["role"] == "system"
    assert "# Prefixes / Local Ontologies" in latest[3]["content"]
    assert "# Concepts" in latest[3]["content"]
    assert "support_local" in latest[3]["content"]
    assert "Support Local" in latest[3]["content"]
    assert latest[4]["role"] == "system"
    assert "Available assistant skills:" in latest[4]["content"]
    assert latest[5] == {"role": "user", "content": "First question"}
    assert latest[6] == {"role": "assistant", "content": "First answer"}
    assert latest[7] == {"role": "user", "content": "What is Ticket?"}


def test_valid_ingest_sets_current_release_pointer(client: TestClient) -> None:
    response = client.post(
        "/api/v1/ontology/ingest",
        json={"release_id": "phase1-valid", "turtle": _valid_turtle()},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["validation_status"] == "passed"
    assert body["release_graph_iri"] == "urn:seer:ontology:release:phase1-valid"
    assert body["current_graph_iri"] == "urn:seer:ontology:release:phase1-valid"

    current = client.get("/api/v1/ontology/current")
    assert current.status_code == 200
    current_body = current.json()
    assert current_body["release_id"] == "phase1-valid"
    assert current_body["current_graph_iri"] == "urn:seer:ontology:release:phase1-valid"


def test_ontology_routes_handle_cors_preflight(client: TestClient) -> None:
    headers = {
        "Origin": "http://localhost:3000",
        "Access-Control-Request-Method": "GET",
    }
    current = client.options("/api/v1/ontology/current", headers=headers)
    concepts = client.options("/api/v1/ontology/concepts", headers=headers)

    assert current.status_code == 200
    assert concepts.status_code == 200
    assert current.headers.get("access-control-allow-origin") == "http://localhost:3000"
    assert concepts.headers.get("access-control-allow-origin") == "http://localhost:3000"


def test_concepts_endpoint_returns_user_graph_nodes_only(client: TestClient) -> None:
    _ingest_success(client, release_id="phase1-concepts-filter")

    response = client.get("/api/v1/ontology/concepts", params={"search": "", "limit": 200})
    assert response.status_code == 200, response.text
    concepts = response.json()
    assert concepts

    allowed_categories = {
        "ObjectModel",
        "Action",
        "Process",
        "Workflow",
        "Event",
        "Signal",
        "Transition",
        "EventTrigger",
    }
    assert all(concept["category"] in allowed_categories for concept in concepts)
    assert all(
        not concept["iri"].startswith("http://prophet.platform/ontology#")
        for concept in concepts
    )
    assert all(
        not concept["iri"].startswith("http://prophet.platform/standard-types#")
        for concept in concepts
    )
    assert any(concept["iri"].startswith("http://prophet.platform/local/") for concept in concepts)


def test_invalid_ingest_returns_shacl_diagnostics(client: TestClient) -> None:
    response = client.post(
        "/api/v1/ontology/ingest",
        json={"release_id": "phase1-invalid", "turtle": _invalid_turtle()},
    )

    assert response.status_code == 422
    body = response.json()
    assert body["validation_status"] == "failed"
    assert body["release_graph_iri"] == "urn:seer:ontology:release:phase1-invalid"
    assert any("prophet:name" in diagnostic["message"] for diagnostic in body["diagnostics"])


def test_reingest_same_release_replaces_graph_deterministically(client: TestClient) -> None:
    release_id = "phase1-reingest"
    original_turtle = _valid_turtle()
    updated_description = "Updated support ontology description from deterministic re-ingest."
    updated_turtle = original_turtle.replace(
        "Minimal support ontology used for Turtle target examples.",
        updated_description,
    )

    first = client.post(
        "/api/v1/ontology/ingest",
        json={"release_id": release_id, "turtle": original_turtle},
    )
    assert first.status_code == 200

    second = client.post(
        "/api/v1/ontology/ingest",
        json={"release_id": release_id, "turtle": updated_turtle},
    )
    assert second.status_code == 200
    assert second.json()["release_graph_iri"] == f"urn:seer:ontology:release:{release_id}"

    query = """
PREFIX prophet: <http://prophet.platform/ontology#>
SELECT ?description
WHERE {
  <http://prophet.platform/local/support_local#ont_support_local> prophet:description ?description .
}
""".strip()
    query_response = client.post("/api/v1/ontology/query", json={"query": query})

    assert query_response.status_code == 200
    bindings = query_response.json()["bindings"]
    assert len(bindings) == 1
    assert bindings[0]["description"] == updated_description


def test_query_endpoint_enforces_read_only_mode(client: TestClient) -> None:
    _ingest_success(client, release_id="phase1-read-only")

    mutation_query = """
INSERT DATA {
  <urn:test:s> <urn:test:p> "x" .
}
""".strip()
    response = client.post("/api/v1/ontology/query", json={"query": mutation_query})

    assert response.status_code == 400
    assert "not allowed" in response.json()["detail"].lower()


def test_query_endpoint_allows_dataset_keyword_in_variable_name(client: TestClient) -> None:
    _ingest_success(client, release_id="phase1-read-only-variable-name")

    query = """
PREFIX prophet: <http://prophet.platform/ontology#>
SELECT ?from
WHERE {
  <http://prophet.platform/local/support_local#ont_support_local> prophet:description ?from .
}
""".strip()
    response = client.post("/api/v1/ontology/query", json={"query": query})

    assert response.status_code == 200, response.text
    bindings = response.json()["bindings"]
    assert len(bindings) >= 1
    assert "from" in bindings[0]


def test_graph_endpoint_returns_current_release_named_graph_only(client: TestClient) -> None:
    release_id = "phase1-graph-only-current-release"
    _ingest_success(client, release_id=release_id)

    response = client.get("/api/v1/ontology/graph")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["release_id"] == release_id
    assert body["graph_iri"] == f"urn:seer:ontology:release:{release_id}"
    assert len(body["nodes"]) > 0

    node_iris = [node["iri"] for node in body["nodes"]]
    assert all(not iri.startswith("http://prophet.platform/ontology#") for iri in node_iris)
    assert all(not iri.startswith("http://prophet.platform/standard-types#") for iri in node_iris)
    assert all(not iri.startswith("http://www.w3.org/") for iri in node_iris)


def test_copilot_executes_tool_call_and_returns_structured_rows() -> None:
    model_output = CopilotStructuredOutput(
        mode="tool_call",
        answer="I need a read-only query to confirm the ontology description.",
        evidence=[
            {
                "concept_iri": "http://prophet.platform/local/support_local#ont_support_local",
                "query": "tool:model-tool-call",
            }
        ],
        tool_call=CopilotToolCall(
            tool="sparql_read_only_query",
            query=(
                "PREFIX prophet: <http://prophet.platform/ontology#>\n"
                "SELECT ?description\n"
                "WHERE {\n"
                "  <http://prophet.platform/local/support_local#ont_support_local> "
                "prophet:description ?description .\n"
                "}"
            ),
        ),
    )
    client = build_client(model_output)
    _ingest_success(client, release_id="phase1-copilot-tool")

    response = client.post(
        "/api/v1/ontology/copilot",
        json={
            "question": "What describes support ontology?",
            "conversation": [{"role": "user", "content": "Tell me about support ontology."}],
        },
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["mode"] == "direct_answer"
    assert body["answer"].startswith("I ran a read-only SELECT query")
    assert body["tool_call"]["tool"] == "sparql_read_only_query"
    assert body["tool_result"]["query_type"] == "SELECT"
    assert body["tool_result"]["variables"] == ["description"]
    assert body["tool_result"]["row_count"] >= 1
    assert body["tool_result"]["truncated"] is False
    assert body["tool_result"]["error"] is None
    assert body["tool_result"]["rows"][0]["description"]


def test_copilot_injects_missing_standard_prefixes_for_tool_query() -> None:
    model_output = CopilotStructuredOutput(
        mode="tool_call",
        answer="I need a read-only query to confirm labels.",
        evidence=[],
        tool_call=CopilotToolCall(
            tool="sparql_read_only_query",
            query=(
                "PREFIX prophet: <http://prophet.platform/ontology#>\n"
                "SELECT ?concept ?label\n"
                "WHERE {\n"
                "  ?concept a prophet:ObjectModel .\n"
                "  OPTIONAL { ?concept rdfs:label ?label . }\n"
                "}\n"
                "LIMIT 5"
            ),
        ),
    )
    client = build_client(model_output)
    _ingest_success(client, release_id="phase1-copilot-prefix-inject")

    response = client.post(
        "/api/v1/ontology/copilot",
        json={"question": "List object model labels", "conversation": []},
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["mode"] == "direct_answer"
    assert body["tool_result"]["error"] is None
    assert body["tool_result"]["query_type"] == "SELECT"
    assert (
        "PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>"
        in body["tool_result"]["query"]
    )


def test_copilot_rejects_unsafe_tool_call_query() -> None:
    model_output = CopilotStructuredOutput(
        mode="tool_call",
        answer="Attempting a tool call.",
        evidence=[],
        tool_call=CopilotToolCall(
            tool="sparql_read_only_query",
            query='INSERT DATA { <urn:test:s> <urn:test:p> "x" . }',
        ),
    )
    client = build_client(model_output)
    _ingest_success(client, release_id="phase1-copilot-unsafe")

    response = client.post(
        "/api/v1/ontology/copilot",
        json={"question": "Do something unsafe", "conversation": []},
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["mode"] == "direct_answer"
    assert body["answer"].startswith("I ran a read-only SPARQL query, but it failed:")
    assert body["tool_result"]["query_type"] is None
    assert body["tool_result"]["row_count"] == 0
    assert body["tool_result"]["error"] is not None
    assert "not allowed" in body["tool_result"]["error"].lower()


def test_copilot_returns_502_on_runtime_error() -> None:
    class BrokenRuntime(CopilotModelRuntime):
        async def run_messages(
            self,
            messages: list[dict[str, Any]],
            tools: list[dict[str, Any]] | None = None,
        ) -> CopilotStructuredOutput:
            del messages, tools
            raise OntologyError("runtime parse failed")

    client = _build_client_with_runtime(BrokenRuntime())
    _ingest_success(client, release_id="phase1-copilot-runtime-error")

    response = client.post(
        "/api/v1/ontology/copilot",
        json={"question": "What is Ticket?", "conversation": []},
    )

    assert response.status_code == 502
    assert "runtime parse failed" in response.json()["detail"].lower()
