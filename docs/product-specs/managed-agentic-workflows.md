# Managed Agent Actions

**Status:** completed (`current managed-agent authoring, catalog, and execution surface`)
**Owner plan:** `docs/exec-plans/completed/managed-agent-authoring-and-seer-data.md`
**Last updated:** 2026-03-16

---

## What This Is

This spec defines the current Seer-managed experience for authoring, browsing, editing, and operating managed agents.

The delivered model is:

1. the ontology remains the executable capability catalog,
2. `seer:AgenticWorkflow` remains a subtype of `prophet:Action`,
3. Seer can now author managed-agent RDF definitions into a dedicated `seer_data` named graph,
4. every managed-agent run is still a generic action execution in the shared control plane,
5. Seer now automatically claims and runs managed agents through a Seer-owned runner service backed by the shared copilot runtime,
6. `agent_orchestration` owns transcript persistence plus produced-event provenance for those runs,
7. and the inspector is now agent-first instead of execution-first.

This is still not a general ontology editor, a low-code workflow compiler, or a separate action registry.

## Why It Exists

Managed agents are not operationally useful if Seer can only inspect runs that were defined elsewhere.

The delivered surface lets users:

1. browse all Seer-authored managed agents from one table,
2. create or edit a managed agent without writing Turtle,
3. inspect the managed agent definition before drilling into runs,
4. and then inspect canonical run history nested under that agent.
5. and rely on Seer to pick up those runs automatically in the default stack.

## Product Model

Managed-agent operations now have six product-visible layers:

1. `Canonical RDF definition`
   - one `seer:AgenticWorkflow`
   - one `prophet:ActionInput`
   - one `prophet:Event`
   - stored in the dedicated `seer_data` named graph
2. `Managed-agent catalog surface`
   - `/inspector/managed-agents`
   - table of authored managed agents with search and enabled-state filtering
3. `Managed-agent definition surface`
   - `/inspector/managed-agents/[managedAgentKey]`
   - details-first page with instruction, input schema, output schema, and edit controls
4. `Managed-agent execution records`
   - generic action lifecycle state, attempts, lineage, and lease metadata
   - persisted in PostgreSQL through the `actions` control plane
5. `Seer-owned execution runner`
   - internal claim path for `agentic_workflow` rows across users
   - default local stack service that executes Seer-authored managed agents through the shared copilot runtime
   - managed-agent-specific prompt optimized for accurate, precise task completion
   - restricted runtime tool policy: managed-agent `load_skill` plus `load_action`
   - prompt guidance that tells the runner to inspect existing objects/events through object-store and object-history evidence before acting, to invoke ontology-defined actions through `load_action` when appropriate, and to keep moving without asking a live human clarifying questions mid-run
   - explicit self-recursive guardrail: a managed agent must not `load_action` its own action URI
   - public `/api/v1/actions/claim` exclusion for managed-agent rows
6. `Canonical transcript state`
   - ordered append-only `completion_messages`
   - persisted in ClickHouse for inspection and resume

## Authoring Boundary

Ontology authoring still originates in Prophet for the general business ontology.

The Seer authoring boundary is intentionally constrained:

1. Seer may author managed-agent RDF clusters only,
2. those authored clusters live in the dedicated `seer_data` named graph,
3. the editor maps to Prophet-valid action/input/event/property structures rather than raw Turtle,
4. and Seer still does not offer general object-model, event-model, or arbitrary ontology editing.

## Primary User Flows

### Browse Managed Agents

1. User opens `/inspector/managed-agents`.
2. Seer shows a table of managed agents, not a run list.
3. User searches by name/key/description or filters by enabled state.
4. User opens one managed agent to review its definition first.

### Create Or Edit A Managed Agent

1. User clicks `New Managed Agent` from the index page, or `Edit` from an agent page.
2. Seer shows one shared editor page with:
   - basics,
   - instruction,
   - input definition,
   - output definition,
   - schema field builders,
   - generated identity preview.
3. User saves once.
4. Seer validates the definition and persists the canonical RDF cluster in `seer_data`.

### Inspect Runs For One Managed Agent

1. User opens `/inspector/managed-agents/[managedAgentKey]`.
2. Seer defaults to the `Details` tab.
3. User switches to `Runs`.
4. Seer shows only the runs for that managed agent.
5. User opens one nested run under `/inspector/managed-agents/[managedAgentKey]/runs/[executionId]`.
6. Seer shows transcript, related actions, and produced events with ontology-aware labeling, including persisted managed-agent tool activity when the run loaded skills or actions.
7. If the run ended in `failed_terminal` or `dead_letter`, Seer exposes a retry button that creates a fresh queued execution from the same managed-agent action and payload, then navigates to the new run.

### Execute A Managed Agent

1. User submits the managed-agent action through the shared action submit surface.
2. Seer stores the run in the shared `actions` control plane as `action_kind=agentic_workflow`.
3. The Seer-owned managed-agent runner claims that run internally; external workers do not lease it through `POST /api/v1/actions/claim`.
4. Seer executes the managed agent through the shared copilot runtime using the managed-agent prompt plus restricted `load_skill` / `load_action`, rejects self-recursive `load_action` attempts against the currently executing managed agent, persists transcript messages, emits the output event, and updates the shared action lifecycle state.

## Relationship To The Ontology

The ontology remains the capability catalog.

That means:

1. managed-agent definitions are canonical RDF resources, not frontend-only documents,
2. UI-authored managed agents become discoverable executable capabilities through ontology queries,
3. execution validation still resolves `acceptsInput` and `producesEvent` from ontology state,
4. and Seer does not invent a conflicting capability registry outside RDF identity.

## User Trust Requirements

The delivered surface must make the following clear:

1. what managed agents exist,
2. which ones are enabled,
3. what instruction and schema each one has,
4. what runs belong to that agent,
5. what happened during a run,
6. and which raw identifiers back the visible definition and execution state.

## Acceptance Expectations

1. Users can browse a managed-agent table from `/inspector/managed-agents`.
2. The page exposes a primary `New Managed Agent` CTA and matching empty state.
3. Users can create and edit a managed agent through one shared editor screen.
4. The editor exposes basics, instruction, input schema, and output schema without exposing raw Turtle.
5. Users can open one managed agent and land on `Details` first.
6. Users can switch to a `Runs` tab that is scoped to that agent.
7. Users can open one nested run and inspect transcript, related actions, and produced events.
8. The UI presents ontology-resolved names and supporting identifiers together, rather than raw URI-first controls.
9. Default-stack managed-agent submissions leave `queued` automatically because Seer picks them up without an external worker.
10. Terminal failed managed-agent runs can be manually retried from the run detail UI, and the retry creates a new execution instead of mutating the failed record.

## Out Of Scope For This Spec

1. General ontology authoring in Seer beyond constrained managed-agent authoring.
2. Final billing, quotas, or multi-tenant packaging.
3. Final authz, approvals, or pause/resume/revoke controls.
4. Broader assistant skill-catalog exposure beyond the restricted managed-agent runtime tool policy.

## Follow-Up Gaps

1. Final authz and approval workflows remain intentionally out of scope for the trusted-mode runtime.
2. Pause/resume/revoke semantics remain deferred beyond the current execution and authoring surface.
3. Broader runtime guardrail editing beyond `enabled` and instruction/schema definition still needs its own product pass.
