# Object Store Model-Locked Tabs

**Status:** completed  
**Owner:** UX-HISTORY-2  
**Last updated:** 2026-03-13

---

## Objective

Refactor Object Store into a model-locked workspace that:

1. always has one ontology object model selected,
2. exposes top-level live-objects and insights tabs,
3. makes live objects more model-specific with key-part, display-name, and state columns,
4. keeps the existing object-details route for per-object timeline and graph analysis.

## Delivery Stance

1. Preserve the dedicated object-details route for per-object history inspection.
2. Do not preserve the old discovery-only Object Store IA.
3. Keep standalone `/inspector/insights` available; the new history insights tab is an additional scoped entry point.

## Scope Delivered

### Phase 1: Model-Locked Object Store Host

1. Reworked `/inspector/history` into a page host with required object-model selection.
2. Added URL-backed top-level `objects` and `insights` tabs.
3. Normalized missing or invalid `object_type` query state to a deterministic ontology model.

### Phase 2: Detailed Live Objects Table

1. Split the live-objects table into a dedicated model-scoped component.
2. Removed the generic visible type column.
3. Added dynamic key-part, display-name, and state columns derived from ontology metadata plus returned object payload/reference fields.
4. Kept property filtering scoped to the selected model and preserved row navigation into `/inspector/history/object`.

### Phase 3: Embedded Scoped Insights

1. Reused the existing Insights panel inside Object Store.
2. Added locked-model support for RCA and OC-DFG so embedded insights follow the selected Object Store model.
3. Moved embedded insights subtab state to `insights_tab` so it does not conflict with the history page tab query state.

### Phase 4: Contract And Spec Ratification

1. Updated history and insights contract tests for the new IA.
2. Updated the history product spec to ratify the model-locked, tabbed Object Store behavior.
3. Recorded this execution in the completed plans indexes.

## Acceptance Criteria

1. `/inspector/history` always resolves to a selected ontology object model.
2. Object Store exposes exactly two top-level tabs: model-scoped live objects and insights.
3. Live objects render model-specific columns for key parts, display name, and state fields.
4. Embedded insights are locked to the selected model and do not expose an independent model selector.
5. Clicking a live object row still opens `/inspector/history/object` with canonical identity params.
6. Standalone `/inspector/insights` remains intact.

## Validation

1. `cd seer-ui && node --test tests/history.contract.test.mjs tests/insights.contract.test.mjs`
2. `cd seer-ui && npm run build`

## Completion Notes

1. The old discovery-only history contract was intentionally removed in favor of a model-scoped investigation workspace.
2. Embedded insights now reuse the existing RCA and OC-DFG components rather than creating a parallel implementation.
3. Display-name derivation falls back to summarized object reference text when no preferred payload name field exists.
