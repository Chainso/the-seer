# History Inspector Phase 3A Spec

**Status:** completed  
**Owner phase:** `/home/chanzo/code/large-projects/seer-python/docs/exec-plans/completed/object-centric-history-inspector-consolidation.md`  
**Last updated:** 2026-03-01

---

## Purpose

Define user-facing behavior for the object-centric History Inspector:

1. latest live object snapshots,
2. object-first drill-down into dedicated object activity details,
3. ontology-aware labels for fields, types, and states.

## Primary User Flow

1. User opens `/inspector/history`.
2. User optionally filters by object type and property filters.
3. UI loads latest object snapshots (paginated) sorted by latest update descending.
4. User selects an object row.
5. UI navigates to `/inspector/history/object` with `object_type` and `object_ref_canonical` query params (`object_ref_hash` optional).
6. Object details route loads that identity's timeline (paginated) and graph.
7. Graph defaults to `Follow Timeline` time source and depth `1`.
8. Loading older timeline pages extends follow-mode graph coverage to older timestamps.

## Filter Behavior

1. `Object type` is a dropdown.
2. Property filter field dropdown is scoped to the selected object type only.
3. Property filters are disabled until object type is selected.
4. For object types with ontology states:
   - `State` appears as a filter field option.
   - State value input is a dropdown of ontology states.
   - State filter applies as exact match (`eq`) only.

## Object Store Responsibilities

1. `/inspector/history` is discovery-only.
2. It owns:
   - object type + property filtering,
   - latest object snapshot pagination,
   - row navigation to object details.
3. It does not render embedded object timeline or graph analysis panels.

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
2. `/inspector/history` shows discovery controls + latest objects table only.
3. Clicking a live object row navigates to `/inspector/history/object` with required identity params.
4. Object details route renders timeline and graph for the selected identity.
5. Graph controls expose only object-centric time/depth controls; no trace/workflow controls are present.
6. `Follow Timeline` and `Custom Range` produce deterministic, user-visible graph window behavior.
7. Latest objects and timeline pagination remain server-driven and deterministic.
8. Filter controls never expose fields from unrelated object types.
9. State dropdown appears only when the selected object type has possible states.

## Out of Scope (Phase 3A)

1. Editing object history or event payloads.
2. Arbitrary nested JSON query/filter expressions.
3. Non-canonical history endpoint compatibility shims.
