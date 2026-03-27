# Post-MVP Exec Plan: Hero Card Removal And Insights Top Tabs

**Status:** completed  
**Target order:** post-MVP track 15  
**Agent slot:** AI-ASSISTANT-1  
**Predecessor:** `docs/exec-plans/completed/assistant-canvas-shared-display-surfaces.md`  
**Successor:** none (archived on 2026-03-13)  
**Last updated:** 2026-03-13

---

## Objective

Remove the explanatory top hero-card pattern from the current page hosts that still use it, and flatten `/inspector/insights` so `RCA` and `OC-DFG` become the only top-level page controls.

## Why This Plan Exists

The current page shells still spend too much vertical space re-explaining surfaces the user is already on:

1. insights wraps the main switcher inside a large summary card,
2. multiple inspector pages open with a hero header before the real controls,
3. shared surfaces such as object history still render page-intro chrome instead of compact context.

The desired direction is simpler:

1. remove the hero-card explainer layer,
2. let filters, tabs, and results start immediately,
3. keep only compact identity or navigation context where it materially helps.

## Delivery Stance

1. Forward-only UI cleanup.
2. Do not preserve the hero-card treatment behind props or dead branches.
3. Prefer compact inline context over replacement summary cards.

## Invariants

1. Existing route/query-state behavior remains unchanged.
2. Insights keeps the same two modes and URL-backed tab selection.
3. Shared object-history and workflow surfaces keep enough identity context to orient users without restoring a hero card.
4. No backend/API/type contract changes are introduced.

## Legacy Behavior Removal (Intentional)

1. Remove page-top cards whose main job is to explain what the current page is.
2. Remove the nested “card inside a page” framing for Insights mode switching.
3. Remove the dormant `showIntro` branching from the consolidated insights subpanels.

Rationale: these headers add noise and delay the first meaningful control without improving navigation.

## Baseline Validation And Regression Ledger

Recorded on: `2026-03-13`

Controller baseline validation for this execution track:

1. `cd seer-ui && node --test tests/insights.contract.test.mjs tests/history.contract.test.mjs tests/agentic-workflows.contract.test.mjs tests/assistant-history.contract.test.mjs tests/ontology-display.contract.test.mjs`
   - passed

Existing unrelated working tree items:

1. untracked `rca-canvas.png`
2. untracked `scripts/assistant_chat_stream.py`

These files are outside this plan scope and must remain untouched.

## Phase Map

### Phase 1: Remove Hero Cards And Flatten Insights

Scope:

1. Simplify `InsightsPanel` to a plain top-level tab bar with `RCA` and `OC-DFG`.
2. Remove the intro-card branches from the RCA and process-mining panels.
3. Remove hero-card intros from current inspector and ontology host surfaces, preserving only compact context rows where needed.

Exit criteria:

1. No targeted surface begins with an explanatory hero card.
2. `/inspector/insights` starts with the page-level tab bar, not a summary card.
3. Shared object-history and workflow detail hosts still expose identity/navigation context without restoring explanatory copy.

Validation:

1. `cd seer-ui && node --test tests/insights.contract.test.mjs tests/history.contract.test.mjs tests/agentic-workflows.contract.test.mjs tests/assistant-history.contract.test.mjs tests/ontology-display.contract.test.mjs`

### Phase 2: Contract Coverage, Validation, And Archive Readiness

Scope:

1. Update contract tests to match the simplified page shells.
2. Run targeted validation and a production build.
3. Record docs impact and archive the plan when implementation is complete.

Exit criteria:

1. Contract tests reflect the new UI shell structure.
2. Validation passes.
3. Plan progress and docs-impact notes are recorded.

Validation:

1. `cd seer-ui && node --test tests/insights.contract.test.mjs tests/history.contract.test.mjs tests/agentic-workflows.contract.test.mjs tests/assistant-history.contract.test.mjs tests/ontology-display.contract.test.mjs`
2. `cd seer-ui && npm run build`

## Progress Checklist

- [x] Phase 1 complete
- [x] Phase 2 complete

Current execution state:

- `in_progress`: none
- `blocked`: none
- `completed`: Phase 1 - Remove hero cards and flatten insights
- `completed`: Phase 2 - Contract coverage, validation, and archive readiness

## Phase Progress Notes

### 2026-03-13: Plan Created And Baseline Recorded

1. Confirmed the explanatory hero-card pattern is still present in insights, history, object-history, workflow execution, ontology explorer, and ontology analytics hosts.
2. Confirmed `/inspector/insights` already owns the page-level mode switch and only needs the enclosing summary card removed.
3. Recorded baseline validation:
   - `cd seer-ui && node --test tests/insights.contract.test.mjs tests/history.contract.test.mjs tests/agentic-workflows.contract.test.mjs tests/assistant-history.contract.test.mjs tests/ontology-display.contract.test.mjs` passed
4. Docs impact decision:
   - `no-doc-impact` for canonical product/design/spec docs because this change removes redundant page-shell copy without changing product capabilities, IA, or architecture.

### 2026-03-13: Phases 1 And 2 Complete

1. Flattened `/inspector/insights` so the page now starts with a plain `RCA` / `OC-DFG` top tab bar and removed the now-dead intro prop branches from both subpanels.
2. Removed explanatory hero cards from the current history, object-history, workflow execution, ontology analytics, and ontology explorer hosts while keeping compact badges/actions where they still orient the user.
3. Preserved URL/query-state behavior and shared-surface reuse; object history still carries object identity context and workflow detail still exposes run status plus back navigation.
4. Updated contract coverage to assert the simplified page shells rather than the removed header copy.
5. Final validation passed:
   - `cd seer-ui && node --test tests/insights.contract.test.mjs tests/history.contract.test.mjs tests/agentic-workflows.contract.test.mjs tests/assistant-history.contract.test.mjs tests/ontology-display.contract.test.mjs`
   - `cd seer-ui && npm run build`
