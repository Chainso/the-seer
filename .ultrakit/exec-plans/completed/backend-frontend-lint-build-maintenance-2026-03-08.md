# Post-MVP Exec Plan: Backend And Frontend Lint/Build Maintenance

**Status:** completed  
**Target order:** post-MVP track 16  
**Agent slot:** QUALITY-1  
**Predecessor:** `docs/exec-plans/completed/agentic-workflow-execution-ui-polish.md`  
**Successor:** none (archived on 2026-03-08)  
**Last updated:** 2026-03-08

---

## Objective

Re-verify the canonical backend and frontend lint/build commands in the current repository state, fixing any failures that block them and then ratifying the results.

## Scope

1. Run the repo-standard lint/build commands for `seer-backend` and `seer-ui`.
2. Record the exact failure set and unrelated repo state.
3. Fix only the code/config issues required to make those commands pass.
4. Re-run validation, record evidence, and archive the plan if successful.

## Non-Goals

1. Expanding into unrelated tests unless they block lint/build.
2. Refactoring working code outside the failing paths.
3. Preserving legacy implementation details when a cleaner current fix is preferable.

## Invariants

1. `seer-backend` remains the canonical backend package and must build via the existing Python packaging workflow.
2. `seer-ui` remains the canonical frontend app and must build via the existing Next.js production build workflow.
3. Only one execution phase is active at a time.

## Legacy Behavior Removal (Intentional)

1. None expected. This is a maintenance pass intended to restore or confirm validation health.

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
   - passed (`All checks passed!`; `uv` emitted a non-blocking warning that the active `VIRTUAL_ENV` path did not match the project-local `.venv`)
2. `cd seer-backend && uv build`
   - passed (`Successfully built dist/seer_backend-0.1.0.tar.gz` and `dist/seer_backend-0.1.0-py3-none-any.whl`)
3. `cd seer-ui && npm run lint`
   - passed
4. `cd seer-ui && npm run build`
   - passed (Next.js 16.1.3 production build completed successfully for `/`, `/assistant`, `/inspector`, `/ontology`, and related routes)

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

1. Re-ran the canonical backend Ruff/build and frontend ESLint/Next build commands in the current repo state.
2. Confirmed all four commands passed without any source changes.
3. Archived the execution record after updating the active/completed indexes.

## Acceptance Evidence

1. `cd seer-backend && uv run ruff check src tests` -> pass (`All checks passed!`)
2. `cd seer-backend && uv build` -> pass (`Successfully built dist/seer_backend-0.1.0.tar.gz` and `dist/seer_backend-0.1.0-py3-none-any.whl`)
3. `cd seer-ui && npm run lint` -> pass
4. `cd seer-ui && npm run build` -> pass (Next.js 16.1.3 production build completed successfully for `/`, `/assistant`, `/inspector`, `/inspector/agentic-workflows`, `/inspector/analytics`, `/inspector/history`, `/ontology`, and the dynamic routes `/inspector/agentic-workflows/[executionId]`, `/inspector/insights`, `/ontology/[tab]`)

## Docs Impact

1. `docs/exec-plans/completed/backend-frontend-lint-build-maintenance-2026-03-08.md`: archived execution record for this verification pass.
2. `docs/exec-plans/active/index.md`: marked this work in progress, then cleared it on archive.
3. `docs/exec-plans/completed/README.md`: index the archived plan if the run closes successfully.

## Decision Log

1. 2026-03-08: Reuse the canonical lint/build commands established by the prior stability plan because the backend and frontend package manifests have not changed.

## Progress Checklist

- [x] Phase 1 complete
- [x] Phase 2 complete
- [x] Phase 3 complete

Current execution state:

- `in_progress`: none
- `blocked`: none
- `completed`: Phase 1 - baseline validation
- `completed`: Phase 2 - remediation not needed
- `completed`: Phase 3 - ratification and archive

## Phase Progress Notes

### 2026-03-08: Plan Created

1. Opened a focused maintenance plan to verify current backend/frontend lint and build health.
2. Scoped the work to the canonical backend Ruff/build and frontend ESLint/Next build commands.

### 2026-03-08: Baseline Validation Complete

1. Confirmed backend Ruff lint, backend package build, frontend ESLint, and frontend Next.js production build all passed on the first run.
2. Recorded the non-blocking `uv` environment-path warning separately from the pass/fail ledger because it did not affect artifact production or exit status.

### 2026-03-08: Ratification And Archive Complete

1. No code remediation was required because the canonical validation commands were already green.
2. Archived this plan and updated the execution indexes to reflect the completed maintenance pass.
