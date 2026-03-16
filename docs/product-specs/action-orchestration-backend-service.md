# Action Orchestration Backend Service Spec

**Status:** completed  
**Owner phase:** `docs/exec-plans/completed/action-orchestration-backend-service.md`  
**Last updated:** 2026-03-16

---

## Purpose

Define user-visible and operator-visible behavior for Seer action orchestration.

This spec covers:
1. action submit-time validation and enqueue semantics,
2. pull-based claiming by user instances for ordinary actions,
3. Seer-owned managed-agent claiming and execution,
4. completion/failure lifecycle behavior with retries/dead-letter transitions,
5. status visibility for UI/operator surfaces.

## Who Interacts With This

1. Submitter client: any API client that creates actions for a user queue.
2. Executor instance: a user-owned worker process that polls (`claim`) and executes ordinary actions.
3. Seer managed-agent runner: a Seer-owned process that claims and executes `agentic_workflow` rows internally.
4. Operator/UI: reads action state via status/list/SSE endpoints.

## End-To-End Interaction Model

1. Submitter calls `POST /api/v1/actions/submit`.
2. If the submitted action is an ordinary action, a user-owned instance polls `POST /api/v1/actions/claim`.
3. If the submitted action is a managed agent, the Seer-owned managed-agent runner claims it internally.
4. Backend leases eligible actions to the appropriate claimer for a bounded lease window.
5. The lease owner executes the payload and reports terminal attempt outcome via:
   - `POST /api/v1/actions/{action_id}/complete`, or
   - `POST /api/v1/actions/{action_id}/fail`.
6. If lease expires without callback, dedicated sweeper runtime reconciles:
   - to `retry_wait` (attempt budget remaining), or
   - to `dead_letter` (attempt budget exhausted).
7. UI/operator clients track state through:
   - `GET /api/v1/actions/{action_id}`,
   - `GET /api/v1/actions`,
   - `GET /api/v1/actions/{action_id}/stream` (SSE).

## Canonical Lifecycle

1. `queued`
2. `running`
3. `retry_wait`
4. `completed`
5. `failed_terminal`
6. `dead_letter`

Notes:
1. Claiming work transitions an action directly into `running`; no separate executor start-ack callback exists.
2. Lease ownership metadata remains distinct from status semantics and still gates lifecycle callbacks.

## Primary Flows

## Submit Flow

1. Client calls `POST /api/v1/actions/submit` with `user_id`, `action_uri`, `payload`, optional `idempotency_key`, and optional `priority`.
2. Backend validates the action contract against the current ontology release.
3. Backend validates payload shape/cardinality/type against ontology-derived input metadata.
4. On success, backend enqueues action with backend-generated UUID `action_id`, status `queued`, ontology-derived `action_kind`, pinned `ontology_release_id`, and deterministic `validation_contract_hash`.
5. If `(user_id, idempotency_key)` already exists, backend returns the existing action with `dedupe_hit=true`.

## Public Claim Flow (Ordinary Actions Only)

1. Instance calls `POST /api/v1/actions/claim` with `user_id`, `instance_id`, `capacity`, and optional `max_actions`.
2. Backend heartbeats/upserts the instance before claiming.
3. Backend returns up to `min(capacity, max_actions)` eligible ordinary actions only.
4. Claim ordering is deterministic: `priority DESC`, then FIFO by `submitted_at`, then `action_id`.
5. Claimed actions transition to `running`, are leased to the caller instance with `lease_expires_at`, and increment `attempt_count`.
6. Draining instances (`status=draining`) receive zero new claims.

## Managed-Agent Claim And Execution Flow

1. Seer-owned managed-agent runner claims `action_kind=agentic_workflow` rows through an internal service/repository path rather than the public HTTP claim API.
2. Managed-agent claiming is global across submitter `user_id` values.
3. Submitter `user_id` remains on the action row for audit, list/detail filtering, and provenance.
4. The runner executes the managed agent, persists canonical transcript messages, emits the produced output event, and then completes or fails the leased action through the existing lifecycle callbacks.
5. External callers to `POST /api/v1/actions/claim` must never receive managed-agent rows.

## Instance Heartbeat Flow

1. Instance may call `POST /api/v1/actions/instances/heartbeat` to set liveness/capacity/metadata explicitly.
2. Claim requests also refresh liveness implicitly.
3. `status=draining` should be set before instance shutdown to stop new claims.

## Lifecycle Callback Flow

1. Lease owner calls `POST /api/v1/actions/{action_id}/complete` to complete action.
2. Lease owner calls `POST /api/v1/actions/{action_id}/fail` with canonical failure code to report failure.
3. Backend enforces active lease ownership for complete/fail callbacks.
4. Retryable failures transition to `retry_wait` with computed `next_visible_at`.
5. Retryable failures at max attempts transition to `dead_letter`.
6. Terminal failures transition to `failed_terminal`.
7. Duplicate completion callbacks for already completed actions are idempotent.

## Status Visibility Flow

1. `GET /api/v1/actions/{action_id}` returns canonical per-action status/audit payload.
2. `GET /api/v1/actions` returns user-scoped filtered/paginated list (`status`, `submitted_after`, `submitted_before`, `page`, `size`).
3. `GET /api/v1/actions/{action_id}/stream` emits SSE events:
   - `snapshot` as initial state,
   - `update` when tracked status token changes,
   - `terminal` once terminal state is reached.
4. Action status payloads expose `action_kind` and optional `parent_execution_id` so generic actions can represent workflow/process classification and parent-child execution lineage.

## API Usage Playbook (Client Contract)

1. Submit action

```bash
curl -sS -X POST http://localhost:8000/api/v1/actions/submit \
  -H 'content-type: application/json' \
  -d '{
    "user_id": "user-123",
    "action_uri": "urn:seer:action:notify-customer",
    "payload": {"ticket_id": "T-9001"},
    "idempotency_key": "notify-T-9001",
    "priority": 5
  }'
```

2. Poll for ordinary work from an instance

```bash
curl -sS -X POST http://localhost:8000/api/v1/actions/claim \
  -H 'content-type: application/json' \
  -d '{
    "user_id": "user-123",
    "instance_id": "instance-a",
    "capacity": 4,
    "max_actions": 2
  }'
```

3. Complete successful execution

```bash
curl -sS -X POST http://localhost:8000/api/v1/actions/<action_id>/complete \
  -H 'content-type: application/json' \
  -d '{"instance_id":"instance-a"}'
```

4. Report failure

```bash
curl -sS -X POST http://localhost:8000/api/v1/actions/<action_id>/fail \
  -H 'content-type: application/json' \
  -d '{
    "instance_id":"instance-a",
    "error_code":"upstream_timeout",
    "error_detail":"dependency timeout after 10s"
  }'
```

5. Read status and stream updates

```bash
curl -sS "http://localhost:8000/api/v1/actions/<action_id>"
curl -sS "http://localhost:8000/api/v1/actions?user_id=user-123&status=retry_wait&page=1&size=20"
curl -N "http://localhost:8000/api/v1/actions/<action_id>/stream"
```

## Executor Responsibilities

1. Treat `action_id` as the execution idempotency key for side effects.
2. Call exactly one terminal callback per attempt (`complete` or `fail`) before lease expiry.
3. Use canonical failure codes only for `/fail`.
4. Handle duplicate deliveries safely (at-least-once contract).
5. Respect `status=draining` operationally before shutdown.

## Managed-Agent Runner Responsibilities

1. Claim `agentic_workflow` rows only through the internal Seer-owned claim path.
2. Never rely on submitter `user_id` as the ownership partition for managed-agent claiming.
3. Persist canonical transcript messages and output-event provenance for managed-agent runs.
4. Use the same complete/fail lifecycle callbacks and retry semantics as the shared action control plane.

## Failure Taxonomy (Accepted `error_code`)

Retryable:
1. `lease_expired`
2. `instance_unreachable`
3. `upstream_timeout`
4. `transient_dependency_error`
5. `rate_limited`

Terminal:
1. `input_validation_failed`
2. `ontology_contract_missing`
3. `authorization_failed`
4. `unsupported_action_capability`
5. `executor_protocol_violation`

## Error Semantics

1. Validation failures return `422` with actionable `issues[]` details.
2. Lease/state conflicts return `409` with deterministic conflict code.
3. Missing actions return `404`.
4. Unavailable action dependencies return `503`.
5. Unexpected action domain failures are mapped to `502`.

## Acceptance Expectations

1. Valid submit requests return stable `action_id` and `queued` status.
2. Unknown/non-executable action URIs are rejected at submit with actionable `422` response.
3. Invalid payload fields/cardinality/type are rejected at submit with actionable `422` response.
4. Competing claimers cannot hold the same active lease simultaneously.
5. Public `POST /api/v1/actions/claim` never leases `agentic_workflow` rows.
6. Managed-agent runs are claimable by the Seer-owned runner across submitter `user_id` values.
7. Expired leases are proactively reconciled by sweeper and reclaimable through retry eligibility, preserving at-least-once delivery behavior.
8. Complete/fail callbacks are accepted only from current lease owner while lease is active.
9. Retry progression is deterministic and reaches `dead_letter` when retryable failures exhaust max attempts.
10. Status list/detail/stream contracts expose consistent lifecycle state transitions.

## Out of Scope

1. Exactly-once side-effect guarantees (executor must dedupe by `action_id`).
2. Push-first delivery/webhook orchestration as canonical path.
3. Platform-wide auth policy finalization (auth seams exist; enforcement model is tracked separately).
4. Broker-first queue architecture (Kafka/SQS/Celery) in this phase.
