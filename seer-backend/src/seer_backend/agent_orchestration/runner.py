"""Seer-owned managed-agent runner process and execution service."""

from __future__ import annotations

import asyncio
import json
import logging
import signal
from contextlib import suppress
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from time import monotonic
from typing import Any, Protocol
from uuid import uuid4

from seer_backend.actions.models import ActionKind, ActionRecord
from seer_backend.actions.service import (
    ActionsService,
    UnavailableActionsService,
    build_actions_service,
)
from seer_backend.agent_orchestration.repository import ClickHouseAgentTranscriptRepository
from seer_backend.agent_orchestration.service import AgentTranscriptService
from seer_backend.ai.assistant_tools import AssistantDomainToolAdapter
from seer_backend.ai.ontology_copilot import (
    CopilotActionExecutionContext,
)
from seer_backend.analytics.rca_service import UnavailableRootCauseService
from seer_backend.analytics.service import UnavailableProcessMiningService
from seer_backend.api.history import build_history_service
from seer_backend.api.ontology import build_ontology_services
from seer_backend.config.settings import Settings
from seer_backend.history.models import EventIngestRequest
from seer_backend.history.service import HistoryService, UnavailableHistoryService
from seer_backend.logging import configure_logging
from seer_backend.ontology.errors import OntologyDependencyUnavailableError, OntologyError
from seer_backend.ontology.managed_agents import (
    ManagedAgentDetail,
    managed_agent_key_from_action_uri,
    managed_agent_output_event_iri,
)
from seer_backend.ontology.service import OntologyService, UnavailableOntologyService

_RUNNER_SOURCE = "seer.managed_agent_runner"
class ManagedAgentCopilotRuntime(Protocol):
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
    ) -> Any: ...


@dataclass(slots=True, frozen=True)
class ManagedAgentRunnerBatchResult:
    claimed_count: int = 0
    completed_count: int = 0
    failed_count: int = 0


class ManagedAgentExecutionService:
    """Claims and executes managed-agent runs inside Seer."""

    def __init__(
        self,
        *,
        actions_service: ActionsService,
        ontology_service: OntologyService | UnavailableOntologyService,
        history_service: HistoryService | UnavailableHistoryService,
        transcript_service: AgentTranscriptService,
        copilot_service: ManagedAgentCopilotRuntime,
        assistant_tool_adapter: AssistantDomainToolAdapter,
    ) -> None:
        self._actions_service = actions_service
        self._ontology_service = ontology_service
        self._history_service = history_service
        self._transcript_service = transcript_service
        self._copilot_service = copilot_service
        self._assistant_tool_adapter = assistant_tool_adapter

    async def claim_and_execute_batch(
        self,
        *,
        instance_id: str,
        capacity: int,
        max_actions: int,
        lease_seconds: int,
    ) -> ManagedAgentRunnerBatchResult:
        claimed = await self._actions_service.claim_managed_agent_actions(
            instance_id=instance_id,
            capacity=capacity,
            max_actions=max_actions,
            lease_seconds=lease_seconds,
        )
        completed_count = 0
        failed_count = 0
        for action in claimed:
            success = await self._execute_claimed_action(action=action, instance_id=instance_id)
            if success:
                completed_count += 1
            else:
                failed_count += 1
        return ManagedAgentRunnerBatchResult(
            claimed_count=len(claimed),
            completed_count=completed_count,
            failed_count=failed_count,
        )

    async def _execute_claimed_action(
        self,
        *,
        action: ActionRecord,
        instance_id: str,
    ) -> bool:
        if action.action_kind is not ActionKind.AGENTIC_WORKFLOW:
            await self._actions_service.fail_action(
                action_id=action.action_id,
                instance_id=instance_id,
                error_code="unsupported_action_capability",
                error_detail=(
                    f"Managed-agent runner received unsupported action kind "
                    f"'{action.action_kind.value}'."
                ),
            )
            return False

        managed_agent_key = managed_agent_key_from_action_uri(action.action_uri)
        if managed_agent_key is None:
            await self._actions_service.fail_action(
                action_id=action.action_id,
                instance_id=instance_id,
                error_code="unsupported_action_capability",
                error_detail=(
                    "Managed-agent runner only supports Seer-managed action URIs with prefix "
                    "'urn:seer:managed-agent:'."
                ),
            )
            return False

        try:
            detail = await self._ontology_service.get_managed_agent(managed_agent_key)
        except ValueError as exc:
            await self._actions_service.fail_action(
                action_id=action.action_id,
                instance_id=instance_id,
                error_code="unsupported_action_capability",
                error_detail=str(exc),
            )
            return False
        except (OntologyDependencyUnavailableError, OntologyError) as exc:
            await self._actions_service.fail_action(
                action_id=action.action_id,
                instance_id=instance_id,
                error_code="transient_dependency_error",
                error_detail=str(exc),
            )
            return False

        if not detail.enabled:
            await self._actions_service.fail_action(
                action_id=action.action_id,
                instance_id=instance_id,
                error_code="unsupported_action_capability",
                error_detail=f"Managed agent '{managed_agent_key}' is disabled.",
            )
            return False

        system_prompt = _build_system_prompt(detail)
        user_prompt = _build_user_prompt(detail=detail, action=action)
        attempt_no = max(int(action.attempt_count), 1)
        try:
            await self._transcript_service.append_completion_messages(
                execution_id=action.action_id,
                action_uri=action.action_uri,
                attempt_no=attempt_no,
                completion_messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
            )
            response = await self._copilot_service.answer(
                user_prompt,
                assistant_tool_adapter=self._assistant_tool_adapter,
                action_runtime=self._actions_service,
                action_execution_context=CopilotActionExecutionContext(
                    user_id=action.user_id,
                    parent_execution_id=action.action_id,
                    priority=action.priority,
                ),
                runtime_mode="managed_agent",
                workflow_system_prompt_override=system_prompt,
            )
            if response.completion_messages_delta:
                await self._transcript_service.append_completion_messages(
                    execution_id=action.action_id,
                    action_uri=action.action_uri,
                    attempt_no=attempt_no,
                    completion_messages=response.completion_messages_delta,
                )
            output_payload = _coerce_output_payload(
                response.answer,
                expects_json=bool(detail.output_fields),
            )
            await self._history_service.ingest_event(
                EventIngestRequest(
                    event_id=uuid4(),
                    occurred_at=datetime.now(UTC),
                    event_type=managed_agent_output_event_iri(detail.managed_agent_key),
                    source=_RUNNER_SOURCE,
                    payload=output_payload,
                    produced_by_execution_id=action.action_id,
                )
            )
            await self._actions_service.complete_action(
                action_id=action.action_id,
                instance_id=instance_id,
            )
            return True
        except TimeoutError as exc:
            await self._actions_service.fail_action(
                action_id=action.action_id,
                instance_id=instance_id,
                error_code="upstream_timeout",
                error_detail=str(exc),
            )
            return False
        except Exception as exc:
            await self._actions_service.fail_action(
                action_id=action.action_id,
                instance_id=instance_id,
                error_code="transient_dependency_error",
                error_detail=str(exc),
            )
            return False


async def run_managed_agent_runner_loop(settings: Settings) -> int:
    """Run the managed-agent claim/execute loop until process shutdown."""

    logger = logging.getLogger(__name__)
    if not settings.managed_agent_runner_enabled:
        logger.info("managed_agent_runner_disabled")
        return 0

    actions_service = build_actions_service(settings)
    if isinstance(actions_service, UnavailableActionsService):
        logger.error("managed_agent_runner_init_failed", extra={"reason": actions_service.reason})
        return 1
    assert isinstance(actions_service, ActionsService)

    ontology_service, _copilot_service = build_ontology_services(settings)
    history_service = build_history_service(settings)
    if isinstance(ontology_service, UnavailableOntologyService):
        logger.error(
            "managed_agent_runner_init_failed",
            extra={"reason": ontology_service.reason},
        )
        return 1
    if isinstance(history_service, UnavailableHistoryService):
        logger.error(
            "managed_agent_runner_init_failed",
            extra={"reason": history_service.reason},
        )
        return 1

    if not settings.openai_base_url.strip():
        logger.error(
            "managed_agent_runner_init_failed",
            extra={"reason": "OpenAI runtime base URL is not configured"},
        )
        return 1
    if not settings.openai_model.strip():
        logger.error(
            "managed_agent_runner_init_failed",
            extra={"reason": "OpenAI runtime model is not configured"},
        )
        return 1

    transcript_service = AgentTranscriptService(
        repository=_build_transcript_repository(settings)
    )
    execution_service = ManagedAgentExecutionService(
        actions_service=actions_service,
        ontology_service=ontology_service,
        history_service=history_service,
        transcript_service=transcript_service,
        copilot_service=_copilot_service,
        assistant_tool_adapter=AssistantDomainToolAdapter(
            process_service=UnavailableProcessMiningService(
                "Managed-agent runtime does not expose process mining tools"
            ),
            root_cause_service=UnavailableRootCauseService(
                "Managed-agent runtime does not expose root-cause tools"
            ),
            history_service=history_service,
        ),
    )

    interval_seconds = max(int(settings.managed_agent_runner_interval_seconds), 1)
    stop_event = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        with suppress(NotImplementedError):
            loop.add_signal_handler(sig, stop_event.set)

    instance_id = settings.managed_agent_runner_instance_id.strip() or "seer-managed-agent-runner"
    logger.info(
        "managed_agent_runner_started",
        extra={
            "interval_seconds": interval_seconds,
            "batch_size": settings.managed_agent_runner_batch_size,
            "instance_id": instance_id,
        },
    )

    while not stop_event.is_set():
        cycle_started = monotonic()
        try:
            stats = await execution_service.claim_and_execute_batch(
                instance_id=instance_id,
                capacity=settings.managed_agent_runner_batch_size,
                max_actions=settings.managed_agent_runner_batch_size,
                lease_seconds=settings.actions_lease_seconds,
            )
        except Exception as exc:  # pragma: no cover - process/runtime behavior
            logger.exception("managed_agent_runner_cycle_failed", extra={"error": str(exc)})
        else:
            duration_ms = int((monotonic() - cycle_started) * 1000)
            logger.info(
                "managed_agent_runner_cycle",
                extra={
                    "claimed_count": stats.claimed_count,
                    "completed_count": stats.completed_count,
                    "failed_count": stats.failed_count,
                    "duration_ms": duration_ms,
                },
            )

        try:
            await asyncio.wait_for(stop_event.wait(), timeout=interval_seconds)
        except TimeoutError:
            continue

    logger.info("managed_agent_runner_stopped")
    return 0


def run() -> None:
    """CLI entrypoint for managed-agent runner process."""

    settings = Settings()
    configure_logging(settings.log_level)
    raise SystemExit(asyncio.run(run_managed_agent_runner_loop(settings)))


def _build_transcript_repository(settings: Settings) -> ClickHouseAgentTranscriptRepository:
    backend_root = Path(__file__).resolve().parents[3]
    migrations_dir = Path(settings.clickhouse_migrations_dir)
    if not migrations_dir.is_absolute():
        migrations_dir = backend_root / migrations_dir
    return ClickHouseAgentTranscriptRepository(
        host=settings.clickhouse_host,
        port=settings.clickhouse_port,
        database=settings.clickhouse_database,
        user=settings.clickhouse_user,
        password=settings.clickhouse_password,
        timeout_seconds=settings.clickhouse_timeout_seconds,
        connect_timeout_seconds=settings.clickhouse_connect_timeout_seconds,
        send_receive_timeout_seconds=settings.clickhouse_send_receive_timeout_seconds,
        compression=settings.clickhouse_compression,
        query_limit=settings.clickhouse_query_limit,
        migrations_dir=migrations_dir,
    )


def _build_system_prompt(detail: ManagedAgentDetail) -> str:
    lines = [
        "You are a Seer-managed agent execution running inside the Seer backend.",
        (
            "Follow the operating instruction exactly and stay within the provided "
            "input/output contract."
        ),
        "",
        f"Managed agent: {detail.name}",
        f"Managed agent key: {detail.managed_agent_key}",
        "",
        "Operating instruction:",
        detail.instruction.strip(),
        "",
        "Input fields:",
        _format_fields(detail.input_fields),
        "",
        "Output fields:",
        _format_fields(detail.output_fields),
    ]
    if detail.output_fields:
        lines.extend(
            [
                "",
                "Return only one JSON object matching the output-field keys.",
                "Do not wrap the JSON in Markdown fences.",
            ]
        )
    else:
        lines.extend(
            [
                "",
                "Return a concise natural-language result.",
            ]
        )
    return "\n".join(lines).strip()


def _build_user_prompt(
    *,
    detail: ManagedAgentDetail,
    action: ActionRecord,
) -> str:
    payload_json = json.dumps(action.input_payload, ensure_ascii=True, sort_keys=True, indent=2)
    return "\n".join(
        [
            f"Execute managed agent '{detail.name}'.",
            f"Submitter user_id: {action.user_id}",
            f"Execution id: {action.action_id}",
            "",
            "Input payload JSON:",
            payload_json,
        ]
    )


def _format_fields(fields: list[Any]) -> str:
    if not fields:
        return "- none"
    lines: list[str] = []
    for field in fields:
        value_target = field.value_type_iri or field.object_model_iri or "unspecified"
        cardinality = "many" if field.multi_value else "one"
        required = "required" if field.required else "optional"
        lines.append(
            f"- {field.field_key} | {required} | {cardinality} | "
            f"{field.field_type.value} | {value_target}"
        )
    return "\n".join(lines)


def _coerce_output_payload(assistant_text: str, *, expects_json: bool) -> dict[str, Any]:
    normalized = assistant_text.strip()
    if expects_json:
        try:
            parsed = json.loads(_strip_markdown_code_fence(normalized))
            if isinstance(parsed, dict):
                return parsed
        except json.JSONDecodeError:
            pass
    return {"result_text": normalized}


def _strip_markdown_code_fence(value: str) -> str:
    stripped = value.strip()
    if not stripped.startswith("```"):
        return stripped
    lines = stripped.splitlines()
    if len(lines) >= 3 and lines[0].startswith("```") and lines[-1].startswith("```"):
        return "\n".join(lines[1:-1]).strip()
    return stripped
