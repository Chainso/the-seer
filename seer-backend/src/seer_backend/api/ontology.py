"""Ontology API endpoints."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request, status
from fastapi.responses import JSONResponse

from seer_backend.ai.ontology_copilot import (
    CopilotModelRuntime,
    OntologyCopilotService,
    OpenAiChatCompletionsRuntime,
)
from seer_backend.ai.skills import AssistantSkillRegistry
from seer_backend.api.status_codes import HTTP_422_UNPROCESSABLE_CONTENT
from seer_backend.config.settings import Settings
from seer_backend.ontology.errors import (
    OntologyDependencyUnavailableError,
    OntologyError,
    OntologyNotReadyError,
    OntologyReadOnlyViolationError,
)
from seer_backend.ontology.models import (
    CopilotChatRequest,
    CopilotChatResponse,
    CopilotStructuredOutput,
    OntologyConceptDetail,
    OntologyConceptSummary,
    OntologyCurrentResponse,
    OntologyGraphResponse,
    OntologyIngestRequest,
    OntologyIngestResponse,
    OntologySparqlQueryRequest,
    OntologySparqlQueryResponse,
)
from seer_backend.ontology.service import OntologyService, UnavailableOntologyService

router = APIRouter(prefix="/ontology", tags=["ontology"])


class _UnavailableModelRuntime:
    def __init__(self, reason: str) -> None:
        self.reason = reason

    async def run_messages(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
    ) -> CopilotStructuredOutput:
        del messages, tools
        raise OntologyDependencyUnavailableError(self.reason)


def build_ontology_services(
    settings: Settings,
) -> tuple[OntologyService | UnavailableOntologyService, OntologyCopilotService]:
    skill_registry = AssistantSkillRegistry(settings.assistant_skill_dirs)
    fallback_runtime: CopilotModelRuntime = _UnavailableModelRuntime(
        "Model runtime is unavailable"
    )
    try:
        from seer_backend.ontology.repository import FusekiOntologyRepository
        from seer_backend.ontology.service import OntologyService
        from seer_backend.ontology.validation import ShaclValidator
    except Exception as exc:
        fallback = UnavailableOntologyService(f"ontology dependencies unavailable: {exc}")
        return fallback, OntologyCopilotService(
            fallback,
            model_runtime=fallback_runtime,
            skill_registry=skill_registry,
        )

    try:
        validator = ShaclValidator(settings.prophet_metamodel_path)
        repository = FusekiOntologyRepository(
            host=settings.fuseki_host,
            port=settings.fuseki_port,
            dataset=settings.fuseki_dataset,
            username=settings.fuseki_username,
            password=settings.fuseki_password,
            timeout_seconds=settings.fuseki_timeout_seconds,
        )
        ontology_service = OntologyService(repository=repository, validator=validator)
    except Exception as exc:
        fallback = UnavailableOntologyService(f"ontology service initialization failed: {exc}")
        return fallback, OntologyCopilotService(
            fallback,
            model_runtime=fallback_runtime,
            skill_registry=skill_registry,
        )

    if not settings.openai_base_url.strip():
        fallback_runtime = _UnavailableModelRuntime(
            "OpenAI runtime base URL is not configured"
        )
    elif not settings.openai_model.strip():
        fallback_runtime = _UnavailableModelRuntime(
            "OpenAI runtime model is not configured"
        )
    else:
        fallback_runtime = OpenAiChatCompletionsRuntime(
            base_url=settings.openai_base_url,
            model=settings.openai_model,
            api_key=settings.openai_api_key,
            timeout_seconds=settings.openai_timeout_seconds,
        )

    base_ontology_turtle = validator.base_turtle
    copilot_service = OntologyCopilotService(
        ontology_service,
        model_runtime=fallback_runtime,
        query_row_limit=settings.copilot_query_row_limit,
        base_ontology_turtle=base_ontology_turtle,
        skill_registry=skill_registry,
    )
    return ontology_service, copilot_service


def get_ontology_service(request: Request) -> OntologyService | UnavailableOntologyService:
    return request.app.state.ontology_service


def get_copilot_service(request: Request) -> OntologyCopilotService:
    return request.app.state.ontology_copilot_service


@router.post("/ingest", response_model=OntologyIngestResponse)
async def ingest_ontology(
    payload: OntologyIngestRequest,
    request: Request,
) -> OntologyIngestResponse | JSONResponse:
    service = get_ontology_service(request)
    try:
        result = await service.ingest(release_id=payload.release_id, turtle=payload.turtle)
    except OntologyDependencyUnavailableError as exc:
        raise _http_error(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc
    except OntologyError as exc:
        raise _http_error(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc

    if result.validation_status == "failed":
        return JSONResponse(
            status_code=HTTP_422_UNPROCESSABLE_CONTENT,
            content=result.model_dump(),
        )
    return result


@router.get("/current", response_model=OntologyCurrentResponse)
async def current_ontology(request: Request) -> OntologyCurrentResponse:
    service = get_ontology_service(request)
    try:
        return await service.current()
    except OntologyDependencyUnavailableError as exc:
        raise _http_error(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc


@router.get("/concepts", response_model=list[OntologyConceptSummary])
async def list_concepts(
    request: Request,
    search: str = Query(default="", max_length=120),
    limit: int = Query(default=50, ge=1, le=200),
) -> list[OntologyConceptSummary]:
    service = get_ontology_service(request)
    try:
        return await service.list_concepts(search=search, limit=limit)
    except OntologyDependencyUnavailableError as exc:
        raise _http_error(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc
    except OntologyNotReadyError as exc:
        raise _http_error(status.HTTP_409_CONFLICT, str(exc)) from exc


@router.get("/concept-detail", response_model=OntologyConceptDetail)
async def concept_detail(
    request: Request,
    iri: str = Query(..., description="Concept IRI"),
) -> OntologyConceptDetail:
    service = get_ontology_service(request)
    try:
        return await service.concept_detail(iri=iri)
    except ValueError as exc:
        raise _http_error(HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from exc
    except OntologyDependencyUnavailableError as exc:
        raise _http_error(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc
    except OntologyNotReadyError as exc:
        raise _http_error(status.HTTP_409_CONFLICT, str(exc)) from exc


@router.get("/graph", response_model=OntologyGraphResponse)
async def ontology_graph(request: Request) -> OntologyGraphResponse:
    service = get_ontology_service(request)
    try:
        return await service.graph()
    except OntologyDependencyUnavailableError as exc:
        raise _http_error(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc
    except OntologyNotReadyError as exc:
        raise _http_error(status.HTTP_409_CONFLICT, str(exc)) from exc


@router.post("/query", response_model=OntologySparqlQueryResponse)
async def run_read_only_query(
    payload: OntologySparqlQueryRequest,
    request: Request,
) -> OntologySparqlQueryResponse:
    service = get_ontology_service(request)
    try:
        return await service.run_read_only_query(payload.query)
    except OntologyReadOnlyViolationError as exc:
        raise _http_error(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    except OntologyDependencyUnavailableError as exc:
        raise _http_error(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc
    except OntologyNotReadyError as exc:
        raise _http_error(status.HTTP_409_CONFLICT, str(exc)) from exc
    except OntologyError as exc:
        raise _http_error(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc


@router.post("/copilot", response_model=CopilotChatResponse)
async def copilot_chat(payload: CopilotChatRequest, request: Request) -> CopilotChatResponse:
    copilot = get_copilot_service(request)
    try:
        return await copilot.answer(payload.question, conversation=payload.conversation)
    except OntologyDependencyUnavailableError as exc:
        raise _http_error(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc
    except OntologyNotReadyError as exc:
        raise _http_error(status.HTTP_409_CONFLICT, str(exc)) from exc
    except OntologyError as exc:
        raise _http_error(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc


def _http_error(status_code: int, detail: str) -> HTTPException:
    return HTTPException(status_code=status_code, detail=detail)


def inject_ontology_services(app: Any, settings: Settings) -> None:
    ontology_service, copilot_service = build_ontology_services(settings)
    app.state.ontology_service = ontology_service
    app.state.ontology_copilot_service = copilot_service
