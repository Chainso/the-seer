# Manual Action Retry

**Status:** completed  
**Owner:** Codex  
**Last updated:** 2026-03-17

## Purpose / Big Picture

Operators need a direct way to retry a failed managed-agent execution from the UI without resubmitting payloads manually or mutating the failed record in place. After this change, a failed execution detail page will expose a retry button that creates a fresh queued execution from the same `action_uri` and payload, preserves the original failed run for inspection, and lets Seer pick up the new run through the existing orchestration flow.

## Progress

- [x] 2026-03-17 Created the active plan and confirmed the existing action lifecycle plus managed-agent execution detail surfaces.
- [x] 2026-03-17 Added backend retry API/service behavior that clones failed actions into fresh queued executions and covered the lifecycle with tests.
- [x] 2026-03-17 Added the managed-agent execution detail retry button, client wiring, and success/error handling.
- [x] 2026-03-17 Updated docs/indexes, validated the affected backend/frontend surfaces, and archived the plan.

## Surprises & Discoveries

- 2026-03-17: The current action control plane has no in-place retry primitive. Claiming increments `attempt_count` and persists numbered attempt records, so mutating a dead-lettered action back to `queued` would either preserve an exhausted retry budget or require awkward attempt-number resets. Creating a fresh execution is the safer model.

## Decision Log

- 2026-03-17, Codex: Manual retry will create a new queued execution from the failed action's `action_uri`, payload, priority, and parent lineage instead of reopening the old row. Rationale: preserve immutable operator history, avoid attempt-record collisions, and give the retried execution a clean retry budget.

## Outcomes & Retrospective

Manual retry now creates a fresh queued execution through the canonical submit path and leaves the failed source action untouched for inspection. The managed-agent execution detail page exposes `Retry Run` for `failed_terminal` and `dead_letter`, then redirects to the new execution when the retry succeeds. The backend lifecycle tests, targeted UI contract test, and `seer-ui` production build all passed. No follow-up gap was opened in this pass beyond the existing unrelated dirty working-tree changes outside this plan's scope.

## Context and Orientation

The action lifecycle lives in `seer-backend/src/seer_backend/actions/` with the HTTP surface in `seer-backend/src/seer_backend/api/actions.py`. Managed-agent execution detail UI is rendered by `seer-ui/app/components/inspector/agentic-workflow-execution-details-panel.tsx` and loads data through `seer-ui/app/lib/api/agentic-workflows.ts`. The canonical product behavior for managed-agent runs is described in `docs/product-specs/managed-agentic-workflows.md` and the generic control-plane behavior in `docs/product-specs/action-orchestration-backend-service.md`.

## Plan of Work

Add a backend `POST /api/v1/actions/{action_id}/retry` endpoint that only accepts failed terminal actions (`failed_terminal`, `dead_letter`) and uses the existing submit path to create a fresh queued execution from the stored action contract inputs. Expose the new response shape to the frontend API client, then add a retry button to the managed-agent execution detail page that appears only for retryable terminal failures and redirects to the newly created execution. Update the product spec and architecture/runtime docs to state that manual retry creates a new execution rather than mutating the failed one, then archive the plan once tests and builds pass.

## Concrete Steps

1. Edit backend action service/API files to add the retry operation and guardrails.
2. Add backend lifecycle tests covering:
   - successful retry of `failed_terminal`
   - successful retry of `dead_letter`
   - conflict on non-failed statuses
3. Edit the frontend API client and execution detail panel to expose the retry action in the UI.
4. Update the matching docs and execution-plan indexes.
5. Validate with targeted backend pytest/Ruff plus targeted UI contract/build checks.

## Validation and Acceptance

Acceptance means:

1. `POST /api/v1/actions/{action_id}/retry` returns a fresh queued action when the source action is `failed_terminal` or `dead_letter`.
2. The original failed action remains unchanged and visible in the inspector.
3. The managed-agent execution detail page shows a retry button for terminal failed runs and navigates to the new execution on success.
4. Targeted validation passes:
   - `cd seer-backend && .venv/bin/ruff check src/seer_backend/api/actions.py src/seer_backend/actions/service.py tests/test_actions_lifecycle.py`
   - `cd seer-backend && .venv/bin/pytest tests/test_actions_lifecycle.py`
   - `cd seer-ui && node --test tests/agentic-workflows.contract.test.mjs`
   - `cd seer-ui && npm run build`

## Idempotence and Recovery

The retry endpoint intentionally creates a new execution each time it is called, so operators should only trigger it deliberately. If execution stops mid-implementation, resume from this plan and the working tree; no data migration or destructive rollback is required. If validation fails, keep the original failed action untouched and fix the retry path without attempting to rewrite historical rows.

## Artifacts and Notes

- Backend action API: `seer-backend/src/seer_backend/api/actions.py`
- Backend action service: `seer-backend/src/seer_backend/actions/service.py`
- Managed-agent execution detail UI: `seer-ui/app/components/inspector/agentic-workflow-execution-details-panel.tsx`
- Managed-agent frontend API client: `seer-ui/app/lib/api/agentic-workflows.ts`

## Interfaces and Dependencies

- `ActionsService.submit_action(...)` remains the canonical path for creating a queued execution.
- The new retry endpoint should depend on `ActionsService` plus `ontology_service` to preserve validation and contract resolution behavior.
- The UI should only surface retry for terminal failed actions and should redirect to the new execution route after success.
