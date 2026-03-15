# Managed Agent Actions

**Status:** completed (`current managed-agent runtime and execution surface`)
**Owner plan:** `docs/exec-plans/completed/managed-agent-runtime-and-agentic-workflows.md`
**Last updated:** 2026-03-08

---

## What This Is

This spec defines the current managed-agent runtime model and execution visibility surface.

The delivered model is:

1. the ontology defines executable actions,
2. `seer:AgenticWorkflow` extends `prophet:Action`,
3. every managed-agent run is also a generic action execution,
4. `agent_orchestration` owns LLM-backed execution and transcript semantics,
5. `actions` remains the generic execution control plane,
6. and Seer exposes dedicated execution list/detail/live-tail surfaces for those runs.

This is not a low-code workflow builder or a second capability model outside the ontology.

## Why It Exists

Managed-agent execution needs to feel like a first-class Seer capability rather than an opaque worker queue.

The delivered runtime surface lets users:

1. find managed-agent runs without dropping into backend-only control-plane views,
2. inspect canonical transcript history for one run,
3. understand which child actions and produced events came from that run,
4. and monitor live progress through persisted-message tailing.

## Product Model

Managed-agent execution now has four product-visible layers:

1. `Ontology-defined action`
   - source of truth for the executable action concept
   - represented in Seer as `seer:AgenticWorkflow`
2. `Generic action execution record`
   - canonical lifecycle state, attempts, lineage, and lease metadata
   - persisted in PostgreSQL through the `actions` control plane
3. `Canonical transcript state`
   - ordered append-only `completion_messages`
   - persisted in ClickHouse for inspection and resume
4. `Execution visibility surface`
   - dedicated execution list, detail, and transcript stream APIs/UI
   - rendered with ontology-aligned labels and filters rather than raw URI-first controls

## Authoring Boundary

Ontology authoring remains outside Seer.

That means:

1. action definitions originate in Prophet plus Seer ontology extensions,
2. Seer ingests those definitions, including the `seer:AgenticWorkflow` subtype,
3. Seer does not provide ontology authoring or a separate workflow-graph editor,
4. and the runtime/UI treat managed-agent actions as ontology-discovered executable capabilities.

## Primary User Flow

1. User opens `/inspector/managed-agents`.
2. Seer lists recent managed-agent runs without requiring a `user_id` entry gate.
3. User filters by lifecycle state, time window, and ontology-backed action selection.
4. User opens one run.
5. Seer shows:
   - execution summary,
   - canonical persisted transcript messages,
   - child action executions,
   - produced events,
   - live transcript updates for running executions.
6. The UI resolves action and event labels through shared ontology display helpers, with raw identifiers available as supporting detail.

## Agent Runtime Expectations

The current managed-agent runtime model is:

1. `agent_orchestration` owns LLM-backed execution and transcript reconstruction from persisted `completion_messages`,
2. runtime tool access is intentionally restricted,
3. `load_skill` is limited to deep ontology, object store, and object history,
4. ontology-defined execution flows through `load_action`,
5. child ontology actions remain ordinary action executions linked by `parent_execution_id`,
6. and produced events may carry `produced_by_execution_id` when runtime execution emitted them.

## What Seer Must Persist

1. ontology action identity,
2. generic execution lifecycle state and attempts,
3. canonical ordered transcript `completion_messages`,
4. child action lineage through `parent_execution_id`,
5. produced-event provenance through `produced_by_execution_id` when present,
6. and enough execution metadata to support list/detail/live-tail inspection.

## What Seer Must Not Require

1. A compiled DAG as the canonical representation.
2. A separate action registry detached from the ontology.
3. A second transcript protocol outside canonical persisted `completion_messages`.
4. A `user_id` lookup gate just to open the execution list surface.

## Relationship To The Ontology

The ontology remains the capability catalog.

That means:

1. ordinary actions and managed-agent actions are both discoverable through ontology concepts,
2. `seer:AgenticWorkflow` composes as a subtype of `prophet:Action`,
3. typing and produced-event expectations come from ontology definitions,
4. execution filtering/display uses ontology-discovered actions and shared ontology labels,
5. and Seer does not invent a conflicting capability model.

## User Trust Requirements

The delivered execution surfaces must make the following clear:

1. which action is running,
2. what lifecycle state the run is in,
3. what transcript messages were canonically persisted,
4. which child actions were invoked,
5. which produced events came from the run,
6. and whether the execution is still live or terminal.

## Outcome Expectations

Managed-agent execution inspection is not useful if it only exposes raw control-plane rows.

The product should show:

1. what the action did,
2. what actions it triggered,
3. what events it produced,
4. and the canonical message history that explains the run.

## Acceptance Expectations

1. Users can list/filter managed-agent executions from a dedicated inspector surface.
2. The execution list read surface does not require `user_id`, while generic action control-plane write/claim semantics still do.
3. Filtering uses ontology-backed selectable registered managed-agent actions rather than raw URI text entry.
4. Users can drill into one execution and read canonical persisted transcript history.
5. Execution detail shows child actions and produced events with explicit lineage/provenance data.
6. Live execution visibility uses SSE of persisted transcript messages rather than an ephemeral token-only stream.
7. Execution history and drill-in views use ontology-resolved action and event labels as the primary presentation, with raw identifiers available as supporting detail.

## Out Of Scope For This Spec

1. Managed-agent activation/editor UX and ongoing configuration authoring.
2. Final billing, quotas, or multi-tenant packaging.
3. Final authz, approvals, or pause/resume/revoke controls.
4. Broader assistant skill-catalog exposure beyond the restricted managed-agent runtime tool policy.

## Follow-Up Gaps

1. Activation, instruction editing, and runtime-guardrail authoring still need their own delivered control surface.
2. Pause/resume/revoke semantics remain deferred beyond the current execution visibility phase.
3. Final authz and approval workflows remain intentionally out of scope for the trusted-mode runtime.
