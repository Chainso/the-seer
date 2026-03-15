from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient

pytest.importorskip("rdflib")
pytest.importorskip("pyshacl")

from seer_backend.actions.models import ActionCreate, ActionKind, ActionStatus
from seer_backend.actions.repository import InMemoryActionsRepository
from seer_backend.actions.service import ActionsService, UnavailableActionsService
from seer_backend.config.settings import Settings
from seer_backend.main import create_app

REPO_ROOT = Path(__file__).resolve().parents[2]
PROPHET_METAMODEL = REPO_ROOT / "prophet" / "prophet.ttl"


def _build_status_client() -> tuple[TestClient, InMemoryActionsRepository]:
    app = create_app(settings=Settings(prophet_metamodel_path=str(PROPHET_METAMODEL)))
    repository = InMemoryActionsRepository()
    app.state.actions_service = ActionsService(repository=repository)
    return TestClient(app), repository


def _create_action(
    repository: InMemoryActionsRepository,
    *,
    user_id: str,
    action_uri: str,
    submitted_at: datetime,
    payload: dict[str, object] | None = None,
) -> UUID:
    created = repository.create_action(
        ActionCreate(
            user_id=user_id,
            action_uri=action_uri,
            input_payload=payload or {"ticket_id": "T-300"},
            ontology_release_id="rel-2026-03-01",
            validation_contract_hash="contract-hash-status-test",
            submitted_at=submitted_at,
            next_visible_at=submitted_at,
        )
    )
    return created.action_id


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
                current_event = None
                data_lines = []
    return events


def test_get_action_by_id_returns_status_payload() -> None:
    client, repository = _build_status_client()
    submitted_at = datetime(2026, 3, 1, 16, 0, tzinfo=UTC)
    action_id = _create_action(
        repository,
        user_id="user-status-1",
        action_uri="urn:seer:test:status.single",
        submitted_at=submitted_at,
        payload={"ticket_id": "T-301"},
    )

    response = client.get(f"/api/v1/actions/{action_id}")

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["action_id"] == str(action_id)
    assert body["user_id"] == "user-status-1"
    assert body["action_uri"] == "urn:seer:test:status.single"
    assert body["action_kind"] == ActionKind.ACTION.value
    assert body["parent_execution_id"] is None
    assert body["payload"] == {"ticket_id": "T-301"}
    assert body["status"] == "queued"
    assert body["attempt_count"] == 0
    assert body["submitted_at"] is not None


def test_get_action_by_id_returns_404_for_missing_action() -> None:
    client, _repository = _build_status_client()

    response = client.get(f"/api/v1/actions/{uuid4()}")

    assert response.status_code == 404
    assert "was not found" in response.json()["detail"]


def test_list_actions_supports_filtering_pagination_and_time_window() -> None:
    client, repository = _build_status_client()
    base = datetime(2026, 3, 1, 16, 30, tzinfo=UTC)
    oldest_id = _create_action(
        repository,
        user_id="user-status-2",
        action_uri="urn:seer:test:status.oldest",
        submitted_at=base,
    )
    middle_id = _create_action(
        repository,
        user_id="user-status-2",
        action_uri="urn:seer:test:status.middle",
        submitted_at=base + timedelta(minutes=1),
    )
    completed_id = _create_action(
        repository,
        user_id="user-status-2",
        action_uri="urn:seer:test:status.completed",
        submitted_at=base + timedelta(minutes=2),
    )
    _create_action(
        repository,
        user_id="user-status-other",
        action_uri="urn:seer:test:status.other-user",
        submitted_at=base + timedelta(minutes=3),
    )

    repository.claim_actions(
        user_id="user-status-2",
        instance_id="instance-a",
        capacity=3,
        max_actions=3,
        lease_seconds=60,
        now=base + timedelta(minutes=2),
    )
    repository.complete_action(
        action_id=completed_id,
        instance_id="instance-a",
        now=base + timedelta(minutes=2, seconds=1),
    )

    first_page = client.get("/api/v1/actions", params={"user_id": "user-status-2", "size": 1})
    second_page = client.get(
        "/api/v1/actions",
        params={"user_id": "user-status-2", "size": 1, "page": 2},
    )
    completed_only = client.get(
        "/api/v1/actions",
        params={"user_id": "user-status-2", "status": "completed"},
    )
    time_window = client.get(
        "/api/v1/actions",
        params={
            "user_id": "user-status-2",
            "submitted_after": (base + timedelta(minutes=1, seconds=30)).isoformat(),
        },
    )

    assert first_page.status_code == 200, first_page.text
    assert second_page.status_code == 200, second_page.text
    assert completed_only.status_code == 200, completed_only.text
    assert time_window.status_code == 200, time_window.text

    first_body = first_page.json()
    second_body = second_page.json()
    completed_body = completed_only.json()
    time_window_body = time_window.json()

    assert first_body["total"] == 3
    assert first_body["actions"][0]["action_id"] == str(completed_id)
    assert second_body["actions"][0]["action_id"] == str(middle_id)
    assert oldest_id != completed_id
    assert completed_body["total"] == 1
    assert completed_body["actions"][0]["status"] == "completed"
    assert completed_body["actions"][0]["action_kind"] == ActionKind.ACTION.value
    assert completed_body["actions"][0]["action_id"] == str(completed_id)
    assert time_window_body["total"] == 1
    assert time_window_body["actions"][0]["action_id"] == str(completed_id)


def test_status_endpoints_map_dependency_unavailable_to_503() -> None:
    app = create_app(settings=Settings(prophet_metamodel_path=str(PROPHET_METAMODEL)))
    app.state.actions_service = UnavailableActionsService("actions unavailable")
    client = TestClient(app)
    action_id = uuid4()

    get_by_id = client.get(f"/api/v1/actions/{action_id}")
    list_response = client.get("/api/v1/actions", params={"user_id": "user-status-3"})
    stream_response = client.get(f"/api/v1/actions/{action_id}/stream")

    assert get_by_id.status_code == 503
    assert list_response.status_code == 503
    assert stream_response.status_code == 503
    assert "actions unavailable" in get_by_id.json()["detail"]
    assert "actions unavailable" in list_response.json()["detail"]
    assert "actions unavailable" in stream_response.json()["detail"]


def test_status_stream_emits_snapshot_then_terminal_for_completed_action() -> None:
    client, repository = _build_status_client()
    now = datetime(2026, 3, 1, 17, 0, tzinfo=UTC)
    action_id = _create_action(
        repository,
        user_id="user-status-4",
        action_uri="urn:seer:test:status.stream",
        submitted_at=now,
    )
    repository.claim_actions(
        user_id="user-status-4",
        instance_id="instance-a",
        capacity=1,
        max_actions=1,
        lease_seconds=60,
        now=now + timedelta(seconds=1),
    )
    repository.complete_action(
        action_id=action_id,
        instance_id="instance-a",
        now=now + timedelta(seconds=2),
    )

    events = _parse_sse_events(client, f"/api/v1/actions/{action_id}/stream?poll_interval_ms=50")

    assert [event_name for event_name, _payload in events] == ["snapshot", "terminal"]
    assert events[0][1]["action_id"] == str(action_id)
    assert events[0][1]["status"] == ActionStatus.COMPLETED.value
    assert events[0][1]["sequence"] == 1
    assert events[1][1]["status"] == ActionStatus.COMPLETED.value
    assert events[1][1]["sequence"] == 2
    assert events[1][1]["terminal"] is True
