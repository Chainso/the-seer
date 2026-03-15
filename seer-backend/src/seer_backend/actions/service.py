"""Action orchestration service layer."""

from __future__ import annotations

import asyncio
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime
from hashlib import sha256
from json import dumps
from pathlib import Path
from typing import Any
from uuid import UUID

from seer_backend.actions.errors import (
    ActionDependencyUnavailableError,
    ActionNotFoundError,
    ActionValidationError,
    ActionValidationIssue,
)
from seer_backend.actions.models import (
    ActionCreate,
    ActionKind,
    ActionRecord,
    ActionStatus,
    ActionSubmitResult,
    InstanceRecord,
    InstanceStatus,
    LeaseSweepResult,
)
from seer_backend.actions.repository import (
    ActionsRepository,
    PostgresActionsRepository,
)
from seer_backend.config.settings import Settings
from seer_backend.ontology.constants import SEER_AGENTIC_WORKFLOW_IRI
from seer_backend.ontology.models import OntologyCurrentResponse, OntologySparqlQueryResponse

_ACTION_CONTRACT_QUERY_TEMPLATE = """
PREFIX prophet: <http://prophet.platform/ontology#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX seer: <http://seer.platform/ontology#>
SELECT DISTINCT
  ?actionType
  ?actionKind
  ?input
  ?property
  ?fieldKey
  ?minCardinality
  ?maxCardinality
  ?valueType
  ?valueTypeKind
WHERE {{
  BIND(<{action_uri}> AS ?action)
  ?action a ?actionType ;
          prophet:acceptsInput ?input ;
          prophet:producesEvent ?producedEvent .
  ?actionType rdfs:subClassOf* prophet:Action .

  OPTIONAL {{
    VALUES (?actionKind ?kindType) {{
      ("action" prophet:Action)
      ("agentic_workflow" seer:AgenticWorkflow)
    }}
    FILTER EXISTS {{ ?actionType rdfs:subClassOf* ?kindType . }}
  }}

  OPTIONAL {{
    ?input prophet:hasProperty ?property .
    OPTIONAL {{ ?property prophet:fieldKey ?fieldKey . }}
    OPTIONAL {{ ?property prophet:minCardinality ?minCardinality . }}
    OPTIONAL {{ ?property prophet:maxCardinality ?maxCardinality . }}
    OPTIONAL {{ ?property prophet:valueType ?valueType . }}
    OPTIONAL {{ ?valueType a ?valueTypeKind . }}
  }}
}}
ORDER BY ?fieldKey ?property
""".strip()

_STRING_TYPE_TOKENS = {"string"}
_INTEGER_TYPE_TOKENS = {"int", "integer"}
_NUMBER_TYPE_TOKENS = {"decimal", "double", "float", "number"}
_BOOLEAN_TYPE_TOKENS = {"bool", "boolean"}
_RETRYABLE_FAILURE_CODES = {
    "lease_expired",
    "instance_unreachable",
    "upstream_timeout",
    "transient_dependency_error",
    "rate_limited",
}
_TERMINAL_FAILURE_CODES = {
    "input_validation_failed",
    "ontology_contract_missing",
    "authorization_failed",
    "unsupported_action_capability",
    "executor_protocol_violation",
}
_FAILURE_CODES = _RETRYABLE_FAILURE_CODES | _TERMINAL_FAILURE_CODES


@dataclass(slots=True, frozen=True)
class _ActionInputFieldContract:
    field_key: str
    property_iri: str
    min_cardinality: int | None
    max_cardinality: int | None
    value_type_iri: str | None
    value_type_kind: str | None


@dataclass(slots=True, frozen=True)
class _ResolvedActionContract:
    ontology_release_id: str
    action_uri: str
    input_iri: str
    action_kind: ActionKind
    action_type_iris: tuple[str, ...]
    fields: tuple[_ActionInputFieldContract, ...]


class _OntologyValidationAdapter:
    async def resolve_action_contract(
        self,
        *,
        ontology_service: Any,
        action_uri: str,
    ) -> _ResolvedActionContract:
        current = await ontology_service.current()
        if not isinstance(current, OntologyCurrentResponse):
            raise ActionValidationError(
                "Ontology current release response was invalid",
                issues=[
                    ActionValidationIssue(
                        code="ontology_contract_resolution_failed",
                        message="Unable to resolve current ontology release for action validation.",
                    )
                ],
            )
        if not current.release_id:
            raise ActionValidationError(
                "No current ontology release is available for action validation",
                issues=[
                    ActionValidationIssue(
                        code="ontology_not_ready",
                        message="Ingest an ontology release before submitting actions.",
                    )
                ],
            )

        query = _ACTION_CONTRACT_QUERY_TEMPLATE.format(action_uri=action_uri)
        query_response = await ontology_service.run_read_only_query(query)
        if not isinstance(query_response, OntologySparqlQueryResponse):
            raise ActionValidationError(
                "Ontology contract query returned an invalid response",
                issues=[
                    ActionValidationIssue(
                        code="ontology_contract_resolution_failed",
                        message="Unable to resolve action input metadata from ontology.",
                    )
                ],
            )

        rows = query_response.bindings
        if not rows:
            raise ActionValidationError(
                "Action URI "
                f"'{action_uri}' is not executable in ontology release "
                f"'{current.release_id}'",
                issues=[
                    ActionValidationIssue(
                        code="unknown_or_non_executable_action",
                        field="action_uri",
                        message=(
                            "Action URI was not found as an executable action with input metadata "
                            f"in ontology release '{current.release_id}'."
                        ),
                    )
                ],
            )

        input_iri = ""
        action_types: set[str] = set()
        action_kind_tokens: set[str] = set()
        fields_by_key: dict[str, _ActionInputFieldContract] = {}

        for row in rows:
            row_input = row.get("input", "").strip()
            if row_input and not input_iri:
                input_iri = row_input

            action_type = row.get("actionType", "").strip()
            if action_type:
                action_types.add(action_type)

            action_kind = row.get("actionKind", "").strip()
            if action_kind:
                action_kind_tokens.add(action_kind)

            field_key = row.get("fieldKey", "").strip()
            if not field_key:
                continue

            property_iri = row.get("property", "").strip()
            min_cardinality = _parse_optional_int(row.get("minCardinality"))
            max_cardinality = _parse_optional_int(row.get("maxCardinality"))
            value_type_iri = _normalize_optional_iri(row.get("valueType"))
            value_type_kind = _normalize_optional_iri(row.get("valueTypeKind"))
            fields_by_key[field_key] = _ActionInputFieldContract(
                field_key=field_key,
                property_iri=property_iri or f"{input_iri}#{field_key}",
                min_cardinality=min_cardinality,
                max_cardinality=max_cardinality,
                value_type_iri=value_type_iri,
                value_type_kind=value_type_kind,
            )

        ordered_fields = tuple(
            fields_by_key[key]
            for key in sorted(fields_by_key, key=lambda item: (item.lower(), item))
        )
        return _ResolvedActionContract(
            ontology_release_id=current.release_id,
            action_uri=action_uri,
            input_iri=input_iri or action_uri,
            action_kind=_resolve_action_kind(
                action_kind_tokens=action_kind_tokens,
                action_type_iris=action_types,
                action_uri=action_uri,
            ),
            action_type_iris=tuple(sorted(action_types)),
            fields=ordered_fields,
        )


class ActionsService:
    """Repository-facing action orchestration service with schema bootstrap guard."""

    def __init__(self, repository: ActionsRepository) -> None:
        self._repository = repository
        self._schema_ready = False
        self._schema_lock = asyncio.Lock()
        self._ontology_validation_adapter = _OntologyValidationAdapter()

    async def ensure_schema(self) -> None:
        if self._schema_ready:
            return
        async with self._schema_lock:
            if self._schema_ready:
                return
            await asyncio.to_thread(self._repository.ensure_schema)
            self._schema_ready = True

    async def create_action(self, action: ActionCreate) -> ActionRecord:
        await self.ensure_schema()
        return await asyncio.to_thread(self._repository.create_action, action)

    async def create_action_with_dedupe(self, action: ActionCreate) -> tuple[ActionRecord, bool]:
        await self.ensure_schema()
        return await asyncio.to_thread(self._repository.create_action_with_dedupe, action)

    async def get_action(self, action_id: UUID) -> ActionRecord | None:
        await self.ensure_schema()
        return await asyncio.to_thread(self._repository.get_action, action_id)

    async def list_actions(
        self,
        *,
        user_id: str | None,
        status: ActionStatus | None = None,
        action_kind: ActionKind | None = None,
        action_uri: str | None = None,
        search: str | None = None,
        page: int = 1,
        size: int = 20,
        submitted_after: datetime | None = None,
        submitted_before: datetime | None = None,
    ) -> tuple[list[ActionRecord], int]:
        await self.ensure_schema()
        return await asyncio.to_thread(
            self._repository.list_actions,
            user_id=user_id,
            status=status,
            action_kind=action_kind,
            action_uri=action_uri,
            search=search,
            page=page,
            size=size,
            submitted_after=submitted_after,
            submitted_before=submitted_before,
        )

    async def list_child_actions(
        self,
        *,
        parent_execution_id: UUID,
    ) -> list[ActionRecord]:
        await self.ensure_schema()
        return await asyncio.to_thread(
            self._repository.list_child_actions,
            parent_execution_id=parent_execution_id,
        )

    async def get_action_by_idempotency_key(
        self,
        *,
        user_id: str,
        idempotency_key: str,
    ) -> ActionRecord | None:
        await self.ensure_schema()
        return await asyncio.to_thread(
            self._repository.get_action_by_idempotency_key,
            user_id=user_id,
            idempotency_key=idempotency_key,
        )

    async def claim_actions(
        self,
        *,
        user_id: str,
        instance_id: str,
        capacity: int,
        max_actions: int,
        lease_seconds: int,
    ) -> list[ActionRecord]:
        await self.ensure_schema()
        return await asyncio.to_thread(
            self._repository.claim_actions,
            user_id=user_id,
            instance_id=instance_id,
            capacity=capacity,
            max_actions=max_actions,
            lease_seconds=lease_seconds,
        )

    async def heartbeat_instance(
        self,
        *,
        user_id: str,
        instance_id: str,
        status: InstanceStatus | None = None,
        capacity: int | None = None,
        metadata: Mapping[str, Any] | None = None,
    ) -> InstanceRecord:
        await self.ensure_schema()
        return await asyncio.to_thread(
            self._repository.heartbeat_instance,
            user_id=user_id,
            instance_id=instance_id,
            status=status,
            capacity=capacity,
            metadata=metadata,
        )

    async def complete_action(
        self,
        *,
        action_id: UUID,
        instance_id: str,
    ) -> ActionRecord:
        await self.ensure_schema()
        return await asyncio.to_thread(
            self._repository.complete_action,
            action_id=action_id,
            instance_id=instance_id,
        )

    async def fail_action(
        self,
        *,
        action_id: UUID,
        instance_id: str,
        error_code: str,
        error_detail: str | None = None,
    ) -> ActionRecord:
        await self.ensure_schema()
        normalized_error_code = _normalize_failure_code(error_code)
        if not normalized_error_code:
            raise ActionValidationError(
                "Failure error_code is required",
                issues=[
                    ActionValidationIssue(
                        code="missing_failure_code",
                        field="error_code",
                        message="Provide a non-empty error_code for fail callbacks.",
                    )
                ],
            )
        if normalized_error_code not in _FAILURE_CODES:
            raise ActionValidationError(
                "Failure error_code is not part of the supported taxonomy",
                issues=[
                    ActionValidationIssue(
                        code="unknown_failure_code",
                        field="error_code",
                        message=(
                            f"Unsupported failure code '{normalized_error_code}'. "
                            "Use one of the canonical retryable or terminal failure codes."
                        ),
                    )
                ],
            )

        current = await self.get_action(action_id)
        if current is None:
            raise ActionNotFoundError(f"action '{action_id}' was not found")
        retryable = normalized_error_code in _RETRYABLE_FAILURE_CODES
        retry_delay_seconds = _compute_retry_delay_seconds(current.attempt_count)
        return await asyncio.to_thread(
            self._repository.fail_action,
            action_id=action_id,
            instance_id=instance_id,
            error_code=normalized_error_code,
            error_detail=error_detail,
            retryable=retryable,
            retry_delay_seconds=retry_delay_seconds,
        )

    async def sweep_expired_leases(
        self,
        *,
        advisory_lock_id: int,
        batch_size: int,
        retry_delay_seconds: int,
    ) -> LeaseSweepResult:
        await self.ensure_schema()
        return await asyncio.to_thread(
            self._repository.sweep_expired_leases,
            advisory_lock_id=advisory_lock_id,
            batch_size=batch_size,
            retry_delay_seconds=retry_delay_seconds,
        )

    async def submit_action(
        self,
        *,
        ontology_service: Any,
        user_id: str,
        action_uri: str,
        payload: Mapping[str, Any],
        idempotency_key: str | None = None,
        priority: int | None = None,
    ) -> ActionSubmitResult:
        await self.ensure_schema()
        normalized_idempotency_key = _normalize_optional_idempotency_key(idempotency_key)
        if normalized_idempotency_key is not None:
            existing = await self.get_action_by_idempotency_key(
                user_id=user_id,
                idempotency_key=normalized_idempotency_key,
            )
            if existing is not None:
                return ActionSubmitResult(action=existing, dedupe_hit=True)

        if not isinstance(payload, Mapping):
            raise ActionValidationError(
                "Action payload must be a JSON object",
                issues=[
                    ActionValidationIssue(
                        code="invalid_payload_type",
                        field="payload",
                        message="Payload must be a JSON object keyed by action input field names.",
                    )
                ],
            )

        contract = await self._ontology_validation_adapter.resolve_action_contract(
            ontology_service=ontology_service,
            action_uri=action_uri,
        )
        issues = _validate_submit_payload(payload=payload, contract=contract)
        if issues:
            raise ActionValidationError(
                "Action payload failed ontology input validation",
                issues=issues,
            )

        created, dedupe_hit = await self.create_action_with_dedupe(
            ActionCreate(
                user_id=user_id,
                action_uri=action_uri,
                action_kind=contract.action_kind,
                input_payload=dict(payload),
                ontology_release_id=contract.ontology_release_id,
                validation_contract_hash=_hash_contract(contract),
                idempotency_key=normalized_idempotency_key,
                priority=int(priority or 0),
            )
        )
        return ActionSubmitResult(action=created, dedupe_hit=dedupe_hit)


class UnavailableActionsService:
    """Fallback service when action orchestration dependencies are unavailable."""

    def __init__(self, reason: str) -> None:
        self.reason = reason

    async def ensure_schema(self) -> None:
        raise ActionDependencyUnavailableError(self.reason)

    async def create_action(self, action: ActionCreate) -> ActionRecord:
        del action
        raise ActionDependencyUnavailableError(self.reason)

    async def create_action_with_dedupe(self, action: ActionCreate) -> tuple[ActionRecord, bool]:
        del action
        raise ActionDependencyUnavailableError(self.reason)

    async def get_action(self, action_id: UUID) -> ActionRecord | None:
        del action_id
        raise ActionDependencyUnavailableError(self.reason)

    async def list_actions(
        self,
        *,
        user_id: str | None,
        status: ActionStatus | None = None,
        action_kind: ActionKind | None = None,
        action_uri: str | None = None,
        search: str | None = None,
        page: int = 1,
        size: int = 20,
        submitted_after: datetime | None = None,
        submitted_before: datetime | None = None,
    ) -> tuple[list[ActionRecord], int]:
        del (
            user_id,
            status,
            action_kind,
            action_uri,
            search,
            page,
            size,
            submitted_after,
            submitted_before,
        )
        raise ActionDependencyUnavailableError(self.reason)

    async def list_child_actions(
        self,
        *,
        parent_execution_id: UUID,
    ) -> list[ActionRecord]:
        del parent_execution_id
        raise ActionDependencyUnavailableError(self.reason)

    async def get_action_by_idempotency_key(
        self,
        *,
        user_id: str,
        idempotency_key: str,
    ) -> ActionRecord | None:
        del user_id, idempotency_key
        raise ActionDependencyUnavailableError(self.reason)

    async def claim_actions(
        self,
        *,
        user_id: str,
        instance_id: str,
        capacity: int,
        max_actions: int,
        lease_seconds: int,
    ) -> list[ActionRecord]:
        del user_id, instance_id, capacity, max_actions, lease_seconds
        raise ActionDependencyUnavailableError(self.reason)

    async def heartbeat_instance(
        self,
        *,
        user_id: str,
        instance_id: str,
        status: InstanceStatus | None = None,
        capacity: int | None = None,
        metadata: Mapping[str, Any] | None = None,
    ) -> InstanceRecord:
        del user_id, instance_id, status, capacity, metadata
        raise ActionDependencyUnavailableError(self.reason)

    async def submit_action(
        self,
        *,
        ontology_service: Any,
        user_id: str,
        action_uri: str,
        payload: Mapping[str, Any],
        idempotency_key: str | None = None,
        priority: int | None = None,
    ) -> ActionSubmitResult:
        del ontology_service, user_id, action_uri, payload, idempotency_key, priority
        raise ActionDependencyUnavailableError(self.reason)

    async def complete_action(
        self,
        *,
        action_id: UUID,
        instance_id: str,
    ) -> ActionRecord:
        del action_id, instance_id
        raise ActionDependencyUnavailableError(self.reason)

    async def fail_action(
        self,
        *,
        action_id: UUID,
        instance_id: str,
        error_code: str,
        error_detail: str | None = None,
    ) -> ActionRecord:
        del action_id, instance_id, error_code, error_detail
        raise ActionDependencyUnavailableError(self.reason)

    async def sweep_expired_leases(
        self,
        *,
        advisory_lock_id: int,
        batch_size: int,
        retry_delay_seconds: int,
    ) -> LeaseSweepResult:
        del advisory_lock_id, batch_size, retry_delay_seconds
        raise ActionDependencyUnavailableError(self.reason)


def build_actions_repository(settings: Settings) -> PostgresActionsRepository:
    backend_root = Path(__file__).resolve().parents[3]
    migrations_dir = Path(settings.actions_db_migrations_dir)
    if not migrations_dir.is_absolute():
        migrations_dir = backend_root / migrations_dir
    return PostgresActionsRepository(
        dsn=settings.actions_db_dsn,
        migrations_dir=migrations_dir,
        pool_size=settings.actions_db_pool_size,
        max_overflow=settings.actions_db_max_overflow,
    )


def build_actions_service(settings: Settings) -> ActionsService | UnavailableActionsService:
    try:
        return ActionsService(repository=build_actions_repository(settings))
    except Exception as exc:  # pragma: no cover - tested through fallback behavior
        return UnavailableActionsService(f"actions service initialization failed: {exc}")


def inject_actions_service(app: Any, settings: Settings) -> None:
    app.state.actions_service = build_actions_service(settings)


def _normalize_optional_idempotency_key(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip()
    return normalized if normalized else None


def _normalize_optional_iri(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip()
    return normalized if normalized else None


def _normalize_failure_code(value: str) -> str:
    return value.strip().lower()


def _compute_retry_delay_seconds(attempt_no: int) -> int:
    exponent = max(int(attempt_no) - 1, 0)
    return min(2 * (2**exponent), 300)


def _parse_optional_int(value: str | None) -> int | None:
    if value is None:
        return None
    try:
        return int(value)
    except ValueError:
        return None


def _validate_submit_payload(
    *,
    payload: Mapping[str, Any],
    contract: _ResolvedActionContract,
) -> list[ActionValidationIssue]:
    issues: list[ActionValidationIssue] = []
    if not contract.fields:
        return issues

    known_fields = {field.field_key for field in contract.fields}
    required_fields = sorted(
        field.field_key for field in contract.fields if (field.min_cardinality or 0) >= 1
    )
    for field_key in required_fields:
        if field_key not in payload or payload[field_key] is None:
            issues.append(
                ActionValidationIssue(
                    code="missing_required_field",
                    field=f"payload.{field_key}",
                    message=f"Missing required input field '{field_key}'.",
                )
            )

    for extra_key in sorted(set(payload) - known_fields):
        issues.append(
            ActionValidationIssue(
                code="unknown_payload_field",
                field=f"payload.{extra_key}",
                message=(
                    f"Field '{extra_key}' is not defined for action '{contract.action_uri}' "
                    "in the current ontology input contract."
                ),
            )
        )

    for field in contract.fields:
        if field.field_key not in payload:
            continue
        issues.extend(_validate_field_value(field=field, value=payload[field.field_key]))
    return issues


def _validate_field_value(
    *,
    field: _ActionInputFieldContract,
    value: Any,
) -> list[ActionValidationIssue]:
    issues: list[ActionValidationIssue] = []
    if value is None:
        return issues

    values = value if isinstance(value, list) else [value]
    count = len(values)
    field_path = f"payload.{field.field_key}"

    if field.min_cardinality is not None and count < field.min_cardinality:
        issues.append(
            ActionValidationIssue(
                code="invalid_cardinality",
                field=field_path,
                message=(
                    f"Field '{field.field_key}' requires at least {field.min_cardinality} value(s)."
                ),
            )
        )
    if field.max_cardinality is not None and count > field.max_cardinality:
        issues.append(
            ActionValidationIssue(
                code="invalid_cardinality",
                field=field_path,
                message=(
                    f"Field '{field.field_key}' allows at most {field.max_cardinality} value(s)."
                ),
            )
        )

    expected_type = _expected_field_type(field)
    if expected_type is None:
        return issues

    for item in values:
        if _matches_expected_type(item=item, expected_type=expected_type):
            continue
        issues.append(
            ActionValidationIssue(
                code="invalid_field_type",
                field=field_path,
                message=(
                    f"Field '{field.field_key}' expects {expected_type} values based on ontology "
                    f"value type '{field.value_type_iri or 'unknown'}'."
                ),
            )
        )
    return issues


def _expected_field_type(field: _ActionInputFieldContract) -> str | None:
    kind_local_name = _local_name(field.value_type_kind).lower()
    if kind_local_name == "objectreference":
        return "object"

    value_type_local_name = _local_name(field.value_type_iri).lower()
    if value_type_local_name in _STRING_TYPE_TOKENS:
        return "string"
    if value_type_local_name in _INTEGER_TYPE_TOKENS:
        return "integer"
    if value_type_local_name in _NUMBER_TYPE_TOKENS:
        return "number"
    if value_type_local_name in _BOOLEAN_TYPE_TOKENS:
        return "boolean"
    return None


def _matches_expected_type(*, item: Any, expected_type: str) -> bool:
    if expected_type == "object":
        return isinstance(item, Mapping)
    if expected_type == "string":
        return isinstance(item, str)
    if expected_type == "integer":
        return isinstance(item, int) and not isinstance(item, bool)
    if expected_type == "number":
        return isinstance(item, (int, float)) and not isinstance(item, bool)
    if expected_type == "boolean":
        return isinstance(item, bool)
    return True


def _local_name(iri: str | None) -> str:
    if not iri:
        return ""
    hash_index = iri.rfind("#")
    if hash_index >= 0 and hash_index < len(iri) - 1:
        return iri[hash_index + 1 :]
    slash_index = iri.rfind("/")
    if slash_index >= 0 and slash_index < len(iri) - 1:
        return iri[slash_index + 1 :]
    return iri


def _resolve_action_kind(
    *,
    action_kind_tokens: set[str],
    action_type_iris: set[str],
    action_uri: str,
) -> ActionKind:
    if "agentic_workflow" in action_kind_tokens or SEER_AGENTIC_WORKFLOW_IRI in action_type_iris:
        return ActionKind.AGENTIC_WORKFLOW
    if "action" in action_kind_tokens or action_type_iris:
        return ActionKind.ACTION
    raise ActionValidationError(
        f"Action URI '{action_uri}' did not resolve to a supported executable kind",
        issues=[
            ActionValidationIssue(
                code="unsupported_action_capability",
                field="action_uri",
                message=(
                    "Action URI resolved to an executable action, but it was not classified as "
                    "an action or agentic workflow."
                ),
            )
        ],
    )


def _hash_contract(contract: _ResolvedActionContract) -> str:
    contract_representation = {
        "action_uri": contract.action_uri,
        "input_iri": contract.input_iri,
        "action_kind": contract.action_kind.value,
        "action_type_iris": list(contract.action_type_iris),
        "fields": [
            {
                "field_key": field.field_key,
                "property_iri": field.property_iri,
                "min_cardinality": field.min_cardinality,
                "max_cardinality": field.max_cardinality,
                "value_type_iri": field.value_type_iri,
                "value_type_kind": field.value_type_kind,
            }
            for field in contract.fields
        ],
    }
    canonical = dumps(contract_representation, sort_keys=True, separators=(",", ":"))
    return sha256(canonical.encode("utf-8")).hexdigest()
