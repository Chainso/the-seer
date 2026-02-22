from __future__ import annotations

import asyncio
import json
from asyncio.subprocess import PIPE
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

pytest.importorskip("rdflib")
pytest.importorskip("pyshacl")

from seer_backend.ai.ontology_copilot import (
    GeminiCliRuntime,
    GeminiCliSubprocessRuntime,
    OntologyCopilotService,
)
from seer_backend.api.ontology import build_ontology_services
from seer_backend.config.settings import Settings
from seer_backend.main import create_app
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


class FakeGeminiRuntime(GeminiCliRuntime):
    def __init__(self, output_text: str) -> None:
        self.output_text = output_text
        self.prompts: list[str] = []

    async def run_prompt(self, prompt: str) -> str:
        self.prompts.append(prompt)
        return self.output_text


def build_client(gemini_output_text: str) -> TestClient:
    settings = Settings(prophet_metamodel_path=str(PROPHET_METAMODEL))
    app = create_app(settings=settings)

    repository = InMemoryOntologyRepository()
    validator = ShaclValidator(str(PROPHET_METAMODEL))
    ontology_service = OntologyService(repository=repository, validator=validator)
    gemini_runtime = FakeGeminiRuntime(gemini_output_text)
    app.state.ontology_service = ontology_service
    app.state.ontology_copilot_service = OntologyCopilotService(
        ontology_service=ontology_service,
        gemini_runtime=gemini_runtime,
        query_row_limit=5,
    )
    return TestClient(app)


@pytest.fixture
def client() -> TestClient:
    output = json.dumps(
        {
            "mode": "direct_answer",
            "answer": "Ticket is an object model in the ontology.",
            "evidence": [
                {
                    "concept_iri": "http://prophet.platform/local/support_local#Ticket",
                    "query": "tool:list_concepts",
                }
            ],
            "tool_call": None,
        }
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


def test_gemini_subprocess_runtime_uses_headless_json_contract(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict[str, object] = {}

    class FakeProcess:
        returncode = 0

        async def communicate(self) -> tuple[bytes, bytes]:
            return b'{"mode":"direct_answer"}', b""

    async def fake_create_subprocess_exec(*args: object, **kwargs: object) -> FakeProcess:
        captured["args"] = args
        captured["kwargs"] = kwargs
        return FakeProcess()

    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_create_subprocess_exec)

    runtime = GeminiCliSubprocessRuntime(command="gemini", timeout_seconds=12.0)
    output = asyncio.run(runtime.run_prompt("Explain Ticket"))

    assert output == '{"mode":"direct_answer"}'
    assert captured["args"] == (
        "gemini",
        "-p",
        "Explain Ticket",
        "--output-format",
        "json",
    )
    kwargs = captured["kwargs"]
    assert isinstance(kwargs, dict)
    assert kwargs["stdout"] is PIPE
    assert kwargs["stderr"] is PIPE


def test_build_services_keeps_ontology_available_when_gemini_missing() -> None:
    settings = Settings(
        prophet_metamodel_path=str(PROPHET_METAMODEL),
        gemini_cli_bin="missing-gemini-cli",
    )
    ontology_service, _ = build_ontology_services(settings)
    assert not isinstance(ontology_service, UnavailableOntologyService)


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


def test_copilot_executes_tool_call_and_returns_structured_rows() -> None:
    gemini_output = json.dumps(
        {
            "mode": "tool_call",
            "answer": "I need a read-only query to confirm the ontology description.",
            "evidence": [
                {
                    "concept_iri": "http://prophet.platform/local/support_local#ont_support_local",
                    "query": "tool:gemini-tool-call",
                }
            ],
            "tool_call": {
                "tool": "sparql_read_only_query",
                "query": (
                    "PREFIX prophet: <http://prophet.platform/ontology#>\n"
                    "SELECT ?description\n"
                    "WHERE {\n"
                    "  <http://prophet.platform/local/support_local#ont_support_local> "
                    "prophet:description ?description .\n"
                    "}"
                ),
            },
        }
    )
    client = build_client(gemini_output)
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
    assert body["mode"] == "tool_call"
    assert body["tool_call"]["tool"] == "sparql_read_only_query"
    assert body["tool_result"]["query_type"] == "SELECT"
    assert body["tool_result"]["variables"] == ["description"]
    assert body["tool_result"]["row_count"] >= 1
    assert body["tool_result"]["truncated"] is False
    assert body["tool_result"]["error"] is None
    assert body["tool_result"]["rows"][0]["description"]


def test_copilot_rejects_unsafe_tool_call_query() -> None:
    gemini_output = json.dumps(
        {
            "mode": "tool_call",
            "answer": "Attempting a tool call.",
            "evidence": [],
            "tool_call": {
                "tool": "sparql_read_only_query",
                "query": 'INSERT DATA { <urn:test:s> <urn:test:p> "x" . }',
            },
        }
    )
    client = build_client(gemini_output)
    _ingest_success(client, release_id="phase1-copilot-unsafe")

    response = client.post(
        "/api/v1/ontology/copilot",
        json={"question": "Do something unsafe", "conversation": []},
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["mode"] == "tool_call"
    assert body["tool_result"]["query_type"] is None
    assert body["tool_result"]["row_count"] == 0
    assert body["tool_result"]["error"] is not None
    assert "not allowed" in body["tool_result"]["error"].lower()


def test_copilot_returns_502_on_non_json_cli_output() -> None:
    client = build_client("this is not json")
    _ingest_success(client, release_id="phase1-copilot-invalid-json")

    response = client.post(
        "/api/v1/ontology/copilot",
        json={"question": "What is Ticket?", "conversation": []},
    )

    assert response.status_code == 502
    assert "not valid json" in response.json()["detail"].lower()


def test_copilot_returns_502_on_schema_invalid_cli_output() -> None:
    client = build_client(
        json.dumps(
            {
                "mode": "tool_call",
                "answer": "Tool call missing payload.",
                "evidence": [],
                "tool_call": None,
            }
        )
    )
    _ingest_success(client, release_id="phase1-copilot-invalid-schema")

    response = client.post(
        "/api/v1/ontology/copilot",
        json={"question": "What is Ticket?", "conversation": []},
    )

    assert response.status_code == 502
    assert "schema validation" in response.json()["detail"].lower()
