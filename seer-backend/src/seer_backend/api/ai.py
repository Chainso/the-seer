"""Unified AI gateway API endpoints."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Request, status

from seer_backend.ai.gateway import (
    AiAssistantChatRequest,
    AiAssistantChatResponse,
    AiGatewayService,
    AiOntologyQuestionRequest,
    AiOntologyQuestionResponse,
    AiProcessInterpretRequest,
    AiProcessInterpretResponse,
    AiRootCauseInterpretRequest,
    AiRootCauseInterpretResponse,
    AiRootCauseSetupRequest,
    AiRootCauseSetupResponse,
    GuidedInvestigationRequest,
    GuidedInvestigationResponse,
)
from seer_backend.analytics.errors import (
    ProcessMiningDependencyUnavailableError,
    ProcessMiningError,
    ProcessMiningLimitExceededError,
    ProcessMiningNoDataError,
    ProcessMiningValidationError,
    RootCauseDependencyUnavailableError,
    RootCauseError,
    RootCauseLimitExceededError,
    RootCauseNoDataError,
    RootCauseValidationError,
)
from seer_backend.ontology.errors import (
    OntologyDependencyUnavailableError,
    OntologyError,
    OntologyNotReadyError,
)

router = APIRouter(prefix="/ai", tags=["ai"])


def get_ai_gateway_service(request: Request) -> AiGatewayService:
    return request.app.state.ai_gateway_service


@router.post("/assistant/chat", response_model=AiAssistantChatResponse)
async def assistant_chat(
    payload: AiAssistantChatRequest,
    request: Request,
) -> AiAssistantChatResponse:
    service = get_ai_gateway_service(request)
    try:
        return await service.assistant_chat(payload)
    except ValueError as exc:
        raise _http_error(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc
    except OntologyDependencyUnavailableError as exc:
        raise _http_error(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc
    except OntologyNotReadyError as exc:
        raise _http_error(status.HTTP_409_CONFLICT, str(exc)) from exc
    except OntologyError as exc:
        raise _http_error(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc


@router.post("/ontology/question", response_model=AiOntologyQuestionResponse)
async def ask_ontology_question(
    payload: AiOntologyQuestionRequest,
    request: Request,
) -> AiOntologyQuestionResponse:
    service = get_ai_gateway_service(request)
    try:
        return await service.ontology_question(payload)
    except OntologyDependencyUnavailableError as exc:
        raise _http_error(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc
    except OntologyNotReadyError as exc:
        raise _http_error(status.HTTP_409_CONFLICT, str(exc)) from exc
    except OntologyError as exc:
        raise _http_error(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc


@router.post("/process/interpret", response_model=AiProcessInterpretResponse)
async def interpret_process_run(
    payload: AiProcessInterpretRequest,
    request: Request,
) -> AiProcessInterpretResponse:
    service = get_ai_gateway_service(request)
    try:
        return await service.process_interpret(payload)
    except ProcessMiningValidationError as exc:
        raise _http_error(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc
    except ProcessMiningLimitExceededError as exc:
        raise _http_error(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, str(exc)) from exc
    except ProcessMiningNoDataError as exc:
        raise _http_error(status.HTTP_404_NOT_FOUND, str(exc)) from exc
    except ProcessMiningDependencyUnavailableError as exc:
        raise _http_error(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc
    except ProcessMiningError as exc:
        raise _http_error(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc


@router.post("/root-cause/setup", response_model=AiRootCauseSetupResponse)
async def assist_root_cause_setup(
    payload: AiRootCauseSetupRequest,
    request: Request,
) -> AiRootCauseSetupResponse:
    service = get_ai_gateway_service(request)
    try:
        return await service.root_cause_setup(payload)
    except RootCauseValidationError as exc:
        raise _http_error(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc
    except RootCauseDependencyUnavailableError as exc:
        raise _http_error(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc
    except RootCauseError as exc:
        raise _http_error(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc


@router.post("/root-cause/interpret", response_model=AiRootCauseInterpretResponse)
async def assist_root_cause_interpret(
    payload: AiRootCauseInterpretRequest,
    request: Request,
) -> AiRootCauseInterpretResponse:
    service = get_ai_gateway_service(request)
    try:
        return await service.root_cause_interpret(payload)
    except RootCauseValidationError as exc:
        raise _http_error(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc
    except RootCauseDependencyUnavailableError as exc:
        raise _http_error(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc
    except RootCauseError as exc:
        raise _http_error(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc


@router.post("/guided-investigation", response_model=GuidedInvestigationResponse)
async def run_guided_investigation(
    payload: GuidedInvestigationRequest,
    request: Request,
) -> GuidedInvestigationResponse:
    service = get_ai_gateway_service(request)
    try:
        return await service.guided_investigation(payload)
    except OntologyDependencyUnavailableError as exc:
        raise _http_error(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc
    except OntologyNotReadyError as exc:
        raise _http_error(status.HTTP_409_CONFLICT, str(exc)) from exc
    except OntologyError as exc:
        raise _http_error(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc
    except ProcessMiningValidationError as exc:
        raise _http_error(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc
    except ProcessMiningLimitExceededError as exc:
        raise _http_error(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, str(exc)) from exc
    except ProcessMiningNoDataError as exc:
        raise _http_error(status.HTTP_404_NOT_FOUND, str(exc)) from exc
    except ProcessMiningDependencyUnavailableError as exc:
        raise _http_error(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc
    except ProcessMiningError as exc:
        raise _http_error(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc
    except RootCauseValidationError as exc:
        raise _http_error(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc
    except RootCauseLimitExceededError as exc:
        raise _http_error(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, str(exc)) from exc
    except RootCauseNoDataError as exc:
        raise _http_error(status.HTTP_404_NOT_FOUND, str(exc)) from exc
    except RootCauseDependencyUnavailableError as exc:
        raise _http_error(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc
    except RootCauseError as exc:
        raise _http_error(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc


def inject_ai_gateway_service(app: Any) -> None:
    app.state.ai_gateway_service = AiGatewayService(
        ontology_copilot_service=app.state.ontology_copilot_service,
        process_service=app.state.process_service,
        root_cause_service=app.state.root_cause_service,
    )


def _http_error(status_code: int, detail: str) -> HTTPException:
    return HTTPException(status_code=status_code, detail=detail)
