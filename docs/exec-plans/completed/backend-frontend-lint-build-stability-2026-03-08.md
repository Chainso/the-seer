# Post-MVP Exec Plan: Backend And Frontend Lint/Build Stability

**Status:** completed  
**Target order:** post-MVP track 15  
**Agent slot:** QUALITY-1  
**Predecessor:** `docs/exec-plans/completed/assistant-canvas-shared-display-surfaces.md`  
**Successor:** none (archived on 2026-03-08)  
**Last updated:** 2026-03-08

---

## Objective

Make the canonical backend and frontend validation commands pass cleanly in the current repository state:

1. backend lint,
2. backend build,
3. frontend lint,
4. frontend build.

## Scope

1. Identify the repo-standard lint/build commands for `seer-backend` and `seer-ui`.
2. Run a baseline pass and record failures.
3. Fix only the code/config issues required to make those commands pass.
4. Re-run validation and capture final evidence.

## Non-Goals

1. Expanding scope into unrelated failing tests unless they block lint/build.
2. Refactoring working areas that are not implicated by validation failures.
3. Preserving legacy implementation details when a cleaner current fix is available.

## Invariants

1. `seer-backend` remains the canonical backend package and must build through the existing Python packaging workflow.
2. `seer-ui` remains the canonical frontend app and must build through the existing Next.js production build workflow.
3. Only one execution phase is active at a time.

## Legacy Behavior Removal (Intentional)

1. None expected. This work is intended to restore validation health without changing user-facing behavior unless a fix requires it.

## Baseline Validation And Regression Ledger

Recorded on: `2026-03-08`

Planned baseline commands:

1. `cd seer-backend && uv run ruff check src tests`
2. `cd seer-backend && uv build`
3. `cd seer-ui && npm run lint`
4. `cd seer-ui && npm run build`

Known unrelated repository state before execution:

1. Untracked images in repo root: `gemini-canvas-split.png`, `rca-canvas.png`

Baseline results:

1. `cd seer-backend && uv run ruff check src tests`
   - failed on `src/seer_backend/ai/ontology_copilot.py` because one validation error string exceeded the configured Ruff line length by one character.
2. `cd seer-backend && uv build`
   - passed
3. `cd seer-ui && npm run lint`
   - failed on `app/components/layout/nav-sidebar.tsx` because the sidebar used `setMounted(true)` inside `useEffect`, which violates the enabled `react-hooks/set-state-in-effect` rule.
4. `cd seer-ui && npm run build`
   - passed

## Phase Map

### Phase 1: Baseline Validation

Scope:

1. Run the canonical backend/frontend lint and build commands.
2. Record the exact failure set and impacted files.

Exit criteria:

1. The failure ledger clearly identifies all blockers for lint/build parity.

Validation:

1. `cd seer-backend && uv run ruff check src tests`
2. `cd seer-backend && uv build`
3. `cd seer-ui && npm run lint`
4. `cd seer-ui && npm run build`

### Phase 2: Remediation

Scope:

1. Fix backend issues blocking lint/build.
2. Fix frontend issues blocking lint/build.
3. Keep changes tightly scoped to validation blockers.

Exit criteria:

1. All four canonical commands pass.

Validation:

1. `cd seer-backend && uv run ruff check src tests`
2. `cd seer-backend && uv build`
3. `cd seer-ui && npm run lint`
4. `cd seer-ui && npm run build`

### Phase 3: Ratification And Archive

Scope:

1. Record final evidence and any residual risks.
2. Move the plan to `completed/` and update execution indexes.

Exit criteria:

1. Plan is archived with final acceptance evidence.

Validation:

1. `git status --short`

## Acceptance Criteria

1. `cd seer-backend && uv run ruff check src tests` passes.
2. `cd seer-backend && uv build` passes.
3. `cd seer-ui && npm run lint` passes.
4. `cd seer-ui && npm run build` passes.
5. Execution tracking is updated in the relevant plan indexes.

## Completion Summary

1. Fixed the backend Ruff failure in `seer_backend/ai/ontology_copilot.py` by wrapping the offending validation message across two adjacent string literals.
2. Fixed the frontend ESLint failure in `app/components/layout/nav-sidebar.tsx` by replacing the mount-tracking `useEffect`/`setState` pattern with the repo’s existing `useSyncExternalStore` mounted-state pattern.
3. Re-ran all four canonical validation commands and confirmed they now pass.

## Acceptance Evidence

1. `cd seer-backend && uv run ruff check src tests` -> pass (`All checks passed!`)
2. `cd seer-backend && uv build` -> pass (`Successfully built dist/seer_backend-0.1.0.tar.gz` and `dist/seer_backend-0.1.0-py3-none-any.whl`)
3. `cd seer-ui && npm run lint` -> pass
4. `cd seer-ui && npm run build` -> pass (Next.js 16.1.3 production build completed successfully for `/`, `/assistant`, `/inspector`, `/ontology`, and related routes)

## Docs Impact

1. `docs/exec-plans/completed/backend-frontend-lint-build-stability-2026-03-08.md`: archived execution record with baseline, remediation, and acceptance evidence.
2. `docs/exec-plans/active/index.md`: mark this work in progress, then remove it on archive.
3. `docs/exec-plans/completed/README.md`: index the archived plan.

## Decision Log

1. 2026-03-08: Use the repo-standard canonical commands already referenced in prior execution plans: backend `uv run ruff check src tests` and `uv build`, frontend `npm run lint` and `npm run build`.

## Progress Checklist

- [x] Phase 1 complete
- [x] Phase 2 complete
- [x] Phase 3 complete

Current execution state:

- `in_progress`: none
- `blocked`: none
- `completed`: Phase 1 - baseline validation
- `completed`: Phase 2 - remediation
- `completed`: Phase 3 - ratification and archive

## Phase Progress Notes

### 2026-03-08: Plan Created

1. Created a focused execution plan to restore canonical lint/build health for both `seer-backend` and `seer-ui`.
2. Scoped the work to backend/frontend lint and production build commands only.

### 2026-03-08: Baseline Validation Complete

1. Confirmed backend build and frontend build both passed in the initial repository state.
2. Isolated the backend lint failure to one overlong validation message in `src/seer_backend/ai/ontology_copilot.py`.
3. Isolated the frontend lint failure to `app/components/layout/nav-sidebar.tsx`, where `setMounted(true)` was called inside `useEffect`.

### 2026-03-08: Remediation And Ratification Complete

1. Rewrapped the backend validation message so `uv run ruff check src tests` passes without changing runtime behavior.
2. Replaced the sidebar mounted-state effect with a `useSyncExternalStore` mounted flag, matching an existing repo pattern used in `app/components/inspector/insights-panel.tsx`.
3. Re-ran backend/frontend lint and build commands and confirmed all four pass.
4. Archived this plan and updated execution indexes.
