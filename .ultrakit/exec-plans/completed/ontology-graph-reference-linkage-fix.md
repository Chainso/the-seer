# Exec Plan: Ontology Graph Reference Linkage Fix

**Status:** completed  
**Last updated:** 2026-03-15

## Purpose / Big Picture

The read-only ontology explorer should reflect the Prophet ontology contract in `prophet/prophet.ttl`. Today the explorer graph drops some useful object-model relationships because it derives `referencesObjectModel` edges with a narrower client-side walk than the shared runtime semantics helper, and the graph uses one automation style for multiple predicates without a legend. After this change, the ontology map should show object-model links for actions and events based on Prophet property-container semantics, keep each relationship type visually distinct, and explain those encodings through a compact legend instead of inline edge labels.

## Progress

- [x] 2026-03-15 Investigated the current explorer graph path, the shared reference-edge helper, and the Prophet turtle predicates that define `Action`, `Event`, `EventTrigger`, `ActionInput`, `hasProperty`, `valueType`, `itemType`, and `referencesObjectModel`.
- [x] 2026-03-15 Replace the explorer-local derived reference walker with the shared helper so the map uses one canonical derivation path.
- [x] 2026-03-15 Render distinct per-edge-type styling in the ontology map and add a compact relationship legend while keeping relationship-scope filtering intact.
- [x] 2026-03-15 Add targeted frontend contract/behavior coverage and run validation.

## Surprises & Discoveries

- 2026-03-15: `seer-ui/app/components/ontology/ontology-explorer-tabs.tsx` contains a second `referencesObjectModel` derivation path that is weaker than `seer-ui/app/components/ontology/graph-reference-edges.ts`. The explorer-local version does not walk nested `StructType -> hasProperty -> valueType` chains and does not include `Action -> producesEvent -> Event` output references when deriving action-level model links.
- 2026-03-15: Distinct ontology relationship types are easier to scan through stroke/dash encoding plus a legend than through inline edge text, especially once the map grows beyond a few nodes.
- 2026-03-15: Prophet does not define direct `ObjectModel -> Action` or `ObjectModel -> Event` predicates. Those links are intentionally indirect via `hasProperty -> valueType -> ObjectReference.referencesObjectModel`, with list recursion through `itemType`. Action output is the produced `Event`, not a separate output schema class.

## Decision Log

- 2026-03-15, Codex: Reuse `buildReferenceEdges` as the canonical authoring-reference derivation for the ontology explorer instead of maintaining a second custom walker. Rationale: the shared helper already encodes the deeper property/type traversal and action input/output semantics the explorer currently misses.
- 2026-03-15, Codex: Centralize ontology edge visuals in a shared presentation utility consumed by both the renderer and the explorer legend. Rationale: edge encoding should stay label-free in the graph itself, but the legend and renderer still need one canonical mapping so relationship semantics do not drift.

## Outcomes & Retrospective

Completed on 2026-03-15. The explorer now imports the shared `buildReferenceEdges` helper instead of keeping a weaker local `deriveAuthoringReferenceEdges` implementation, which restores `referencesObjectModel` links inferred through action output events and nested struct/list reference chains. Ontology edge visuals are now centralized in a shared presentation utility so the renderer keeps the graph label-free while the explorer shows a compact legend with distinct samples for `producesEvent`, `triggers`, `listensTo`, `invokes`, and `referencesObjectModel`. Automation filtering/classification recognizes the current Prophet `triggers` predicate.

Validation evidence:

1. `cd /workspaces/seer-python/seer-ui && node --test tests/ontology-display.contract.test.mjs` passed.
2. `cd /workspaces/seer-python/seer-ui && npm run build` passed.

## Context and Orientation

The ontology explorer page lives under `seer-ui/app/ontology/[tab]/page.tsx` and renders the shared `OntologyExplorerTabs` host in `seer-ui/app/components/ontology/ontology-explorer-tabs.tsx`. The map itself is rendered by `seer-ui/app/components/ontology/ontology-graph.tsx`. The backend graph endpoint in `seer-backend/src/seer_backend/ontology/service.py` exposes direct RDF edges only; the frontend derives extra `referencesObjectModel` edges for authoring surfaces. The shared derivation helper is `seer-ui/app/components/ontology/graph-reference-edges.ts`. Prophet ontology semantics come from `prophet/prophet.ttl`.

This work is frontend-only. No ontology schema or backend contract changes are planned. Product/spec impact is expected to be `no-doc-impact` beyond this execution plan because the change fixes explorer fidelity and relationship encoding rather than changing product scope.

## Plan of Work

Update the explorer tabs to import and reuse the shared reference-edge builder, then filter those derived edges down to the current visible authoring nodes before merging them with direct graph edges. Remove the duplicate local derivation function so future ontology semantics are centralized in one place.

Update the graph renderer so relationship types are visually distinct without inline labels. Keep the graph itself uncluttered, centralize edge styling in a shared presentation utility, and render a legend in the explorer card that explains the distinct relationship encodings.

Add test coverage in the existing frontend contract test suite. One test should execute the shared reference-edge helper against a small fixture graph that exercises nested struct/list references and action output events. Another test should guard that the shared edge-presentation utility keeps automation/reference edge types visually distinct and that the explorer wires the legend through the shared mapping. Then run the targeted contract tests and a production build in `seer-ui`.

## Concrete Steps

1. From `/workspaces/seer-python`, add an active execution plan under `docs/exec-plans/active/` and update `docs/exec-plans/active/index.md`.
2. Edit `seer-ui/app/components/ontology/ontology-explorer-tabs.tsx` to reuse `buildReferenceEdges`.
3. Edit `seer-ui/app/components/ontology/ontology-graph.tsx` to apply the shared per-edge-type presentation without inline edge labels.
4. Edit `seer-ui/tests/ontology-display.contract.test.mjs` to cover the derived-reference behavior plus the shared edge-presentation utility and legend wiring.
5. Run:

```bash
cd /workspaces/seer-python/seer-ui
node --test tests/ontology-display.contract.test.mjs
npm run build
```

Expected result: the contract test passes, and the Next.js production build succeeds without new lint/type failures.

## Validation and Acceptance

Acceptance is met when all of the following are true:

1. In the ontology explorer map, authoring nodes can show derived `referencesObjectModel` links that reflect Prophet property-container semantics for actions and events, including action output events and nested struct/list object references.
2. The map keeps relationship lines label-free while visually distinguishing relationship types and exposing a legend that explains those encodings.
3. `cd /workspaces/seer-python/seer-ui && node --test tests/ontology-display.contract.test.mjs` passes.
4. `cd /workspaces/seer-python/seer-ui && npm run build` passes.

## Idempotence and Recovery

This plan is safe to retry. The changes are confined to frontend source and tests. If work stops midway, reopen this plan, inspect `git diff` for the touched `seer-ui` files, and rerun the targeted contract test before continuing. No destructive data migration or backend state change is involved.

## Artifacts and Notes

- Prophet ontology predicates reviewed: `prophet:acceptsInput`, `prophet:producesEvent`, `prophet:listensTo`, `prophet:invokes`, `prophet:hasProperty`, `prophet:valueType`, `prophet:itemType`, `prophet:referencesObjectModel`.
- Shared reference derivation helper: `seer-ui/app/components/ontology/graph-reference-edges.ts`.
- Shared edge-presentation helper: `seer-ui/app/components/ontology/ontology-edge-presentation.ts`.
- Explorer-local duplicate derivation to remove or replace: `seer-ui/app/components/ontology/ontology-explorer-tabs.tsx`.

## Interfaces and Dependencies

- Frontend graph host: `seer-ui/app/components/ontology/ontology-explorer-tabs.tsx`
- Frontend graph renderer: `seer-ui/app/components/ontology/ontology-graph.tsx`
- Shared reference-edge helper: `seer-ui/app/components/ontology/graph-reference-edges.ts`
- Shared edge-presentation helper: `seer-ui/app/components/ontology/ontology-edge-presentation.ts`
- Frontend contract tests: `seer-ui/tests/ontology-display.contract.test.mjs`
- Ontology source of truth: `prophet/prophet.ttl`
