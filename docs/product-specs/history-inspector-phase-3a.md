# History Inspector Phase 3A Spec

**Status:** completed  
**Owner phase:** `docs/exec-plans/completed/object-store-model-locked-tabs.md`  
**Last updated:** 2026-03-14

---

## Purpose

Define user-facing behavior for the object-centric History Inspector:

1. latest live object snapshots,
2. model-scoped insights inside Object Store,
3. object-first drill-down into dedicated object activity details,
4. ontology-aware labels for fields, types, and states.

## Primary User Flow

1. User opens `/inspector/history`.
2. UI always resolves one selected object model.
3. User switches between a live-objects tab and an insights tab.
4. Live objects load latest object snapshots (paginated) sorted by latest update descending.
5. User optionally applies property filters scoped to the selected model.
6. User selects an object row.
7. UI navigates to `/inspector/history/object` with `object_type` and `object_ref_canonical` query params (`object_ref_hash` optional).
8. Object details route loads that identity's timeline (paginated) and graph.
9. Graph defaults to `Follow Timeline` time source and depth `1`.
10. Loading older timeline pages extends follow-mode graph coverage to older timestamps.

## Filter Behavior

1. `Object model` is always selected; there is no `All object types` option.
2. Property filter field dropdown is scoped to the selected object type only.
3. Changing object model clears model-specific analysis/filter run state and reseeds scoped insights to the new model.
4. For object types with ontology states:
   - `State` appears as a filter field option.
   - State value input is a dropdown of ontology states.
   - State filter applies as exact match (`eq`) only.

## Object Store Responsibilities

1. `/inspector/history` is a model-scoped investigation workspace.
2. It owns:
   - required object-model selection,
   - top-level live-objects and insights tabs,
   - model-scoped property filtering,
   - latest object snapshot pagination with model-specific columns,
   - embedded insights locked to the selected model,
   - row navigation to object details.
3. It does not render embedded per-object timeline or graph analysis panels.

## Live Objects Tab Responsibilities

1. The live-objects tab label is the pluralized selected object model label.
2. The table is model-specific rather than generic.
3. The table includes:
   - key-part columns derived from object reference fields,
   - a display-name field column only when the model has a preferred name field,
   - state/status columns when present for the model,
   - `Latest update`.
4. When present, the display-name column header uses the ontology label of the actual selected field.
5. The display-name field prefers payload fields in this order:
   - `display_name`,
   - `name`,
   - `<model-local-name>_name`,
6. If none of those fields exist on the selected model, Object Store does not render a display-name column.

## Object Details Responsibilities

1. `/inspector/history/object` owns object activity analysis for one identity.
2. It renders:
   - paginated timeline cards (`Load older` append behavior),
   - object-centric graph from canonical history endpoints.
3. Graph controls include only:
   - `Graph time source`: `Follow Timeline` or `Custom Range`,
   - `Graph depth` (default `1`, max bounded by UI guardrail),
   - `Apply Range` for custom mode.
4. Graph scope must stay object-centric:
   - no trace selector controls,
   - no workflow selector controls,
   - no process-mining scope pills.

## Insights Tab Responsibilities

1. The insights tab embeds the existing RCA and OC-DFG insights surface inside `/inspector/history`.
2. Embedded insights are locked to the currently selected object model.
3. Embedded insights do not expose an independent anchor/model selector.
4. RCA and OC-DFG continue to use their existing time-window, depth, run, and result interactions.
5. Standalone `/inspector/insights` remains available for broader non-history entry.

## Graph Time Source Behavior

1. `Follow Timeline`:
   - active graph window is derived from loaded timeline event timestamps,
   - loading older pages expands the window automatically.
2. `Custom Range`:
   - user sets `From` and `To`,
   - range changes apply only on `Apply Range`,
   - invalid/missing values show inline validation errors.

## Labeling and Display Rules

1. Field and state label resolution must use the shared ontology display resolver as the single source of truth.
2. Field labels should use ontology property labels where available.
3. State-like payload values (`status`, `state`, `*_status`, `*_state`) should use ontology state labels where available.
4. If no ontology label exists, raw key/value is shown.
5. Timeline rendering is event-card based and grouped by day:
   - day headers separate loaded event history into chronological sections,
   - each event card shows ontology-aware event name, timestamp, relation role, and source.
6. Event cards must prioritize ontology-first signal over raw payload dumps:
   - state transitions render as explicit `from -> to` badges when present,
   - highlights are limited to a small set of ontology-relevant fields (for scanability),
   - payload summary text is generated via ontology display summarization.
7. Object reference display should remain compact and human-readable via ontology summarization helpers.

## Backend Contracts Consumed by UI

1. `POST /api/v1/history/objects/latest/search`
   - body: `object_type`, `page`, `size`, `property_filters[]`
2. `GET /api/v1/history/objects/events`
   - query: `object_type`, `object_ref_canonical`, `page`, `size`, `start_at?`, `end_at?`
   - `object_ref_hash` optional
3. `GET /api/v1/history/relations`
   - query: `event_id`, `limit`
4. `GET /api/v1/ontology/graph` (label/state metadata context)

## Acceptance Expectations

1. No legacy `/objects/*` endpoint usage in History flows.
2. `/inspector/history` always has a valid selected object model.
3. `/inspector/history` exposes top-level live-objects and insights tabs.
4. Live objects render model-specific key-part columns, conditional display-name field columns, and state columns when data exists.
5. Clicking a live object row navigates to `/inspector/history/object` with required identity params.
6. Object details route renders timeline and graph for the selected identity.
7. Graph controls expose only object-centric time/depth controls; no trace/workflow controls are present.
8. Embedded insights stay locked to the selected object model.
9. `Follow Timeline` and `Custom Range` produce deterministic, user-visible graph window behavior.
10. Latest objects and timeline pagination remain server-driven and deterministic.
11. Filter controls never expose fields from unrelated object types.
12. State dropdown appears only when the selected object type has possible states.

## Out of Scope (Phase 3A)

1. Editing object history or event payloads.
2. Arbitrary nested JSON query/filter expressions.
3. Non-canonical history endpoint compatibility shims.
