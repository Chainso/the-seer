# Post-MVP Exec Plan: Searchable Dropdown Audit

**Status:** completed  
**Target order:** post-MVP track 14  
**Agent slot:** UX-SEARCH-1  
**Predecessor:** `docs/exec-plans/completed/agentic-workflow-execution-ui-polish.md`  
**Successor:** none  
**Last updated:** 2026-03-13

---

## Objective

Audit remaining dropdown usage in `seer-ui` and convert the ones that are difficult to scan because they are ontology-backed, runtime-populated, or likely to grow beyond comfortable visual browsing.

## Scope

1. Audit remaining plain `Select` usage in user-facing `seer-ui` components.
2. Convert high-cardinality or dynamic option lists to the shared `SearchableSelect`.
3. Preserve plain selects for short, fixed enumerations where search would add friction instead of clarity.
4. Validate touched frontend files with ESLint.

## Non-Goals

1. Reworking dropdown styling beyond what is required to support searchable behavior.
2. Converting short enum selectors like depth, status, operator, or evidence-limit controls.
3. Changing backend contracts or ontology data shape.

## Acceptance Criteria

1. Dynamic ontology-backed selectors in inspector workflows are searchable.
2. Long runtime-populated selectors in inspector workflows are searchable.
3. Ontology authoring dialogs no longer leave high-cardinality model/state pickers as plain selects.
4. Small fixed-option selectors remain plain where that is the more usable interaction.
5. `eslint` passes for the touched frontend files.

## Decision Log

1. 2026-03-13: Treat searchability as an ergonomics tool for long or dynamic lists, not as a blanket replacement for every select.
2. 2026-03-13: Keep fixed enums like depth, status, edge-metric, duration-metric, and evidence-limit as plain selects because scanning them is faster than typing.
3. 2026-03-13: Convert outcome-event, workflow-capability, scenario-opportunity, ontology object-model/state, and dynamic filter-field selectors because they are ontology/runtime driven and can become cumbersome to browse.

## Progress Log

1. 2026-03-13: Audited remaining dropdown usage across inspector and ontology-dialog surfaces to separate fixed enums from dynamic/high-cardinality lists.
2. 2026-03-13: Converted inspector workflow capability, outcome event type, RCA cohort filter field, analytics scenario opportunity, and ontology create-action model/state selectors to `SearchableSelect`.
3. 2026-03-13: Retained plain selects for short enumerations including status, depth, evidence limit, operators, booleans, and state/value toggles.
4. 2026-03-13: Validated the touched UI files with `npm run lint -- ...`.

## Validation Commands

1. `cd seer-ui && npm run lint -- app/components/ui/searchable-select.tsx app/components/inspector/inspector-scope-filters.tsx app/components/inspector/history-panel.tsx app/components/inspector/ontology-analytics-panel.tsx app/components/inspector/process-insights-panel.tsx app/components/inspector/agentic-workflow-execution-panel.tsx app/components/ontology/dialogs/create-action-dialog.tsx`

## Docs Impact

1. `docs/exec-plans/completed/searchable-dropdown-audit-2026-03-13.md`
2. `docs/exec-plans/active/index.md`
3. `docs/exec-plans/completed/README.md`

## Progress Tracking

- [x] Dropdown audit complete
- [x] Searchable conversions complete
- [x] Validation complete

Current execution state:

1. `completed`: audit, implementation, and lint validation.
