# Object Store Combined RCA + OC-DFG Workspace

**Status:** completed  
**Target order:** post-MVP track 16  
**Agent slot:** AI-ASSISTANT-1  
**Predecessor:** `docs/exec-plans/completed/object-store-model-locked-tabs.md`  
**Successor:** none (archived on 2026-03-14)  
**Last updated:** 2026-03-14

---

## Objective

Replace the Object Store `Insights` tab with one combined investigation workspace that:

1. shares `time window` and `depth` controls,
2. auto-runs the primary OC-DFG whenever shared scope changes,
3. lets the user choose an RCA outcome event and run RCA manually,
4. shows ranked RCA results beside the OC-DFG after RCA completes,
5. shows a lower comparison OC-DFG only for RCA insights that are representable as anchor-field filters.

## Why This Plan Exists

The current Object Store insights experience is still a nested version of the standalone analytics UI:

1. users first choose between `RCA` and `OC-DFG`,
2. the two panels keep separate controls and separate run models,
3. there is no direct comparison between an RCA hypothesis and the mined process graph.

The desired Object Store workflow is tighter:

1. always show the scoped OC-DFG for the selected model,
2. run RCA against the same shared scope,
3. compare compatible RCA results against the baseline graph without leaving Object Store.

## Delivery Stance

1. Forward-only Object Store UX change.
2. Do not preserve the embedded `RCA` / `OC-DFG` subtab pattern inside Object Store.
3. Keep standalone `/inspector/insights` unchanged for this pass.
4. Keep RCA comparison honest: unsupported RCA rule families must surface a clear message rather than a misleading graph.

## Invariants

1. Object Store remains model-locked to the selected `object_type`.
2. Shared Object Store scope changes invalidate stale RCA results.
3. Standalone `/inspector/insights` keeps the existing tabbed RCA/OC-DFG workflow.
4. OC-DFG trace drill-down must stay consistent with any new comparison filter contract.

## Legacy Behavior Removal (Intentional)

1. Remove the embedded analytics subtab switch from Object Store.
2. Remove Object Store access to the existing process-mining min-share and freeform mining filters.
3. Remove Object Store access to the RCA cohort-filter builder, evidence surface, and AI interpretation surface.
4. Replace the old “reuse generic InsightsPanel inside history” approach with a dedicated Object Store combined workspace.

Rationale: Object Store should be a single scoped investigation flow, not a smaller copy of the standalone expert surfaces.

## Baseline Validation And Regression Ledger

Recorded on: `2026-03-14`

Controller baseline validation for this execution track:

1. `cd seer-ui && node --test tests/history.contract.test.mjs tests/insights.contract.test.mjs`
   - passed
2. `cd seer-backend && .venv/bin/pytest tests/test_process_phase3.py tests/test_root_cause_phase4.py`
   - passed

Existing unrelated working tree items:

1. modified `prophet`
2. untracked `gemini-canvas-split.png`
3. untracked `rca-canvas.png`

These items are outside this plan scope and must remain untouched.

## Phase Map

### Phase 1: Backend OC-DFG Anchor-Filter Support

Scope:

1. Add optional `anchor_filters[]` to the OC-DFG mining contract.
2. Support only `anchor.<field>` RCA-style filters for comparison mining.
3. Apply the filters to anchor instances before graph mining and include them in trace-handle context.
4. Add regression coverage for supported filtering, empty filtered cohorts, and handle round-trip behavior.

Exit criteria:

1. `POST /api/v1/process/ocdfg/mine` accepts anchor filters.
2. Mining results narrow correctly for anchor-field filters.
3. Trace drill-down context remains consistent for filtered comparison runs.

Validation:

1. `cd seer-backend && .venv/bin/pytest tests/test_process_phase3.py`

### Phase 2: Object Store Combined Workspace

Scope:

1. Replace the embedded Object Store insights tabs with a dedicated combined workspace.
2. Auto-run the primary OC-DFG from shared scope (`from`, `to`, `depth`).
3. Add manual RCA outcome selection + run flow.
4. After RCA completion, show the ranked results table beside the graph region and auto-select the first insight.
5. Render the lower comparison OC-DFG only when every selected RCA condition is an `anchor.<field>` rule.
6. Show a clear unsupported-comparison message for non-anchor RCA rules.

Exit criteria:

1. Object Store insights no longer render the nested `InsightsPanel`.
2. Primary OC-DFG reruns automatically on shared scope changes.
3. RCA stays manual and resets on shared scope changes.
4. Compatible RCA insights render a lower comparison graph; incompatible insights render an explicit message.

Validation:

1. `cd seer-ui && node --test tests/history.contract.test.mjs tests/insights.contract.test.mjs`

### Phase 3: Docs, Validation, And Archive Readiness

Scope:

1. Update product specs for Object Store, OC-DFG, and RCA.
2. Run targeted validation plus frontend production build.
3. Record final progress notes and archive the plan to `completed/`.

Exit criteria:

1. Canonical docs describe the new Object Store combined workspace and the anchor-only comparison limitation.
2. Validation passes.
3. Active/completed indexes reflect the archived plan state.

Validation:

1. `cd seer-ui && node --test tests/history.contract.test.mjs tests/insights.contract.test.mjs`
2. `cd seer-ui && npm run build`
3. `cd seer-backend && .venv/bin/pytest tests/test_process_phase3.py tests/test_root_cause_phase4.py`

## Progress Checklist

- [x] Phase 1 complete
- [x] Phase 2 complete
- [x] Phase 3 complete

Current execution state:

- `in_progress`: none
- `blocked`: none
- `completed`: Phase 1 - Backend OC-DFG anchor-filter support
- `completed`: Phase 2 - Object Store combined workspace
- `completed`: Phase 3 - Docs, validation, and archive readiness

## Phase Progress Notes

### 2026-03-14: Plan Created And Baseline Recorded

1. Confirmed Object Store currently reuses the generic `InsightsPanel` with model locking rather than a dedicated combined workspace.
2. Confirmed the process-mining frontend accepts a `filters` input, but the OC-DFG backend contract currently drops that information before the request reaches `/process/ocdfg/mine`.
3. Confirmed RCA insight rule families include more than anchor fields, notably event-count/presence and depth-neighbor payload features, so a faithful comparison graph would require broader shared analytics logic.
4. Chose the narrower v1 comparison contract:
   - support only RCA insights whose conditions are all `anchor.<field>` rules,
   - show a clear unsupported message for all other RCA rule families.
5. Recorded baseline validation:
   - `cd seer-ui && node --test tests/history.contract.test.mjs tests/insights.contract.test.mjs` passed
   - `cd seer-backend && .venv/bin/pytest tests/test_process_phase3.py tests/test_root_cause_phase4.py` passed

### 2026-03-14: Phases 1-3 Complete

1. Added optional `anchor_filters[]` to the OC-DFG mining contract, limited validation to `anchor.<field>` keys, propagated the new context through trace handles, and kept filtered drill-down runs consistent with the comparison graph scope.
2. Implemented anchor-filtered OC-DFG extraction for both in-memory and ClickHouse-backed repository flows, added regression coverage for filtered graph narrowing and non-anchor rejection, and preserved the existing native OC-DFG query path for unfiltered runs.
3. Replaced Object Store's embedded generic `InsightsPanel` with a dedicated combined workspace that:
   - auto-runs the baseline OC-DFG on shared time/depth scope,
   - runs RCA manually from an outcome selector,
   - auto-selects the first RCA result,
   - renders a lower comparison graph only for anchor-field-compatible RCA insights,
   - shows an explicit unsupported-comparison message for non-anchor rule families.
4. Added split-height support to the shared OC-DFG graph component so the Object Store comparison stack can render baseline and comparison graphs vertically without affecting existing full-height consumers.
5. Updated the Object Store, OC-DFG, and RCA product specs to ratify the combined Object Store workspace and the v1 anchor-only comparison limitation.
6. Final validation passed:
   - `cd seer-backend && .venv/bin/ruff check src/seer_backend/analytics tests/test_process_phase3.py tests/test_root_cause_phase4.py`
   - `cd seer-backend && .venv/bin/pytest tests/test_process_phase3.py tests/test_root_cause_phase4.py`
   - `cd seer-ui && node --test tests/history.contract.test.mjs tests/insights.contract.test.mjs`
   - `cd seer-ui && npm run build`
