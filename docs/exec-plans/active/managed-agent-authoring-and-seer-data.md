# Managed Agent Authoring And `seer_data`

**Status:** in_progress  
**Target order:** post-MVP follow-on  
**Agent slot:** AGENT-MANAGED-AUTHORING-1  
**Predecessor:** `docs/exec-plans/completed/managed-agent-runtime-and-agentic-workflows.md`  
**Last updated:** 2026-03-15

---

## Purpose / Big Picture

Seer currently lets users inspect managed-agent executions, but it does not let them author managed agents inside the product. After this plan lands, users can open `/inspector/managed-agents`, browse a real table of managed agents, create a new managed agent from the UI, edit an existing one, and inspect runs from within that agent's detail page. The authored agent definitions become canonical RDF resources stored in a dedicated Fuseki named graph, `seer_data`, instead of ad hoc frontend-only state or a separate non-ontology registry.

The end-user result should feel like an agent management product, not a raw execution log. The index page is agent-first, the detail page starts with the agent's definition, the runs experience is subordinate to that agent, and the create/edit flow maps cleanly onto the Prophet action model without exposing raw Turtle authoring.

## Progress

- [x] 2026-03-15 Create the active execution plan, add it to `docs/exec-plans/active/index.md`, and record baseline validation results before implementation.
- [x] 2026-03-15 Phase 1: land backend `seer_data` authoring/storage/query support plus managed-agent authoring APIs and tests.
- [ ] 2026-03-15 Phase 2: land agent-first UI routes, managed-agent list/detail/runs surfaces, create/edit experience, and frontend validation.
- [ ] 2026-03-15 Phase 3: ratify canonical docs/specs, run final validation, archive the plan, and update indexes/references.

## Surprises & Discoveries

- 2026-03-15: The current `/inspector/managed-agents` experience is execution-first. `seer-ui/app/components/inspector/agentic-workflow-execution-panel.tsx` lists runs directly, and `seer-ui/app/inspector/managed-agents/[executionId]/page.tsx` is keyed by execution id rather than managed-agent identity.
- 2026-03-15: Managed-agent discovery today is ontology-query driven only. `seer-ui/app/lib/api/agentic-workflows.ts` builds the selector via `queryOntologySelect(...)`, while `seer-backend/src/seer_backend/actions/service.py` validates executability by querying ontology for `prophet:acceptsInput` and `prophet:producesEvent`.
- 2026-03-15: The current ontology service scopes read queries to `[base graph, current release graph]` only. UI-authored agents stored in a new named graph will remain invisible to discovery and validation unless those query scopes are widened deliberately.
- 2026-03-15: Prophet action validity is stricter than just `rdf:type seer:AgenticWorkflow`. A valid authored managed agent must also own exactly one `prophet:ActionInput` and one `prophet:Event`, and both containers are closed SHACL shapes.
- 2026-03-15: Existing action payload validation treats `prophet:ObjectReference` inputs as generic JSON objects, not a deeper object-reference wire contract. That keeps the first editor payload surface simpler because object-reference fields only need to submit an object-shaped value.
- 2026-03-15: Widening `OntologyService._scoped_graphs()` is enough to make UI-authored managed agents discoverable to existing action validation and frontend ontology-backed selectors. No changes were required in `ActionsService` beyond using the broader ontology scope.

## Decision Log

- 2026-03-15, Codex: Store UI-authored managed agents as canonical RDF in a dedicated Fuseki named graph, `seer_data`, rather than PostgreSQL-only records. Rationale: Seer's executable capability model is ontology-first, and introducing a separate control-plane catalog for agent definitions would violate current architecture.
- 2026-03-15, Codex: Keep v1 lifecycle forward-only and live on save. Rationale: the user explicitly rejected draft/publish; `seer:enabled` is sufficient for first-pass operational control.
- 2026-03-15, Codex: Use an agent-first information architecture with nested run routes under the parent managed agent. Rationale: this aligns with the requested UX and keeps execution inspection anchored to the authored capability.
- 2026-03-15, Codex: Use encoded canonical IRI as the route key for managed-agent detail/edit pages. Rationale: the RDF subject IRI remains the identity, while the route stays reversible and stable without inventing a second surrogate identifier.
- 2026-03-15, Codex: Support first-class input/output schema authoring in v1 by reusing existing ontology value types rather than building a full type authoring system. Rationale: the Prophet action model requires input/output shape authoring, but new type authoring is broader than the requested scope.
- 2026-03-15, Codex: Keep backend authoring inside `OntologyService` and the existing `agentic_workflows` API router instead of adding a separate managed-agent registry service. Rationale: the authoritative persistence and validation concerns are ontology graph concerns, and this keeps discovery/execution aligned with current architecture.
- 2026-03-15, Codex: Use a pragmatic editor field contract of `required` + `multi_value` + (`value_type_iri` or `object_model_iri`) instead of exposing raw cardinality and RDF type internals in the first backend payload. Rationale: this is sufficient to generate Prophet-valid property definitions while keeping the UI schema builder intuitive.

## Outcomes & Retrospective

2026-03-15 baseline setup:

1. The execution plan and active index entry were created before code changes.
2. Baseline validation was clean:
   - `cd /workspaces/seer-python/seer-backend && .venv/bin/ruff check .` passed
   - `cd /workspaces/seer-python/seer-backend && .venv/bin/pytest` passed (`134 passed in 37.12s`)
   - `cd /workspaces/seer-python/seer-ui && npm run build` passed
3. No unrelated failures are currently recorded, so any new failure during execution should be treated as a regression until proven otherwise.

2026-03-15 Phase 1 backend delivery:

1. Added managed-agent authoring models/RDF helpers and a dedicated `seer_data` graph path in backend ontology infrastructure.
2. Added managed-agent authoring endpoints under `/api/v1/agentic-workflows/managed-agents` plus `/managed-agents/editor-catalog`.
3. Widened ontology read/query scope to include `seer_data`, which makes authored agents discoverable to existing action validation and managed-agent capability selection.
4. Added targeted backend coverage proving a UI-authored managed agent can be created, listed, fetched, updated, and submitted through the existing `/actions/submit` contract as an `agentic_workflow`.
5. Phase 1 validation passed:
   - `cd /workspaces/seer-python/seer-backend && .venv/bin/ruff check src/seer_backend/ontology src/seer_backend/api/agentic_workflows.py tests/test_managed_agent_authoring_phase1.py`
   - `cd /workspaces/seer-python/seer-backend && .venv/bin/pytest tests/test_managed_agent_authoring_phase1.py`
   - `cd /workspaces/seer-python/seer-backend && .venv/bin/pytest tests/test_agent_orchestration_phase4.py tests/test_managed_agent_authoring_phase1.py`

## Context and Orientation

The current managed-agent runtime was delivered in `docs/exec-plans/completed/managed-agent-runtime-and-agentic-workflows.md`. That work established managed agents as ontology-defined executable capabilities and delivered execution list/detail APIs plus a run-inspection UI, but it explicitly left authoring out of scope.

Relevant backend paths:

- `seer-backend/src/seer_backend/ontology/`
  - current ontology ingest/query services and named-graph repository adapters
- `seer-backend/src/seer_backend/actions/service.py`
  - resolves action executability from ontology by requiring `acceptsInput` and `producesEvent`
- `seer-backend/src/seer_backend/api/agentic_workflows.py`
  - current execution list/detail/message endpoints only
- `seer-backend/tests/test_agent_orchestration_phase4.py`
  - existing managed-agent execution API coverage

Relevant frontend paths:

- `seer-ui/app/inspector/managed-agents/page.tsx`
  - current top-level managed-agents route
- `seer-ui/app/inspector/managed-agents/[executionId]/page.tsx`
  - current run-detail route
- `seer-ui/app/components/inspector/agentic-workflow-execution-panel.tsx`
  - current execution list UI
- `seer-ui/app/components/inspector/agentic-workflow-execution-details-panel.tsx`
  - current transcript/detail UI
- `seer-ui/app/lib/api/agentic-workflows.ts`
  - current frontend API client
- `seer-ui/tests/agentic-workflows.contract.test.mjs`
  - current route/API contract assertions

Key architectural constraint: the ontology is still the executable capability catalog. This plan adds constrained authoring for managed agents only; it must not turn Seer into a general ontology editor or invent a separate managed-agent registry detached from RDF identity.

## Plan of Work

Phase 1 adds a backend authoring boundary for managed agents backed by a dedicated named graph. This includes a new constant/graph identity for `seer_data`, write operations that replace only the authored agent's RDF cluster instead of replacing an entire graph, query-scope updates so managed-agent discovery sees the new graph, and API contracts for managed-agent list/detail/create/update plus an editor catalog of reusable ontology types and object models. The backend must also translate the editor payload into a Prophet-conformant action/input/event/property graph and validate that graph before persisting it.

Phase 2 reorients the UI around managed agents rather than runs. The list page becomes a table of authored agents with create CTA and search/filter support. The detail page becomes agent-centric with `Details` and `Runs` tabs. Create and edit pages share one editor that exposes basics, instruction, input schema, and output schema with an intuitive field-builder experience. Existing execution inspection is retained, but moved under nested routes scoped to a parent managed agent.

Phase 3 ratifies the product and architecture docs so repository truth matches the delivered behavior. It also performs final validation, archives the plan, and updates active/completed indexes and spec references.

## Concrete Steps

1. Create the active execution plan and register it in `docs/exec-plans/active/index.md`.
2. Run baseline validation before code changes:
   ```bash
   cd /workspaces/seer-python/seer-backend && .venv/bin/ruff check .
   cd /workspaces/seer-python/seer-backend && .venv/bin/pytest
   cd /workspaces/seer-python/seer-ui && npm run build
   ```
3. Implement backend `seer_data` graph support and managed-agent authoring APIs.
4. Add backend tests covering authoring, query visibility, validation, and execution compatibility.
5. Implement frontend agent-first routes, detail tabs, runs table, and create/edit editor.
6. Add/update frontend contract tests and run targeted frontend validation.
7. Update canonical docs/specs to reflect managed-agent authoring.
8. Run final validation and archive the plan.

Expected observable milestones:

- After Phase 1, API clients can list and mutate managed-agent definitions through dedicated endpoints, and ontology-backed action discovery sees authored agents stored in `seer_data`.
- After Phase 2, `/inspector/managed-agents` is an agent table with create CTA, and `/inspector/managed-agents/[agentKey]` opens a detail-first page with a nested runs experience.
- After Phase 3, docs/specs no longer describe managed-agent authoring as out of scope.

## Validation and Acceptance

Baseline validation:

- `cd /workspaces/seer-python/seer-backend && .venv/bin/ruff check .`
- `cd /workspaces/seer-python/seer-backend && .venv/bin/pytest`
- `cd /workspaces/seer-python/seer-ui && npm run build`

Phase 1 acceptance:

- Managed-agent authoring endpoints pass targeted backend tests.
- Action contract resolution succeeds for a managed agent authored only in `seer_data`.
- Invalid editor payloads fail with explicit validation detail rather than silent partial writes.

Phase 2 acceptance:

- `seer-ui/tests/agentic-workflows.contract.test.mjs` reflects the new route hierarchy and agent-first surfaces.
- `cd /workspaces/seer-python/seer-ui && npm run build` succeeds.
- Manual route behavior is coherent:
  - `/inspector/managed-agents` shows a managed-agent table
  - `/inspector/managed-agents/new` opens the editor
  - `/inspector/managed-agents/[agentKey]` defaults to `Details`
  - `/inspector/managed-agents/[agentKey]?tab=runs` or equivalent opens the runs table

Final acceptance:

- Canonical docs are updated in the same change.
- The active plan is archived to `docs/exec-plans/completed/`.
- Active/completed indexes and references are consistent.

Known baseline failures before implementation: none recorded yet. Update this section if the baseline commands reveal unrelated failures.

## Idempotence and Recovery

The backend write path must be safe to rerun for the same managed agent. Recovery should use subject-scoped replacement inside `seer_data`: delete the previous RDF cluster for that agent and rewrite the new validated cluster atomically from the backend's perspective. Do not use whole-graph replacement for authored data.

If execution stops mid-phase:

- use the `Progress` checklist as the source of truth for the current phase
- inspect the relevant `Phase Handoff` subsection for restart context
- run the targeted validation commands for the phase before resuming new edits
- never revert unrelated user changes if the tree becomes dirty; instead, work around them or ask if they conflict directly

If frontend route migration leaves stale links, the recovery path is to update route helpers and contract tests together before attempting broader UI validation.

## Artifacts and Notes

- Proposed named graph IRI: `urn:seer:ontology:data:seer_data`
- Proposed route model:
  - `/inspector/managed-agents`
  - `/inspector/managed-agents/new`
  - `/inspector/managed-agents/[agentKey]`
  - `/inspector/managed-agents/[agentKey]/edit`
  - `/inspector/managed-agents/[agentKey]/runs/[executionId]`
- Proposed RDF identity pattern:
  - managed agent: `urn:seer:managed-agent:{key}`
  - input: `urn:seer:managed-agent:{key}:input`
  - output event: `urn:seer:managed-agent:{key}:output`
- Baseline validation ledger (2026-03-15):
  - backend Ruff: pass
  - backend pytest: pass (`134 passed in 37.12s`)
  - frontend build: pass

## Interfaces and Dependencies

Important backend interfaces and modules:

- `OntologyService` and `OntologyRepository`
- `ActionsService` ontology validation adapter
- `agentic_workflows` API router
- new managed-agent authoring service/repository types

Important frontend interfaces and modules:

- `app/lib/api/agentic-workflows.ts`
- `app/types/agentic-workflows.ts`
- managed-agent list/detail/editor components and routes
- `app/lib/api/ontology.ts` for reusable editor catalogs when needed

Important external/model dependencies:

- Prophet SHACL and class/property model in `prophet/prophet.ttl`
- Seer ontology extension constants in `seer-backend/src/seer_backend/ontology/constants.py`

## Phase 1

### Phase Handoff

**Goal**

Land backend support for managed-agent authoring in `seer_data`, including write/query semantics, API contracts, and regression coverage proving authored agents are executable and discoverable.

**Scope Boundary**

Only backend/domain/API/test work for `seer_data` and managed-agent authoring. Do not implement the new frontend routes or editor UI in this phase beyond unavoidable type-contract alignment.

**Read First**

1. `AGENTS.md`
2. `PLANS.md`
3. `docs/exec-plans/active/managed-agent-authoring-and-seer-data.md`
4. `seer-backend/src/seer_backend/ontology/service.py`
5. `seer-backend/src/seer_backend/ontology/repository.py`
6. `seer-backend/src/seer_backend/actions/service.py`
7. `seer-backend/src/seer_backend/api/agentic_workflows.py`
8. `prophet/prophet.ttl`

**Files Expected To Change**

- `seer-backend/src/seer_backend/ontology/constants.py`
- `seer-backend/src/seer_backend/ontology/service.py`
- `seer-backend/src/seer_backend/ontology/repository.py`
- `seer-backend/src/seer_backend/api/agentic_workflows.py`
- new managed-agent authoring module(s) under `seer-backend/src/seer_backend/agent_orchestration/` or a dedicated adjacent domain
- `seer-backend/tests/test_agent_orchestration_phase4.py` and/or new targeted backend tests
- this plan file

**Validation**

- `cd /workspaces/seer-python/seer-backend && .venv/bin/ruff check .`
- `cd /workspaces/seer-python/seer-backend && .venv/bin/pytest tests/test_agent_orchestration_phase4.py`
- any new targeted backend pytest module added for managed-agent authoring

**Plan / Docs To Update**

- `Progress`
- `Surprises & Discoveries`
- `Decision Log`
- `Outcomes & Retrospective`
- this phase handoff subsection with `Status`, `Completion Notes`, and `Next Starter Context`

**Deliverables**

- dedicated `seer_data` graph support
- managed-agent list/detail/create/update API surface
- editor catalog endpoint or equivalent reusable backend contract for schema authoring
- regression tests for discovery/executability of authored agents

**Commit Expectation**

- One phase commit with subject: `Add managed-agent authoring backend and seer_data graph support`

**Known Constraints / Baseline Failures**

- Managed-agent authoring must remain ontology-first and Prophet-valid.
- Do not introduce a PostgreSQL-only managed-agent registry.
- Baseline failures: none recorded yet.

**Status**

Completed.

**Completion Notes**

Backend managed-agent authoring now persists RDF in `seer_data`, validates the merged ontology + authored graph before write, exposes list/detail/create/update/editor-catalog APIs, and keeps existing execution discovery working by including `seer_data` in ontology query scope.

**Next Starter Context**

Phase 2 should consume `/api/v1/agentic-workflows/managed-agents`, `/api/v1/agentic-workflows/managed-agents/{managed_agent_key}`, and `/api/v1/agentic-workflows/managed-agents/editor-catalog`. The backend payload uses `required`/`multi_value` plus `field_type` and either `value_type_iri` or `object_model_iri`, so the UI editor should model that shape directly rather than inventing a second schema form.

## Phase 2

### Phase Handoff

**Goal**

Replace the execution-first managed-agent UI with an agent-first management surface and ship the managed-agent create/edit experience.

**Scope Boundary**

Frontend routes, components, API client/types, contract tests, and any minimal backend wiring needed strictly for frontend integration. Do not reopen backend RDF modeling decisions unless Phase 1 evidence proves a blocking gap.

**Read First**

1. `AGENTS.md`
2. `PLANS.md`
3. `docs/exec-plans/active/managed-agent-authoring-and-seer-data.md`
4. `seer-ui/app/inspector/managed-agents/page.tsx`
5. `seer-ui/app/inspector/managed-agents/[executionId]/page.tsx`
6. `seer-ui/app/components/inspector/agentic-workflow-execution-panel.tsx`
7. `seer-ui/app/components/inspector/agentic-workflow-execution-details-panel.tsx`
8. `seer-ui/app/lib/api/agentic-workflows.ts`
9. `seer-ui/tests/agentic-workflows.contract.test.mjs`

**Files Expected To Change**

- managed-agent routes under `seer-ui/app/inspector/managed-agents/`
- new managed-agent list/detail/editor components under `seer-ui/app/components/inspector/`
- `seer-ui/app/lib/api/agentic-workflows.ts`
- `seer-ui/app/types/agentic-workflows.ts`
- `seer-ui/tests/agentic-workflows.contract.test.mjs`
- this plan file

**Validation**

- `cd /workspaces/seer-python/seer-ui && npm run build`
- `cd /workspaces/seer-python/seer-ui && node --test tests/agentic-workflows.contract.test.mjs`

**Plan / Docs To Update**

- `Progress`
- `Surprises & Discoveries`
- `Decision Log`
- `Outcomes & Retrospective`
- this phase handoff subsection with `Status`, `Completion Notes`, and `Next Starter Context`

**Deliverables**

- managed-agent table index with primary create CTA
- managed-agent detail page with `Details` and `Runs`
- nested run-detail route under the parent managed agent
- shared create/edit editor with input/output schema field builders

**Commit Expectation**

- One phase commit with subject: `Ship agent-first managed-agent authoring UI`

**Known Constraints / Baseline Failures**

- Preserve the repo's current visual language; do not introduce a disconnected design system.
- The editor must feel intuitive and standard, not like raw ontology/Turtle editing.
- Baseline failures: none recorded yet.

**Status**

Pending.

**Completion Notes**

Not started.

**Next Starter Context**

Reuse the current run-detail panel where possible, but re-anchor it under the agent route and move the top-level managed-agents page to an authored-agent table.

## Phase 3

### Phase Handoff

**Goal**

Ratify the new managed-agent authoring behavior in canonical docs, run final validation, and archive the completed plan.

**Scope Boundary**

Docs/spec/index/archive work only, plus final validation reruns and any tiny cleanup directly required to keep docs truthful.

**Read First**

1. `AGENTS.md`
2. `PLANS.md`
3. `docs/exec-plans/active/managed-agent-authoring-and-seer-data.md`
4. `VISION.md`
5. `ARCHITECTURE.md`
6. `docs/product-specs/index.md`
7. existing managed-agent specs under `docs/product-specs/`
8. `docs/exec-plans/active/index.md`
9. `docs/exec-plans/completed/README.md`

**Files Expected To Change**

- `VISION.md`
- `ARCHITECTURE.md`
- relevant docs under `docs/product-specs/`
- `docs/exec-plans/active/index.md`
- `docs/exec-plans/completed/README.md`
- move this plan to `docs/exec-plans/completed/`

**Validation**

- rerun the key backend/frontend validation commands from Phases 1 and 2
- `rg -n "out of scope|read-only for ontology|managed-agent authoring" VISION.md ARCHITECTURE.md docs/product-specs`

**Plan / Docs To Update**

- all living sections of this plan
- active/completed indexes
- any references that still point to the active plan path

**Deliverables**

- canonical docs/spec updates reflecting delivered managed-agent authoring
- archived completed plan with final retrospective
- updated indexes and references

**Commit Expectation**

- One phase commit with subject: `Ratify managed-agent authoring docs and archive execution plan`

**Known Constraints / Baseline Failures**

- Docs must reflect the delivered behavior, not the brainstorming state.
- Archive only after validation and acceptance are recorded.

**Status**

Pending.

**Completion Notes**

Not started.

**Next Starter Context**

Use the final working tree and validation ledger from Phases 1 and 2; do not archive until the plan's living sections are internally consistent.
