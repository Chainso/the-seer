# Post-MVP Exec Plan: Action Orchestration Backend Service

**Status:** in_progress  
**Target order:** post-MVP track 5  
**Agent slot:** ORCH-ACT-1  
**Predecessor:** none (new post-MVP track)  
**Successor:** TBD  
**Last updated:** 2026-03-01

---

## Objective

Deliver a dedicated backend action orchestration module in `seer-backend/` so Seer can:

1. accept user-submitted actions,
2. validate submitted action inputs against the user ontology contract,
3. route delivery to user instances through pull-based claiming,
4. enforce at-least-once completion guarantees with leases/retries,
5. expose deterministic run-state and auditability for operators and UI.

## Problem Statement

Today Seer has no durable action delivery subsystem. Action-like concepts exist in ontology contracts, but runtime execution guarantees (routing, retries, completion tracking, dead-lettering) are not implemented as a backend domain.

This plan adds that missing control plane without introducing a separate service yet.

## Compatibility Stance

1. Forward-only delivery for orchestration contracts.
2. Backward compatibility is explicitly out of scope for this track unless the user later requests a specific exception.
3. No requirement to preserve ad hoc or synchronous action-execution patterns.
4. Prefer one canonical pull/lease flow over multiple compatibility paths and avoid compatibility shims.

## Why This Architecture

1. Pull-based claiming aligns with user-hosted/multi-instance deployments.
2. At-least-once semantics are operationally realistic and robust under failure.
3. Idempotency-by-`action_id` keeps duplicated deliveries safe.
4. Ontology release pinning ensures retries stay semantically deterministic.
5. Keeping orchestration as a backend module minimizes early distributed-system complexity.

## Invariants Introduced By This Plan

1. Every submitted action has a backend-generated UUID `action_id`.
2. Every action is validated against a specific pinned `ontology_release_id` before enqueue.
3. Delivery is pull-based (`claim`) and lease-scoped (`lease_owner_instance_id`, `lease_expires_at`).
4. Completion guarantee is at-least-once, never exactly-once.
5. Duplicate delivery is acceptable; duplicate side effects are prevented by idempotent execution semantics tied to `action_id`.
6. Instance eligibility/liveness is represented by lightweight registry semantics (`instances` table or equivalent).
7. Control-plane orchestration state is stored in OLTP persistence; ClickHouse remains analytics/audit-oriented.

## Storage Architecture (Canonical)

## Datastore Responsibilities

1. **PostgreSQL (primary control-plane store)** is the system of record for action orchestration state:
   - `actions`,
   - `action_attempts`,
   - `instances`,
   - optional `action_dead_letters`.
2. **ClickHouse** remains the immutable analytics/event-history store and is not the source of truth for lease/claim state transitions.
3. **Fuseki** remains ontology state/query infrastructure and is only used for contract validation context, not orchestration persistence.

## Why PostgreSQL For Control Plane

1. Row-level locks and transactional semantics are required for safe multi-instance claims.
2. Atomic compare-and-set updates are required for lease ownership enforcement.
3. Reliable unique constraints are required for idempotency keys and attempt numbering.
4. `FOR UPDATE SKIP LOCKED` patterns enable concurrent claimers without duplicate lease assignment.

## Why Not ClickHouse/Redis As Primary Control Plane (This Track)

1. ClickHouse is optimized for append/query analytics, not transactional queue semantics.
2. Redis-only queueing would add availability/consistency risk without durable relational audit semantics by default.
3. Introducing broker-first architecture now increases complexity without clear necessity for initial rollout.

## Transaction Semantics (Required)

1. **Submit transaction**:
   - validate ontology contract,
   - insert action row (`queued`),
   - enforce `(user_id, idempotency_key)` uniqueness when provided,
   - commit once durable.
2. **Claim transaction**:
   - select eligible `queued` rows for `user_id` where `next_visible_at <= now()`,
   - lock rows with `FOR UPDATE SKIP LOCKED`,
   - update lease fields (`lease_owner_instance_id`, `lease_expires_at`, `status=leased`),
   - insert `action_attempts` rows,
   - commit atomically.
3. **Complete transaction**:
   - verify ownership (`lease_owner_instance_id` + unexpired lease),
   - transition `leased/running -> completed`,
   - finalize attempt row (`outcome=completed`),
   - set terminal timestamps,
   - commit atomically.
4. **Fail transaction**:
   - verify ownership,
   - classify retryable vs terminal,
   - update `status`, `next_visible_at`, and error fields,
   - finalize attempt row,
   - commit atomically.
5. **Sweeper transaction**:
   - identify expired leases,
   - transition to `retry_wait` or `dead_letter` based on attempts,
   - persist lease-expired attempt outcome when applicable.

## Storage Runtime and Configuration

1. Add dedicated orchestration settings, e.g.:
   - `SEER_ACTIONS_DB_DSN`,
   - `SEER_ACTIONS_DB_POOL_SIZE`,
   - `SEER_ACTIONS_DB_MAX_OVERFLOW`,
   - `SEER_ACTIONS_LEASE_SECONDS`,
   - `SEER_ACTIONS_SWEEPER_INTERVAL_SECONDS`.
2. Use SQLAlchemy Core for query construction (aligned with existing backend standards), with PostgreSQL driver/runtime binding for execution.
3. Add PostgreSQL service in local compose runtime for deterministic development and CI integration.

## Migration Strategy

1. Introduce a dedicated migration path for orchestration tables (e.g., `seer-backend/migrations/postgres/`).
2. Migrations are forward-only; no legacy schema compatibility layer is required.
3. Phase 1 must include bootstrap migration execution in backend startup/service wiring for the action domain.

## Retention and Archival Policy

1. `actions` and `action_attempts` remain queryable for operator debugging for a defined retention window.
2. Optional archival flow can mirror terminal action summaries to ClickHouse for long-horizon analytics.
3. Dead-letter records are retained until manually replayed/resolved via operator workflow.

## Scope

1. New backend action orchestration domain module (`seer_backend/actions`).
2. Action submission, claim, completion, failure, and status APIs.
3. Ontology-aware action input validation at submit-time.
4. Lease expiry, retry backoff, and dead-letter handling.
5. Lightweight instance registry semantics (heartbeat, status, capacity).
6. Run-state and audit payloads consumable by UI and operator tooling.
7. Contract/unit/integration tests and runbook/docs updates.

## Non-Goals

1. Exactly-once side-effect guarantees.
2. Separate orchestration microservice in this track.
3. Cross-region/global scheduler design.
4. Multi-tenant policy partitioning beyond current Seer scope.
5. Broker-first architecture (Kafka/SQS/Celery) in this initial slice.

## Resolved Ambiguities

1. **Routing mode:** claim-time routing by polling instance; no pre-assignment required.
2. **Registry requirement:** lightweight registry semantics required for multi-instance eligibility/liveness.
3. **Validation point:** strict ontology validation at submit-time; optional lightweight guard at claim-time.
4. **Ontology drift behavior:** action keeps pinned `ontology_release_id`; retries do not rebind to latest release.
5. **Service boundary:** backend module now, extraction to separate service deferred until explicit scaling triggers.

## Planning Lock Decisions (2026-03-01 Review)

1. **Auth dependency posture:** global auth is unresolved across platform. This plan proceeds with explicit auth integration seams and a temporary internal-trust mode for local/dev execution only. Production auth model is a cross-cutting prerequisite outside this domain and must be plugged into these endpoints without changing orchestration semantics.
2. **Claim fairness policy:** use priority-then-FIFO ordering within user queues; this does not change the core architecture, only scheduler behavior.
3. **Lease timing defaults:** lease TTL `60s`, heartbeat interval target `20s`, lease-extension max step `60s`, stale-instance TTL `90s`, and server-clock authority for lease expiry.
4. **Sweeper runtime ownership:** run sweeper as a dedicated backend maintenance process (same repo/runtime) using singleton leadership via PostgreSQL advisory lock.
5. **Submit idempotency policy:** keep optional `idempotency_key`; `action_id` alone is not enough for safe client retry dedupe on submit.
6. **Dead-letter operations:** provide explicit operator replay flow that creates a new `action_id` and links `replayed_from_action_id`.
7. **Failure taxonomy baseline:** ship canonical retryable/terminal error codes in this track (see failure taxonomy section).
8. **Payload guardrails:** enforce bounded input/result payload sizes and structural limits (see payload limits section).
9. **SLO and alert baseline:** ship initial orchestration SLO/alert thresholds in this track (see SLO section).
10. **PostgreSQL runtime library:** use SQLAlchemy Core with PostgreSQL driver (psycopg) in backend module.
11. **Rollout strategy:** feature-flag/canary/rollback planning is intentionally out of scope for this pre-product platform stage.
12. **Executor conformance:** a minimal executor protocol contract is required and in scope for this plan.

## Backend Contract (Target)

## API Endpoints

1. `POST /api/v1/actions/submit`
   - Purpose: validate + enqueue action.
   - Request includes: `user_id`, `action_uri`, `payload`, optional `idempotency_key`, optional `priority`.
   - Response includes: `action_id`, `status=queued`, `ontology_release_id`, `dedupe_hit`.
2. `POST /api/v1/actions/claim`
   - Purpose: polling instances claim work.
   - Request includes: `instance_id`, `user_id`, `capacity`, optional `capabilities`, optional `max_actions`.
   - Response includes: leased actions with `lease_expires_at`, attempt metadata.
3. `POST /api/v1/actions/{action_id}/heartbeat`
   - Purpose: extend active lease during long-running execution.
4. `POST /api/v1/actions/{action_id}/complete`
   - Purpose: mark completion with output/result metadata.
5. `POST /api/v1/actions/{action_id}/fail`
   - Purpose: mark attempt failure (retryable/non-retryable classification).
6. `GET /api/v1/actions/{action_id}`
   - Purpose: canonical per-action status/audit view.
7. `GET /api/v1/actions`
   - Purpose: filtered list by `user_id`, `status`, time window, cursor/page.
8. `POST /api/v1/actions/instances/heartbeat`
   - Purpose: explicit instance liveness + drain/capacity updates.

## Canonical Status Model

1. `queued`
2. `leased`
3. `running`
4. `completed`
5. `retry_wait`
6. `failed_terminal`
7. `dead_letter`
8. `cancelled` (optional if cancellation is added in this track)

## State Transition Rules

1. `queued -> leased` only through successful `claim`.
2. `leased -> running` when executor acknowledges start (or immediate upon claim if simplified path chosen).
3. `running -> completed` on valid completion callback from lease owner.
4. `running -> retry_wait` on retryable failure, with computed `next_visible_at`.
5. `running -> failed_terminal` on non-retryable failure.
6. `retry_wait -> queued` when backoff expires.
7. Any non-terminal state with expired lease becomes retry-eligible via sweeper.
8. `attempt_count >= max_attempts` transitions to `dead_letter`.

## Idempotency Rules

1. Submit dedupe key: `(user_id, idempotency_key)` unique when key provided.
2. Execution dedupe key: `action_id` (required invariant).
3. Completion callbacks are idempotent: duplicate `complete` calls for terminal action return canonical terminal state.
4. Failure callbacks are idempotent per `(action_id, attempt_no)`.

## Data Model (Target)

## `actions`

1. `action_id` UUID PK
2. `user_id` String
3. `action_uri` String
4. `input_payload` JSON/JSONB
5. `status` Enum/String
6. `priority` Int
7. `idempotency_key` Nullable String
8. `ontology_release_id` String
9. `validation_contract_hash` String
10. `attempt_count` Int
11. `max_attempts` Int
12. `next_visible_at` Timestamp
13. `lease_owner_instance_id` Nullable String
14. `lease_expires_at` Nullable Timestamp
15. `last_error_code` Nullable String
16. `last_error_detail` Nullable String
17. `submitted_at` Timestamp
18. `updated_at` Timestamp
19. `completed_at` Nullable Timestamp

Indexes:

1. `(user_id, status, next_visible_at)`
2. `(lease_expires_at)` for sweeper
3. unique partial/indexed `(user_id, idempotency_key)` when non-null
4. `(submitted_at)` for operator queries

## `action_attempts`

1. `attempt_id` UUID PK
2. `action_id` UUID FK
3. `attempt_no` Int
4. `instance_id` String
5. `leased_at` Timestamp
6. `started_at` Nullable Timestamp
7. `finished_at` Nullable Timestamp
8. `outcome` Enum/String (`completed`, `retryable_failed`, `terminal_failed`, `lease_expired`)
9. `error_code` Nullable String
10. `error_detail` Nullable String
11. `result_summary` Nullable JSON/JSONB

Indexes:

1. unique `(action_id, attempt_no)`
2. `(instance_id, leased_at)`
3. `(outcome, finished_at)`

## `instances`

1. `instance_id` String PK
2. `user_id` String
3. `status` Enum/String (`online`, `draining`, `offline`)
4. `capabilities` JSON/JSONB
5. `max_concurrency` Int
6. `reported_load` Int
7. `version` Nullable String
8. `last_seen_at` Timestamp
9. `last_heartbeat_at` Timestamp
10. `metadata` Nullable JSON/JSONB

Indexes:

1. `(user_id, status, last_seen_at)`
2. `(last_seen_at)`

## `action_dead_letters` (optional explicit table, else status in `actions`)

1. `action_id` UUID PK/FK
2. `dead_lettered_at` Timestamp
3. `reason` String
4. `last_attempt_id` UUID
5. `snapshot` JSON/JSONB

## Validation Model (Ontology-Aware)

At submit-time:

1. Resolve active ontology release for `user_id`.
2. Verify `action_uri` exists and is executable in that release.
3. Compile/resolve action input contract (required fields, value types, URI fields, cardinality).
4. Validate payload against contract.
5. Persist `ontology_release_id` + `validation_contract_hash`.

At completion-time (optional phase in this plan):

1. Validate returned result/output event shape against action output contract.
2. Emit structured validation failures as `terminal_failed` with typed error codes.

## Polling + Registry Semantics

1. Claim request implicitly refreshes instance liveness (`instances.last_seen_at`).
2. Explicit heartbeat endpoint supports liveness when no claim traffic exists.
3. Claim eligibility:
   - instance is known for `user_id`,
   - status is `online`,
   - last seen within configured TTL,
   - optional capability match with action metadata.
4. Drain behavior:
   - `draining` instances can complete in-flight actions,
   - `draining` instances cannot claim new actions.

## Retry/Backoff Policy

1. Default backoff: exponential with jitter (`base=2s`, `cap=5m`; tune in settings).
2. Retryable classes: network/transient dependency errors, lease timeouts.
3. Terminal classes: schema validation failures, permanent authorization/policy failures.
4. Max attempts default: `8` (configurable).
5. On max attempts exceeded: transition to `dead_letter`.

## Observability Contract

1. Structured logs for all transitions with `action_id`, `attempt_no`, `instance_id`, `user_id`, `status_from`, `status_to`, `latency_ms`.
2. Metrics:
   - queue depth by user/status,
   - claim latency,
   - completion latency percentiles,
   - retry count and dead-letter rate,
   - stale lease count.
3. Correlation:
   - propagate `action_id` as correlation/tracing key.
4. Optional SSE/status endpoint for UI:
   - event names: `meta`, `status_delta`, `final`, `error`, `done`.

## Failure Taxonomy (Initial)

1. Retryable:
   - `lease_expired`,
   - `instance_unreachable`,
   - `upstream_timeout`,
   - `transient_dependency_error`,
   - `rate_limited`.
2. Terminal:
   - `input_validation_failed`,
   - `ontology_contract_missing`,
   - `authorization_failed`,
   - `unsupported_action_capability`,
   - `executor_protocol_violation`.

## Payload Limits (Initial)

1. Max submit payload body size: `256 KiB`.
2. Max completion result summary size: `256 KiB`.
3. Max JSON nesting depth: `12`.
4. Max top-level payload fields: `200`.
5. Requests exceeding limits return `413` with actionable error details.

## SLO / Alert Baseline (Initial)

1. Claimable queue latency SLO (enqueue to lease for ready actions): `p95 <= 5s` under healthy capacity.
2. Control-plane API availability (`submit/claim/complete/fail/status`): `>= 99.9%` monthly target.
3. Stale lease alert: fire when expired active leases exceed `1%` of running actions over 5-minute window.
4. Dead-letter alert: fire when dead-letter rate exceeds `0.5%` of completed+failed actions over 15-minute window.

## Executor Conformance Contract (Minimum)

1. Executor must treat `action_id` as idempotency key for side effects.
2. Executor must heartbeat before lease expiry for long-running actions.
3. Executor must send terminal callback (`complete` or `fail`) exactly once logically; duplicate callbacks are tolerated by backend idempotency.
4. Executor must not acknowledge completion/failure for actions it does not lease-own.
5. Executor should persist a local inbox/dedupe record keyed by `action_id`.

## Security and Correctness Guardrails

1. Authn/Authz ensures instance can only claim actions for authorized `user_id`.
2. Claim/complete/fail endpoints enforce lease ownership.
3. Immutable attempt history (append-only).
4. Replay-safe completion semantics.
5. Bounded claim batch size to prevent hot-spot starvation.

## Phase Plan

## Phase 0: Baseline and Failure Ledger

Goal: establish measurable baseline and lock target contract choices before implementation.

Deliverables:

1. Baseline lint/test/build run evidence for current backend.
2. Failure ledger captured in this plan (if any pre-existing issues).
3. Confirmed contract decisions (pull/lease, at-least-once, ontology pinning, module boundary, PostgreSQL control-plane storage).

Exit Criteria:

1. Baseline command outputs recorded.
2. No unresolved contract ambiguity blocking schema/API work.

Validation:

1. `cd seer-backend && uv run ruff check src tests`
2. `cd seer-backend && uv run pytest -q`

## Phase 1: Domain Skeleton + Persistence Migrations

Goal: land data model and repository primitives.

Deliverables:

1. New `seer_backend/actions/` package with models/errors/repository interfaces.
2. OLTP migration files for `actions`, `action_attempts`, `instances` (and dead-letter table if used).
3. Repository implementation with atomic claim/lease operations.
4. Runtime configuration and compose wiring for PostgreSQL-backed action storage.

Exit Criteria:

1. Migrations apply cleanly in local runtime.
2. Repository contract tests cover create/claim/lease-expiry paths.
3. Action domain fails closed with actionable dependency errors at service boundary; HTTP 503 mapping is verified when action API transport lands in Phase 2.

Validation:

1. `cd seer-backend && uv run ruff check src/seer_backend/actions tests`
2. `cd seer-backend && uv run pytest -q tests/test_actions_repository.py`

## Phase 2: Submit API + Ontology Validation + Enqueue

Goal: accept actions safely and deterministically.

Deliverables:

1. `POST /actions/submit` endpoint.
2. Ontology validation adapter for action contract lookup + input validation.
3. Persisted `ontology_release_id` and `validation_contract_hash`.
4. Idempotency-key dedupe behavior and canonical responses.

Exit Criteria:

1. Invalid action payloads rejected with actionable 422 responses.
2. Duplicate idempotency submissions return stable response semantics.

Validation:

1. `cd seer-backend && uv run pytest -q tests/test_actions_submit.py`

## Phase 3: Claim API + Instance Registry Semantics

Goal: implement safe pull routing for multiple instances.

Deliverables:

1. `POST /actions/claim` endpoint with capacity-aware batch claim.
2. Instance heartbeat/upsert on claim.
3. Optional explicit `POST /actions/instances/heartbeat`.
4. Lease-owner enforcement primitives.

Exit Criteria:

1. Two instances cannot claim the same action in the same lease window.
2. Draining instances do not receive new claims.

Validation:

1. `cd seer-backend && uv run pytest -q tests/test_actions_claim.py`

## Phase 4: Complete/Fail APIs + Retry Sweeper + Dead Letter

Goal: guarantee at-least-once completion lifecycle.

Deliverables:

1. `POST /actions/{id}/complete` and `/fail`.
2. Attempt history append and terminal state handling.
3. Lease expiry sweeper job.
4. Retry backoff and dead-letter transition.

Exit Criteria:

1. Lease-expired actions are retried deterministically.
2. Actions exceeding max attempts are dead-lettered with traceable reason.

Validation:

1. `cd seer-backend && uv run pytest -q tests/test_actions_lifecycle.py`

## Phase 5: Status Query + Streamed Updates + Operator Surfaces

Goal: make runtime observable to UI/operators.

Deliverables:

1. `GET /actions/{id}` and list query endpoint.
2. Optional status SSE stream endpoint for UI run-state.
3. Structured response schema aligned to `queued/running/completed/error` UX semantics.

Exit Criteria:

1. UI can reliably render action progress with no polling race ambiguity.
2. Terminal state payload includes final error/success context.

Validation:

1. `cd seer-backend && uv run pytest -q tests/test_actions_status_api.py`

## Phase 6: Hardening, Load, and Fault-Injection

Goal: validate behavior under realistic failure and concurrency conditions.

Deliverables:

1. Concurrency tests for claim races.
2. Fault-injection tests for dropped completion callbacks and instance crashes.
3. Retry/dead-letter metrics assertions.

Exit Criteria:

1. No duplicate lease claims under contention.
2. At-least-once semantics hold under induced failures.

Validation:

1. `cd seer-backend && uv run pytest -q tests/test_actions_concurrency.py`
2. `cd seer-backend && uv run pytest -q tests/test_actions_faults.py`

## Phase 7: Documentation Ratification + Plan Closeout

Goal: finalize source-of-truth documentation and archive-ready status.

Deliverables:

1. Update `ARCHITECTURE.md` with orchestration module boundaries and invariants.
2. Update `VISION.md` and/or `DESIGN.md` if scope/invariant changes are now canonical.
3. Add/refresh product spec for user-visible action orchestration behavior.
4. Update `docs/exec-plans/active/index.md` progress state.
5. Record deferred items in `docs/exec-plans/tech-debt-tracker.md`.

Exit Criteria:

1. Docs reflect final behavior and invariants.
2. Plan has completion summary, acceptance evidence, known issues, and next-step context.

Validation:

1. `cd seer-backend && uv run ruff check src tests`
2. `cd seer-backend && uv run pytest -q`
3. `cd seer-ui && npm run lint`
4. `cd seer-ui && npm run build`

## Phase Ownership and Guardrails

1. Exactly one phase in progress at a time.
2. Each phase must land with tests and doc updates for changed behavior.
3. Each phase implementation must be committed as a scoped phase commit before advancing.
4. If baseline unrelated failures exist, record them once and reference them in subsequent phase evidence.
5. Gap-fix retries must target only failed acceptance gates.

## Documentation Update Targets (By Change Type)

1. New architectural invariants and domain boundaries: `ARCHITECTURE.md`.
2. Product-level scope/outcome semantics: `VISION.md`.
3. UX and interaction policy details: `DESIGN.md` and `docs/product-specs/*`.
4. Execution progress state and sequencing: this file + `docs/exec-plans/active/index.md`.
5. Deferrals and intentionally postponed hardening: `docs/exec-plans/tech-debt-tracker.md`.

## Test Strategy

1. Contract tests at API level for submit/claim/complete/fail/status.
2. Repository tests for atomic claim and lease expiration transitions.
3. Ontology validation tests for action input correctness and release pinning.
4. Concurrency/fault tests for at-least-once guarantees.
5. End-to-end smoke using local runtime with synthetic instance poller.

## Acceptance Criteria

1. User can submit valid action requests and receive stable `action_id`.
2. Invalid action payloads are rejected against pinned ontology contract.
3. Multiple instances for one user can safely claim work without duplicate lease ownership.
4. Lost/crashed executions are retried until completion or dead-letter threshold.
5. Duplicate delivery does not duplicate side effects when executor honors `action_id` idempotency.
6. Backend exposes reliable status/audit views for each action lifecycle.
7. Ops visibility includes queue depth, retries, and dead-letter telemetry.

## Risks and Mitigations

1. Risk: OLTP persistence choice introduces infra lift.  
   Mitigation: isolate repository abstraction and gate migration rollout behind config.
2. Risk: ontology validation path adds submit latency.  
   Mitigation: cache contract resolvers by `(ontology_release_id, action_uri)`.
3. Risk: claim starvation for low-priority actions.  
   Mitigation: priority + FIFO fairness policy, cap per-claim batch.
4. Risk: executor-side non-idempotent handlers create duplicate side effects.  
   Mitigation: mandatory idempotency integration guide + validation in conformance tests.

## Legacy Behavior Removed (Explicit)

Backend:

1. No synchronous “submit-and-run-immediately” canonical path.
2. No push/webhook-first delivery requirement.
3. No best-effort completion semantics without lease/retry tracking.

UI/Client-facing:

1. No ambiguous run-state outside canonical lifecycle statuses.
2. No assumptions that a claimed action will complete without retry or re-delivery.

Rationale:

1. Pull/lease + durable state machine provides clearer guarantees and easier failure recovery.
2. Forward-only change strategy minimizes complexity and maximizes long-term correctness/operability.

## Progress Tracking

- [x] Phase 0 complete
- [x] Phase 1 complete
- [x] Phase 2 complete
- [ ] Phase 3 complete
- [ ] Phase 4 complete
- [ ] Phase 5 complete
- [ ] Phase 6 complete
- [ ] Phase 7 complete

Current execution state:

- `in_progress`: Phase 3 claim API + instance registry semantics
- `blocked`: none
- `completed`: Phase 0 baseline/failure ledger; Phase 1 domain skeleton + persistence migrations; Phase 2 submit API + ontology validation + enqueue

## Baseline Failure Ledger

1. `cd seer-backend && uv run ruff check src tests` -> pass (`All checks passed!`).
2. `cd seer-backend && uv run pytest -q` -> pass (`70 passed`), with non-blocking deprecation warnings (FastAPI startup hook + deprecated status constants).
3. `cd seer-backend && uv run python -c \"... build_actions_service(...); ensure_schema() ...\"` -> pass (`actions schema bootstrap ok`) against live local PostgreSQL.

## Phase 1 Acceptance Evidence

1. `cd seer-backend && uv run ruff check src/seer_backend/actions tests/test_actions_repository.py` -> pass.
2. `cd seer-backend && uv run pytest -q tests/test_actions_repository.py` -> pass (`4 passed`).
3. Local schema bootstrap smoke against PostgreSQL -> pass (`actions schema bootstrap ok`).
4. Phase 1 implementation commit: `29d258016c4def96b7524db7e20f14f5fc56a4ff`.

## Phase 2 Acceptance Evidence

1. Added `POST /api/v1/actions/submit` transport with request/response contracts and app router wiring.
2. Added submit-time ontology adapter resolving current release, validating executable action/input metadata, and persisting deterministic `validation_contract_hash`.
3. Added idempotency dedupe path with stable submit responses (`dedupe_hit`) and repository-level dedupe hooks.
4. Added submit API tests covering success path, invalid action/payload 422 responses, idempotency dedupe, and dependency-unavailable mapping.
5. `cd seer-backend && uv run ruff check src/seer_backend/actions src/seer_backend/api tests/test_actions_submit.py` -> pass (`All checks passed!`).
6. `cd seer-backend && uv run pytest -q tests/test_actions_submit.py` -> pass (`4 passed`).

## Decision Log

1. 2026-03-01: Selected pull-based claim routing with lease semantics as canonical delivery model.
2. 2026-03-01: Selected at-least-once completion guarantee with `action_id` idempotency requirement.
3. 2026-03-01: Selected ontology validation on submit with pinned `ontology_release_id` for deterministic retries.
4. 2026-03-01: Selected module-in-backend implementation; standalone service deferred.
5. 2026-03-01: User-confirmed no backward compatibility requirement; implementation should optimize for target-state architecture without compatibility shims.
6. 2026-03-01: Selected PostgreSQL as canonical action orchestration control-plane store; ClickHouse remains analytics/history plane.
7. 2026-03-01: Kept optional submit `idempotency_key` in addition to backend `action_id` for safe client retry dedupe.
8. 2026-03-01: Set lease/heartbeat defaults (`lease_ttl=60s`, heartbeat target `20s`, stale-instance TTL `90s`).
9. 2026-03-01: Selected dedicated maintenance sweeper process with PostgreSQL advisory-lock singleton leadership.
10. 2026-03-01: Locked initial failure taxonomy, payload guardrails, and SLO/alert baseline as in-scope deliverables.
11. 2026-03-01: Chose SQLAlchemy Core + psycopg for PostgreSQL integration.
12. 2026-03-01: Marked rollout/canary strategy as out-of-scope for this pre-product platform stage.
13. 2026-03-01: Kept executor conformance protocol in scope and required for acceptance.
14. 2026-03-01: Phase 1 completed (domain skeleton, Postgres migrations/config/runtime wiring, repository/service tests, live schema bootstrap validation).
15. 2026-03-01: Added plan guardrail requiring per-phase scoped commits (including worker-owned phase implementation slices).
16. 2026-03-01: Phase 2 completed with best-available ontology input validation (`acceptsInput` + `hasProperty` + cardinality + basic type/object-reference checks) and deterministic contract hashing.
17. 2026-03-01: Deferred deeper semantic type validation (enum/domain-specific constraints/date-format strictness) to later phases; current behavior returns actionable 422s for contract coverage available today.

## Next-Phase Starter Context

1. Backend entrypoint and service wiring: `seer-backend/src/seer_backend/main.py`
2. Ontology contract/query services:
   - `seer-backend/src/seer_backend/api/ontology.py`
   - `seer-backend/src/seer_backend/ontology/service.py`
3. Existing status/streaming interaction patterns:
   - `seer-backend/src/seer_backend/api/ai.py`
   - `seer-ui/app/lib/api/assistant-chat.ts`
4. Existing immutable event/history patterns for audit references:
   - `seer-backend/src/seer_backend/history/models.py`
   - `seer-backend/src/seer_backend/history/service.py`
