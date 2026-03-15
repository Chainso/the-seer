# Managed Agent Runtime Controls

**Status:** completed (`trusted-mode execution inspection surface; approvals deferred`)
**Owner plan:** `docs/exec-plans/completed/managed-agent-runtime-and-agentic-workflows.md`
**Last updated:** 2026-03-08

---

## What This Is

This spec defines the user-facing trusted-mode inspection surface for managed-agent executions in the current phase.

The delivered scope is about runtime visibility and auditability:

1. what execution is running or finished,
2. what it already did,
3. which child actions and produced events came from it,
4. and how a user inspects the canonical transcript history of that run.

## Why It Exists

Managed agents are only useful if users can understand what happened during a run.

In the current trusted-mode phase, that trust comes from:

1. visibility into execution state,
2. audit trails built from persisted transcript history,
3. explicit child-action and produced-event traceability,
4. and ontology-aligned presentation rather than raw backend-only identifiers.

## Core User Promise

At any point, the user should be able to answer:

1. what managed-agent action this run represents,
2. what has it done recently,
3. what actions and events are linked to it,
4. whether it is still running,
5. and what the canonical persisted transcript says happened.

## Primary User Flows

### Inspect Agent Run History

1. User opens `/inspector/managed-agents`.
2. User filters execution history by runtime state such as running, completed, failed, or dead-letter.
3. User can also narrow by time window and ontology-backed action selection.
4. User opens one execution from a browseable inspector card rather than an action-column-only table flow.
4. User sees:
   - managed-agent action identity,
   - current lifecycle state,
   - execution-chain orientation before transcript deep-reading,
   - recent decisions,
   - canonical persisted transcript messages,
   - executed actions,
   - produced events,
   - failures.
5. Transcript entries are grouped and summarized for scanability, while raw payloads and identifiers remain available as supporting detail.
6. User can inspect the evidence behind a major decision and watch newly persisted transcript messages arrive live while the execution is still running.

### Inspect Execution Traceability

1. User opens one execution detail page.
2. The page shows child actions and produced events in dedicated tables.
3. Managed-agent action, child action, and event names resolve through shared ontology display helpers.
4. Raw identifiers remain available as supporting detail when needed for audit/debug work.

## Control Surface Requirements

The control surface should expose:

1. current lifecycle state,
2. execution list/history with reasonable filters,
3. execution detail drill-in,
4. canonical persisted transcript messages for one run,
5. child action lineage,
6. produced-event provenance,
7. trusted-mode execution state,
8. and live transcript tailing for running executions.

## Trusted-Mode Scope

This spec does not define final organizational authz or approval workflows.

Current phase assumptions:

1. Seer runs in a trusted/internal environment.
2. Managed agents operate with runtime guardrails rather than finalized role-based authorization.
3. Execution list reads do not require `user_id`, but generic action submit/claim/heartbeat semantics still do.
4. Final authz and approval semantics are intentionally deferred.

## Audit UX Requirements

Users should be able to reconstruct the agent's behavior over time.

Audit records should show:

1. investigation steps that materially informed a decision,
2. executed actions,
3. produced events,
4. canonical persisted transcript messages in execution order,
5. failures and retries,
6. returned results,
7. and ontology-resolved labels for managed-agent action / child action / event identity.

## Default Safety Posture

The current trusted-mode runtime assumes conservative runtime tooling and explicit auditability.

Examples:

1. managed-agent runtime should not silently expand beyond its restricted `load_skill` catalog,
2. ontology-defined execution should be exposed through explicit `load_action`,
3. canonical transcript history should be reconstructable from persisted `completion_messages`,
4. and operator visibility should come from persisted execution state rather than ephemeral debug streams.

## Relationship To Investigation UX

The product should connect investigation and control.

That means:

1. a user can inspect a managed-agent run with the same ontology-aware display patterns used elsewhere in Seer,
2. a user can inspect an agent's reasoning through canonical transcript history,
3. and a user can jump from execution detail into action/event evidence rather than reading only raw logs.

## Acceptance Expectations

1. Users can inspect recent agent decisions without reading raw logs.
2. Users can list/filter agent executions and drill into one execution's transcript, child actions, and produced events.
3. Users can watch a running execution through persisted-message live tailing rather than a token-only debug stream.
4. The execution list read surface works without `user_id`, while generic action control-plane write/claim semantics remain user-scoped.
5. Managed-agent action, child action, and event identity are shown with ontology-resolved labels as the primary presentation.
6. Audit history is sufficient to explain what happened to a non-author of the agent.
7. Raw action/event identifiers remain available for audit/debug work, but do not dominate the primary hierarchy.
8. The control model is understandable to someone who does not already know Seer's internal architecture.

## Out Of Scope For This Spec

1. Final organization/role model for authz or approvals.
2. Pause/resume/revoke controls and post-activation guardrail editing UX.
3. Final alerting and notification channels.
4. Final legal/compliance packaging.

## Follow-Up Gaps

1. Approval flows remain deferred beyond the current trusted-mode execution visibility surface.
2. Pause/resume/revoke semantics for in-flight work still need product definition and implementation.
3. Runtime guardrail editing after activation still needs a dedicated delivered UX.
