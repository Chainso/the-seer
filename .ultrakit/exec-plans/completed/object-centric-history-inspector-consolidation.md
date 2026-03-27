# Object-Centric History Inspector Consolidation

**Status:** completed  
**Owner:** UX-HISTORY-1  
**Last updated:** 2026-02-28

---

## Supersession Note

1. This plan remains the historical record for the first object-centric history consolidation delivered on 2026-02-28.
2. Its "Object Store as discovery only" IA was later superseded on 2026-03-13 by `docs/exec-plans/completed/object-store-model-locked-tabs.md`.
3. The dedicated `/inspector/history/object` deep-link route introduced here remains current; only the `/inspector/history` page responsibilities changed.

## Objective

Consolidate inspector navigation and flows into an object-centric history experience by:

1. removing the duplicate Process Inspector surface,
2. keeping Object Store as discovery only,
3. moving per-object timeline + graph analysis into a dedicated object activity details page.

## Delivery Stance

1. Forward-only UX delivery is required.
2. Legacy inspector tab compatibility is intentionally not preserved.
3. Any conflicting legacy behavior should be removed, not shimmed.

## Invariants

1. History and object exploration must remain read-only.
2. Object identity for drill-down is `(object_type, object_ref_canonical)` (hash optional).
3. Object activity details must be object-centric and must not expose trace/workflow controls.
4. History labels and value rendering continue through the shared ontology display resolver.

## Legacy Behavior Removal (Intentional)

1. Remove top-level `Process Inspector` navigation entry and `/inspector` tabbed hub behavior.
2. Remove standalone `Object Activity` tab/panel controls that duplicate Object Store + Insights.
3. Remove trace/workflow selectors from object activity investigation UX.

Rationale: these surfaces duplicate navigation and split one user job across multiple routes. A single object discovery flow followed by object details is lower-friction and easier to reason about.

## Phase Map

### Phase 1: Route and Nav Consolidation

Scope:

1. Redirect `/inspector` to `/inspector/history`.
2. Remove `Process Inspector` sidebar item.
3. Keep `Object Store` and `Insights` as primary inspector entries.

Exit criteria:

1. No active UI route uses `/inspector?tab=*`.
2. Sidebar has no `Process Inspector` item.

Validation:

1. `cd seer-ui && node --test tests/history.contract.test.mjs tests/insights.contract.test.mjs`

### Phase 2: Object Activity Data Contract Hardening

Scope:

1. Add optional object event time filtering (`start_at`, `end_at`) to canonical history object events API path.
2. Update frontend history API client/types to consume time-filterable object events and event-object relation fetches needed by graph construction.

Exit criteria:

1. Object event API accepts optional time range without breaking existing pagination behavior.
2. Regression tests cover filtered and unfiltered responses.

Validation:

1. `cd seer-backend && .venv/bin/pytest -q tests/test_history_phase2.py`

### Phase 3: Object-Centric Details Page

Scope:

1. Simplify Object Store page to latest-object discovery and navigation only.
2. Add dedicated object details route with:
   - paginated timeline,
   - graph view,
   - graph time source modes: `Follow Timeline` and `Custom Range`,
   - default graph load depth `1`.
3. Implement follow-mode graph window expansion as timeline pages extend farther back.
4. Keep graph controls object-centric (no trace/workflow controls).

Exit criteria:

1. Clicking a live object from Object Store navigates to object details page.
2. Timeline + graph render on object details page using canonical history APIs.
3. Follow/custom time source behavior is visible and deterministic.

Validation:

1. `cd seer-ui && node --test tests/history.contract.test.mjs tests/insights.contract.test.mjs`
2. `cd seer-ui && npm run test:contracts`

### Phase 4: Documentation and Ratification

Scope:

1. Update product spec and active plan artifacts for new object-centric split.
2. Record decisions and known limitations.
3. Ensure docs index references remain accurate.

Exit criteria:

1. Product spec reflects discovery page vs details page responsibilities.
2. Active plans index includes this plan and status.

Validation:

1. `cd seer-ui && node --test tests/history.contract.test.mjs tests/insights.contract.test.mjs`
2. `cd seer-ui && npm run test:contracts`
3. `cd seer-backend && .venv/bin/pytest -q tests/test_history_phase2.py -k "object_events_returns_desc_timeline_with_pagination"`

## Progress Checklist

- [x] Phase 1 complete
- [x] Phase 2 complete
- [x] Phase 3 complete
- [x] Phase 4 complete

Current execution state:

- `completed`: All four phases complete and ratified on 2026-02-28.

## Phase Progress Notes

### 2026-02-28: Phase 3 Delivery Complete

1. Object Store is now discovery-first only: filters + live objects table remain, embedded event timeline/details were removed.
2. Live object row click now routes to `/inspector/history/object` with required identity query params (`object_type`, `object_ref_canonical`, optional `object_ref_hash`).
3. Added dedicated object details page with:
   - paginated object timeline,
   - object-centric graph,
   - graph time source mode switch (`Follow Timeline` default, `Custom Range` apply flow),
   - graph depth input defaulting to `1`.
4. Graph construction now uses canonical history APIs only (`/history/objects/events`, `/history/relations`) and seeds after initial timeline load.
5. Follow mode now expands graph window as older timeline pages are loaded; custom mode uses explicit from/to apply behavior.
6. Added practical graph-size guardrails with explicit cap messaging in UI when limits are hit.
7. Removed obsolete standalone object activity surface and updated contract coverage for forward-only IA.
8. Validation passed:
   - `cd seer-ui && node --test tests/history.contract.test.mjs tests/insights.contract.test.mjs`
   - `cd seer-ui && npm run test:contracts`

### 2026-02-28: Phase 4 Ratification Complete

1. Updated product spec to ratify forward-only IA:
   - `/inspector/history` is discovery-only (filters + live objects + row navigation),
   - `/inspector/history/object` owns timeline + graph analysis,
   - graph controls are constrained to object-centric time/depth modes.
2. Explicitly documented graph time source modes (`Follow Timeline`, `Custom Range`) and object-centric constraints (no trace/workflow controls).
3. Updated spec and active-plan index entries so status text matches ratified behavior and completion state.
4. Validation passed:
   - `cd seer-ui && node --test tests/history.contract.test.mjs tests/insights.contract.test.mjs`
   - `cd seer-ui && npm run test:contracts`
   - `cd seer-backend && .venv/bin/pytest -q tests/test_history_phase2.py -k "object_events_returns_desc_timeline_with_pagination"`

## Decision Log

1. 2026-02-28: Chosen UX model is object-store discovery -> dedicated object details route; object details owns timeline + graph.
2. 2026-02-28: Graph scope model uses two explicit time-source modes (`Follow Timeline`, `Custom Range`) to reduce UI ambiguity versus multiple scope pills.
3. 2026-02-28: Follow mode extends graph window as older timeline pages are loaded; graph does not auto-shrink without explicit reset/apply actions.
4. 2026-02-28: User-approved forward-only stance: legacy tab compatibility is deprioritized in favor of the cleanest object-centric UX.
5. 2026-02-28: Object activity graph is now built exclusively from canonical history endpoints and no longer uses legacy `/objects/graph` or trace/workflow controls.
6. 2026-02-28: Guardrails cap graph events/objects/relations and emit user-visible cap notices to keep graph expansion predictable.
7. 2026-02-28: Ratified forward-only information architecture in product specs: Object Store handles discovery/navigation only; timeline + graph live exclusively on the dedicated object details route.

## Risks and Mitigations

1. Risk: graph expansion can become expensive with many events.
   Mitigation: cap graph event/object expansion and show clear limit messaging.
2. Risk: adding object event range filters could regress existing object event pagination.
   Mitigation: maintain backwards-compatible optional filters and enforce tests for default path.
3. Risk: route consolidation could break deep links to `/inspector`.
   Mitigation: preserve compatibility via redirect to `/inspector/history`.
