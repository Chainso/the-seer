# Post-MVP Exec Plan: Prophet Action-Only Alignment

**Status:** active (archive-ready)  
**Target order:** post-MVP track 13  
**Agent slot:** AGENT-ACTION-MODEL-1  
**Predecessor:** `docs/exec-plans/completed/managed-agent-runtime-and-agentic-workflows.md`, `docs/exec-plans/completed/object-store-model-locked-tabs.md`, `docs/exec-plans/completed/adaptive-lifecycle-label-display.md`  
**Successor:** none  
**Last updated:** 2026-03-15

---

## Purpose / Big Picture

Prophet shipped an action-only executable model on 2026-03-13 and a field-marked state model on 2026-03-15. Seer still assumes older Prophet concepts such as `process`, `workflow`, `signal`, `transition`, and explicit ontology `State` resources across backend validation, managed-agent contracts, ontology graph categorization, lifecycle display, and analytics setup.

This plan updates Seer so contributors and users see one coherent model:

1. every runnable ontology-defined thing is an action,
2. managed agents are Seer-managed actions rather than a separate Prophet workflow kind,
3. action outputs are events,
4. lifecycle state comes from enum-backed state carrier fields,
5. and Seer no longer preserves obsolete Prophet vocabulary for backward compatibility.

After this work lands, a contributor should be able to ingest current Prophet Turtle output, submit ordinary and managed-agent actions, inspect managed-agent runs by `action_uri`, view stateful objects through state-carrier metadata, and use ontology/analytics surfaces without any visible dependency on removed Prophet concepts.

## Progress

- [x] 2026-03-15 Open active execution plan, update active index, and lock the forward-only migration stance in repository docs.
- [x] 2026-03-15 Run baseline backend/frontend validation commands once, record any unrelated failures in this plan, and confirm the current breakpoints before implementation.
- [x] 2026-03-15 Phase 1 complete: backend ontology/action contracts now classify runnable ontology concepts as `action | agentic_workflow`, bootstrap `seer:AgenticWorkflow` as a `prophet:Action` subtype without touching the dirty `prophet` submodule, and pass the targeted backend validation commands.
- [x] 2026-03-15 Phase 2 complete: managed-agent APIs/UI use action-first terminology and `action_uri`, while `seer:AgenticWorkflow` remains a subtype of `prophet:Action`.
- [x] 2026-03-15 Phase 3 backend/shared-display slice complete: ontology graph nodes now project state-carrier metadata from Prophet field annotations and the shared ontology-display catalog/resolver consume that metadata for state labels and filters.
- [x] 2026-03-15 Phase 3 consumer/history slice complete: Object Store and history consumers now derive lifecycle badges from adjacent state-carrier snapshots and no longer parse explicit `fromState` / `toState` payload keys.
- [x] 2026-03-15 Phase 3 complete: controller merged-branch validation passed for the backend/shared-display and consumer/history slices, closing the state-carrier lifecycle migration.
- [x] 2026-03-15 Phase 4 complete: ontology explorer and analytics/RCA surfaces now use live `Action`, `Event`, and `EventTrigger` concepts, while dead read-only ontology editor and analytics affordances were deleted instead of migrated.
- [x] 2026-03-15 Phase 5 complete: canonical docs/specs are ratified, full validation evidence is recorded, residual grep matches are classified, and the plan is ready to archive.

## Surprises & Discoveries

- 2026-03-15: Prophet's own changelog now records the exact removals Seer must follow: `0.25.0` removed `process` / `workflow` action kinds on 2026-03-13, and `0.27.0` removed dedicated `signal`, object-level `state`, and `transition` concepts on 2026-03-15.
- 2026-03-15: Current Prophet generated Turtle still includes `prophet:EventTrigger`, so Seer should preserve trigger/event automation surfaces rather than removing them with the rest of the stale lifecycle taxonomy.
- 2026-03-15: The repo already contains a large stale read-only ontology editor surface. Because Seer UI is read-only for ontology authoring, these obsolete mutation affordances should be deleted or flattened rather than ported.
- 2026-03-15: Managed-agent execution currently threads `workflow_uri` through backend models, API payloads, frontend types, UI filters, and transcript contracts even though the value is functionally the ontology action identifier.
- 2026-03-15: Baseline validation before implementation produced one clean backend/static baseline and one intentionally broken backend baseline:
  - `cd seer-backend && .venv/bin/ruff check .` passed.
  - `cd seer-ui && npm run build` passed.
  - `cd seer-backend && .venv/bin/pytest` failed with 5 failures and 2 errors, concentrated in `tests/test_actions_submit.py`, `tests/test_ontology_phase1.py`, and `tests/test_root_cause_fake_data.py`.
- 2026-03-15: The broad pytest failures line up with the migration target rather than an unrelated regression:
  - 4 `tests/test_actions_submit.py` failures all report `unsupported_action_capability` because ordinary Prophet actions are no longer classified as `process`, `workflow`, or `agentic_workflow`.
  - `tests/test_ontology_phase1.py::test_ontology_ingest_and_query_include_seer_agentic_workflow_extension` still expects `seer:AgenticWorkflow rdfs:subClassOf prophet:Workflow`.
  - 2 `tests/test_root_cause_fake_data.py` errors currently fail to map the small-business Turtle local identifiers and need reassessment after the ontology/lifecycle migration.
- 2026-03-15: The backend validator was already prepared to load a Seer ontology extension next to `prophet.ttl`, but no tracked `seer.ttl` is present in the superproject. Phase 1 therefore had to embed the Seer extension Turtle in backend ontology bootstrap so the dirty `prophet` submodule could remain untouched.
- 2026-03-15: The first Phase 1 validation rerun exposed one more old-kind dependency outside the original handoff file list: `seer-backend/src/seer_backend/api/actions.py` and `seer-backend/src/seer_backend/api/agentic_workflows.py` still constrained `action_kind` to `process|workflow|agentic_workflow`, so Pydantic rejected the new `action` enum value until those literals were collapsed too.
- 2026-03-15: The agent-orchestration tests outside the Phase 2 handoff `Read First` list still asserted removed `ActionKind.PROCESS|WORKFLOW` members and `workflow_uri` transcript fields, so Phase 2 had to update `tests/test_agent_orchestration_phase3.py` and `tests/test_agent_orchestration_phase4.py` alongside the production contract rename to keep the related suite truthful.
- 2026-03-15: Phase 3 backend work could not rely on explicit enum member nodes in generated Turtle. Prophet emits state options only through `sh:in (...)` on the enum constraint shape, while `prophet:initialEnumValue` points at an `enumv_*` IRI with no separate label triples, so the backend graph had to derive initial literal values by matching the enum-value IRI suffix back to the SHACL option list.
- 2026-03-15: The shared resolver still short-circuited every state-like field label to `"State"` before checking ontology labels. Once the state carrier field became `status`, Phase 3 had to change `displayFieldLabel` to consult ontology field labels first so state-carrier fields keep their real labels.
- 2026-03-15: The canonical object-history contract exposes only the event-linked object snapshot, not an explicit previous snapshot or `fromState` / `toState` payload fields, so the consumer lane had to derive lifecycle badges by diffing adjacent snapshots in timeline order on the shared `stateFilterFieldKey`.
- 2026-03-15: The old read-only ontology editor and standalone ontology analytics panel were completely unmounted from the live app. Phase 4 could therefore delete those files outright instead of preserving mutation-era scaffolding that only referenced removed Prophet concepts.
- 2026-03-15: RCA setup, Object Store insights, and process mining all needed the same event-to-model traversal after `Signal` / `Transition` removal, so Phase 4 introduced one shared frontend runtime helper instead of leaving three slightly divergent copies of the old logic.
- 2026-03-15: Phase 5 full-suite validation exposed a second wave of stale truth that was not product behavior but still blocked acceptance: action tests still asserted removed `ActionKind.PROCESS|WORKFLOW` members, the ontology copilot prompt/index still taught removed Prophet concepts, and the RCA fake-data normalizer still expected transition-era small-business local names. Those were fixed in-scope because final validation is part of the phase contract.
- 2026-03-15: After the final cleanup pass, the required broad grep still returns a small set of intentional or false-positive matches:
  - the internal ClickHouse transcript storage column and historical migration still use `workflow_uri`,
  - `AbortSignal`, React `startTransition`, and `disableTransitionOnChange` are framework/library symbols rather than Prophet concepts,
  - `docs/product-specs/new-user-onboarding.md` contains the heading `Success Signals`,
  - `tests/test_root_cause_fake_data.py` intentionally keeps legacy transition-era identifier strings so the old fake-data fixture can be canonicalized onto the current event model.

## Decision Log

- 2026-03-15, Codex: Seer will not preserve backward compatibility for removed Prophet executable categories or lifecycle concepts. Rationale: `AGENTS.md` explicitly says to optimize for the best current model, and the user explicitly requested breakage over compatibility shims.
- 2026-03-15, Codex: All public managed-agent contracts should replace `workflow_uri` with `action_uri`. Rationale: in the new Prophet model every runnable ontology-defined thing is an action, so `workflow_uri` is semantically wrong even when the underlying value remains the same URI.
- 2026-03-15, Codex: `seer:AgenticWorkflow` remains as the Seer ontology class name for managed-agent actions, but it must extend `prophet:Action`. Rationale: this preserves Seer's managed-agent subtype without pretending Prophet still has a first-class workflow capability kind.
- 2026-03-15, Codex: Generic execution classification should collapse to `action | agentic_workflow`. Rationale: the shared control plane still needs one small classifier for ordinary versus managed-agent execution rows, but Prophet's old `process | workflow` taxonomy must be removed.
- 2026-03-15, Codex: Phase 1 should ship the Seer ontology extension as backend-owned bootstrap Turtle instead of editing files inside `prophet/`. Rationale: the `prophet` submodule is already dirty and explicitly out of scope for this phase, while backend validation/query bootstrap already owns the base graph composition seam.
- 2026-03-15, Codex: Phase 1 may update backend response-model literals in `api/actions.py` and `api/agentic_workflows.py` even though managed-agent contract renames belong to Phase 2. Rationale: the shared execution-kind collapse is a Phase 1 deliverable, and the backend cannot serialize `action` records correctly until those schema literals accept the new value.
- 2026-03-15, Codex: Phase 2 keeps the ClickHouse transcript table column name `workflow_uri` unchanged while remapping every managed-agent service/API/UI field to `action_uri`. Rationale: the storage column is an internal persistence detail, and avoiding a schema migration keeps the phase scoped to public contract correction instead of storage churn.
- 2026-03-15, Codex: Phase 3 is safe to split into two implementation lanes as long as the backend/shared-display lane lands first and the consumer/UI lane only reads the new metadata. Rationale: the backend graph plus shared resolver files are largely disjoint from the inspector history consumers, and sequencing the metadata producer first reduces merge risk while keeping the plan truthful about the phase still being open.
- 2026-03-15, Codex: The history/Object Store consumer lane should use adjacent object snapshots as the lifecycle diff source and treat explicit transition payload fields as removed legacy behavior. Rationale: this matches the real history API contract and keeps the UI aligned to Prophet's state-carrier model instead of reconstructing obsolete transition resources.
- 2026-03-15, Codex: Phase 4 should delete dead read-only ontology editor and ontology analytics files rather than porting them to the new model. Rationale: those surfaces were unmounted, mutations are already unsupported, and keeping them would preserve removed Prophet taxonomy as misleading dead code.
- 2026-03-15, Codex: Explorer and analytics runtime discovery should share one `ontology-runtime-semantics` helper that is `Event`-only. Rationale: one event-only traversal path keeps RCA, Object Store insights, and process mining aligned to Prophet's current model and reduces the chance of stale `Signal` / `Transition` logic reappearing in one panel.
- 2026-03-15, Codex: Phase 5 may fix stale tests, prompt examples, and fixture normalizers when they are the only blockers for the final validation gate. Rationale: the phase brief explicitly permits fixes required to satisfy final validation, and leaving removed Prophet concepts in validation scaffolding would make the repository's acceptance evidence misleading.
- 2026-03-15, Codex: Leave the internal transcript storage column named `workflow_uri` for now and record it as technical debt rather than expanding Phase 5 into a storage migration. Rationale: public/backend/frontend contracts already expose `action_uri`, the remaining column name is internal persistence detail, and the archive-prep phase should not take on schema churn.

## Outcomes & Retrospective

2026-03-15 Phase 1 closed with the backend executing current Prophet action-only Turtle without `prophet:Process` or `prophet:Workflow` assumptions. `seer_backend.actions` now classifies ordinary Prophet actions as `action`, `seer:AgenticWorkflow` is bootstrapped as a Seer-managed subtype of `prophet:Action`, and ontology concept categorization no longer advertises dead Prophet executable/event-taxonomy classes in the Phase 1 backend surfaces.

The scoped tests were updated to patch generated Turtle from `prophet:Action` instead of `prophet:Process`, and the backend response models that emit `action_kind` were collapsed to `action | agentic_workflow` so validation and serialization agree on the new contract.

Phase 1 validation evidence:
1. `cd /workspaces/seer-python/seer-backend && .venv/bin/pytest tests/test_actions_submit.py tests/test_ontology_phase1.py` passed with `33 passed in 22.62s`.
2. `cd /workspaces/seer-python/seer-backend && .venv/bin/ruff check src tests` passed with `All checks passed!`.

2026-03-15 Phase 2 closed with the managed-agent list/detail/transcript surface exposing `action_uri` only. Backend query params, response payloads, transcript snapshots/messages, frontend TypeScript contracts, API clients, and inspector UI filters now use action-first terminology without introducing compatibility shims for `workflow_uri`.

Phase 2 also updated the related agent-orchestration tests to the new action-first contracts and current `ActionKind` enum so later contributors can use those tests to verify managed-agent list/detail/message behavior instead of reading stale workflow-era assertions.

Phase 2 validation evidence:
1. `cd /workspaces/seer-python/seer-backend && .venv/bin/pytest tests/test_actions_submit.py` passed with `5 passed in 5.71s`.
2. `cd /workspaces/seer-python/seer-ui && npm run build` passed and produced a successful Next.js production build.
3. Additional confidence check: `cd /workspaces/seer-python/seer-backend && .venv/bin/pytest tests/test_actions_submit.py tests/test_agent_orchestration_phase3.py tests/test_agent_orchestration_phase4.py` passed with `14 passed in 7.89s`.
4. Additional confidence check: `cd /workspaces/seer-python/seer-backend && .venv/bin/ruff check src tests/test_actions_submit.py tests/test_agent_orchestration_phase3.py tests/test_agent_orchestration_phase4.py` passed with `All checks passed!`.

Remaining work stays in later phases: state-carrier lifecycle migration, explorer/analytics taxonomy cleanup, and the unrelated baseline RCA fake-data failures in `tests/test_root_cause_fake_data.py`.

2026-03-15 Phase 3 backend/shared-display work is now landed, but the full phase is still open pending the consumer-side history/Object Store lane. The ontology graph endpoint now annotates object/property nodes with state-carrier metadata (`stateCarrierFieldKey`, `stateCarrierPropertyUri`, `stateOptions`, `initialStateValue`, and property-level `isStateCarrier`), and the shared ontology-display catalog/resolver now use that metadata to resolve state labels and state-carrier fields without requiring explicit ontology state/transition resources.

The shared display contract tests were also rewritten to exercise the state-carrier path directly instead of fabricating `State` and `Transition` nodes in the fixture graph, which keeps future contributors from accidentally rebuilding the removed Prophet concepts into the shared resolver layer.

Phase 3 backend/shared-display validation evidence:
1. `cd /workspaces/seer-python/seer-backend && .venv/bin/pytest tests/test_ontology_phase1.py -k 'graph_endpoint_returns_current_release_named_graph_only or ontology_ingest_and_query_include_seer_agentic_workflow_extension'` passed with `2 passed, 26 deselected in 4.19s`.
2. `cd /workspaces/seer-python/seer-backend && .venv/bin/ruff check src tests/test_ontology_phase1.py` passed with `All checks passed!`.
3. `cd /workspaces/seer-python/seer-ui && node tests/ontology-display.contract.test.mjs` passed with `11 passed, 0 failed`.
4. `cd /workspaces/seer-python/seer-ui && npm run build` passed and produced a successful Next.js production build.

2026-03-15 Phase 3 consumer/history work is now landed as well. `use-object-history-display-data.ts` reads the shared `stateFilterFieldKey`, compares adjacent object snapshots in timeline order, and renders lifecycle badges from observed state-carrier value changes instead of parsing `fromState` / `toState` payload keys. The history contract test now locks that behavior so future edits do not reintroduce the legacy transition-payload path.

Phase 3 consumer/history validation evidence:
1. `cd /workspaces/seer-python/seer-ui && node --test tests/history.contract.test.mjs` passed with `1 pass, 0 fail`.
2. `cd /workspaces/seer-python/seer-ui && npm run build` passed and produced a successful Next.js production build.

2026-03-15 Phase 3 is now fully closed at the controller gate after the backend/shared-display and consumer/history commits were merged together. The controller reran the combined validation set on the merged branch, which confirmed the full state-carrier lifecycle migration rather than only the individual worker slices.

Phase 3 controller validation evidence:
1. `cd /workspaces/seer-python/seer-backend && .venv/bin/pytest tests/test_ontology_phase1.py` passed with `28 passed in 20.07s`.
2. `cd /workspaces/seer-python/seer-backend && .venv/bin/ruff check src tests/test_ontology_phase1.py` passed with `All checks passed!`.
3. `cd /workspaces/seer-python/seer-ui && node tests/ontology-display.contract.test.mjs` passed with `11 pass, 0 fail`.
4. `cd /workspaces/seer-python/seer-ui && node --test tests/history.contract.test.mjs` passed with `1 pass, 0 fail`.
5. `cd /workspaces/seer-python/seer-ui && npm run build` passed with a successful Next.js production build.

2026-03-15 Phase 4 closed with the live ontology explorer and analytics setup surfaces fully aligned to Prophet's current taxonomy. Explorer tabs and graph rendering now present only `ObjectModel`, `Action`, `Event`, and `EventTrigger` as live categories, analytics outcome discovery is `Event`-only through a shared runtime semantics helper, and dead read-only ontology editor / standalone ontology analytics files were deleted instead of migrated.

Phase 4 also simplified the read-only ontology boundary in the frontend. `app/types/ontology.ts` now carries only the graph/query contracts the live app still uses, `app/lib/api/ontology.ts` no longer exposes dead mutation stubs, and `app/lib/ontology-helpers.ts` keeps only the property-definition mapping used by the shared ontology display catalog.

Phase 4 validation evidence:
1. `cd /workspaces/seer-python/seer-ui && node tests/ontology-display.contract.test.mjs` passed with `11 pass, 0 fail`.
2. `cd /workspaces/seer-python/seer-ui && node tests/insights.contract.test.mjs` passed with `5 pass, 0 fail`.
3. `cd /workspaces/seer-python/seer-ui && node tests/process-mining.contract.test.mjs` passed with `1 pass, 0 fail`.
4. `cd /workspaces/seer-python/seer-ui && npm run build` passed with a successful Next.js production build.

2026-03-15 Phase 5 closed with the canonical docs/specs aligned to Prophet's current `Action` / `Event` / state-carrier model, plus a final validation pass that removed stale test/prompt assumptions discovered after Phases 3 and 4. `VISION.md`, `DESIGN.md`, `ARCHITECTURE.md`, and the managed-agent/history specs now describe action-first execution, `action_uri`, managed-agent actions, and enum-backed state-carrier lifecycle display rather than removed Prophet workflow/process/signal/transition/state-machine concepts.

Phase 5 also tightened the repo's validation truth. Full backend `pytest` and `ruff` now pass, the UI build and touched contract tests pass, the ontology copilot no longer suggests removed Prophet categories in its built-in examples/index, and the broad grep is reduced to explicitly classified residuals instead of active product truth drift.

Phase 5 validation evidence:
1. `cd /workspaces/seer-python/seer-backend && .venv/bin/pytest` passed with `134 passed in 41.95s`.
2. `cd /workspaces/seer-python/seer-backend && .venv/bin/ruff check .` passed with `All checks passed!`.
3. `cd /workspaces/seer-python/seer-ui && node tests/ontology-display.contract.test.mjs` passed with `11 pass, 0 fail`.
4. `cd /workspaces/seer-python/seer-ui && node --test tests/history.contract.test.mjs` passed with `1 pass, 0 fail`.
5. `cd /workspaces/seer-python/seer-ui && node tests/insights.contract.test.mjs` passed with `5 pass, 0 fail`.
6. `cd /workspaces/seer-python/seer-ui && npm run build` passed with a successful Next.js production build.
7. `cd /workspaces/seer-python && rg -n "prophet:Process|prophet:Workflow|Signal|Transition|workflow_uri" VISION.md DESIGN.md ARCHITECTURE.md docs/product-specs seer-backend seer-ui` returned only classified residuals:
   - false positives (`Success Signals`, `AbortSignal`, `startTransition`, `disableTransitionOnChange`),
   - the intentional internal transcript-storage `workflow_uri` column/migration,
   - legacy identifier strings in `tests/test_root_cause_fake_data.py` used only to canonicalize the historical fake-data fixture onto current Prophet event URIs.

## Context and Orientation

The current migration touches five connected surfaces.

1. `seer-backend/src/seer_backend/actions/` now validates executable ontology concepts against the Phase 1 `action | agentic_workflow` contract. Later phases should treat that classifier as stable and avoid reintroducing `process` or `workflow` kinds.
2. `seer-backend/src/seer_backend/api/agentic_workflows.py`, `seer-backend/src/seer_backend/agent_orchestration/`, and `seer-ui/app/lib/api/agentic-workflows.ts` still use internal `agentic_workflow` module names and routes, but their public managed-agent contracts now filter and serialize runs by `action_uri`.
3. `seer-backend/src/seer_backend/ontology/service.py` and `seer-ui/app/components/ontology/` still categorize graph nodes using labels such as `Process`, `Workflow`, `Signal`, `Transition`, and `State`. The frontend explorer, read-only dialogs, and helpers assume those labels are live.
4. `seer-ui/app/lib/ontology-display/`, `seer-ui/app/components/inspector/history-*`, and related Object Store helpers currently derive state filters and lifecycle labels from explicit ontology state/transition resources. Prophet's current model instead marks one enum-backed field on an object as the state carrier.
5. `seer-ui/app/components/inspector/process-*`, `seer-ui/app/components/inspector/object-store-insights-workspace.tsx`, and related analytics helpers still treat event outcome choices and lifecycle interpretation as `Event | Signal | Transition` plus transition-resource joins.

The authoritative Prophet reference in this repo is local, not external:

1. `prophet/prophet-cli/CHANGELOG.md` records the recent removals.
2. `prophet/docs/reference/concepts.md`, `prophet/docs/reference/dsl.md`, and `prophet/docs/reference/turtle.md` describe the current event-and-state-carrier model.
3. `prophet/examples/turtle/prophet_example_turtle_minimal/gen/turtle/ontology.ttl` and `prophet/examples/turtle/prophet_example_turtle_small_business/gen/turtle/ontology.ttl` provide real generated Turtle that Seer must accept.

This plan intentionally treats legacy Seer behavior as migration context only. Any route, payload, enum, graph category, or UI label that exists solely to preserve removed Prophet concepts should be deleted or renamed in place.

## Plan of Work

The work proceeds in five sequential phases.

Phase 1 redefines the backend contract boundary so Seer can ingest and execute current Prophet output without stale executable-kind assumptions. This phase updates the Seer ontology extension from `prophet:Workflow` to `prophet:Action`, removes all backend dependency on `prophet:Process` and `prophet:Workflow`, and collapses the shared execution classifier to `action | agentic_workflow`. The backend tests that currently patch generated Turtle by replacing `prophet:Process` with `seer:AgenticWorkflow` must be rewritten to patch `prophet:Action` instead.

Phase 2 realigns managed-agent contracts. The goal is not to remove managed agents, but to make them action-first everywhere public. API payloads, transcript models, frontend types, selectors, and UI labels should rename `workflow_uri` to `action_uri`, and the public surface should describe runs as managed-agent actions rather than ontology workflows. Internal module names may stay in place if renaming them would be pure churn, but public contracts, specs, and user-visible labels should switch completely.

Phase 3 updates ontology graph production and display semantics. The backend graph/read model should stop advertising dead top-level Prophet classes and instead derive state-carrier metadata directly from object properties. The frontend shared display catalog, Object Store filters, and timeline rendering then switch from explicit state/transition nodes to the new metadata plus observed payload or snapshot diffs. This phase is the core lifecycle-display migration and should leave the UI with no dependency on explicit `State` or `Transition` graph resources.

Phase 4 removes stale taxonomy from the ontology explorer and analytics surfaces. Explorer tabs, graph legends, read-only dialogs, and analytics setup helpers should work only with live Prophet concepts (`Action`, `Event`, `EventTrigger`) plus Seer-derived state-carrier metadata. Any analytics view that previously depended on ontology transition resources should fall back to observed state-pair metrics keyed by state-carrier field values.

Phase 5 is the ratification and archive-prep phase. Update `VISION.md`, `DESIGN.md`, `ARCHITECTURE.md`, and the affected product specs so future contributors do not reintroduce removed Prophet concepts. Re-run broad validation, record exact evidence here, and prepare the active plan for archival once acceptance is met.

## Concrete Steps

1. Create the active plan and register it in the active index.
   ```bash
   cd /workspaces/seer-python
   sed -n '1,260p' PLANS.md
   sed -n '1,260p' .agents/skills/plan-and-execute/SKILL.md
   ```
   Expected result: the active plan exists under `docs/exec-plans/active/` and `docs/exec-plans/active/index.md` lists it as the current post-MVP in-progress plan.

2. Establish a baseline failure ledger before implementation.
   ```bash
   cd /workspaces/seer-python/seer-backend && .venv/bin/pytest
   cd /workspaces/seer-python/seer-backend && .venv/bin/ruff check .
   cd /workspaces/seer-python/seer-ui && npm run build
   ```
   Expected result: pass/fail state is captured in `Surprises & Discoveries` and `Validation and Acceptance` so later contributors can distinguish pre-existing failures from regressions.

3. Audit the stale backend seams before Phase 1 changes.
   ```bash
   cd /workspaces/seer-python
   rg -n "prophet:Process|prophet:Workflow|workflow_uri|ActionKind|seer:AgenticWorkflow" seer-backend
   rg -n "Signal|Transition|workflow_uri|Process|Workflow" seer-ui
   ```
   Expected result: the exact files named in the phase handoffs still match the real breakpoints before edits start.

4. Implement and validate one phase at a time, updating this plan after each phase.
   ```bash
   cd /workspaces/seer-python
   git status --short
   ```
   Expected result: only phase-relevant files are in flight, `Progress` stays truthful, and each completed phase records validation evidence and next-starter context.

5. Run final ratification checks before archival.
   ```bash
   cd /workspaces/seer-python
   rg -n "prophet:Process|prophet:Workflow|Signal|Transition|workflow_uri" VISION.md DESIGN.md ARCHITECTURE.md docs/product-specs seer-backend seer-ui
   ```
   Expected result: remaining matches are either historical archived records or intentional internal identifiers documented in this plan.

## Validation and Acceptance

Baseline validation to run once near the start of implementation:

1. `cd seer-backend && .venv/bin/pytest`
2. `cd seer-backend && .venv/bin/ruff check .`
3. `cd seer-ui && npm run build`

Baseline results captured on 2026-03-15 before implementation:

1. `cd seer-backend && .venv/bin/pytest` failed with `5 failed, 127 passed, 2 errors in 39.65s`.
   - Action-kind failures:
     - `tests/test_actions_submit.py::test_submit_enqueues_action_with_ontology_release_and_contract_hash`
     - `tests/test_actions_submit.py::test_submit_rejects_unknown_action_and_invalid_payload_with_actionable_422`
     - `tests/test_actions_submit.py::test_submit_idempotency_key_returns_stable_dedupe_response`
     - `tests/test_actions_submit.py::test_submit_classifies_agentic_workflow_from_seer_ontology_extension`
   - Seer ontology-extension failure:
     - `tests/test_ontology_phase1.py::test_ontology_ingest_and_query_include_seer_agentic_workflow_extension`
   - RCA fixture errors:
     - `tests/test_root_cause_fake_data.py::test_fake_data_sales_order_cancel_rca_has_actionable_insights`
     - `tests/test_root_cause_fake_data.py::test_fake_data_invoice_overdue_rca_surfaces_high_lift_signal`
2. `cd seer-backend && .venv/bin/ruff check .` passed with `All checks passed!`.
3. `cd seer-ui && npm run build` passed and produced a successful Next.js production build.

Phase acceptance expectations:

1. Phase 1 is complete when current Prophet Turtle ingests successfully, `POST /api/v1/actions/submit` classifies ordinary Prophet actions as `action`, and managed-agent actions as `agentic_workflow`, with no dependency on `prophet:Process` or `prophet:Workflow`.
2. Phase 2 is complete when managed-agent APIs/UI/filtering use `action_uri` only, including `/api/v1/agentic-workflows/executions?action_uri=...` and transcript snapshot/message payloads, and user-facing labels describe managed-agent actions rather than ontology workflows.
3. Phase 3 is complete when state filters, state labels, and lifecycle badges render from state-carrier metadata and observed value deltas instead of ontology state/transition resources.
4. Phase 4 is complete when `/ontology` surfaces and analytics/RCA setup no longer require `Signal`, `Transition`, `Process`, `Workflow`, or explicit ontology `State` categories.
5. Phase 5 is complete when canonical docs/specs describe the new model accurately and the final backend/frontend validation commands pass or any known unrelated failures are explicitly logged here.

Phase 5 validation recorded on 2026-03-15:

1. `cd /workspaces/seer-python/seer-backend && .venv/bin/pytest` passed with `134 passed in 41.95s`.
2. `cd /workspaces/seer-python/seer-backend && .venv/bin/ruff check .` passed with `All checks passed!`.
3. `cd /workspaces/seer-python/seer-ui && node tests/ontology-display.contract.test.mjs` passed with `11 pass, 0 fail`.
4. `cd /workspaces/seer-python/seer-ui && node --test tests/history.contract.test.mjs` passed with `1 pass, 0 fail`.
5. `cd /workspaces/seer-python/seer-ui && node tests/insights.contract.test.mjs` passed with `5 pass, 0 fail`.
6. `cd /workspaces/seer-python/seer-ui && npm run build` passed with a successful Next.js production build.
7. `cd /workspaces/seer-python && rg -n "prophet:Process|prophet:Workflow|Signal|Transition|workflow_uri" VISION.md DESIGN.md ARCHITECTURE.md docs/product-specs seer-backend seer-ui` returned only classified residuals:
   - `docs/product-specs/new-user-onboarding.md:25` (`Success Signals`) is unrelated product copy.
   - `seer-ui` `AbortSignal`, `startTransition`, and `disableTransitionOnChange` matches are framework/library names, not Prophet concepts.
   - `seer-backend/src/seer_backend/agent_orchestration/repository.py` and `seer-backend/migrations/clickhouse/002_agentic_workflow_transcripts.sql` still carry the internal transcript storage column name `workflow_uri`.
   - `seer-backend/tests/test_root_cause_fake_data.py` intentionally retains legacy transition-era identifiers to normalize the historical fake-data fixture onto current event URIs.

Phase 1 validation recorded on 2026-03-15 after implementation:

1. `cd /workspaces/seer-python/seer-backend && .venv/bin/pytest tests/test_actions_submit.py tests/test_ontology_phase1.py` passed with `33 passed in 22.62s`.
2. `cd /workspaces/seer-python/seer-backend && .venv/bin/ruff check src tests` passed with `All checks passed!`.

Phase 3 backend/shared-display validation recorded on 2026-03-15:

1. `cd /workspaces/seer-python/seer-backend && .venv/bin/pytest tests/test_ontology_phase1.py -k 'graph_endpoint_returns_current_release_named_graph_only or ontology_ingest_and_query_include_seer_agentic_workflow_extension'` passed with `2 passed, 26 deselected in 4.19s`.
2. `cd /workspaces/seer-python/seer-backend && .venv/bin/ruff check src tests/test_ontology_phase1.py` passed with `All checks passed!`.
3. `cd /workspaces/seer-python/seer-ui && node tests/ontology-display.contract.test.mjs` passed with `11 passed, 0 failed`.
4. `cd /workspaces/seer-python/seer-ui && npm run build` passed and produced a successful Next.js production build.

Final observable acceptance:

1. Seer ingests current Prophet generated Turtle from the minimal and small-business examples without semantic adaptation layers.
2. Every runnable ontology-defined thing is treated as an action in public contracts.
3. Managed-agent runs are still supported, but they are identified by `action_uri`.
4. Object Store and history views remain state-aware using state-carrier fields.
5. Explorer and analytics surfaces no longer present removed Prophet concepts as current truth.

## Idempotence and Recovery

1. Re-running the baseline search and validation commands is safe and should be used to confirm scope after interruptions.
2. If work stops mid-phase, update the matching `Progress`, `Surprises & Discoveries`, `Decision Log`, and the active phase handoff before handing off to another contributor.
3. If a phase lands partial code without complete validation, do not start the next phase. First run `git status --short`, inspect touched files, finish missing validation, and update the phase handoff `Status`, `Completion Notes`, and `Next Starter Context`.
4. If a rename from `workflow_uri` to `action_uri` lands partially, finish the contract rename in one coherent pass before running frontend or API validation. Mixed naming across backend and frontend will produce misleading breakage.
5. If analytics conformance visuals cannot be rebuilt cleanly after the lifecycle migration, ship the simpler observed state-pair version, record the intentional behavior drop in this plan and in `docs/exec-plans/tech-debt-tracker.md`, and do not recreate fake transition resources for compatibility.

## Artifacts and Notes

Useful reference files:

1. `prophet/prophet-cli/CHANGELOG.md`
2. `prophet/docs/reference/concepts.md`
3. `prophet/docs/reference/dsl.md`
4. `prophet/docs/reference/turtle.md`
5. `prophet/examples/turtle/prophet_example_turtle_minimal/gen/turtle/ontology.ttl`
6. `prophet/examples/turtle/prophet_example_turtle_small_business/gen/turtle/ontology.ttl`
7. `seer-backend/src/seer_backend/actions/service.py`
8. `seer-backend/src/seer_backend/ontology/service.py`
9. `seer-ui/app/lib/ontology-display/catalog.ts`
10. `seer-ui/app/lib/api/agentic-workflows.ts`

Key terminology for this plan:

1. `state carrier field`: the one enum-backed object field Prophet marks as the lifecycle state field.
2. `action_uri`: the ontology URI of the runnable action definition. This replaces `workflow_uri` in public managed-agent contracts.
3. `generic execution kind`: the shared control-plane classifier on an execution row. After this migration it should mean `action` or `agentic_workflow`, not old Prophet categories.

Legacy behavior intentionally removed by this plan:

1. public and canonical use of `process` and `workflow` as Prophet executable kinds,
2. public `workflow_uri` managed-agent contracts,
3. UI dependence on explicit ontology `Signal`, `Transition`, and `State` concepts,
4. any compatibility shim that exists only to preserve removed Prophet concepts.

## Interfaces and Dependencies

Primary backend interfaces:

1. `seer_backend.actions.models.ActionKind`
2. `seer_backend.actions.service._ACTION_CONTRACT_QUERY_TEMPLATE`
3. `seer_backend.actions.service._resolve_action_kind`
4. `seer_backend.ontology.service` graph/category queries
5. `seer_backend.api.agentic_workflows` response models and query parameters
6. `seer_backend.agent_orchestration` transcript/message models

Primary frontend interfaces:

1. `seer-ui/app/types/agentic-workflows.ts`
2. `seer-ui/app/lib/api/agentic-workflows.ts`
3. `seer-ui/app/types/ontology.ts`
4. `seer-ui/app/lib/ontology-display/catalog.ts`
5. `seer-ui/app/lib/ontology-display/resolver.ts`
6. `seer-ui/app/components/ontology/ontology-explorer-tabs.tsx`
7. `seer-ui/app/components/inspector/history-*`
8. `seer-ui/app/components/inspector/process-*`
9. `seer-ui/app/components/inspector/object-store-insights-workspace.tsx`

Canonical docs/specs that must be updated by the end of the plan:

1. `VISION.md`
2. `DESIGN.md`
3. `ARCHITECTURE.md`
4. `docs/product-specs/managed-agentic-workflows.md`
5. `docs/product-specs/managed-agent-controls-and-approvals.md`
6. `docs/product-specs/history-inspector-phase-3a.md`

## Phase 1

Deliver a backend contract model that accepts the current Prophet action-only vocabulary and removes stale executable-kind assumptions.

### Phase Handoff

- Goal: Update Seer ontology extension, action validation, action submission classification, and backend tests so current Prophet generated Turtle is executable without `Process` or `Workflow` dependencies.
- Scope Boundary: Backend-only changes in ontology/action domains and directly related tests. Do not rename managed-agent public routes or frontend types in this phase.
- Read First:
  1. `PLANS.md`
  2. `docs/exec-plans/active/prophet-action-only-alignment.md`
  3. `prophet/prophet-cli/CHANGELOG.md`
  4. `seer-backend/src/seer_backend/actions/service.py`
  5. `seer-backend/src/seer_backend/actions/models.py`
  6. `seer-backend/src/seer_backend/ontology/service.py`
  7. `seer-backend/tests/test_actions_submit.py`
  8. `seer-backend/tests/test_ontology_phase1.py`
- Files Expected To Change:
  1. `seer-backend/src/seer_backend/actions/`
  2. `seer-backend/src/seer_backend/ontology/`
  3. `seer-backend/src/seer_backend/api/actions.py`
  4. `seer-backend/src/seer_backend/api/agentic_workflows.py`
  5. `seer-backend/tests/test_actions_submit.py`
  6. `seer-backend/tests/test_ontology_phase1.py`
- Validation:
  1. `cd seer-backend && .venv/bin/pytest tests/test_actions_submit.py tests/test_ontology_phase1.py`
  2. `cd seer-backend && .venv/bin/ruff check src tests`
- Plan / Docs To Update:
  1. `Progress`
  2. `Surprises & Discoveries`
  3. `Decision Log`
  4. `Outcomes & Retrospective`
  5. This phase handoff `Status`, `Completion Notes`, `Next Starter Context`
- Deliverables:
  1. `seer:AgenticWorkflow` extends `prophet:Action`
  2. action-kind collapse to `action | agentic_workflow`
  3. backend tests updated to use current Prophet action-only Turtle
  4. validation evidence recorded in this plan
- Commit Expectation: one phase commit with a subject like `Align backend actions with Prophet action-only model`
- Known Constraints / Baseline Failures:
  1. The repository is already dirty outside this scope (`prophet` submodule and untracked PNG files); do not touch them.
  2. No compatibility shims should be retained for old Prophet kinds.
  3. Baseline broad-suite failures already logged in this plan: 4 action-kind failures, 1 Seer ontology-extension failure, and 2 RCA fake-data errors from `cd seer-backend && .venv/bin/pytest`.
- Status: complete
- Completion Notes:
  1. Collapsed `ActionKind` and backend response literals to `action | agentic_workflow`.
  2. Embedded the Seer ontology extension in backend ontology bootstrap so `seer:AgenticWorkflow rdfs:subClassOf prophet:Action` is always available without editing `prophet/`.
  3. Updated ontology concept categorization and the scoped backend tests to use the current Prophet action-only Turtle assumptions.
  4. Validation passed:
     - `cd /workspaces/seer-python/seer-backend && .venv/bin/pytest tests/test_actions_submit.py tests/test_ontology_phase1.py` -> `33 passed in 22.62s`
     - `cd /workspaces/seer-python/seer-backend && .venv/bin/ruff check src tests` -> `All checks passed!`
- Next Starter Context: Phase 2 can start from the now-stable backend execution kind contract. The next work is the public managed-agent rename from `workflow_uri` to `action_uri`; do not re-open the Phase 1 classifier or reintroduce `process|workflow` literals while doing that contract pass.

## Phase 2

Rename managed-agent contracts from workflow-first to action-first without reintroducing a second executable ontology model.

### Phase Handoff

- Goal: Replace `workflow_uri` with `action_uri` across managed-agent backend/frontend contracts and align the managed-agent surface with action-first language.
- Scope Boundary: Managed-agent APIs, frontend types, API clients, list/detail UI, and transcript models only. Do not touch state-carrier lifecycle rendering in this phase.
- Read First:
  1. `PLANS.md`
  2. `docs/exec-plans/active/prophet-action-only-alignment.md`
  3. `seer-backend/src/seer_backend/api/agentic_workflows.py`
  4. `seer-backend/src/seer_backend/agent_orchestration/`
  5. `seer-ui/app/types/agentic-workflows.ts`
  6. `seer-ui/app/lib/api/agentic-workflows.ts`
  7. `seer-ui/app/components/inspector/agentic-workflow-execution-panel.tsx`
  8. `seer-ui/app/components/inspector/agentic-workflow-execution-details-panel.tsx`
- Files Expected To Change:
  1. `seer-backend/src/seer_backend/api/agentic_workflows.py`
  2. `seer-backend/src/seer_backend/agent_orchestration/`
  3. `seer-ui/app/types/agentic-workflows.ts`
  4. `seer-ui/app/lib/api/agentic-workflows.ts`
  5. `seer-ui/app/components/inspector/agentic-workflow-*`
  6. managed-agent routes/pages if renamed
- Validation:
  1. `cd seer-backend && .venv/bin/pytest tests/test_actions_submit.py`
  2. `cd seer-ui && npm run build`
- Plan / Docs To Update:
  1. `Progress`
  2. `Surprises & Discoveries`
  3. `Decision Log`
  4. `Outcomes & Retrospective`
  5. This phase handoff `Status`, `Completion Notes`, `Next Starter Context`
- Deliverables:
  1. public managed-agent contracts use `action_uri`
  2. UI filters/selectors/display resolve managed-agent actions by `action_uri`
  3. stale workflow-first wording removed from public managed-agent surfaces
  4. validation evidence recorded in this plan
- Commit Expectation: one phase commit with a subject like `Rename managed-agent contracts to action_uri`
- Known Constraints / Baseline Failures:
  1. Internal module names may stay if renaming is pure churn, but public payloads and UI copy must switch fully.
  2. Do not preserve deprecated `workflow_uri` fields for compatibility.
- Status: complete
- Completion Notes:
  1. Backend managed-agent list/message/snapshot contracts now expose `action_uri` only, and the list filter query param is `action_uri`.
  2. Agent-orchestration transcript and resume/message page models now use `action_uri` while the internal ClickHouse column name remains unchanged.
  3. Frontend types, API client helpers, list/detail selectors, and inspector copy now describe managed-agent actions and runs instead of workflow capabilities or workflow URIs.
  4. Related tests were updated to assert the action-first contracts and current `ActionKind` enum members.
  5. Validation passed:
     - `cd /workspaces/seer-python/seer-backend && .venv/bin/pytest tests/test_actions_submit.py` -> `5 passed in 5.71s`
     - `cd /workspaces/seer-python/seer-ui && npm run build` -> successful Next.js production build
- Next Starter Context: Phase 3 can start from stable action-first managed-agent contracts. Keep the `agentic-workflows` module/route shell if it avoids churn, but do not reintroduce `workflow_uri` fields while migrating lifecycle/state-carrier rendering.

## Phase 3

Move ontology display and lifecycle interpretation to the state-carrier field model.

### Phase Handoff

- Goal: Produce state-carrier metadata from the ontology layer and consume it in shared display/Object Store/history surfaces so lifecycle rendering no longer depends on explicit ontology state or transition resources.
- Scope Boundary: Ontology graph/read-model, shared ontology display helpers, Object Store filters, and history timeline rendering. Do not rewrite explorer/analytics taxonomy outside what is necessary to support this metadata.
- Read First:
  1. `PLANS.md`
  2. `docs/exec-plans/active/prophet-action-only-alignment.md`
  3. `seer-backend/src/seer_backend/ontology/service.py`
  4. `seer-ui/app/lib/ontology-display/catalog.ts`
  5. `seer-ui/app/lib/ontology-display/resolver.ts`
  6. `seer-ui/app/components/inspector/history-live-objects-panel.tsx`
  7. `seer-ui/app/components/inspector/use-object-history-display-data.ts`
- Files Expected To Change:
  1. `seer-backend/src/seer_backend/ontology/`
  2. `seer-ui/app/lib/ontology-display/`
  3. `seer-ui/app/components/inspector/history-*`
  4. `seer-ui/app/components/inspector/object-history-*`
  5. `seer-ui/app/types/ontology.ts`
- Validation:
  1. targeted backend ontology tests covering graph payload semantics
  2. targeted frontend contract tests for ontology display/history rendering
  3. `cd seer-ui && npm run build`
- Plan / Docs To Update:
  1. `Progress`
  2. `Surprises & Discoveries`
  3. `Decision Log`
  4. `Outcomes & Retrospective`
  5. This phase handoff `Status`, `Completion Notes`, `Next Starter Context`
- Deliverables:
  1. graph metadata for state-carrier fields and state options
  2. Object Store state filters driven by state-carrier metadata
  3. lifecycle badges driven by observed state value diffs
  4. validation evidence recorded in this plan
- Commit Expectation: one phase commit with a subject like `Migrate lifecycle display to state-carrier metadata`
- Known Constraints / Baseline Failures:
  1. Prophet generated Turtle currently exposes `prophet:isStateField` and `prophet:initialEnumValue`, but not explicit enum member resources in the examples; fallback label logic may be required.
  2. Do not recreate fake `State` or `Transition` nodes for compatibility.
- Status: complete
- Completion Notes:
  1. Backend/shared-display producer work is complete. `seer_backend.ontology.service` now derives state-carrier metadata from `prophet:isStateField`, `prophet:initialEnumValue`, and enum constraint `sh:in` lists, and the shared catalog/resolver consume that metadata for object-model state filters and value display.
  2. Consumer/history work is complete. `seer-ui/app/components/inspector/use-object-history-display-data.ts` now derives lifecycle badges from adjacent state-carrier snapshot deltas, and `seer-ui/tests/history.contract.test.mjs` guards against reintroducing explicit `fromState` / `toState` payload parsing.
  3. Validation passed for the consumer lane:
     - `cd /workspaces/seer-python/seer-ui && node --test tests/history.contract.test.mjs` -> `1 pass, 0 fail`
     - `cd /workspaces/seer-python/seer-ui && npm run build` -> successful Next.js production build
  4. Controller merged-branch validation also passed:
     - `cd /workspaces/seer-python/seer-backend && .venv/bin/pytest tests/test_ontology_phase1.py` -> `28 passed in 20.07s`
     - `cd /workspaces/seer-python/seer-backend && .venv/bin/ruff check src tests/test_ontology_phase1.py` -> `All checks passed!`
     - `cd /workspaces/seer-python/seer-ui && node tests/ontology-display.contract.test.mjs` -> `11 pass, 0 fail`
     - `cd /workspaces/seer-python/seer-ui && node --test tests/history.contract.test.mjs` -> `1 pass, 0 fail`
     - `cd /workspaces/seer-python/seer-ui && npm run build` -> successful Next.js production build
- Next Starter Context: Historical only. Phase 4 started from the new shared `stateFilterFieldKey`, `stateFilterOptions`, and `initialStateValue` metadata without reintroducing explicit ontology state or transition concepts.

## Phase 4

Remove obsolete Prophet taxonomy from explorer and analytics surfaces.

### Phase Handoff

- Goal: Update ontology explorer and analytics/RCA setup so they operate on `Action`, `Event`, `EventTrigger`, and state-carrier semantics only.
- Scope Boundary: Frontend explorer tabs, ontology helpers, analytics setup helpers, and related tests. Do not re-open backend action-kind or managed-agent contract work in this phase.
- Read First:
  1. `PLANS.md`
  2. `docs/exec-plans/active/prophet-action-only-alignment.md`
  3. `seer-ui/app/components/ontology/ontology-explorer-tabs.tsx`
  4. `seer-ui/app/components/ontology/tabs/`
  5. `seer-ui/app/lib/ontology-helpers.ts`
  6. `seer-ui/app/components/inspector/process-insights-panel.tsx`
  7. `seer-ui/app/components/inspector/object-store-insights-workspace.tsx`
  8. `seer-ui/app/lib/api/analytics.ts`
- Files Expected To Change:
  1. `seer-ui/app/components/ontology/`
  2. `seer-ui/app/lib/ontology-helpers.ts`
  3. `seer-ui/app/components/inspector/process-*`
  4. `seer-ui/app/components/inspector/object-store-insights-workspace.tsx`
  5. related frontend contract tests
- Validation:
  1. targeted frontend contract tests covering ontology tabs and analytics option derivation
  2. `cd seer-ui && npm run build`
- Plan / Docs To Update:
  1. `Progress`
  2. `Surprises & Discoveries`
  3. `Decision Log`
  4. `Outcomes & Retrospective`
  5. This phase handoff `Status`, `Completion Notes`, `Next Starter Context`
- Deliverables:
  1. explorer surfaces no longer show stale Prophet category names as current truth
  2. analytics outcome/event discovery is `Event`-only
  3. lifecycle analytics fall back to observed state-pair metrics where transition-resource joins were previously required
  4. validation evidence recorded in this plan
- Commit Expectation: one phase commit with a subject like `Remove obsolete Prophet taxonomy from explorer and analytics`
- Known Constraints / Baseline Failures:
  1. Some read-only ontology editor affordances are already dead code because mutations throw read-only errors; prefer deletion to migration.
  2. If a conformance visualization cannot be rebuilt cleanly, record the dropped behavior explicitly rather than preserving fake transition concepts.
- Status: complete
- Completion Notes:
  1. The live explorer taxonomy was reduced to `ObjectModel`, `Action`, `Event`, and `EventTrigger`. Relationship scopes now distinguish only structure, automation, and references; no explorer tab or graph legend presents `State`, `Process`, `Workflow`, `Signal`, or `Transition` as current truth.
  2. RCA setup, Object Store insights, and process mining now share `app/components/inspector/ontology-runtime-semantics.ts` for event-only outcome discovery and depth-scoped object-model traversal.
  3. Dead read-only ontology editor files, the standalone ontology analytics panel/graph, and the unused `app/lib/api/analytics.ts` / `app/types/analytics.ts` contracts were deleted instead of migrated.
  4. The frontend read-only ontology boundary was simplified by removing dead mutation/request contracts from `app/types/ontology.ts`, trimming `app/lib/ontology-helpers.ts` to property-definition mapping only, and dropping mutation stubs from `app/lib/api/ontology.ts`.
  5. Validation passed:
     - `cd /workspaces/seer-python/seer-ui && node tests/ontology-display.contract.test.mjs` -> `11 pass, 0 fail`
     - `cd /workspaces/seer-python/seer-ui && node tests/insights.contract.test.mjs` -> `5 pass, 0 fail`
     - `cd /workspaces/seer-python/seer-ui && node tests/process-mining.contract.test.mjs` -> `1 pass, 0 fail`
     - `cd /workspaces/seer-python/seer-ui && npm run build` -> successful Next.js production build
- Next Starter Context: Phase 5 can now ratify the canonical docs and capture final broad validation. Keep the event-only runtime helper as the shared source of truth for analytics traversal, and do not recreate deleted read-only ontology editor or standalone analytics scaffolding.

## Phase 5

Ratify the new model in canonical docs, close the validation ledger, and prepare the plan for archive.

### Phase Handoff

- Goal: Update canonical docs/specs, record full validation evidence, and leave the plan archive-ready once all implementation phases are complete.
- Scope Boundary: Docs/specs/indexes and final validation only. No new behavioral code should be introduced here except fixes required to satisfy final validation.
- Read First:
  1. `PLANS.md`
  2. `docs/exec-plans/active/prophet-action-only-alignment.md`
  3. `VISION.md`
  4. `DESIGN.md`
  5. `ARCHITECTURE.md`
  6. `docs/product-specs/managed-agentic-workflows.md`
  7. `docs/product-specs/managed-agent-controls-and-approvals.md`
  8. `docs/product-specs/history-inspector-phase-3a.md`
- Files Expected To Change:
  1. `VISION.md`
  2. `DESIGN.md`
  3. `ARCHITECTURE.md`
  4. relevant specs under `docs/product-specs/`
  5. `docs/exec-plans/active/index.md`
  6. this active plan
- Validation:
  1. `cd seer-backend && .venv/bin/pytest`
  2. `cd seer-backend && .venv/bin/ruff check .`
  3. `cd seer-ui && npm run build`
  4. `cd /workspaces/seer-python && rg -n "prophet:Process|prophet:Workflow|Signal|Transition|workflow_uri" VISION.md DESIGN.md ARCHITECTURE.md docs/product-specs seer-backend seer-ui`
- Plan / Docs To Update:
  1. `Progress`
  2. `Surprises & Discoveries`
  3. `Decision Log`
  4. `Outcomes & Retrospective`
  5. This phase handoff `Status`, `Completion Notes`, `Next Starter Context`
- Deliverables:
  1. canonical docs/specs aligned with the new Prophet model
  2. full validation evidence recorded in this plan
  3. archive-ready plan state with any intentional deferred work called out explicitly
- Commit Expectation: one phase commit with a subject like `Ratify Prophet action-only alignment docs and validation`
- Known Constraints / Baseline Failures:
  1. Completed plans remain historical records and do not need wording rewrites beyond link/index maintenance.
  2. Any intentionally deferred cleanup must be documented in `docs/exec-plans/tech-debt-tracker.md` before archival.
- Status: complete
- Completion Notes:
  1. Canonical docs/specs now describe the action-only executable model, `action_uri`, managed-agent actions, and state-carrier lifecycle semantics.
  2. Final validation required a narrow cleanup of stale tests/prompts/fixture normalization that still encoded removed Prophet categories; those fixes landed in this phase and the full backend suite now passes.
  3. The required broad grep is reduced to classified residuals only. The one real deferred cleanup is the internal transcript-storage `workflow_uri` column, which is now tracked in `docs/exec-plans/tech-debt-tracker.md`.
- Next Starter Context: This plan is archive-ready. The next controller step is to move it under `docs/exec-plans/completed/`, update the active/completed indexes, and preserve the classified residual grep note plus `workflow_uri` storage-debt link during archival.
