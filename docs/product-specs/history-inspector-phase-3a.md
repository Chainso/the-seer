# History Inspector Phase 3A Spec

**Status:** in_progress  
**Owner phase:** `/home/chanzo/code/large-projects/seer-python/docs/exec-plans/active/post-mvp-ontology-process-readonly-adaptation.md`  
**Last updated:** 2026-02-28

---

## Purpose

Define user-facing behavior for the post-MVP History tab in Inspector:

1. latest live object snapshots,
2. per-object event timeline,
3. ontology-aware labels for fields and states.

## Primary User Flow

1. User opens `/inspector/history`.
2. User optionally filters by object type and property filters.
3. UI loads latest object snapshots (paginated) sorted by latest update descending.
4. User selects an object row.
5. UI loads that object's event timeline (paginated).
6. Latest event is selected by default.
7. User clicks a different event to inspect object-at-that-time details.

## Filter Behavior

1. `Object type` is a dropdown.
2. Property filter field dropdown is scoped to the selected object type only.
3. Property filters are disabled until object type is selected.
4. For object types with ontology states:
   - `State` appears as a filter field option.
   - State value input is a dropdown of ontology states.
   - State filter applies as exact match (`eq`) only.

## Labeling and Display Rules

1. Field and state label resolution must use the shared ontology display resolver as the single source of truth.
2. Field labels should use ontology property labels where available.
3. State-like payload values (`status`, `state`, `*_status`, `*_state`) should use ontology state labels where available.
4. If no ontology label exists, raw key/value is shown.
5. Event cards and object references use compact inline formatting:
   - field display: `Key · Value`
   - separator between fields: ` | `

## Backend Contracts Consumed by UI

1. `POST /api/v1/history/objects/latest/search`
   - body: `object_type`, `page`, `size`, `property_filters[]`
2. `GET /api/v1/history/objects/events`
   - query: `object_type`, `object_ref_canonical`, `page`, `size`
   - `object_ref_hash` optional
3. `GET /api/v1/ontology/graph` (label/state metadata context)

## Acceptance Expectations

1. No legacy `/objects/*` endpoint usage in History tab.
2. Latest objects table is server-paginated and stable by latest snapshot time.
3. Timeline pagination remains server-driven and deterministic.
4. Event selection updates right-side object details to selected event snapshot state.
5. Filter controls never expose fields from unrelated object types.
6. State dropdown appears only when the selected object type has possible states.

## Out of Scope (Phase 3A)

1. Editing object history or event payloads.
2. Arbitrary nested JSON query/filter expressions.
3. Non-canonical history endpoint compatibility shims.
