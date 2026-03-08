from __future__ import annotations

import json
import threading
import time
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient

pytest.importorskip("rdflib")
pytest.importorskip("pyshacl")

from seer_backend.actions.models import ActionCreate, ActionKind
from seer_backend.actions.repository import InMemoryActionsRepository
from seer_backend.actions.service import ActionsService
from seer_backend.agent_orchestration.repository import InMemoryAgentTranscriptRepository
from seer_backend.agent_orchestration.service import (
    AgentOrchestrationService,
    AgentTranscriptService,
)
from seer_backend.config.settings import Settings
from seer_backend.history.models import EventIngestRequest
from seer_backend.history.repository import InMemoryHistoryRepository
from seer_backend.history.service import HistoryService
from seer_backend.main import create_app

REPO_ROOT = Path(__file__).resolve().parents[2]
PROPHET_METAMODEL = REPO_ROOT / "prophet" / "prophet.ttl"


def _build_client() -> tuple[
    TestClient,
    InMemoryActionsRepository,
    HistoryService,
    AgentTranscriptService,
]:
    app = create_app(settings=Settings(prophet_metamodel_path=str(PROPHET_METAMODEL)))
    actions_repository = InMemoryActionsRepository()
    history_service = HistoryService(repository=InMemoryHistoryRepository())
    transcript_service = AgentTranscriptService(repository=InMemoryAgentTranscriptRepository())
    actions_service = ActionsService(repository=actions_repository)
    app.state.actions_service = actions_service
    app.state.history_service = history_service
    app.state.agent_orchestration_service = AgentOrchestrationService(
        actions_service=actions_service,
        history_service=history_service,
        transcript_service=transcript_service,
    )
    return TestClient(app), actions_repository, history_service, transcript_service


def _create_action(
    repository: InMemoryActionsRepository,
    *,
    user_id: str,
    action_uri: str,
    action_kind: ActionKind,
    submitted_at: datetime,
    parent_execution_id: UUID | None = None,
) -> UUID:
    action = repository.create_action(
        ActionCreate(
            user_id=user_id,
            action_uri=action_uri,
            action_kind=action_kind,
            parent_execution_id=parent_execution_id,
            input_payload={"invoice_id": "INV-100"},
            ontology_release_id="rel-2026-03-01",
            validation_contract_hash="phase4-contract-hash",
            submitted_at=submitted_at,
            next_visible_at=submitted_at,
        )
    )
    return action.action_id


def _append_messages(
    transcript_service: AgentTranscriptService,
    *,
    execution_id: UUID,
    workflow_uri: str,
    attempt_no: int,
    messages: list[dict[str, object]],
) -> None:
    import asyncio

    asyncio.run(
        transcript_service.append_completion_messages(
            execution_id=execution_id,
            workflow_uri=workflow_uri,
            attempt_no=attempt_no,
            completion_messages=messages,
        )
    )


def _ingest_event(
    history_service: HistoryService,
    *,
    event_id: UUID,
    occurred_at: datetime,
    event_type: str,
    produced_by_execution_id: UUID | None,
) -> None:
    import asyncio

    asyncio.run(
        history_service.ingest_event(
            EventIngestRequest(
                event_id=event_id,
                occurred_at=occurred_at,
                event_type=event_type,
                source="agent-orchestration-test",
                payload={"status": "completed"},
                produced_by_execution_id=produced_by_execution_id,
            )
        )
    )


def _parse_sse_events(client: TestClient, path: str) -> list[tuple[str, dict[str, object]]]:
    events: list[tuple[str, dict[str, object]]] = []
    with client.stream("GET", path) as response:
        assert response.status_code == 200, response.text
        assert response.headers["content-type"].startswith("text/event-stream")
        current_event: str | None = None
        data_lines: list[str] = []
        for raw_line in response.iter_lines():
            line = raw_line if isinstance(raw_line, str) else raw_line.decode("utf-8")
            if line.startswith("event:"):
                current_event = line.split(":", maxsplit=1)[1].strip()
                continue
            if line.startswith("data:"):
                data_lines.append(line.split(":", maxsplit=1)[1].strip())
                continue
            if line == "":
                if current_event is not None:
                    payload = json.loads("".join(data_lines) or "{}")
                    events.append((current_event, payload))
                    if current_event == "terminal":
                        break
                current_event = None
                data_lines = []
    return events


def test_execution_list_filters_to_agentic_workflows_and_exposes_transcript_counts() -> None:
    client, repository, _history_service, transcript_service = _build_client()
    base = datetime(2026, 3, 8, 10, 0, tzinfo=UTC)
    running_id = _create_action(
        repository,
        user_id="user-phase4",
        action_uri="urn:seer:test:workflow.invoice.follow-up",
        action_kind=ActionKind.AGENTIC_WORKFLOW,
        submitted_at=base,
    )
    completed_id = _create_action(
        repository,
        user_id="user-phase4",
        action_uri="urn:seer:test:workflow.invoice.overdue",
        action_kind=ActionKind.AGENTIC_WORKFLOW,
        submitted_at=base + timedelta(minutes=1),
    )
    _create_action(
        repository,
        user_id="user-phase4",
        action_uri="urn:seer:test:process.invoice.sync",
        action_kind=ActionKind.PROCESS,
        submitted_at=base + timedelta(minutes=2),
    )
    _create_action(
        repository,
        user_id="other-user",
        action_uri="urn:seer:test:workflow.other",
        action_kind=ActionKind.AGENTIC_WORKFLOW,
        submitted_at=base + timedelta(minutes=3),
    )

    repository.claim_actions(
        user_id="user-phase4",
        instance_id="instance-phase4",
        capacity=3,
        max_actions=3,
        lease_seconds=60,
        now=base + timedelta(minutes=2),
    )
    repository.complete_action(
        action_id=completed_id,
        instance_id="instance-phase4",
        now=base + timedelta(minutes=2, seconds=5),
    )
    _append_messages(
        transcript_service,
        execution_id=completed_id,
        workflow_uri="urn:seer:test:workflow.invoice.overdue",
        attempt_no=1,
        messages=[
            {"role": "user", "content": "Handle invoice"},
            {"role": "assistant", "content": "Loaded actions."},
        ],
    )

    response = client.get(
        "/api/v1/agentic-workflows/executions",
        params={
            "user_id": "user-phase4",
            "status": "completed",
            "search": "invoice.overdue",
        },
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["total"] == 1
    assert body["executions"][0]["action"]["action_id"] == str(completed_id)
    assert body["executions"][0]["action"]["status"] == "completed"
    assert body["executions"][0]["action"]["action_kind"] == "agentic_workflow"
    assert body["executions"][0]["transcript_message_count"] == 2
    assert str(running_id) != body["executions"][0]["action"]["action_id"]


def test_execution_detail_includes_child_actions_produced_events_and_parent_context() -> None:
    client, repository, history_service, transcript_service = _build_client()
    base = datetime(2026, 3, 8, 11, 0, tzinfo=UTC)
    execution_id = _create_action(
        repository,
        user_id="user-phase4-detail",
        action_uri="urn:seer:test:workflow.invoice.recovery",
        action_kind=ActionKind.AGENTIC_WORKFLOW,
        submitted_at=base,
    )
    child_process_id = _create_action(
        repository,
        user_id="user-phase4-detail",
        action_uri="urn:seer:test:process.email.customer",
        action_kind=ActionKind.PROCESS,
        submitted_at=base + timedelta(minutes=1),
        parent_execution_id=execution_id,
    )
    child_workflow_id = _create_action(
        repository,
        user_id="user-phase4-detail",
        action_uri="urn:seer:test:workflow.flag.shipping",
        action_kind=ActionKind.WORKFLOW,
        submitted_at=base + timedelta(minutes=2),
        parent_execution_id=execution_id,
    )

    repository.claim_actions(
        user_id="user-phase4-detail",
        instance_id="instance-detail",
        capacity=3,
        max_actions=3,
        lease_seconds=60,
        now=base + timedelta(minutes=3),
    )
    repository.complete_action(
        action_id=child_process_id,
        instance_id="instance-detail",
        now=base + timedelta(minutes=3, seconds=5),
    )
    repository.complete_action(
        action_id=child_workflow_id,
        instance_id="instance-detail",
        now=base + timedelta(minutes=3, seconds=10),
    )

    _append_messages(
        transcript_service,
        execution_id=execution_id,
        workflow_uri="urn:seer:test:workflow.invoice.recovery",
        attempt_no=1,
        messages=[
            {"role": "user", "content": "Recover the overdue invoice"},
            {
                "role": "assistant",
                "content": None,
                "tool_calls": [
                    {
                        "id": "call_email_customer",
                        "type": "function",
                        "function": {"name": "load_action", "arguments": "{}"},
                    }
                ],
            },
        ],
    )
    _ingest_event(
        history_service,
        event_id=uuid4(),
        occurred_at=base + timedelta(minutes=3, seconds=6),
        event_type="urn:seer:test:event.customer.emailed",
        produced_by_execution_id=child_process_id,
    )

    response = client.get(f"/api/v1/agentic-workflows/executions/{execution_id}")

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["execution"]["action"]["action_id"] == str(execution_id)
    assert body["execution"]["transcript_message_count"] == 2
    assert len(body["child_executions"]) == 2
    assert {item["action_id"] for item in body["child_executions"]} == {
        str(child_process_id),
        str(child_workflow_id),
    }
    assert len(body["produced_events"]) == 1
    assert body["produced_events"][0]["produced_by_execution_id"] == str(child_process_id)
    assert body["parent_execution"] is None


def test_messages_endpoint_uses_monotonic_ordinals_across_attempts() -> None:
    client, repository, _history_service, transcript_service = _build_client()
    base = datetime(2026, 3, 8, 12, 0, tzinfo=UTC)
    execution_id = _create_action(
        repository,
        user_id="user-phase4-messages",
        action_uri="urn:seer:test:workflow.messages",
        action_kind=ActionKind.AGENTIC_WORKFLOW,
        submitted_at=base,
    )
    _append_messages(
        transcript_service,
        execution_id=execution_id,
        workflow_uri="urn:seer:test:workflow.messages",
        attempt_no=1,
        messages=[{"role": "user", "content": "Attempt 1"}],
    )
    _append_messages(
        transcript_service,
        execution_id=execution_id,
        workflow_uri="urn:seer:test:workflow.messages",
        attempt_no=2,
        messages=[
            {"role": "user", "content": "Attempt 2"},
            {"role": "assistant", "content": "Recovered."},
        ],
    )

    first_response = client.get(
        f"/api/v1/agentic-workflows/executions/{execution_id}/messages",
    )
    second_response = client.get(
        f"/api/v1/agentic-workflows/executions/{execution_id}/messages",
        params={"after_ordinal": 1},
    )

    assert first_response.status_code == 200, first_response.text
    assert second_response.status_code == 200, second_response.text
    first_body = first_response.json()
    second_body = second_response.json()

    assert [item["ordinal"] for item in first_body["messages"]] == [1, 2, 3]
    assert [(item["attempt_no"], item["sequence_no"]) for item in first_body["messages"]] == [
        (1, 1),
        (2, 1),
        (2, 2),
    ]
    assert [item["ordinal"] for item in second_body["messages"]] == [2, 3]
    assert second_body["last_ordinal"] == 3


def test_message_stream_emits_snapshot_then_persisted_message_then_terminal() -> None:
    client, repository, _history_service, transcript_service = _build_client()
    base = datetime(2026, 3, 8, 13, 0, tzinfo=UTC)
    execution_id = _create_action(
        repository,
        user_id="user-phase4-stream",
        action_uri="urn:seer:test:workflow.stream",
        action_kind=ActionKind.AGENTIC_WORKFLOW,
        submitted_at=base,
    )
    repository.claim_actions(
        user_id="user-phase4-stream",
        instance_id="instance-stream",
        capacity=1,
        max_actions=1,
        lease_seconds=60,
        now=base + timedelta(seconds=1),
    )

    def _persist_and_complete() -> None:
        time.sleep(0.12)
        _append_messages(
            transcript_service,
            execution_id=execution_id,
            workflow_uri="urn:seer:test:workflow.stream",
            attempt_no=1,
            messages=[{"role": "assistant", "content": "Persisted update"}],
        )
        time.sleep(0.12)
        repository.complete_action(
            action_id=execution_id,
            instance_id="instance-stream",
            now=base + timedelta(seconds=3),
        )

    worker = threading.Thread(target=_persist_and_complete, daemon=True)
    worker.start()
    events = _parse_sse_events(
        client,
        f"/api/v1/agentic-workflows/executions/{execution_id}/messages/stream?poll_interval_ms=50",
    )
    worker.join(timeout=1)

    assert [event_name for event_name, _payload in events] == ["snapshot", "message", "terminal"]
    assert events[0][1]["last_ordinal"] == 0
    assert events[0][1]["status"] == "running"
    assert events[1][1]["ordinal"] == 1
    assert events[1][1]["message"]["content"] == "Persisted update"
    assert events[2][1]["terminal"] is True
    assert events[2][1]["last_ordinal"] == 1


def test_non_agentic_execution_ids_return_404_for_agentic_surfaces() -> None:
    client, repository, _history_service, _transcript_service = _build_client()
    execution_id = _create_action(
        repository,
        user_id="user-phase4-404",
        action_uri="urn:seer:test:process.not-agentic",
        action_kind=ActionKind.PROCESS,
        submitted_at=datetime(2026, 3, 8, 14, 0, tzinfo=UTC),
    )

    response = client.get(f"/api/v1/agentic-workflows/executions/{execution_id}")

    assert response.status_code == 404
    assert "was not found" in response.json()["detail"]
