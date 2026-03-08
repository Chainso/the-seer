# Post-MVP Exec Plan: Managed Agent Runtime and Agentic Workflow Architecture

**Status:** in_progress  
**Target order:** post-MVP track 12  
**Agent slot:** AGENT-RUNTIME-1  
**Predecessor:** `docs/exec-plans/completed/ai-first-investigation-and-managed-agents.md`, `docs/exec-plans/completed/action-orchestration-backend-service.md`  
**Successor:** none  
**Last updated:** 2026-03-08

---

## Objective

Define the technical architecture and implementation plan for Seer's managed-agent runtime so that:

1. agentic workflows are modeled as ontology-defined executable capabilities,
2. Seer reuses the generic action orchestration control plane rather than inventing a parallel runtime stack,
3. agent-specific runtime state is reduced to canonical persisted `completion_messages`,
4. ontology actions invoked by agentic workflows remain first-class actions with explicit execution lineage,
5. and UI/operator surfaces can list, filter, inspect, and live-tail agentic workflow executions.

## Problem Statement

The current repository now has:

1. product framing for managed agents and runtime controls,
2. a generic action orchestration backend service,
3. a canonical assistant `completion_messages` contract,
4. and event/object history infrastructure.

What is still missing is the technical binding between those pieces:

1. how Seer extends Prophet for agentic workflows,
2. how agentic executions reuse generic action orchestration,
3. where canonical agent transcript history is persisted,
4. how ontology actions invoked by an agent are linked back to the parent execution,
5. and what backend/UI contracts expose this coherently.

This plan closes that gap before implementation starts.

## Compatibility Stance

1. Backward compatibility is explicitly out of scope for this track.
2. Existing action lifecycle/API/storage contracts may change if a cleaner managed-agent architecture requires it.
3. `leased` should not remain the user-facing semantic status for actively executing work; `running` is the canonical in-flight status.
4. No compatibility shim is required for non-agent-specific transcript endpoints; agent transcript APIs should be specific to agentic workflow executions.

## Scope

1. Define the Seer ontology extension contract for `AgenticWorkflow`.
2. Define the canonical execution model binding agentic workflows to generic action orchestration.
3. Define the backend module boundary between generic `actions` orchestration and new `agent_orchestration` runtime logic.
4. Define action-control-plane schema changes required for lineage and agent classification.
5. Define event-history schema changes required for produced-event provenance.
6. Define the canonical append-only transcript storage model for agentic workflow `completion_messages`.
7. Define the agentic-workflow-specific list/detail/messages/SSE API contracts.
8. Define the intended UI architecture for execution table, drill-in page, and live transcript tailing.
9. Sequence implementation into explicit phases with validation and doc targets.

## Non-Goals

1. Scheduling as an agent-specific concern. If needed later, scheduling should be a generic action scheduler concern.
2. Final authz, approvals, tenancy, or multi-tenant partitioning.
3. Version pinning strategy beyond the existing ontology release pinning already present in generic actions.
4. Pause/resume/revoke product semantics beyond what canonical persisted messages already make technically possible.
5. Deterministic replay guarantees for agentic executions.
6. A separate microservice for managed-agent execution in this track.
7. Reusing the full `/assistant` skill-loading surface for managed-agent runtime execution.

## Why This Architecture

1. Prophet already defines the executable capability surface: actions, workflows, processes, typed input, produced events, object models, state transitions, and event triggers.
2. Seer should extend Prophet rather than creating a second incompatible capability model.
3. Generic action orchestration already provides the correct control-plane skeleton: submission, claiming, retries, status, attempts, and SSE status visibility.
4. The only state that is genuinely unique to agentic execution is the accumulated `completion_messages` history for a run.
5. ClickHouse is already the append-oriented history plane in Seer, so transcript persistence fits better there than in mutable control-plane tables.
6. UI/operator surfaces should read as a specialized execution-history experience, not as a generic action admin panel with ad hoc transcript behavior bolted on.

## Planning Lock Decisions (2026-03-08)

1. `seer:AgenticWorkflow` extends `prophet:Workflow`; it is not a separate parallel action system.
2. Agentic workflows retain typed `acceptsInput` and typed `producesEvent` contracts so they compose like other actions.
3. The canonical in-flight lifecycle status is `running`; `leased` should be removed as the primary semantic status and retained only as lease metadata if needed internally.
4. The canonical persisted agent-specific runtime state is ordered `completion_messages`; no separate checkpoint/state machine is required in this phase.
5. `completion_messages` are the source of truth for resume/replay/inspection, but replay is reconstructable rather than deterministic.
6. Child ontology actions invoked by an agent remain ordinary action executions linked through `parent_execution_id`.
7. Event provenance uses optional `produced_by_execution_id`; not all events have a producing execution.
8. Agent transcript APIs are agentic-workflow-specific and should not imply transcript semantics for all actions.
9. Transcript persistence should use a dedicated ClickHouse append-only table with workflow identifier denormalized into each row for future filtering/querying.
10. Workflow execution UI should reuse history-surface filtering/drill-in patterns where possible rather than inventing a new admin-style table model.
11. Agentic workflow executions must not inherit the full assistant skill/tool catalog; they should start from a narrow runtime tool set.
12. Managed-agent runtime should still use `load_skill`, but only a curated subset of skills should be visible.
13. The initially visible skills should be deep ontology, object store, and object history.
14. Ontology actions should be exposed to agentic workflows through a dedicated `load_action` tool that dynamically registers one callable action tool using the ontology action's typed input contract as the tool schema.
15. The new backend domain/module name should be `agent_orchestration`, not `agent_runtime`.
16. `agent_orchestration` owns LLM calls and iterative agent execution; `actions` owns generic action execution records and invoked action lifecycle.

## Invariants Introduced By This Plan

1. Every agentic workflow execution is also a generic action execution.
2. Every ontology action invoked by an agent is also a generic action execution.
3. Agentic workflow runs persist canonical ordered `completion_messages` outside transient executor memory.
4. Resuming a claimed/reclaimed agentic execution must reconstruct runtime state from persisted `completion_messages`, not from prior in-memory executor state.
5. Event provenance is explicit when available: events produced by an execution carry optional `produced_by_execution_id`.
6. Execution lineage is explicit when relevant: child executions carry optional `parent_execution_id`.
7. Agent-specific UI surfaces derive transcript state from persisted messages only; no UI-only ephemeral transcript protocol is authoritative.

## Canonical Architecture

## Datastore Responsibilities

1. **PostgreSQL** remains the source of truth for generic execution control-plane state:
   - action rows,
   - attempt rows,
   - lifecycle status,
   - retries/dead-letter,
   - parent/child execution lineage.
2. **ClickHouse** remains the append/query history plane and should also store:
   - event history,
   - object history,
   - agentic workflow `completion_messages`.
3. **Fuseki** remains the ontology query/inference boundary:
   - Prophet base contracts,
   - Seer ontology extensions,
   - action/workflow/event metadata used at validation/runtime binding time.

## Module Responsibilities

Backend module boundaries should be explicit:

1. `seer_backend/actions`
   - generic action execution control plane,
   - submit/claim/complete/fail lifecycle,
   - retries/dead-letter,
   - execution lineage fields,
   - executing ontology actions as first-class actions
2. `seer_backend/agent_orchestration`
   - LLM-backed agentic workflow run loop,
   - persisted transcript read/write behavior,
   - runtime tool policy,
   - `load_action`,
   - agent-specific execution detail/message/SSE APIs,
   - resume/replay from canonical `completion_messages`
3. `seer_backend/ontology`
   - action/workflow discovery,
   - typed input/output contract resolution,
   - Seer ontology extension integration
4. `seer_backend/history`
   - event/object history persistence,
   - produced-event provenance persistence,
   - history/object evidence queries used by agent runs

Rules:

1. `agent_orchestration` must reuse `actions` as its generic execution control plane rather than reimplementing claiming/retry/dead-letter semantics.
2. `actions` should not absorb LLM call orchestration, transcript persistence, or agent tool-policy behavior.
3. Invoked ontology actions remain owned by the `actions` domain even when they are launched from `agent_orchestration`.

## Capability Boundary

1. Prophet base metamodel defines reusable executable business capabilities.
2. Seer ontology extension defines which workflow capabilities are specifically agentic.
3. Seer runtime decides how an execution is orchestrated, persisted, resumed, observed, and governed.

## Control Plane vs Transcript Plane

1. Control plane answers:
   - what execution exists,
   - what state it is in,
   - who owns the lease,
   - how many attempts it has used,
   - which execution launched which child execution.
2. Transcript plane answers:
   - what messages were persisted,
   - what tool calls/results the agent accumulated,
   - what exact message context must be replayed for resume or inspection.

## Lifecycle Model

Canonical statuses:

1. `queued`
2. `running`
3. `retry_wait`
4. `completed`
5. `failed_terminal`
6. `dead_letter`

Notes:

1. Lease metadata remains relevant (`lease_owner_instance_id`, `lease_expires_at`) but should not replace the user-facing or API-visible meaning of "currently executing".
2. Existing orchestration contracts that still expose `leased` should be updated forward-only in this implementation track.

## Ontology Contract (Target)

## Base Assumptions From Prophet

Seer builds on the existing Prophet contracts:

1. `prophet:Workflow` as an executable action capability,
2. `prophet:acceptsInput` for typed input,
3. `prophet:producesEvent` for typed output/event,
4. `prophet:EventTrigger` for event-to-action invocation,
5. typed `prophet:ObjectReference` and object/state/transition modeling.

## Seer Ontology Extension

Introduce a Seer extension namespace and define:

1. `seer:AgenticWorkflow rdfs:subClassOf prophet:Workflow`

Required behavior:

1. A `seer:AgenticWorkflow` must still satisfy Prophet action constraints.
2. It must still have one `prophet:acceptsInput`.
3. It must still have one `prophet:producesEvent`.
4. It remains discoverable and composable anywhere a workflow/action capability is expected.

Deferred ontology questions:

1. whether Seer should add reusable default instruction/guardrail template predicates at ontology level,
2. whether agentic workflow capabilities should declare allowed tool categories in ontology versus runtime policy,
3. whether Seer should distinguish agentic workflow sub-kinds in ontology before runtime implementation proves the need.

## Execution Control-Plane Contract (Target)

## `actions` Table Changes

Retain the generic table, but evolve it for managed-agent support:

1. `action_id` UUID PK
2. `user_id` String
3. `action_uri` String
4. `input_payload` JSONB
5. `status` Enum/String (`queued|running|retry_wait|completed|failed_terminal|dead_letter`)
6. `action_kind` Enum/String
   - `process`
   - `workflow`
   - `agentic_workflow`
7. `parent_execution_id` Nullable UUID FK -> `actions.action_id`
8. `priority` Int
9. `idempotency_key` Nullable String
10. `ontology_release_id` String
11. `validation_contract_hash` String
12. `attempt_count` Int
13. `max_attempts` Int
14. `next_visible_at` Timestamp
15. `lease_owner_instance_id` Nullable String
16. `lease_expires_at` Nullable Timestamp
17. `last_error_code` Nullable String
18. `last_error_detail` Nullable String
19. `submitted_at` Timestamp
20. `updated_at` Timestamp
21. `completed_at` Nullable Timestamp

Indexes:

1. `(user_id, status, next_visible_at)`
2. `(action_kind, status, submitted_at)`
3. `(parent_execution_id, submitted_at)`
4. `(action_uri, submitted_at)`
5. unique `(user_id, idempotency_key)` when non-null

## `action_attempts` Table

Retain generic attempt tracking. No agent-specific divergence is required.

Agentic executions resume by:

1. loading the current action row,
2. loading transcript rows by `action_id`,
3. reconstructing the runtime state from persisted messages.

## Event History Contract Changes

Extend event history with optional execution provenance:

1. `produced_by_execution_id` Nullable UUID

Semantics:

1. If present, this event was directly emitted by that execution.
2. If absent, the event was externally ingested or its producing execution is intentionally not modeled.

This field is optional because Seer event history is broader than orchestrated runtime output.

## Agent Transcript Storage Contract (Target)

Create a dedicated ClickHouse table for canonical agent transcript history, e.g. `agentic_workflow_completion_messages`.

Columns:

1. `execution_id` UUID
2. `workflow_uri` String
3. `attempt_no` UInt32
4. `sequence_no` UInt64
5. `message_role` String
6. `message_kind` Nullable String
7. `call_id` Nullable String
8. `message_json` String or JSON representation aligned with current ClickHouse repository conventions
9. `persisted_at` DateTime64

Sorting / primary access pattern:

1. `(execution_id, attempt_no, sequence_no)`

Secondary query goals:

1. list recent messages for one execution,
2. filter/query transcript rows by `workflow_uri`,
3. analyze tool/message patterns across runs of one workflow,
4. resume one execution deterministically by sequence order.

Rules:

1. append-only only,
2. no in-place edits or transcript rewriting,
3. message order is assigned by backend persistence path, not by executor guesswork,
4. SSE transcript streaming emits only persisted messages,
5. `completion_messages` remain canonical source of truth for agentic execution state.

## Runtime Execution Semantics

## Runtime Tool Access Model

Managed-agent runtime tool access must be narrower than the general `/assistant` skill system, but it should still use the same `load_skill` mechanism.

Initial runtime tool set:

1. ontology tools / ontology skill
   - capability discovery,
   - concept detail,
   - read-only ontology query as needed
2. object store skill
   - live object lookup/query
3. object history skill
   - event/object history lookup for evidence and state reconstruction

Explicit exclusions in this phase:

1. no automatic access to the whole backend assistant skill catalog,
2. no managed-agent visibility into skills outside the curated default allowlist,
3. no broad process-mining or RCA tool unlock by default unless a later phase explicitly adds them to the runtime policy.

Rationale:

1. managed-agent runtime should begin with the minimum tools required to understand ontology capabilities and inspect current/historical business state,
2. ontology actions themselves should be the primary execution mechanism for doing work,
3. a narrow default tool surface keeps runtime behavior legible and reduces accidental coupling to the general assistant product surface.

The runtime/tool loop itself belongs to `agent_orchestration`, not `actions`.

## Skill Loading Policy

Managed-agent runtime should reuse `load_skill`, but with a runtime-specific visible catalog.

Initial visible skills:

1. deep ontology
2. object store
3. object history

Rules:

1. `load_skill` remains the mechanism for bringing those skills into the current agent execution context.
2. Skills outside the managed-agent visible catalog must not be loadable in this runtime.
3. The visible catalog for managed-agent runtime is independent from the broader `/assistant` product surface.
4. Loaded skill/tool availability must be reconstructable from persisted `completion_messages`.

## Dynamic Action Loading

Introduce a dedicated runtime tool:

1. `load_action`

Behavior:

1. accepts an ontology action/workflow IRI,
2. validates that the referenced capability is executable in the current ontology release,
3. resolves the action's typed `acceptsInput` contract,
4. registers a callable runtime tool for that one ontology action using the action input contract as the tool schema,
5. makes that callable tool available for subsequent model turns in the current agent execution context.

Result:

1. the agent discovers capabilities through ontology tools,
2. calls `load_action` for the action it intends to use,
3. then invokes the loaded action naturally as a tool call with a schema derived from ontology input metadata.

Constraints:

1. `load_action` should only expose ontology-defined executable capabilities,
2. loaded action tools should preserve the action/workflow IRI for execution lineage and audit,
3. child action execution should still create a normal action row with `parent_execution_id`,
4. loaded action availability should be reflected in persisted `completion_messages` so replay/resume reconstructs the same callable-tool context.

## Submit / Claim / Resume

1. Submitting a `seer:AgenticWorkflow` creates a normal action execution with `action_kind=agentic_workflow`.
2. Claiming such an execution returns the same generic action metadata needed by `agent_orchestration`.
3. `agent_orchestration` is responsible for making the LLM calls for that execution.
4. Before execution/resume, `agent_orchestration` must load persisted transcript rows ordered by `attempt_no`, `sequence_no`.
5. Runtime continuation must be reconstructed from those messages rather than prior in-memory state.

## Child Ontology Action Invocation

When an agentic workflow decides to invoke an ontology action:

1. create a new child action execution,
2. set `parent_execution_id` to the parent agent execution,
3. hand off execution of that child to the generic `actions` orchestration path,
4. persist the emitted event with `produced_by_execution_id=<child action execution id>` when the output is produced by runtime execution.

This creates a traceable graph:

1. parent agentic workflow execution,
2. child ontology action execution,
3. produced event,
4. downstream history/object changes.

## Completion and Produced-Event Persistence

Because generic action state lives in PostgreSQL and event/transcript history live in ClickHouse, this track should not pretend cross-store atomicity exists.

Required behavior:

1. explicitly document non-atomic cross-store semantics,
2. persist transcript rows before broadcasting transcript SSE,
3. prefer persisting produced event history before marking action `completed`,
4. treat retry/reconciliation as the recovery path for partial failure between stores.

Deferred hardening:

1. transactional outbox/finalization flow if cross-store reliability becomes a demonstrated problem.

## Backend API Contract (Target)

## Generic Action APIs

Generic action APIs remain canonical for submission/claim/complete/fail/list/status of all executions, but should evolve to the new lifecycle semantics:

1. list/detail/status should use `running`, not `leased`, as the canonical in-flight state,
2. responses should expose `action_kind`,
3. detail/list responses should expose `parent_execution_id` when present.

## Runtime Tooling Contract

The managed-agent runtime also needs a model/tool contract distinct from HTTP APIs.

Required built-in runtime tools:

1. `load_skill`
2. ontology discovery/query tools
3. object store query tools
4. object history query tools
5. `load_action`

`load_skill` request contract:

1. `skill_name: string`

`load_skill` allowed values in this phase:

1. deep ontology
2. object store
3. object history

`load_skill` response contract:

1. resolved skill name
2. newly available tool identifiers
3. runtime-visible skill catalog metadata if useful for debugging/inspection

`load_action` request contract:

1. `action_uri: string`

`load_action` response contract:

1. resolved `action_uri`
2. action label/name
3. action kind (`process` or `workflow`)
4. ontology release id used for resolution
5. generated tool name or callable identifier
6. JSON-schema-like input contract derived from ontology `acceptsInput`

Loaded action tool contract:

1. tool identity should remain stably attributable to the ontology action IRI it wraps,
2. tool input schema should be derived from the ontology action input contract,
3. successful invocation should enqueue/execute a child action execution through the generic action orchestration path,
4. tool result payload should include at least the spawned child `action_id` and immediate execution summary.

## Agentic Workflow Execution APIs

Add an agentic-workflow-specific execution surface because transcript semantics do not apply to all actions.

Suggested endpoints:

1. `GET /api/v1/agentic-workflows/executions`
   - Purpose: paginated/filterable list of agentic workflow executions.
   - Filters:
     - `status`
     - `workflow_uri`
     - `submitted_after`
     - `submitted_before`
     - optional text search when supported
2. `GET /api/v1/agentic-workflows/executions/{execution_id}`
   - Purpose: execution detail summary.
   - Returns:
     - execution metadata,
     - parent execution if any,
     - child action summaries,
     - produced event summaries,
     - transcript counts/timestamps.
3. `GET /api/v1/agentic-workflows/executions/{execution_id}/messages`
   - Purpose: fetch persisted canonical messages for drill-in page load/reload.
   - Pagination:
     - by `after_sequence` or page/cursor; choose one canonical pattern during implementation.
4. `GET /api/v1/agentic-workflows/executions/{execution_id}/messages/stream`
   - Purpose: SSE stream of newly persisted transcript messages.
   - Events:
     - `snapshot` optional initial summary/checkpoint,
     - `message` for each newly persisted message,
     - `terminal` when execution reaches terminal state,
     - `error` on stream failure.

Rules:

1. transcript SSE emits persisted messages only,
2. transcript SSE is not token-delta transport,
3. agent transcript endpoints should reject non-agentic execution ids with a deterministic `404` or typed validation error,
4. generic action status SSE remains separate and lifecycle-focused.

## UI Architecture (Target)

## Execution List Surface

Build a dedicated agentic workflow execution list page that reuses:

1. history-surface filtering conventions from `seer-ui/app/components/inspector/history-panel.tsx`,
2. list/table row and drill-action patterns from `seer-ui/app/components/ontology/lists/event-list.tsx`,
3. status chips and table-system primitives already present in `seer-ui/app/components/ui/table.tsx`.

Expected behavior:

1. table of workflow executions,
2. status filters such as `running`, `completed`, `failed_terminal`, `dead_letter`,
3. workflow identifier filter,
4. time-window filters,
5. row drill-in into execution detail.

## Execution Detail Surface

Mirror the history object detail pattern used by:

1. `seer-ui/app/inspector/history/object/page.tsx`
2. `seer-ui/app/components/inspector/object-history-details-panel.tsx`

Expected behavior:

1. execution summary header,
2. persisted transcript message list,
3. child action executions panel,
4. produced events panel,
5. live-tail transcript experience through SSE,
6. easy back-navigation to execution list.

## UI Data Shape

The detail page should not reconstruct important semantics by parsing message text alone.

It should receive explicit execution metadata for:

1. workflow uri,
2. current status,
3. attempt count,
4. submission and completion timestamps,
5. child executions,
6. produced events.

The transcript itself should remain a separate ordered message feed.

## Implementation Phases

## Phase 1: Architecture Lock + Contracts

**Goal:** ratify the ontology/control-plane/transcript/API/UI contracts before implementation work starts.

Deliverables:

1. active execution plan finalized with architecture and contract detail,
2. ratified schema deltas for PostgreSQL/ClickHouse/history,
3. ratified API shapes for generic action and agentic workflow execution surfaces,
4. ratified UI list/detail/live-tail direction.

Exit criteria:

1. No core ambiguity remains about where runtime state lives.
2. The repository has one authoritative plan for implementation follow-through.

## Phase 2: Ontology Extension + Action Control-Plane Evolution

**Goal:** encode `seer:AgenticWorkflow` and extend generic action orchestration for managed-agent execution lineage/classification.

Deliverables:

1. Seer ontology extension classes/TTL updates,
2. submit-time action classification into `action_kind`,
3. `parent_execution_id` support in control plane,
4. lifecycle change from `leased`-semantic to `running`-semantic.

Exit criteria:

1. Agentic workflow executions are representable as generic actions.
2. Child ontology action invocations can be linked to parent agent runs.

Validation:

1. backend schema/migration checks,
2. action repository/service tests updated for new status and lineage semantics,
3. ontology validation/query tests for the new extension contract.

## Phase 3: Transcript Persistence + Runtime Resume + Produced-Event Provenance

**Goal:** make persisted `completion_messages` the canonical agent runtime state.

Deliverables:

1. ClickHouse transcript table and repository/service,
2. append-only message persistence path,
3. resume-from-persisted-transcript executor behavior,
4. optional `produced_by_execution_id` in event history path.

Exit criteria:

1. Claimed/reclaimed agentic executions resume from persisted messages only.
2. Transcript SSE can stream persisted messages in canonical order.

Validation:

1. transcript persistence tests,
2. executor resume tests,
3. event provenance tests,
4. targeted ClickHouse repository tests.

## Phase 4: Agentic Workflow Execution APIs + UI Surfaces

**Goal:** expose execution list/detail/transcript visibility in backend and UI.

Deliverables:

1. agentic workflow execution list/detail/messages/SSE APIs,
2. UI execution table with filters,
3. execution detail page with transcript, child actions, and produced events,
4. live transcript tailing from persisted-message SSE.

Exit criteria:

1. Users can find running/completed agentic executions.
2. Users can inspect one execution and read the canonical message history.
3. Live-running workflows are observable in the UI without relying on transient token streams.

Validation:

1. backend API contract tests,
2. frontend lint/build/contracts for new execution surfaces,
3. end-to-end smoke covering list -> detail -> live-tail.

## Phase 5: Execution UX Alignment + Ontology-Backed Filtering

**Goal:** make the execution list/detail surfaces feel like the rest of Seer's ontology/history experience rather than a raw control-plane admin view.

Deliverables:

1. Remove `user_id` from the agentic workflow execution list UX and make it optional on the execution-list read API while leaving the generic action control plane keyed by `user_id`.
2. Replace raw workflow URI text filtering with an ontology-backed workflow selector populated from registered `seer:AgenticWorkflow` capabilities.
3. Reuse ontology display helpers so execution list/detail surfaces resolve workflow/action/event labels the same way other inspector/history pages do.
4. Tighten the execution list/detail copy, chips, and transcript/event/action presentation so it matches the ontology-based display experience used elsewhere.

Exit criteria:

1. Users can open `/inspector/agentic-workflows` without entering `user_id`.
2. Workflow filtering uses a dropdown/select of ontology-discovered agentic workflows rather than raw URI entry.
3. Execution list/detail surfaces use ontology-resolved labels/summaries instead of exposing raw URIs/identifiers as the primary display experience.
4. The execution UI follows the existing history/ontology filter and display patterns closely enough that it no longer feels like a separate admin surface.

Validation:

1. backend API/repository tests covering optional `user_id` execution queries,
2. frontend lint/build/contracts for the updated execution surfaces,
3. focused review against `useOntologyDisplay`, history-panel filter patterns, and object-history display surfaces.

## Phase 6: Canonical Docs and Spec Ratification

**Goal:** update architecture/spec docs once implementation stabilizes.

Deliverables:

1. `ARCHITECTURE.md` updates for managed-agent runtime boundaries and storage responsibilities,
2. `DESIGN.md` updates if execution semantics materially sharpen,
3. `docs/product-specs/*` updates if user-visible execution surfaces change from current drafts,
4. archive plan when implementation/ratification completes.

Exit criteria:

1. Canonical docs reflect the actual landed runtime model.
2. Active/completed indexes are coherent.

## Acceptance Criteria

1. `seer:AgenticWorkflow` is formally modeled as a Seer extension of `prophet:Workflow`.
2. Backend architecture is split cleanly between `agent_orchestration` and generic `actions` responsibilities.
3. The canonical unique runtime state for agentic workflow runs is persisted `completion_messages`.
4. Claimed/reclaimed agentic workflow runs resume from persisted transcript state rather than executor memory.
5. Agentic workflow runtime uses `load_skill`, but the visible skill catalog is restricted to deep ontology, object store, and object history rather than the full assistant skill catalog.
6. Ontology actions are exposed to agentic workflows through a dedicated `load_action` runtime tool whose loaded callable schema is derived from ontology `acceptsInput`.
7. `agent_orchestration` owns LLM calls and invokes ontology actions through the generic `actions` module rather than executing them directly in a parallel control plane.
8. Child ontology actions invoked by agentic workflows are traceable through `parent_execution_id`.
9. Events produced by orchestrated executions can optionally point to `produced_by_execution_id`.
10. Users can list/filter agentic workflow executions and drill into one execution's transcript in the UI.
11. Live execution visibility uses SSE of persisted transcript messages, not a separate ephemeral debug-only protocol.
12. The execution list read surface does not require `user_id` in the user-facing UI/API path.
13. Workflow filtering uses ontology-backed selectable registered agentic workflows rather than raw URI text entry.
14. Execution list/detail surfaces use the shared ontology-based display experience rather than primarily exposing raw URIs and unshaped control-plane data.

## Risks and Mitigations

1. Risk: control-plane and transcript-plane semantics drift.  
   Mitigation: keep control-plane metadata and transcript APIs explicitly separated, with one canonical source of truth for each.
2. Risk: resume behavior accidentally depends on transient executor memory.  
   Mitigation: add explicit resume tests that load only persisted transcript rows.
3. Risk: `leased`/`running` refactor creates orchestration confusion.  
   Mitigation: remove ambiguous dual semantics early and update all affected tests/contracts in one track.
4. Risk: agent transcript APIs become generic action APIs by accident.  
   Mitigation: keep transcript endpoints under an `agentic-workflows` namespace.
5. Risk: cross-store partial failure between PostgreSQL and ClickHouse leaves mismatched completion/event state.  
   Mitigation: document ordered persistence rules now and add hardening/outbox only if implementation evidence shows it is required.
6. Risk: managed-agent runtime silently inherits broad assistant tools and becomes hard to reason about.  
   Mitigation: lock a curated `load_skill` allowlist and require explicit `load_action` for ontology action execution.

## Validation Commands

Plan ratification / doc coherence:

1. `rg -n "agentic workflow|AgenticWorkflow|parent_execution_id|produced_by_execution_id|completion_messages" docs/exec-plans/active/managed-agent-runtime-and-agentic-workflows.md docs/exec-plans/active/index.md`
2. Manual link/reference review for touched docs

Implementation-phase validation targets:

1. `cd seer-backend && uv run pytest -q tests/test_actions_phase*.py`
2. `cd seer-backend && uv run pytest -q tests/test_history_phase2.py`
3. `cd seer-backend && uv run ruff check src tests`
4. `cd seer-ui && npm run lint`
5. `cd seer-ui && npm run build`
6. `cd seer-ui && npm run test:contracts`

## Docs Impact

Immediate:

1. `docs/exec-plans/active/managed-agent-runtime-and-agentic-workflows.md`
2. `docs/exec-plans/active/index.md`

Expected when implementation lands:

1. `ARCHITECTURE.md`
2. `DESIGN.md` if runtime boundary wording changes
3. `docs/product-specs/managed-agentic-workflows.md`
4. `docs/product-specs/managed-agent-controls-and-approvals.md`
5. `docs/exec-plans/completed/README.md`

## Decision Log

1. 2026-03-08: `seer:AgenticWorkflow` will extend `prophet:Workflow` and remain a normal executable capability with typed input and produced event contracts.
2. 2026-03-08: The managed-agent runtime will reuse generic action orchestration rather than introducing a parallel execution control plane.
3. 2026-03-08: The only canonical agent-specific run state in scope is persisted ordered `completion_messages`.
4. 2026-03-08: `leased` should not remain the semantic in-flight lifecycle state; `running` is canonical.
5. 2026-03-08: Agent transcript persistence should use a dedicated append-only ClickHouse table rather than mutable Postgres control-plane storage.
6. 2026-03-08: Child ontology action invocations from agentic workflows will be linked through `parent_execution_id`.
7. 2026-03-08: Event provenance will use optional `produced_by_execution_id` because not all events have a producing execution.
8. 2026-03-08: Agent transcript endpoints should be agentic-workflow-specific and not imply transcript semantics for non-agentic actions.
9. 2026-03-08: Workflow execution list/detail UI should reuse history-surface filtering/drill-in patterns where possible.
10. 2026-03-08: Managed-agent runtime should not inherit the full assistant skill catalog; it should reuse `load_skill` with a curated visible catalog limited to deep ontology, object store, and object history, and use `load_action` to expose ontology actions as callable tools.
11. 2026-03-08: Backend modularization should introduce `agent_orchestration` for LLM-backed agent execution while retaining `actions` as the generic action execution/orchestration domain.
12. 2026-03-08: The Seer ontology extension will live in `prophet/seer.ttl` and be loaded automatically alongside `prophet/prophet.ttl` by backend ontology validation/bootstrap paths.
13. 2026-03-08: `action_kind` classification is derived from ontology subtype relationships with precedence `agentic_workflow` > `process` > `workflow`, so custom Prophet subclasses still map cleanly into the generic action control plane.
14. 2026-03-08: Phase 3 transcript sequencing is backend-assigned per `(execution_id, attempt_no)` at append time, while resume remains attempt-scoped and transcript reads may still span all attempts for audit/debug views.
15. 2026-03-08: Phase 4 execution list APIs require explicit `user_id` until the generic action control plane grows a different authenticated scoping model.
16. 2026-03-08: Phase 4 transcript fetch and SSE tailing use a derived monotonic `after_ordinal` cursor over canonical `(attempt_no, sequence_no)` ordering so the UI can page and resume across attempts without ambiguous per-attempt cursors.
17. 2026-03-08: Follow-on execution UX work will remove `user_id` from the execution-list read surface only, keeping `user_id` mandatory in the generic action control plane while making the agentic-workflow query surface feel like the rest of the inspector UX.
18. 2026-03-08: The execution UI should reuse shared ontology/history display primitives and selectors rather than treating workflow URIs, event types, and action identities as raw control-plane text.
19. 2026-03-08: Phase 5 keeps `user_id` mandatory for generic action submit/claim/heartbeat semantics, but the dedicated agentic workflow execution list read surface treats `user_id` as optional so the inspector can open directly into ontology-scoped workflow runs.

## Progress Log

1. 2026-03-08: Opened the missing follow-on runtime-design plan explicitly deferred by `docs/exec-plans/completed/ai-first-investigation-and-managed-agents.md`.
2. 2026-03-08: Reviewed the Prophet metamodel and small-business ontology example to ground the plan in actual `Action` / `Workflow` / `Event` / `EventTrigger` / `ObjectReference` contracts rather than only product-doc abstractions.
3. 2026-03-08: Locked the initial architecture direction around Seer ontology extension + generic action control plane + ClickHouse transcript history + execution lineage/provenance fields.
4. 2026-03-08: Added explicit managed-agent runtime tool policy: reuse `load_skill` with a curated deep-ontology/object-store/object-history catalog plus `load_action` for dynamically exposing ontology actions as callable tools.
5. 2026-03-08: Locked backend module split: `agent_orchestration` owns LLM calls/transcript/runtime behavior; `actions` owns generic action execution lifecycle and child ontology action execution.
6. 2026-03-08: Baseline validation ledger before Phase 2 is clean enough to proceed: `cd seer-backend && uv run ruff check src tests` passed, `cd seer-backend && uv run pytest -q` passed (`126 passed, 6 FastAPI deprecation warnings`), `cd seer-ui && npm run lint` passed, and `cd seer-ui && npm run build` passed.
7. 2026-03-08: Phase 2 is opened for worker execution with controller-gated requirements to read this entire plan first, use the `execute-phase` skill, update this plan while working, run scoped validation, and create a phase commit.
8. 2026-03-08: Phase 2 implementation landed in the generic action control plane: `ActionKind` (`process`, `workflow`, `agentic_workflow`), optional `parent_execution_id`, `running` replacing `leased` as the canonical in-flight state, and ontology-driven submit-time classification derived from action type metadata.
9. 2026-03-08: Phase 2 validation completed successfully: `cd seer-backend && uv run ruff check src tests` passed, targeted `uv run pytest -q tests/test_actions_submit.py tests/test_actions_claim.py tests/test_actions_concurrency.py tests/test_actions_repository.py tests/test_actions_status_api.py tests/test_ontology_phase1.py` passed (`52 passed, 3 warnings`), and full `uv run pytest -q` passed (`129 passed, 6 warnings`).
10. 2026-03-08: Phase 3 implementation landed backend-only primitives under `seer_backend/agent_orchestration`: append-only transcript models/repository/service, ordered resume-state reconstruction from persisted `completion_messages`, ClickHouse transcript migration, and optional `produced_by_execution_id` carried through history ingest/timeline/object-event/relation models.
11. 2026-03-08: Phase 3 focused validation passed before the full backend gate: `cd seer-backend && uv run ruff check src tests` passed and targeted `uv run pytest -q tests/test_agent_orchestration_phase3.py tests/test_history_phase2.py` passed (`16 passed, 1 warning`).
12. 2026-03-08: Phase 3 final backend validation completed successfully: `cd seer-backend && uv run ruff check src tests` passed and full `uv run pytest -q` passed (`133 passed, 6 warnings`).
13. 2026-03-08: Phase 4 landed dedicated `/api/v1/agentic-workflows/executions` list/detail/message/stream APIs backed by a new `agent_orchestration` query service that composes generic `actions`, persisted transcripts, and produced-event history without inventing a parallel control plane.
14. 2026-03-08: Phase 4 landed the inspector execution surfaces at `/inspector/agentic-workflows` and `/inspector/agentic-workflows/[executionId]`, reusing history-style filtering and drill-in patterns for execution list, child action lineage, produced events, and live persisted-message transcript tailing.
15. 2026-03-08: Phase 4 validation completed successfully: `cd seer-backend && uv run ruff check src tests` passed, `cd seer-backend && uv run pytest -q` passed (`138 passed, 6 warnings`), `cd seer-ui && npm run lint` passed, `cd seer-ui && npm run build` passed, and `cd seer-ui && npm run test:contracts` passed (`49 passed`).
16. 2026-03-08: Phase 5 docs/archive closure was intentionally deferred after review of the new execution surfaces showed UX drift from the shared ontology/history display patterns: the list still required `user_id`, workflow filtering was raw URI entry instead of ontology-backed selection, and list/detail views still exposed raw URI/control-plane data more directly than other inspector surfaces.
17. 2026-03-08: Phase 5 implementation landed optional `user_id` support on `/api/v1/agentic-workflows/executions`, propagated the optional filter through `agent_orchestration` and `actions` list queries only, and removed the top-level `user_id` echo from the dedicated execution-list response while leaving generic action control-plane write/claim semantics unchanged.
18. 2026-03-08: Phase 5 UI execution alignment landed on `/inspector/agentic-workflows` and `/inspector/agentic-workflows/[executionId]`: the list now opens without a user-id gate, workflow filtering uses an ontology-backed selector of registered `seer:AgenticWorkflow` capabilities, and list/detail tables resolve workflow/action/event labels through shared ontology display helpers with reduced raw control-plane copy.
19. 2026-03-08: Phase 5 validation completed successfully: `cd seer-backend && uv run ruff check src tests` passed, `cd seer-backend && uv run pytest -q tests/test_agent_orchestration_phase4.py` passed (`6 passed`), `cd seer-ui && npm run lint` passed, `cd seer-ui && npm run build` passed, and `cd seer-ui && npm run test:contracts` passed (`10 passed`).

## Progress Tracking

- [x] Phase 1 architecture lock opened in docs
- [x] Phase 2 ontology extension + action control-plane evolution
- [x] Phase 3 transcript persistence + resume + provenance
- [x] Phase 4 agentic workflow execution APIs + UI surfaces
- [x] Phase 5 execution UX alignment + ontology-backed filtering
- [ ] Phase 6 canonical docs/spec ratification

Current execution state:

1. `completed`: Phase 2 ontology extension + action control-plane evolution.
2. `completed`: Phase 3 transcript persistence + runtime resume + produced-event provenance.
3. `completed`: Phase 4 agentic workflow execution APIs + UI surfaces.
4. `completed`: Phase 5 execution UX alignment + ontology-backed filtering.
5. `pending`: Phase 6 canonical docs/spec ratification follows after the execution UX alignment phase lands.
