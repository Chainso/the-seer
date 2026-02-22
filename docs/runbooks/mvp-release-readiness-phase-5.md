# MVP Release Readiness Runbook (Phase 5)

**Status:** completed  
**Owner phase:** `/home/chanzo/code/large-projects/seer-python/docs/exec-plans/completed/mvp-phase-5-ai-hardening-release.md`  
**Last updated:** 2026-02-22

---

## Purpose

Define repeatable local checks and smoke steps used to decide MVP release readiness.

## Preconditions

1. Repository checked out with Phase 5 changes.
2. Backend and UI dependencies already installed locally (no network install during verification).
3. Runtime services available if running full interactive flow.

## Verification Commands

1. `cd seer-backend && uv run ruff check src tests`
2. `cd seer-backend && uv run pytest -q`
3. `cd seer-ui && npm run lint`
4. `cd seer-ui && npm run build`

## Smoke Journey Checklist

1. Open `/ontology` and submit at least one copilot question.
2. Open `/process` and run a process mining request.
3. Trigger `AI assist: summarize run` in Process Explorer.
4. Open `/root-cause` and run RCA with explicit outcome.
5. Trigger both AI assists in Root-Cause Lab and open at least one evidence drill-down.
6. Open `/insights` and execute guided investigation.

## Release Gate Mapping

1. Gate A-D inherited from completed phases; no regressions allowed.
2. Gate E checks:
   - critical smoke path passes,
   - no unresolved P0/P1 defects,
   - docs/runbook/spec links updated.

## Known Non-Blocking Warnings

1. FastAPI `on_event("startup")` deprecation warning is still present and tracked outside MVP scope.
2. FastAPI deprecation warnings for `HTTP_422_UNPROCESSABLE_ENTITY` and `HTTP_413_REQUEST_ENTITY_TOO_LARGE` are currently non-blocking.
