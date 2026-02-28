# Post-MVP Exec Plan: `seer-ui` Legacy Baseline Adaptation to Canonical Backend

**Status:** in_progress  
**Target order:** post-MVP track 2 (pivoted)  
**Agent slot:** UX-R2  
**Predecessor:** `/home/chanzo/code/large-projects/seer-python/docs/exec-plans/completed/ui-experience-replatform-2026.md`  
**Successor:** TBD (post-MVP plan chain)  
**Last updated:** 2026-02-28

---

## Pivot Summary (2026-02-28)

Repository baseline changed:

1. Previous `seer-ui/src/*` replatformed UI was removed.
2. Legacy old UI was moved into `seer-ui/app/*` and is now the active frontend baseline.

As a result, this plan is now a backend-contract adaptation plan over the legacy UI baseline, not a pattern-port plan.

## Objective

Adapt the current `seer-ui` (legacy baseline) to canonical Seer backend contracts and current product boundaries for:

1. Read-only ontology experience.
2. Process mining and analytics experience.
3. History-first object exploration (latest snapshots + per-object timeline).

## Current Delta to Close

Legacy UI currently expects:

1. Base URL default `http://localhost:8080/api`
2. Legacy ontology endpoints (`/ontology/graph`, `/ontology/actions`, `/ontology/*types`, mutations).
3. Legacy process endpoint (`/process-mining/ocpn`).
4. Legacy ontology analytics endpoints (`/analytics/ontology/flows`, `/analytics/ontology/durations`).

Canonical backend provides:

1. `/api/v1/ontology/current`, `/concepts`, `/concept-detail`, `/query`, `/copilot`
2. `/api/v1/process/mine`, `/traces`
3. `/api/v1/ai/ontology/question`, `/api/v1/ai/process/interpret`
4. No canonical `/api/v1/analytics/ontology/*` endpoints at this time.

## Product and Architecture Guardrails (Must Hold)

1. Ontology UI remains read-only.
2. No ontology mutation actions are exposed in UI.
3. Backend contracts remain canonical and owned by `seer-backend`.
4. No legacy endpoint parity shims.
5. Analytics must be evidence-backed and traceable to canonical process data.

## Scope

1. Replace legacy API client contract usage in `seer-ui/app/lib/api/*` with canonical backend mappings.
2. Rework ontology route and components to remove edit flows and enforce read-only behavior.
3. Rework process mining route to use canonical mine + traces contracts.
4. Implement process analytics section that matches current backend expectations.
5. Add a history tab experience that shows latest object snapshots and object event timelines using history contracts.
6. Add focused regression tests around contract mappings and key ontology/process/history flows.

## Non-Goals

1. Reintroducing any ontology create/edit/delete/publish workflows.
2. Porting Change Intelligence scope.
3. Implementing legacy `/objects/*` parity.
4. Adding broad backend domains beyond what ontology/process analytics adaptation requires.

## Canonical Mapping Plan

### Ontology Mapping

1. `getOntologyGraph()` legacy behavior becomes composed canonical reads:
   - `GET /api/v1/ontology/concepts`
   - `GET /api/v1/ontology/concept-detail`
   - `POST /api/v1/ontology/query` (read-only neighborhood)
2. Copilot/assistant ontology calls map to:
   - `POST /api/v1/ai/ontology/question`
3. All mutation functions in `seer-ui/app/lib/api/ontology.ts` are removed or isolated as unsupported.

### Process Mapping

1. `getOcpnGraph()` maps to:
   - `POST /api/v1/process/mine`
2. Trace drill-down maps to:
   - `GET /api/v1/process/traces`
3. AI interpretation maps to:
   - `POST /api/v1/ai/process/interpret`

### Analytics Mapping

1. Legacy ontology analytics APIs are deprecated in UI integration path.
2. Process analytics section uses one of:
   - derived metrics from canonical process mine/traces payloads, or
   - additive canonical endpoint(s) under `/api/v1/process/*` if derived approach is insufficient.

Decision gate: finalize derived-vs-additive approach before Phase 3 implementation.

### History Mapping

1. Replace legacy object-store/object-activity `/objects/*` usage with canonical `/api/v1/history/*` usage.
2. Use canonical backend search endpoint for latest object snapshot listing (paginated):
   - `POST /api/v1/history/objects/latest/search`
   - body: `object_type`, `page`, `size`, `property_filters[]`.
3. Use row selection from latest snapshot table to drive right-side event timeline panel.
4. Use canonical object timeline lookup keyed by canonical object reference:
   - `GET /api/v1/history/objects/events`
   - query: `object_type`, `object_ref_canonical`, `page`, `size` (`object_ref_hash` optional).
5. History labels should resolve through ontology metadata (property labels and state labels) wherever available.
6. Maintain read-only behavior across all history interactions.

## Phase Plan

## Phase 1: Contract Adapter Foundation (Current)

**Goal:** establish canonical API client layer over legacy `app/lib/api` surface.

Deliverables:

1. Update API base behavior to canonical backend defaults (`/api/v1` contract expectations).
2. Create canonical-backed ontology and process client functions.
3. Mark/remove legacy-only API calls that violate read-only or canonical constraints.
4. Produce endpoint migration matrix in plan decision log.

Exit criteria:

1. No direct runtime dependency on `/ontology/*` legacy endpoints.
2. No direct runtime dependency on `/process-mining/ocpn`.
3. Build compiles with canonical client types in place.

## Phase 2: Read-Only Ontology UX Adaptation

**Goal:** keep legacy UX quality while enforcing read-only ontology boundaries.

Deliverables:

1. Update ontology pages/components to use canonical ontology read contracts.
2. Remove or disable ontology editing dialogs and mutation actions from active route flows.
3. Ensure tab, concept, and graph exploration behavior remains usable for dense ontologies.
4. Keep AI ontology workflow on `/api/v1/ai/ontology/question`.

Exit criteria:

1. Zero ontology mutation controls visible in UI.
2. Ontology route works end-to-end on canonical read APIs.
3. Read-only constraints are covered by tests.

## Phase 3: Process Mining and Analytics Adaptation

**Goal:** map legacy process inspector and analytics to canonical process contracts.

Deliverables:

1. Migrate process mining run flow to `/api/v1/process/mine`.
2. Migrate trace drill-down flow to `/api/v1/process/traces`.
3. Implement analytics section with canonical evidence lineage.
4. Integrate AI interpretation using `/api/v1/ai/process/interpret`.

Exit criteria:

1. Process route runs and drills down using only canonical contracts.
2. Analytics outputs link back to deterministic trace evidence.
3. No dependency on `/analytics/ontology/*` legacy endpoints in active process flows.

## Phase 3A: History Tab (Latest Objects + Timeline)

**Goal:** deliver a canonical history experience with one paginated latest-object table and a right-side timeline panel.

Deliverables:

1. Add backend endpoint:
   - `POST /api/v1/history/objects/latest/search`
   - Supports pagination (`page`, `size`), sort by most-recent snapshot, `object_type` filter, and request-body property filters.
2. Add backend endpoint for selected-object timeline panel pagination:
   - `GET /api/v1/history/objects/events`
   - Inputs: `object_type`, `object_ref_canonical`, `page`, `size` (`object_ref_hash` optional).
3. Add UI history tab in inspector area:
   - left: latest object table
   - right: full event timeline for selected object
4. Add filter controls:
   - object type select
   - property filters (`key`, `op`, `value`) for top-level scalar properties
   - `State` filter option (shown only when selected object type has ontology states), with value dropdown.
5. Keep the table strictly latest snapshots only (one row per `(object_type, object_ref_hash)` identity).
6. Add event selection behavior where selected event changes the object details panel snapshot (latest selected by default).
7. Add adapter tests for new history API client and endpoint contracts.

Exit criteria:

1. History tab loads without legacy `/objects/*` endpoints.
2. Table is server-paginated and sorted by latest snapshot time descending.
3. Selecting a row loads that object's event timeline in the side panel.
4. Filtering by object type and property values narrows results deterministically.
5. Large result sets remain responsive through pagination (no full-client dataset load).
6. Timeline and details field labels resolve through ontology labels where available.
7. State-bearing object types support a `State` dropdown filter.

## Phase 4: Hardening and Rollout Readiness

**Goal:** lock quality and reduce regression risk.

Deliverables:

1. Add/refresh tests for ontology/process contract adapters and route flows.
2. Verify lint/build/tests for `seer-ui` and affected backend tests.
3. Update docs/spec references and record residual debt items.

Exit criteria:

1. `cd seer-ui && npm run lint` passes.
2. `cd seer-ui && npm run build` passes.
3. `cd seer-ui && npm run test` passes.
4. `cd seer-backend && uv run pytest -q` passes for impacted domains.

## Acceptance Criteria

1. `seer-ui` runs on canonical backend contracts for ontology and process flows.
2. Ontology experience is strictly read-only.
3. Process mining + trace drill-down work end-to-end.
4. Process analytics section exists and is evidence-backed on canonical data.
5. History tab supports latest snapshot listing + per-object event timeline on canonical history APIs.
6. Legacy endpoint dependencies are removed from active ontology/process/history workflows.

## Risks and Mitigations

1. Risk: legacy component tree tightly couples to mutation APIs.  
   Mitigation: remove mutation entry points first, then rewire read-only paths.
2. Risk: analytics parity gaps due to missing canonical overlay endpoints.  
   Mitigation: enforce Phase 3 decision gate and choose derived or additive canonical path early.
3. Risk: large refactor surface in `seer-ui/app/*` causes regressions.  
   Mitigation: adapt incrementally with route-level smoke and targeted tests.
4. Risk: property filtering on JSON payloads may be expensive on wide history datasets.  
   Mitigation: constrain Phase 3A operators to top-level scalar filters, add paging hard-limits, and evaluate ClickHouse materialized/index strategy if needed.

## Decision Log

1. 2026-02-28: Plan pivoted because legacy UI is now the active `seer-ui` baseline.
2. 2026-02-28: Ontology mutation behavior remains out-of-scope and must be removed from active UX.
3. 2026-02-28: Canonical process contracts remain source of truth for mining and trace workflows.
4. 2026-02-28: History UX will be anchored on canonical history contracts, not legacy `/objects/*` APIs.
5. 2026-02-28: Additive canonical history endpoints are allowed where current history API cannot express latest-per-object pagination and panel timeline paging.
6. 2026-02-28: Latest-object history search moved to canonical `POST /api/v1/history/objects/latest/search` with structured `property_filters`.
7. 2026-02-28: Object event timeline fetch is keyed by `object_ref_canonical` (hash optional) to avoid client precision problems on 64-bit hashes.
8. 2026-02-28: History UI now supports ontology-aware field/state labels and selected-event snapshot details.
9. 2026-02-28: Added Inspector `Insights` tab powered by canonical `POST /api/v1/process/mine` with trace-handle drill-down via `GET /api/v1/process/traces`.
10. 2026-02-28: Consolidated analytics under Inspector `Insights` with `Process Insights` (root-cause) first and `Process Mining` second; legacy `/inspector/analytics` now redirects to `/inspector/insights`.
11. 2026-02-28: Field/state display consistency handoff completed to `/home/chanzo/code/large-projects/seer-python/docs/exec-plans/completed/ontology-driven-field-display-centralization.md`; shared ontology display resolver is now the canonical policy source for inspector label/value rendering.
12. 2026-02-28: Handoff acknowledged from `/home/chanzo/code/large-projects/seer-python/docs/exec-plans/active/adaptive-lifecycle-label-display.md` Phase 3 completion: cross-object Ontology Explorer contexts are locked to explicit lifecycle labels, while object-local History inspector contexts remain plain/default lifecycle naming; this preserves read-only history clarity without reintroducing alias rewrite tables.

## Progress Tracking

- [ ] Phase 1 complete
- [ ] Phase 2 complete
- [ ] Phase 3 complete
- [x] Phase 3A complete
- [ ] Phase 4 complete

Current execution state:

- `in_progress`: Phase 4 hardening + documentation sync
- `in_progress`: Inspector Insights UX landed with full mine controls, ranked findings, and evidence drill-down.
- `completed-handoff`: Ontology-driven field display centralization ratified in completed plan doc for cross-inspector labeling policy.

## Plan Maintenance Rules

1. Update this file at each phase boundary with concrete evidence.
2. Track deferred work in `docs/exec-plans/tech-debt-tracker.md`.
3. Move to `docs/exec-plans/completed/` only after all acceptance criteria pass.
