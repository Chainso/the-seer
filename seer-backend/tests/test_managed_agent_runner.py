from __future__ import annotations

import asyncio
import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest

pytest.importorskip("rdflib")
pytest.importorskip("pyshacl")

from seer_backend.actions.models import ActionCreate, ActionKind, ActionStatus
from seer_backend.actions.repository import InMemoryActionsRepository
from seer_backend.actions.service import ActionsService
from seer_backend.agent_orchestration.repository import InMemoryAgentTranscriptRepository
from seer_backend.agent_orchestration.runner import ManagedAgentExecutionService
from seer_backend.agent_orchestration.service import AgentTranscriptService
from seer_backend.ai.assistant_tools import AssistantDomainToolAdapter
from seer_backend.ai.ontology_copilot import CopilotActionExecutionContext
from seer_backend.analytics.rca_service import UnavailableRootCauseService
from seer_backend.analytics.service import UnavailableProcessMiningService
from seer_backend.history.repository import InMemoryHistoryRepository
from seer_backend.history.service import HistoryService
from seer_backend.ontology.managed_agents import ManagedAgentUpsertRequest
from seer_backend.ontology.repository import InMemoryOntologyRepository
from seer_backend.ontology.service import OntologyService
from seer_backend.ontology.validation import ShaclValidator

REPO_ROOT = Path(__file__).resolve().parents[2]
PROPHET_METAMODEL = REPO_ROOT / "prophet" / "prophet.ttl"
SUPPORT_FIXTURE = (
    REPO_ROOT
    / "prophet"
    / "examples"
    / "turtle"
    / "prophet_example_turtle_minimal"
    / "gen"
    / "turtle"
    / "ontology.ttl"
)
SUPPORT_OBJECT_MODEL_IRI = "http://prophet.platform/local/support_local#obj_ticket"
STRING_TYPE_IRI = "http://prophet.platform/standard-types#String"


class _FakeCopilotResponse:
    def __init__(
        self,
        *,
        answer: str,
        completion_messages_delta: list[dict[str, Any]],
    ) -> None:
        self.answer = answer
        self.completion_messages_delta = completion_messages_delta


class _FakeCopilotService:
    def __init__(self, response: _FakeCopilotResponse) -> None:
        self._response = response
        self.calls: list[dict[str, Any]] = []

    async def answer(
        self,
        question: str,
        *,
        completion_conversation: list[dict[str, Any]] | None = None,
        assistant_tool_adapter: AssistantDomainToolAdapter | None = None,
        action_runtime: ActionsService | None = None,
        action_execution_context: CopilotActionExecutionContext | None = None,
        runtime_mode: str = "assistant",
        workflow_system_prompt_override: str | None = None,
    ) -> _FakeCopilotResponse:
        self.calls.append(
            {
                "question": question,
                "completion_conversation": completion_conversation,
                "assistant_tool_adapter": assistant_tool_adapter,
                "action_runtime": action_runtime,
                "action_execution_context": action_execution_context,
                "runtime_mode": runtime_mode,
                "workflow_system_prompt_override": workflow_system_prompt_override,
            }
        )
        return self._response


def _run_async(coro: object) -> object:
    return asyncio.run(coro)


def _managed_agent_payload() -> ManagedAgentUpsertRequest:
    return ManagedAgentUpsertRequest.model_validate(
        {
            "managed_agent_key": "ticket_triage_assistant",
            "name": "Ticket Triage Assistant",
            "description": "Reviews a created ticket and decides the next state.",
            "instruction": "Review the ticket evidence and assign the next triage state.",
            "enabled": True,
            "input_name": "Ticket Triage Request",
            "input_description": "Request payload that identifies the ticket to review.",
            "output_name": "Ticket Triage Result",
            "output_description": (
                "Outcome event containing the triaged ticket and resulting state."
            ),
            "input_fields": [
                {
                    "field_key": "ticket",
                    "label": "Ticket",
                    "description": "The ticket to review.",
                    "required": True,
                    "multi_value": False,
                    "field_type": "object_reference",
                    "object_model_iri": SUPPORT_OBJECT_MODEL_IRI,
                }
            ],
            "output_fields": [
                {
                    "field_key": "newState",
                    "label": "New State",
                    "description": "The state assigned by the managed agent.",
                    "required": True,
                    "multi_value": False,
                    "field_type": "value_type",
                    "value_type_iri": STRING_TYPE_IRI,
                },
                {
                    "field_key": "ticket",
                    "label": "Ticket",
                    "description": "Reference to the ticket after triage.",
                    "required": True,
                    "multi_value": False,
                    "field_type": "object_reference",
                    "object_model_iri": SUPPORT_OBJECT_MODEL_IRI,
                },
            ],
        }
    )


def _build_ontology_service() -> OntologyService:
    service = OntologyService(
        repository=InMemoryOntologyRepository(),
        validator=ShaclValidator(str(PROPHET_METAMODEL)),
    )
    _run_async(
        service.ingest(
            release_id="rel-support-runner",
            turtle=SUPPORT_FIXTURE.read_text(encoding="utf-8"),
        )
    )
    _run_async(service.upsert_managed_agent(_managed_agent_payload()))
    return service


def test_internal_managed_agent_claim_is_global_across_users() -> None:
    repository = InMemoryActionsRepository()
    now = datetime(2026, 3, 16, 6, 0, tzinfo=UTC)
    ordinary = repository.create_action(
        ActionCreate(
            user_id="user-a",
            action_uri="urn:seer:test:ordinary",
            action_kind=ActionKind.ACTION,
            input_payload={"ok": True},
            ontology_release_id="rel-1",
            validation_contract_hash="hash-1",
            submitted_at=now,
            next_visible_at=now,
        )
    )
    repository.create_action(
        ActionCreate(
            user_id="user-a",
            action_uri="urn:seer:managed-agent:first",
            action_kind=ActionKind.AGENTIC_WORKFLOW,
            input_payload={"ticket": {"ticketId": "T-1"}},
            ontology_release_id="rel-1",
            validation_contract_hash="hash-2",
            submitted_at=now,
            next_visible_at=now,
        )
    )
    repository.create_action(
        ActionCreate(
            user_id="user-b",
            action_uri="urn:seer:managed-agent:second",
            action_kind=ActionKind.AGENTIC_WORKFLOW,
            input_payload={"ticket": {"ticketId": "T-2"}},
            ontology_release_id="rel-1",
            validation_contract_hash="hash-3",
            submitted_at=now,
            next_visible_at=now,
        )
    )

    public_claim = repository.claim_actions(
        user_id="user-a",
        instance_id="instance-public",
        capacity=10,
        max_actions=10,
        lease_seconds=60,
        now=now,
    )
    internal_claim = repository.claim_managed_agent_actions(
        instance_id="seer-runner",
        capacity=10,
        max_actions=10,
        lease_seconds=60,
        now=now,
    )

    assert [row.action_id for row in public_claim] == [ordinary.action_id]
    assert [row.action_kind for row in public_claim] == [ActionKind.ACTION]
    assert len(internal_claim) == 2
    assert {row.user_id for row in internal_claim} == {"user-a", "user-b"}
    assert {row.action_kind for row in internal_claim} == {ActionKind.AGENTIC_WORKFLOW}


def test_managed_agent_runner_executes_claimed_run_and_emits_output_event() -> None:
    ontology_service = _build_ontology_service()
    actions_service = ActionsService(repository=InMemoryActionsRepository())
    history_service = HistoryService(repository=InMemoryHistoryRepository())
    transcript_service = AgentTranscriptService(repository=InMemoryAgentTranscriptRepository())
    copilot_service = _FakeCopilotService(
        _FakeCopilotResponse(
            answer='{"newState":"closed","ticket":{"ticketId":"T-100"}}',
            completion_messages_delta=[
                {
                    "role": "assistant",
                    "content": "Loading ticket history.",
                    "tool_calls": [
                        {
                            "id": "call_history_1",
                            "type": "function",
                            "function": {
                                "name": "load_skill",
                                "arguments": '{"skill_name":"object-history"}',
                            },
                        }
                    ],
                },
                {
                    "role": "tool",
                    "tool_call_id": "call_history_1",
                    "content": json.dumps(
                        {
                            "tool": "load_skill",
                            "skill_name": "object-history",
                            "allowed_tools": [
                                "history.object_events",
                                "history.relations",
                                "history.object_timeline",
                            ],
                        }
                    ),
                },
                {
                    "role": "assistant",
                    "content": '{"newState":"closed","ticket":{"ticketId":"T-100"}}',
                },
            ],
        )
    )
    execution_service = ManagedAgentExecutionService(
        actions_service=actions_service,
        ontology_service=ontology_service,
        history_service=history_service,
        transcript_service=transcript_service,
        copilot_service=copilot_service,
        assistant_tool_adapter=AssistantDomainToolAdapter(
            process_service=UnavailableProcessMiningService("not used in test"),
            root_cause_service=UnavailableRootCauseService("not used in test"),
            history_service=history_service,
        ),
    )

    submit_result = _run_async(
        actions_service.submit_action(
            ontology_service=ontology_service,
            user_id="managed-agent-user",
            action_uri="urn:seer:managed-agent:ticket_triage_assistant",
            payload={"ticket": {"ticketId": "T-100"}},
        )
    )

    stats = _run_async(
        execution_service.claim_and_execute_batch(
            instance_id="seer-managed-agent-runner",
            capacity=5,
            max_actions=5,
            lease_seconds=60,
        )
    )
    action = _run_async(actions_service.get_action(submit_result.action.action_id))
    events = _run_async(
        history_service.produced_events(
            produced_by_execution_ids=[submit_result.action.action_id],
            limit=10,
        )
    )
    messages = _run_async(
        transcript_service.load_transcript_messages(
            execution_id=submit_result.action.action_id
        )
    )

    assert stats.claimed_count == 1
    assert stats.completed_count == 1
    assert stats.failed_count == 0
    assert action is not None
    assert action.status == ActionStatus.COMPLETED
    assert len(copilot_service.calls) == 1
    assert copilot_service.calls[0]["runtime_mode"] == "managed_agent"
    assert copilot_service.calls[0]["workflow_system_prompt_override"]
    execution_context = copilot_service.calls[0]["action_execution_context"]
    assert isinstance(execution_context, CopilotActionExecutionContext)
    assert execution_context.user_id == "managed-agent-user"
    assert execution_context.parent_execution_id == submit_result.action.action_id
    assert (
        execution_context.current_action_uri
        == "urn:seer:managed-agent:ticket_triage_assistant"
    )
    system_prompt = str(copilot_service.calls[0]["workflow_system_prompt_override"])
    assert "Never call load_action with this managed agent's own action URI." in system_prompt
    assert "You may inspect existing objects, events, and relationships through" in (
        system_prompt
    )
    assert "You may use load_action to load and invoke ordinary executable" in (
        system_prompt
    )
    assert "Do not ask the user clarifying questions during execution." in system_prompt
    assert "Managed agent action URI: urn:seer:managed-agent:ticket_triage_assistant" in (
        system_prompt
    )
    assert len(events.items) == 1
    assert events.items[0].event_type == "urn:seer:managed-agent:ticket_triage_assistant:output"
    assert events.items[0].payload["newState"] == "closed"
    assert events.items[0].produced_by_execution_id == submit_result.action.action_id
    assert [message.message_role for message in messages] == [
        "system",
        "user",
        "assistant",
        "tool",
        "assistant",
    ]
    persisted_tool_payload = json.loads(str(messages[3].message_json["content"]))
    assert persisted_tool_payload["tool"] == "load_skill"
