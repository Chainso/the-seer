# Catalog Reframe And Lifecycle Workspace

**Status:** completed  
**Target order:** post-MVP follow-on  
**Agent slot:** CATALOG-UX-1  
**Predecessor:** none  
**Last updated:** 2026-03-17

---

## Purpose / Big Picture

Seer currently exposes ontology framing directly in its primary navigation and route structure. The main shell sends users to `/ontology/overview`, the sidebar still presents `Ontology Explorer`, and concept discovery is graph-first instead of catalog-first. After this plan lands, the product-facing discovery surface becomes `Catalog`: one top-level catalog workspace with `Objects`, `Actions`, `Events`, and `Triggers` as URL-backed tab-rail views, dedicated detail pages for each concept, and user-facing copy that avoids RDF/ontology implementation language.

The end-user result should feel like a clear business catalog rather than a semantic model browser. Users should be able to open `Catalog`, scan simple tables, click into a concept, understand what it is, and inspect relevant runtime evidence without seeing URI/IRI identifiers, `ObjectModel` labels, `EventTrigger` labels, or `OC-DFG` terminology. Object detail is the one richer exception: it should expose a `Summary` view plus a lifecycle-focused investigation view labeled `<Object Name> Lifecycle`.

This plan intentionally keeps the old ontology implementation code and routes in the repository as deprecated retained surfaces. The goal is to replace the primary product framing and workflow, not to delete the older graph-oriented implementation in this pass.

## Delivery Stance

1. Final-state delivery. This product has not launched, so there is no user migration or backward-compatibility obligation to preserve.
2. Optimize for the best final catalog-first product state even when that replaces older ontology-first, object-store, or insights-first navigation and contracts.
3. Keep old ontology code available for possible future reuse, but do not let the existence of that code constrain the new product shape.
4. When an older route, label, contract, or workflow conflicts with the desired end state, prefer the new end state and document the intentional replacement.

## Progress

- [x] 2026-03-17 Create the active execution plan, add it to `docs/exec-plans/active/index.md`, and record baseline validation before implementation.
- [x] 2026-03-17 Phase 1: land backend catalog read models and dedicated per-concept catalog APIs with regression coverage.
- [x] 2026-03-17 Phase 2: land shell/navigation changes plus catalog list/detail routes and reusable summary/runtime layouts.
- [x] 2026-03-17 Phase 2 finisher: refine catalog runtime tables to remove user-visible internal identifier columns and lock the behavior in contract tests.
- [x] 2026-03-17 Phase 3: fold the existing object-scoped investigation capability into object detail as `<Object Name> Lifecycle`, remove obsolete primary-nav flows, and complete the initial lifecycle integration.
- [x] 2026-03-17 Phase 3 finisher: replace remaining technical lifecycle-result wording and harden object-model resolution for the catalog lifecycle tab.
- [x] 2026-03-17 Phase 4: ratify canonical docs/specs, run final validation, and archive the plan (moved to `docs/exec-plans/completed/catalog-reframe-and-lifecycle-workspace.md`).

## Surprises & Discoveries

- 2026-03-17: The current shell is still ontology-first. `seer-ui/app/components/layout/nav-sidebar.tsx` lists `Ontology Explorer` first, and `seer-ui/app/page.tsx` redirects `/` to `/ontology/overview`.
- 2026-03-17: The shared UI already has the core primitives needed for the new IA. `seer-ui/app/components/ui/tabs.tsx` supports a `rail` variant, `seer-ui/app/components/ui/table.tsx` supports striped table layouts, `seer-ui/app/components/inspector/managed-agent-detail-panel.tsx` provides a strong summary/detail precedent, and `seer-ui/app/components/inspector/history-panel.tsx` / `insights-panel.tsx` already use top-level rail tabs.
- 2026-03-17: The backend already covers parts of the runtime evidence story, but not the full catalog contract. `history` endpoints can serve object instances and event occurrences, while generic action-status APIs do not currently expose list-by-`action_uri` behavior and trigger firings do not have a dedicated read model.
- 2026-03-17: The existing object investigation capability is directly reusable for the lifecycle tab. `seer-ui/app/components/inspector/object-store-insights-workspace.tsx` already provides the desired consolidated RCA + OC-DFG experience; the main gap is reframing the labels, surrounding copy, and page placement so it reads as object lifecycle understanding instead of an academic analytics tool.
- 2026-03-17: Baseline validation is clean before any implementation work:
  - `cd /workspaces/seer-python/seer-backend && ./.venv/bin/ruff check .` passed
  - `cd /workspaces/seer-python/seer-backend && ./.venv/bin/pytest` passed (`154 passed in 51.92s`)
  - `cd /workspaces/seer-python/seer-ui && npm run build` passed
- 2026-03-17: The current production route table still exposes `/ontology`, `/ontology/[tab]`, `/inspector/history`, and `/inspector/insights`. That route list is useful baseline evidence and confirms the current shell still promotes older discovery flows.
- 2026-03-17: Object-to-event relationships are not represented as direct concept-to-concept edges in the ontology graph; they are encoded through event property definitions with `valueType -> ObjectReference -> referencesObjectModel`. Phase 1 catalog read models therefore need explicit SPARQL traversal for relationship composition rather than simple direct edge joins.
- 2026-03-17: The canonical minimal ontology fixture labels the trigger as `On Ticket Created` (not `On Ticket Created Trigger`), which required a test expectation correction during Phase 1 validation.
- 2026-03-17: Next.js app-router route params are promise-shaped in this codebase (`params: Promise<{...}>`), so new catalog dynamic routes and legacy ontology redirects should follow the same async signature for consistency and compile-time safety.
- 2026-03-17: Existing contract tests hard-asserted old sidebar entries (`Object Store`, `Insights`). Phase 2 required updating those assertions to keep test coverage aligned with the new catalog-first shell while preserving the underlying inspector routes as retained code-on-disk surfaces.
- 2026-03-17: Controller validation after initial Phase 2 found that catalog runtime tables still presented raw internal identifiers (`source_event_id`, `run_id`, `trace_id`) as primary columns, which conflicted with the catalog UX requirement for light, user-facing operational language.
- 2026-03-17: Catalog object detail does not currently expose object-model URIs in its API contract, but the reused lifecycle workspace requires one. Phase 3 solved this with a local object-lifecycle adapter that resolves object models from `useOntologyDisplay` and keeps URI internals out of visible UI.
- 2026-03-17: Post-Phase 3 controller gating found two remaining lifecycle quality gaps. `seer-ui/app/components/catalog/object-lifecycle-workspace.tsx` still resolves the object model through catalog display-name matching instead of a stable catalog-key/API-backed identifier, and lifecycle mode in `seer-ui/app/components/inspector/object-store-insights-workspace.tsx` still exposes technical result labels such as `Hypothesis`, `Lift`, `Coverage`, `anchor-field`, and `Graph compare ready`.
- 2026-03-17: The Phase 3 finisher resolved these gaps by adding `object_type_uri` to the catalog object detail response so the lifecycle tab can point to the right model deterministically and by updating the lifecycle copy/information hierarchy to plain lifecycle language instead of score-model jargon.
- 2026-03-17: Phase 4 ratified that catalog is the canonical user surface: `AGENTS.md`, `VISION.md`, `DESIGN.md`, and `docs/product-specs/foundation-module-shell-phase-0.md` now document the catalog-first navigation and treat `/ontology` routes/pages as deprecated retained code, while the architecture text keeps ontology as the internal capability layer behind the catalog read model.

## Decision Log

- 2026-03-17, Codex: Keep `Catalog` as one sidebar item and use a URL-backed tab rail for `Objects`, `Actions`, `Events`, and `Triggers`. Rationale: these are four slices of one catalog, not four separate products; the sidebar should stay simpler and reserve top-level elevation for truly separate workflows like `Managed Agents` and `Assistant`.
- 2026-03-17, Codex: Use dedicated per-concept APIs under a shared catalog namespace rather than one polymorphic catalog endpoint. Rationale: this preserves a coherent product namespace while keeping backend contracts type-stable and easier to evolve, cache, and validate.
- 2026-03-17, Codex: Keep dedicated detail pages as the canonical interaction for all catalog concepts. Rationale: the requested details, documentation, related concepts, and runtime evidence are richer than a drawer-first preview can support cleanly.
- 2026-03-17, Codex: Make object detail the only concept with top-level tabs: `Summary` and `<Object Name> Lifecycle`. Rationale: lifecycle investigation is a materially different mode than summary review for objects, but that distinction does not justify tabs on actions, events, or triggers.
- 2026-03-17, Codex: Reuse the existing consolidated RCA + OC-DFG object-store workspace for the lifecycle tab and avoid surfacing `Insights` or `OC-DFG` in the primary UX copy. Rationale: the underlying combined investigation capability is already the right functional shape; the change needed is wording, framing, and placement around object lifecycle understanding.
- 2026-03-17, Codex: Keep old ontology code and routes in the repository and mark them deprecated instead of deleting them. Rationale: the user explicitly wants to preserve that code for possible future reuse while removing it from the primary product surface now.
- 2026-03-17, Codex: Allow internal ontology-backed implementation names and helpers to remain for now while removing ontology language from user-facing product surfaces. Rationale: the goal is a product reframe and new read model, not an all-at-once symbol rename across the monorepo.
- 2026-03-17, Codex: Do not preserve backward compatibility or migration behavior as a design constraint for this work. Rationale: this is pre-launch work aimed at the best final catalog-first product state, not a user migration.
- 2026-03-17, Codex: Build Phase 1 catalog relation composition from ontology SPARQL queries rather than reusing `/ontology/graph` output directly. Rationale: SPARQL traversal can express the required object/event/action/trigger joins (especially object references) without exposing raw graph payloads as the primary contract and without depending on frontend graph parsing.
- 2026-03-17, Codex: Define trigger firing runtime evidence as occurrences of the trigger's `listensTo` event type, with the trigger detail returning linked event/action catalog links. Rationale: there is no dedicated trigger firing persistence model yet, and listened-event occurrences provide a concrete, testable, user-facing runtime signal for trigger activity.
- 2026-03-17, Codex: Make `/catalog` the single primary shell destination and model concept switching with URL-backed rail tabs (`/catalog/objects|actions|events|triggers`) instead of separate sidebar items. Rationale: this keeps catalog concepts as one coherent workspace while preserving fast switching and linkable URLs.
- 2026-03-17, Codex: Keep `/ontology/*`, `/inspector/history`, and `/inspector/insights` routes on disk but remove ontology/object-store/insights from primary nav. Rationale: final-state product IA requires catalog-first framing now, while retained legacy routes still support internal reuse and transition work in later phases.
- 2026-03-17, Codex: Implement Phase 2 object detail as summary-plus-runtime with an explicit lifecycle placeholder note, deferring actual lifecycle tab integration to Phase 3. Rationale: this satisfies phase scope boundaries and keeps the detail route ready for the lifecycle workspace without prematurely pulling in investigation components.
- 2026-03-17, Codex: Runtime evidence tables in catalog detail should favor operational/user-facing column names and remove raw identifier-first columns (`source_event_id`, `run_id`, `trace_id`) from visible table headers/cells. Rationale: catalog-first UX should expose clarity and utility, not storage/trace implementation details.
- 2026-03-17, Codex: Add a lifecycle framing mode to `object-store-insights-workspace` instead of forking or replacing the investigation implementation. Rationale: this preserves the existing combined RCA + OC-DFG capability while letting catalog object detail present lifecycle-first wording and labels.

## Outcomes & Retrospective

2026-03-17 baseline setup:

1. Created a dedicated active execution plan for the catalog reframe and lifecycle work before changing behavior.
2. Recorded a clean baseline validation ledger:
   - backend Ruff passed
   - backend pytest passed (`154 passed in 51.92s`)
   - frontend production build passed
3. Confirmed that no active post-MVP execution plan currently exists, so this plan becomes the single in-progress execution track when implementation starts.

Execution-phase outcomes will be appended here as phases complete. The final retrospective must explicitly record:

1. what catalog routes and APIs replaced the ontology-first surface,
2. what old nav/routes were intentionally removed from the primary shell,
3. what ontology code was intentionally retained as deprecated implementation,
4. and any follow-on cleanup that is deferred to tech debt.

2026-03-17 Phase 1 outcome:

1. Added a dedicated backend catalog namespace under `/api/v1/catalog` with per-concept list/detail/runtime endpoints for objects, actions, events, and triggers.
2. Added a catalog read-model composition service that generates friendly `catalog_key` values, resolves keys back to concepts, and composes concept relationships from ontology SPARQL reads.
3. Added runtime evidence adapters that keep payloads user-focused and avoid exposing ontology URI identifiers in the catalog contracts.
4. Added targeted regression coverage in `tests/test_catalog_phase1.py` for list/detail/runtime endpoints and catalog key resolution.
5. Phase 1 validation passed:
   - `cd /workspaces/seer-python/seer-backend && ./.venv/bin/ruff check src tests`
   - `cd /workspaces/seer-python/seer-backend && ./.venv/bin/pytest tests/test_catalog_phase1.py`
   - `cd /workspaces/seer-python/seer-backend && ./.venv/bin/pytest`

2026-03-17 Phase 2 outcome:

1. Reframed primary shell navigation to `Catalog`, `Managed Agents`, and `Assistant`, and switched `/` to redirect to `/catalog/objects`.
2. Added new catalog route tree and UI surfaces:
   - `/catalog` redirect
   - `/catalog/[kind]` list pages with URL-backed rail tabs
   - `/catalog/[kind]/[catalogKey]` dedicated concept detail pages with summary-left/runtime-right layouts
3. Added frontend catalog contracts and clients in `seer-ui/app/types/catalog.ts` and `seer-ui/app/lib/api/catalog.ts`, consuming the dedicated `/api/v1/catalog/*` endpoints from Phase 1.
4. Converted `/ontology` and `/ontology/[tab]` to redirect into catalog kinds while leaving old ontology components present on disk.
5. Added/updated UI contract coverage for catalog-first IA and nav/redirect behavior in:
   - `seer-ui/tests/catalog.contract.test.mjs`
   - `seer-ui/tests/history.contract.test.mjs`
   - `seer-ui/tests/insights.contract.test.mjs`
6. Phase 2 validation passed:
   - `cd /workspaces/seer-python/seer-ui && npm run build`
   - `cd /workspaces/seer-python/seer-ui && node --test tests/catalog.contract.test.mjs tests/history.contract.test.mjs tests/insights.contract.test.mjs`

2026-03-17 Phase 2 finisher outcome:

1. Refined catalog detail runtime tables to remove internal identifier-first presentation:
   - objects now show `Recorded`, `Reference`, and `Snapshot`
   - actions now show `Status`, `Submitted`, `Completed`, and `Attempts`
   - events and triggers now show `Occurred`, `Source`, and `Summary`
2. Kept raw internal identifiers out of visible runtime table columns and cells in `seer-ui/app/components/catalog/catalog-detail-page.tsx`.
3. Strengthened `seer-ui/tests/catalog.contract.test.mjs` with explicit assertions for the user-facing headers and explicit guards against old internal-ID headers.
4. Phase 2 finisher validation passed:
   - `cd /workspaces/seer-python/seer-ui && npm run build`
   - `cd /workspaces/seer-python/seer-ui && node --test tests/catalog.contract.test.mjs tests/history.contract.test.mjs tests/insights.contract.test.mjs`

2026-03-17 Phase 3 outcome:

1. Replaced the object-detail lifecycle placeholder with a real two-mode object detail flow in `seer-ui/app/components/catalog/catalog-detail-page.tsx`: `Summary` and `<Object Name> Lifecycle`.
2. Added `seer-ui/app/components/catalog/object-lifecycle-workspace.tsx` as a catalog-local lifecycle adapter that resolves object model context and embeds the existing combined investigation workspace.
3. Extended `seer-ui/app/components/inspector/object-store-insights-workspace.tsx` with a lifecycle framing mode so catalog object detail uses lifecycle-oriented wording while inspector history/insights routes retain existing labels.
4. Kept action/event/trigger detail pages on the existing single-page summary/runtime layout and preserved user-facing runtime table language.
5. Updated `seer-ui/tests/catalog.contract.test.mjs` to assert lifecycle tab/wrapper integration instead of the old Phase 3 placeholder copy.
6. Phase 3 validation passed:
   - `cd /workspaces/seer-python/seer-ui && npm run build`
   - `cd /workspaces/seer-python/seer-ui && node --test tests/catalog.contract.test.mjs tests/history.contract.test.mjs tests/insights.contract.test.mjs` passed (`11/11` tests)
7. Controller gating kept Phase 3 open for a narrow finisher before Phase 4:
   - replace remaining technical lifecycle-result wording with plain lifecycle language,
   - and make lifecycle object-model resolution deterministic instead of relying on catalog display-name matching alone.

2026-03-17 Phase 4 outcome:

1. Canonical docs were ratified: `AGENTS.md`, `VISION.md`, and `DESIGN.md` now describe `Catalog` as the primary discovery surface, `docs/product-specs/foundation-module-shell-phase-0.md` lists `/catalog` routes while marking `/ontology` pages as deprecated retained surfaces, and `ARCHITECTURE.md` keeps ontology as the internal capability layer that powers the catalog read model.
2. Indexes and plan metadata were updated: the active plan entry was removed from `docs/exec-plans/active/index.md`, the completed-plan README gained a new entry, and this plan now lives under `docs/exec-plans/completed/catalog-reframe-and-lifecycle-workspace.md` with its living sections closed out.
3. Final validations ran and passed:
   - `cd /workspaces/seer-python/seer-backend && ./.venv/bin/ruff check .`
   - `cd /workspaces/seer-python/seer-backend && ./.venv/bin/pytest`
   - `cd /workspaces/seer-python/seer-ui && npm run build`
   - `cd /workspaces/seer-python/seer-ui && node --test tests/catalog.contract.test.mjs tests/history.contract.test.mjs tests/insights.contract.test.mjs`
4. The plan’s retrospective records that catalog routes, nav, lifecycle framing, and documentation now represent the final state; legacy ontology surfaces remain on disk purely as deprecated reference implementations.

## Context and Orientation

Current UI state:

- `seer-ui/app/components/layout/nav-sidebar.tsx` now defines the main shell nav as `Catalog`, `Managed Agents`, and `Assistant`.
- `seer-ui/app/page.tsx` now redirects `/` to `/catalog/objects`.
- `seer-ui/app/catalog/` now hosts the primary catalog workspace (`/catalog`, `/catalog/[kind]`, `/catalog/[kind]/[catalogKey]`).
- `seer-ui/app/ontology/page.tsx` and `seer-ui/app/ontology/[tab]/page.tsx` now redirect to catalog routes, while the graph-oriented ontology components remain retained code.
- `seer-ui/app/components/ontology/ontology-explorer-tabs.tsx` is graph-first and not the desired primary catalog experience.
- `seer-ui/app/components/ui/tabs.tsx` and `seer-ui/app/components/ui/table.tsx` already provide the interaction primitives needed for a catalog workspace.
- `seer-ui/app/components/inspector/history-panel.tsx`, `seer-ui/app/components/inspector/insights-panel.tsx`, and `seer-ui/app/components/inspector/managed-agent-detail-panel.tsx` provide reusable tab, summary, and detail layout patterns.
- `seer-ui/app/components/inspector/object-store-insights-workspace.tsx` is the strongest reusable starting point for the future object lifecycle tab.

Current backend/data-contract state:

- `seer-ui/app/lib/api/catalog.ts` and `seer-backend/src/seer_backend/api/catalog.py` now expose dedicated per-concept catalog list/detail/runtime reads as the primary catalog contract.
- `seer-ui/app/lib/api/ontology.ts` and `seer-backend/src/seer_backend/api/ontology.py` remain available for legacy ontology/graph consumers and retained expert surfaces.
- `seer-ui/app/lib/api/history.ts` and `seer-backend/src/seer_backend/api/history.py` already cover latest objects and event occurrences needed for object/event runtime evidence.
- `seer-backend/src/seer_backend/api/actions.py` exposes generic action-status reads, but not a clean catalog-ready action list/detail-by-concept contract.
- No dedicated trigger-firings read model exists today.

Documentation state:

- `AGENTS.md` still states that Seer UI remains read-only for ontology, but it does not yet describe the old ontology pages as deprecated or catalog as the primary user-facing framing.
- `VISION.md` and `DESIGN.md` still use ontology-forward discovery language in several user-facing sections.
- `docs/product-specs/foundation-module-shell-phase-0.md` still lists `/ontology` as a shell-bearing route.
- `docs/product-specs/index.md` currently has no draft spec and no active execution coverage listed.

Architectural constraint:

The ontology remains the internal semantic and executable capability layer. This plan changes user-facing discovery framing and adds catalog-oriented read models, but it must not turn Seer into a general ontology editor or falsely describe the system as ontology-independent.

## Plan of Work

Phase 1 introduces a dedicated catalog read layer in the backend. This phase should create explicit per-concept catalog endpoints under `/api/v1/catalog/` for objects, actions, events, and triggers. The backend implementation should compose existing ontology, history, and action services rather than expose raw graph payloads to the new UI. It also needs to own friendly `catalogKey` generation and concept lookup so frontend navigation never depends on raw ontology URIs. The resulting contracts should be type-stable and concept-specific: list, detail, and runtime-evidence endpoints for each catalog concept.

Phase 2 reorients the shell and routes around catalog-first discovery. The sidebar should become `Catalog`, `Managed Agents`, and `Assistant`. `Catalog` should open on `/catalog/objects`, use a URL-backed tab rail for the four concepts, and render table-first list pages. Each concept should have a dedicated detail route. Actions, events, and triggers should use a single-page summary-plus-runtime layout, while objects initially land on a summary layout that is ready for the lifecycle tab introduced in Phase 3. The old `/ontology/*` routes should redirect into catalog where possible, and raw ontology pages should stop being part of the primary shell flow.

Phase 3 folds the existing consolidated object-store RCA + OC-DFG workspace into object detail as `<Object Name> Lifecycle`. This phase should keep that combined investigation functionality intact, but relabel and reshape it around lifecycle understanding rather than `Insights` or `OC-DFG`. The object detail page should end Phase 3 with top-level tabs: `Summary` and `<Object Name> Lifecycle`. During this same phase, finish the user-facing copy audit so the new product surface consistently says `Catalog` instead of `Ontology`, and remove `Object Store` / `Insights` from the primary nav while leaving reusable route code in place as needed.

Phase 4 ratifies canonical docs, finalizes product/spec truth, runs final validation, and prepares the plan for archive. This includes `AGENTS.md`, `VISION.md`, `DESIGN.md`, relevant product specs, and the active/completed indexes. The final doc pass must make the intentional legacy removals explicit: ontology pages are deprecated, the shell is catalog-first, object lifecycle replaces the old object-scoped insights framing, and old ontology implementation code remains intentionally retained.

## Concrete Steps

1. Create the active plan and register it in `docs/exec-plans/active/index.md`.
2. Record baseline validation before implementation:
   ```bash
   cd /workspaces/seer-python/seer-backend && ./.venv/bin/ruff check .
   cd /workspaces/seer-python/seer-backend && ./.venv/bin/pytest
   cd /workspaces/seer-python/seer-ui && npm run build
   ```
3. Implement backend catalog models, service composition, and dedicated per-concept endpoints.
4. Add backend coverage for concept list/detail/runtime behavior and friendly key resolution.
5. Implement shell/nav/route changes and the catalog tab-rail workspace.
6. Implement concept list tables and detail layouts, then wire old `/ontology/*` routes to redirect behavior.
7. Reuse the object investigation implementation to build the `<Object Name> Lifecycle` tab and update its copy.
8. Update canonical docs/specs and rerun final validation.
9. Archive the plan to `docs/exec-plans/completed/` when acceptance is met.

Expected observable milestones:

1. After Phase 1, the backend can serve catalog-ready object/action/event/trigger lists, concept detail payloads, and runtime evidence without exposing raw ontology graph payloads as the primary contract.
2. After Phase 2, the shell opens on `Catalog`, the sidebar no longer promotes `Ontology Explorer`, `Object Store`, or `Insights`, and catalog detail pages are routable and readable.
3. After Phase 3, object detail exposes `Summary` and `<Object Name> Lifecycle`, and the lifecycle view reuses the consolidated RCA + OC-DFG workspace under business-facing terminology rather than academic process-mining terminology.
4. After Phase 4, the repository docs and specs describe the catalog-first product truth, explicitly mark the old ontology surface as deprecated retained code, and record any intentional replacements of older routes/contracts as final-state cleanup rather than regressions.

## Validation and Acceptance

Baseline validation:

- `cd /workspaces/seer-python/seer-backend && ./.venv/bin/ruff check .`
- `cd /workspaces/seer-python/seer-backend && ./.venv/bin/pytest`
- `cd /workspaces/seer-python/seer-ui && npm run build`

Baseline results recorded on 2026-03-17:

- backend Ruff: passed
- backend pytest: passed (`154 passed in 51.92s`)
- frontend build: passed

Phase 1 acceptance:

1. Dedicated per-concept catalog endpoints exist and return concept-specific, user-facing response shapes.
2. Friendly `catalogKey` resolution works without exposing URI query params in the new UI flow.
3. Trigger runtime evidence is explicitly defined and covered by tests rather than left implicit.
4. Targeted backend validation passes.

Phase 2 acceptance:

1. `/` redirects to `/catalog/objects`.
2. The sidebar shows `Catalog`, `Managed Agents`, and `Assistant`.
3. The `Catalog` workspace exposes the four concept tabs with URL-backed navigation.
4. Catalog tables do not show URI/IRI/RDF/ontology implementation labels.
5. Dedicated concept detail pages render the expected summary/runtime layouts.
6. `/ontology/*` redirects into catalog routes coherently.

Phase 3 acceptance:

1. Object detail renders `Summary` and `<Object Name> Lifecycle`.
2. The lifecycle tab uses the existing consolidated RCA + OC-DFG object-store workspace rather than a different or reduced investigation implementation.
3. Lifecycle copy and UI framing do not rely on `Insights` or `OC-DFG` terminology as the primary user-facing label.
4. Existing reusable object investigation functionality remains available inside the new lifecycle framing.
5. Primary nav no longer exposes `Object Store` or `Insights`.

Final acceptance:

1. `AGENTS.md`, `VISION.md`, `DESIGN.md`, and relevant product specs are updated in the same change.
2. Final validation passes: backend Ruff, backend pytest, frontend `npm run build`, and the catalog/history/insights contract tests all succeeded.
3. The active plan is archived and indexes are consistent.

Known baseline failures before implementation: none recorded. Treat any new failure as a regression until proven otherwise.

## Idempotence and Recovery

This plan is safe to resume phase-by-phase as long as the checked-in `Progress` section and each phase's `Phase Handoff` remain current.

If execution stops mid-phase:

1. read `AGENTS.md`, `PLANS.md`, and this plan first;
2. trust the `Progress` checklist and the active phase handoff over chat history;
3. run that phase's targeted validation commands before making new edits;
4. inspect `git status` and preserve unrelated user changes;
5. never remove old ontology code during recovery unless a later explicit decision supersedes this plan.

Route and UI recovery notes:

1. If catalog routes land before legacy-route cleanup, finish the catalog-first shell rather than restoring ontology-first navigation.
2. If object lifecycle framing is incomplete, keep the lifecycle tab hidden behind a stable route/state until the copy and layout are coherent.
3. If per-concept APIs land before all catalog callers are switched, prioritize completing the new catalog-first callers rather than preserving older call sites for compatibility.

## Artifacts and Notes

Baseline frontend build route table captured on 2026-03-17:

1. `/`
2. `/assistant`
3. `/inspector`
4. `/inspector/analytics`
5. `/inspector/history`
6. `/inspector/history/object`
7. `/inspector/insights`
8. `/inspector/managed-agents`
9. `/ontology`
10. `/ontology/[tab]`

Planned catalog route model:

1. `/catalog`
2. `/catalog/objects`
3. `/catalog/actions`
4. `/catalog/events`
5. `/catalog/triggers`
6. `/catalog/[kind]/[catalogKey]`

Planned list-table columns:

1. Objects: `Name`, `Description`, `Actions`, `Events`
2. Actions: `Name`, `Description`, `Objects`, `Triggers`
3. Events: `Name`, `Description`, `Objects`, `Triggers`
4. Triggers: `Name`, `Description`, `Events`, `Actions`

Planned runtime evidence endpoints:

1. `/api/v1/catalog/objects/:key/instances`
2. `/api/v1/catalog/actions/:key/runs`
3. `/api/v1/catalog/events/:key/occurrences`
4. `/api/v1/catalog/triggers/:key/firings`

## Interfaces and Dependencies

Important frontend modules and routes:

- `seer-ui/app/components/layout/nav-sidebar.tsx`
- `seer-ui/app/page.tsx`
- `seer-ui/app/layout.tsx`
- `seer-ui/app/components/ui/tabs.tsx`
- `seer-ui/app/components/ui/table.tsx`
- `seer-ui/app/ontology/`
- `seer-ui/app/components/ontology/`
- `seer-ui/app/components/inspector/managed-agent-detail-panel.tsx`
- `seer-ui/app/components/inspector/history-panel.tsx`
- `seer-ui/app/components/inspector/object-store-insights-workspace.tsx`
- `seer-ui/app/lib/api/history.ts`
- `seer-ui/app/lib/api/agentic-workflows.ts`
- `seer-ui/app/lib/api/ontology.ts`

Important backend modules:

- `seer-backend/src/seer_backend/api/ontology.py`
- `seer-backend/src/seer_backend/api/history.py`
- `seer-backend/src/seer_backend/api/actions.py`
- `seer-backend/src/seer_backend/ontology/service.py`
- `seer-backend/src/seer_backend/actions/service.py`
- new catalog-specific backend read-model modules under `seer-backend/src/seer_backend/`

Important docs/specs:

- `AGENTS.md`
- `VISION.md`
- `DESIGN.md`
- `ARCHITECTURE.md`
- `docs/product-specs/index.md`
- `docs/product-specs/foundation-module-shell-phase-0.md`
- new catalog-facing product spec to be added during execution

## Phase 1

### Phase Handoff

**Goal**

Land backend catalog read models plus dedicated per-concept catalog APIs for objects, actions, events, and triggers.

**Scope Boundary**

Backend-only implementation for new catalog contracts, friendly key resolution, and regression coverage. Do not change shell navigation or frontend catalog routes in this phase beyond unavoidable type-alignment scaffolding.

**Read First**

1. `AGENTS.md`
2. `PLANS.md`
3. `docs/exec-plans/active/catalog-reframe-and-lifecycle-workspace.md`
4. `seer-backend/src/seer_backend/api/ontology.py`
5. `seer-backend/src/seer_backend/api/history.py`
6. `seer-backend/src/seer_backend/api/actions.py`
7. `seer-backend/src/seer_backend/ontology/service.py`
8. `seer-backend/src/seer_backend/actions/service.py`

**Files Expected To Change**

- new catalog backend modules under `seer-backend/src/seer_backend/`
- backend API router wiring
- backend tests covering catalog endpoints and read-model composition
- this plan

**Validation**

1. `cd /workspaces/seer-python/seer-backend && ./.venv/bin/ruff check src tests`
2. `cd /workspaces/seer-python/seer-backend && ./.venv/bin/pytest`
3. `cd /workspaces/seer-python/seer-backend && ./.venv/bin/pytest tests/test_catalog_phase1.py`

**Plan / Docs To Update**

1. `docs/exec-plans/active/catalog-reframe-and-lifecycle-workspace.md`
2. `docs/exec-plans/active/index.md` only if phase status materially changes beyond this plan's progress log

**Deliverables**

1. Per-concept catalog list/detail/runtime endpoints
2. Friendly `catalogKey` generation and lookup
3. Targeted backend regression coverage
4. Updated plan progress, discoveries, and decision log entries

**Commit Expectation**

One backend-focused commit, for example: `Add dedicated catalog read APIs`

**Known Constraints / Baseline Failures**

1. Keep response contracts concept-specific; do not add one kind-switched mega endpoint.
2. Compatibility is not a requirement. If an older ontology-first caller blocks the new clean contract, replace it rather than preserving it.
3. No baseline failures are recorded as of 2026-03-17.

**Status**

finisher_required

**Completion Notes**

2026-03-17: Phase 1 landed the backend catalog read stack and API namespace.

1. Added `seer-backend/src/seer_backend/catalog/models.py` and `seer-backend/src/seer_backend/catalog/service.py` to define catalog response contracts, friendly `catalog_key` generation, key lookup, and ontology/history/actions composition logic.
2. Added `seer-backend/src/seer_backend/api/catalog.py` and wired it in `seer-backend/src/seer_backend/main.py` to expose dedicated per-concept list/detail/runtime endpoints:
   - `/api/v1/catalog/objects`, `/:key`, `/:key/instances`
   - `/api/v1/catalog/actions`, `/:key`, `/:key/runs`
   - `/api/v1/catalog/events`, `/:key`, `/:key/occurrences`
   - `/api/v1/catalog/triggers`, `/:key`, `/:key/firings`
3. Added `seer-backend/tests/test_catalog_phase1.py` coverage for concept list/detail/runtime behavior, 404 key lookup handling, and no-URI contract expectations.
4. Validation evidence:
   - `cd /workspaces/seer-python/seer-backend && ./.venv/bin/ruff check src tests` passed.
   - `cd /workspaces/seer-python/seer-backend && ./.venv/bin/pytest tests/test_catalog_phase1.py` passed (`4 passed`).
   - `cd /workspaces/seer-python/seer-backend && ./.venv/bin/pytest` passed (`158 passed in 60.09s`).

**Next Starter Context**

Phase 2 can now consume stable catalog backend contracts directly from `/api/v1/catalog/*` and does not need to use ontology graph/query payloads for primary catalog pages.

1. Build the frontend `Catalog` workspace against the new per-concept endpoints.
2. Keep ontology routes/code present but remove them from primary shell framing per plan.
3. Reuse the new `catalog_key` URL pattern for detail pages and runtime tables.

## Phase 2

### Phase Handoff

**Goal**

Land the shell/navigation update and the new catalog list/detail routes using the new backend contracts from Phase 1.

**Scope Boundary**

Frontend shell, routes, tab-rail workspace, concept tables, detail layouts, and ontology-route redirects. Do not build the object lifecycle tab in this phase beyond creating the object detail page structure it will live in.

**Read First**

1. `AGENTS.md`
2. `PLANS.md`
3. `docs/exec-plans/active/catalog-reframe-and-lifecycle-workspace.md`
4. `seer-ui/app/components/layout/nav-sidebar.tsx`
5. `seer-ui/app/page.tsx`
6. `seer-ui/app/components/ui/tabs.tsx`
7. `seer-ui/app/components/ui/table.tsx`
8. `seer-ui/app/components/inspector/managed-agent-detail-panel.tsx`
9. any new frontend catalog API clients/types added in Phase 1

**Files Expected To Change**

- `seer-ui/app/page.tsx`
- `seer-ui/app/components/layout/nav-sidebar.tsx`
- new `seer-ui/app/catalog/` routes and catalog components
- old `/ontology` route files for redirect behavior
- frontend contract tests
- this plan

**Validation**

1. `cd /workspaces/seer-python/seer-ui && npm run build`
2. `cd /workspaces/seer-python/seer-ui && node --test tests/catalog.contract.test.mjs tests/history.contract.test.mjs tests/insights.contract.test.mjs`

**Plan / Docs To Update**

1. `docs/exec-plans/active/catalog-reframe-and-lifecycle-workspace.md`

**Deliverables**

1. `Catalog` shell entry and `/catalog` route tree
2. URL-backed tab rail for objects/actions/events/triggers
3. Dedicated concept detail pages
4. `/ontology/*` redirect behavior
5. Updated plan progress and evidence

**Commit Expectation**

One frontend IA commit, for example: `Add catalog workspace and redirect ontology routes`

**Known Constraints / Baseline Failures**

1. Keep old ontology code present; do not delete graph components/routes.
2. Keep `Managed Agents` and `Assistant` as top-level sidebar entries.
3. `Object Store` and `Insights` should stop being primary-nav items by the end of this phase.
4. Compatibility with the older primary shell is not required if it conflicts with the new catalog-first IA.

**Status**

completed

**Completion Notes**

2026-03-17: Phase 2 landed catalog-first shell/nav/routes and legacy ontology redirects.

1. Updated primary shell navigation in `seer-ui/app/components/layout/nav-sidebar.tsx` to `Catalog`, `Managed Agents`, and `Assistant`.
2. Switched `seer-ui/app/page.tsx` to redirect `/` to `/catalog/objects`.
3. Added catalog routes/components and frontend contracts:
   - `seer-ui/app/catalog/page.tsx`
   - `seer-ui/app/catalog/[kind]/page.tsx`
   - `seer-ui/app/catalog/[kind]/[catalogKey]/page.tsx`
   - `seer-ui/app/components/catalog/catalog-kind-tabs.tsx`
   - `seer-ui/app/components/catalog/catalog-list-page.tsx`
   - `seer-ui/app/components/catalog/catalog-detail-page.tsx`
   - `seer-ui/app/lib/api/catalog.ts`
   - `seer-ui/app/lib/catalog-routes.ts`
   - `seer-ui/app/types/catalog.ts`
4. Updated legacy ontology route files to redirect into catalog:
   - `seer-ui/app/ontology/page.tsx`
   - `seer-ui/app/ontology/[tab]/page.tsx`
5. Updated contract tests for catalog-first shell behavior and new catalog route/API expectations:
   - `seer-ui/tests/catalog.contract.test.mjs`
   - `seer-ui/tests/history.contract.test.mjs`
   - `seer-ui/tests/insights.contract.test.mjs`
6. Validation evidence:
   - `cd /workspaces/seer-python/seer-ui && npm run build` passed.
   - `cd /workspaces/seer-python/seer-ui && node --test tests/catalog.contract.test.mjs tests/history.contract.test.mjs tests/insights.contract.test.mjs` passed (`11/11` tests).
7. 2026-03-17 finisher pass refined runtime table clarity in `seer-ui/app/components/catalog/catalog-detail-page.tsx`:
   - objects: `Recorded`, `Reference`, `Snapshot`
   - actions: `Status`, `Submitted`, `Completed`, `Attempts`
   - events/triggers: `Occurred`, `Source`, `Summary`
   - removed user-visible `source_event_id`, `run_id`, and `trace_id` columns
8. Added explicit contract coverage in `seer-ui/tests/catalog.contract.test.mjs` to keep those internal-ID columns from reappearing.
9. Finisher validation evidence:
   - `cd /workspaces/seer-python/seer-ui && npm run build` passed.
   - `cd /workspaces/seer-python/seer-ui && node --test tests/catalog.contract.test.mjs tests/history.contract.test.mjs tests/insights.contract.test.mjs` passed (`11/11` tests).

**Next Starter Context**

Phase 4 should now drive the docs/spec ratification, final validation, and archive readiness work.

1. Update `AGENTS.md`, `VISION.md`, `DESIGN.md`, and relevant product specs to describe the catalog-first framing, document the deprecated ontology routes, and clarify that the lifecycle workspace reuses the combined RCA + OC-DFG capability without exposing ontology internals.
2. Keep `ARCHITECTURE.md` accurate about the internal ontology layer while referencing the new catalog read model.
3. Prepare the plan and indexes for archive by recording final acceptance, linking the completed plan, and confirming any deferred follow-on work.

## Phase 3

### Phase Handoff

**Goal**

Turn object detail into a two-mode experience with `Summary` and `<Object Name> Lifecycle`, reusing the current object-scoped investigation capability under new lifecycle framing.

**Scope Boundary**

Object detail only: lifecycle tab integration, copy updates, and any local adapters needed to reuse the existing investigation components. Do not broaden this phase into generic analytics or assistant work.

**Read First**

1. `AGENTS.md`
2. `PLANS.md`
3. `docs/exec-plans/active/catalog-reframe-and-lifecycle-workspace.md`
4. `seer-ui/app/components/inspector/object-store-insights-workspace.tsx`
5. `seer-ui/app/components/inspector/history-panel.tsx`
6. `seer-ui/app/catalog/[kind]/[catalogKey]/page.tsx`
7. `seer-ui/app/components/catalog/catalog-detail-page.tsx`

**Files Expected To Change**

- `seer-ui/app/components/catalog/catalog-detail-page.tsx`
- any new lifecycle-specific wrapper or helper components under `seer-ui/app/components/catalog/`
- `seer-ui/app/catalog/[kind]/[catalogKey]/page.tsx` only if the object-detail route host needs light route-level support
- reused object investigation components or wrappers
- relevant UI tests
- this plan

**Validation**

1. `cd /workspaces/seer-python/seer-ui && npm run build`
2. `cd /workspaces/seer-python/seer-ui && node --test tests/catalog.contract.test.mjs tests/history.contract.test.mjs tests/insights.contract.test.mjs`

**Plan / Docs To Update**

1. `docs/exec-plans/active/catalog-reframe-and-lifecycle-workspace.md`

**Deliverables**

1. object detail `Summary` tab
2. object detail `<Object Name> Lifecycle` tab
3. lifecycle-facing copy and labeling
4. updated plan discoveries and decision log entries

**Commit Expectation**

One object-lifecycle-focused commit, for example: `Embed combined object investigation as lifecycle view`

**Known Constraints / Baseline Failures**

1. Avoid surfacing `OC-DFG` and `Insights` as the primary user-facing labels in this flow.
2. Reuse the existing combined RCA + OC-DFG object-store workspace as the functional base for lifecycle view; do not replace it with a weaker or split implementation.
3. Keep the lifecycle tab object-only; actions, events, and triggers stay single-page.
4. If the old object-store framing conflicts with the cleaner lifecycle framing, prefer the lifecycle framing.

**Status**

completed

**Completion Notes**

2026-03-17: Phase 3 completed with lifecycle integration scoped to object detail.

1. `seer-ui/app/components/catalog/catalog-detail-page.tsx` now renders object detail with two rail-tab modes: `Summary` and `<Object Name> Lifecycle`, defaulting to summary on open and feeding the lifecycle tab a backend-provided `object_type_uri` for deterministic model resolution.
2. `seer-ui/app/components/catalog/object-lifecycle-workspace.tsx` now surfaces a friendly lifecycle notice when the object schema is unresolved while always configuring the embedded investigation workspace with the resolved object URI.
3. `seer-ui/app/components/inspector/object-store-insights-workspace.tsx` now embraces lifecycle language in its headers, badges, and helper text so the catalog lifecycle tab reads as business-friendly lifecycle insight rather than academic analytics.
4. `seer-ui/tests/catalog.contract.test.mjs` now guards the new column names, lifecycle copy, and `objectType` wiring while keeping tab/rail expectations intact.
5. Validation evidence:
   - `cd /workspaces/seer-python/seer-ui && npm run build` passed.
   - `cd /workspaces/seer-python/seer-ui && node --test tests/catalog.contract.test.mjs tests/history.contract.test.mjs tests/insights.contract.test.mjs` passed (`11/11` tests).

**Next Starter Context**

Phase 4 should drive the docs/spec ratification, final validation, and plan/index archive now that the lifecycle polish is complete.

1. Explicitly document the catalog-first framing, the deprecated ontology navigation, and the lifecycle wording/copy changes in `AGENTS.md`, `VISION.md`, `DESIGN.md`, and the relevant product specs.
2. Keep `ARCHITECTURE.md` aligned with the internal ontology capability while referencing the catalog read-model truth.
3. Close the active plan by recording the acceptance results, updating the indexes, and noting any intentionally deferred follow-on cleanup in the tech-debt tracker.

## Phase 4

### Phase Handoff

**Goal**

Ratify docs/specs, run final validation, and prepare the plan for archive.

**Scope Boundary**

Documentation, specs, validation, and index/archive readiness only. Do not introduce fresh product behavior beyond the doc fixes needed to accurately describe what already landed.

**Read First**

1. `AGENTS.md`
2. `PLANS.md`
3. `docs/exec-plans/active/catalog-reframe-and-lifecycle-workspace.md`
4. `VISION.md`
5. `DESIGN.md`
6. `ARCHITECTURE.md`
7. `docs/product-specs/index.md`
8. `docs/product-specs/foundation-module-shell-phase-0.md`

**Files Expected To Change**

- `AGENTS.md`
- `VISION.md`
- `DESIGN.md`
- `ARCHITECTURE.md` if invariants or boundaries need ratification
- product spec files and indexes
- active/completed plan indexes
- this plan

**Validation**

1. `cd /workspaces/seer-python/seer-backend && ./.venv/bin/ruff check .`
2. `cd /workspaces/seer-python/seer-backend && ./.venv/bin/pytest`
3. `cd /workspaces/seer-python/seer-ui && npm run build`
4. targeted UI/backend tests added by prior phases

**Plan / Docs To Update**

1. `docs/exec-plans/active/catalog-reframe-and-lifecycle-workspace.md`
2. `docs/exec-plans/active/index.md`
3. relevant product/spec/design docs

**Deliverables**

1. Canonical docs/specs aligned to catalog-first product framing
2. Final validation evidence
3. Archive-ready plan state

**Commit Expectation**

One ratification commit, for example: `Ratify catalog framing and lifecycle docs`

**Known Constraints / Baseline Failures**

1. Keep architecture truthful about the internal ontology layer even while user-facing copy becomes catalog-first.
2. Make deprecation explicit: old ontology routes/pages are retained code, not current product truth.
3. No baseline failures are recorded as of 2026-03-17.
4. Do not retain legacy compatibility shims beyond what is minimally necessary to complete the migration cleanly.

**Status**

pending

**Completion Notes**

Not started.

**Next Starter Context**

Do not wait until the end to think about docs. Each prior phase should leave enough breadcrumbs here that final ratification is a coherence pass, not a rediscovery effort.
