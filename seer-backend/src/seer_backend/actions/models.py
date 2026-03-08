"""Action orchestration models for persistence and service orchestration."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
from enum import StrEnum
from typing import Any
from uuid import UUID, uuid4

JsonObject = dict[str, Any]


class ActionStatus(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    RETRY_WAIT = "retry_wait"
    FAILED_TERMINAL = "failed_terminal"
    DEAD_LETTER = "dead_letter"


class ActionKind(StrEnum):
    PROCESS = "process"
    WORKFLOW = "workflow"
    AGENTIC_WORKFLOW = "agentic_workflow"


class AttemptOutcome(StrEnum):
    COMPLETED = "completed"
    RETRYABLE_FAILED = "retryable_failed"
    TERMINAL_FAILED = "terminal_failed"
    LEASE_EXPIRED = "lease_expired"


class InstanceStatus(StrEnum):
    ACTIVE = "active"
    DRAINING = "draining"


@dataclass(slots=True)
class ActionCreate:
    user_id: str
    action_uri: str
    input_payload: JsonObject
    ontology_release_id: str
    validation_contract_hash: str
    action_id: UUID = field(default_factory=uuid4)
    parent_execution_id: UUID | None = None
    action_kind: ActionKind = ActionKind.WORKFLOW
    priority: int = 0
    idempotency_key: str | None = None
    max_attempts: int = 3
    next_visible_at: datetime | None = None
    submitted_at: datetime = field(default_factory=lambda: datetime.now(UTC))


@dataclass(slots=True)
class ActionSubmitResult:
    action: ActionRecord
    dedupe_hit: bool


@dataclass(slots=True)
class ActionRecord:
    action_id: UUID
    user_id: str
    action_uri: str
    action_kind: ActionKind
    parent_execution_id: UUID | None
    input_payload: JsonObject
    status: ActionStatus
    priority: int
    idempotency_key: str | None
    ontology_release_id: str
    validation_contract_hash: str
    attempt_count: int
    max_attempts: int
    next_visible_at: datetime
    lease_owner_instance_id: str | None
    lease_expires_at: datetime | None
    last_error_code: str | None
    last_error_detail: str | None
    submitted_at: datetime
    updated_at: datetime
    completed_at: datetime | None


@dataclass(slots=True)
class ActionAttemptRecord:
    attempt_id: UUID
    action_id: UUID
    attempt_no: int
    instance_id: str
    leased_at: datetime
    started_at: datetime | None
    finished_at: datetime | None
    outcome: AttemptOutcome | None
    error_code: str | None
    error_detail: str | None


@dataclass(slots=True)
class InstanceRecord:
    instance_id: str
    user_id: str
    status: InstanceStatus
    last_seen_at: datetime
    capacity: int | None
    metadata: JsonObject | None


@dataclass(slots=True, frozen=True)
class LeaseSweepResult:
    leadership_acquired: bool
    scanned_actions: int = 0
    transitioned_retry_wait: int = 0
    transitioned_dead_letter: int = 0
    attempts_marked_lease_expired: int = 0
    dead_letter_upserts: int = 0
