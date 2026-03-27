# Seer-Owned Managed-Agent Runner

**Status:** completed  
**Target order:** post-MVP follow-on  
**Agent slot:** AGENT-MANAGED-RUNNER-1  
**Predecessor:** `docs/exec-plans/completed/managed-agent-authoring-and-seer-data.md`  
**Last updated:** 2026-03-16

---

## Purpose / Big Picture

Managed agents are now authorable in Seer, but submitted managed-agent runs remain stuck in `queued` unless some external worker polls the generic action-claim API. That is the wrong product model. After this plan lands, the default Seer stack will automatically pick up and execute managed agents through a Seer-owned runner service, while ordinary ontology actions remain on the existing external claim/lease model.

The observable user outcome should be straightforward: creating and submitting a managed agent in Seer causes Seer to run it. Operators should not need to deploy or understand an external claim worker for managed agents, and external workers must not be able to lease managed-agent runs through the public claim API.

## Progress

- [x] 2026-03-16 Create the active execution plan, register it in `docs/exec-plans/active/index.md`, and record the current runtime mismatch and baseline constraints before code changes.
- [x] 2026-03-16 Phase 1: implement Seer-owned managed-agent claim/execution plumbing, runner service entrypoint, and backend regression coverage.
- [x] 2026-03-16 Phase 2: wire the runner into the default stack, validate the runtime end-to-end, ratify docs/specs, and archive the plan.

## Surprises & Discoveries

- 2026-03-16: The current generic action contract is explicitly external-worker driven. `docs/product-specs/action-orchestration-backend-service.md` states that a user-owned instance must poll `POST /api/v1/actions/claim` and report complete/fail outcomes.
- 2026-03-16: The default `docker-compose.yml` only starts `seer-backend`, `seer-actions-sweeper`, `seer-ui`, and the data services. There is no managed-agent executor service in the stack today.
- 2026-03-16: `seer-backend/pyproject.toml` currently exposes only one background-process script, `seer-actions-maintenance`; there is no managed-agent runner CLI entrypoint yet.
- 2026-03-16: The current `ActionsRepository.claim_actions(...)` path is hard-wired to `user_id`-scoped claiming. A Seer-owned managed-agent runner will need a separate claim path that can pick up managed-agent rows across users while preserving submitter `user_id` as audit metadata.
- 2026-03-16: There are unrelated uncommitted local changes in `.env.example`, `README.md`, `docker-compose.yml`, and `seer-backend/src/seer_backend/config/settings.py` adjusting OpenAI defaults. They must be preserved and worked around rather than reverted.
- 2026-03-16: The repository did not contain a reusable production managed-agent execution loop. `agent_orchestration` already owned transcript/query surfaces, but no production caller executed `AgentTranscriptService.append_completion_messages(...)`; the runner phase therefore needed a first-pass Seer-owned executor rather than simple service wiring.

## Decision Log

- 2026-03-16, Codex: Managed agents will remain in the shared `actions` table and shared lifecycle model. Rationale: the existing action control plane already owns retries, leasing, lineage, and status visibility, and introducing a second persistence model would be unnecessary churn.
- 2026-03-16, Codex: External callers to `POST /api/v1/actions/claim` must never receive `agentic_workflow` rows. Rationale: managed-agent execution is Seer-owned and should not be leaseable by external workers.
- 2026-03-16, Codex: Seer-owned managed-agent execution will run as a separate Seer service/module in the default stack rather than inside the API process. Rationale: this matches the user request, mirrors the existing sweeper process shape, and keeps API-serving concerns separate from long-running execution loops.
- 2026-03-16, Codex: Managed-agent runs keep the submitter `user_id` for audit/list/detail views, but the Seer runner claims them globally rather than partitioning work by `user_id`. Rationale: the submitter identity is still meaningful, but runner ownership must not depend on a human-specific queue.
- 2026-03-16, Codex: Ordinary actions remain on the current external claim/lease model. Rationale: the user asked to change managed-agent ownership, not to replace the generic action execution contract.
- 2026-03-16, Codex: The first delivered runner should emit the ontology-defined output event and persist canonical transcript messages, but broader tool/action invocation stays out of this change. Rationale: the repo had no reusable managed-agent execution engine, so the lowest-risk end-to-end delivery was a Seer-owned execution loop that proves automatic pickup, transcript persistence, and produced-event provenance without inventing a broader runtime contract.

## Outcomes & Retrospective

2026-03-16 delivered state:

1. Public `POST /api/v1/actions/claim` now excludes `action_kind=agentic_workflow`; ordinary external actions remain on the existing user-scoped public claim model.
2. `seer-backend` now ships a dedicated `seer-managed-agent-runner` CLI/process that claims managed-agent rows internally across users, executes them, persists transcript messages, emits the produced output event, and completes or fails through the shared action lifecycle.
3. The default `docker-compose.yml` stack now starts that runner service alongside `seer-backend` and `seer-actions-sweeper`.
4. Canonical docs/specs now describe managed-agent execution as Seer-owned rather than externally claimable.
5. Targeted backend validation passed after the claim split and runner delivery:
   - `cd /workspaces/seer-python/seer-backend && .venv/bin/ruff check src/seer_backend/actions src/seer_backend/agent_orchestration tests/test_actions_claim.py tests/test_agent_orchestration_phase4.py tests/test_managed_agent_runner.py`
   - `cd /workspaces/seer-python/seer-backend && .venv/bin/pytest tests/test_actions_claim.py tests/test_agent_orchestration_phase4.py tests/test_managed_agent_runner.py`
   - `cd /workspaces/seer-python/seer-backend && .venv/bin/pytest tests/test_actions_repository.py tests/test_actions_faults.py tests/test_actions_status_api.py tests/test_actions_submit.py`

## Context and Orientation

Managed-agent authoring and the agent-first UI were completed in `docs/exec-plans/completed/managed-agent-authoring-and-seer-data.md`, but runtime ownership still reflects the older generic action model. The current backend assumes actions are picked up by an external claimer through `POST /api/v1/actions/claim`, and the default local stack only adds a sweeper process for lease-expiry maintenance.

Relevant backend paths:

- `seer-backend/src/seer_backend/actions/service.py`
  - generic submit/claim/complete/fail service layer
- `seer-backend/src/seer_backend/actions/repository.py`
  - Postgres and in-memory claim logic plus lifecycle persistence
- `seer-backend/src/seer_backend/api/actions.py`
  - public claim/list/detail/status endpoints
- `seer-backend/src/seer_backend/actions/maintenance.py`
  - example of a separate background runner CLI/process shape
- `seer-backend/src/seer_backend/agent_orchestration/`
  - managed-agent transcript persistence and execution-query domain
- `seer-backend/src/seer_backend/config/settings.py`
  - runner/sweeper/action timing config
- `seer-backend/src/seer_backend/main.py`
  - app startup and service injection

Relevant stack/docs paths:

- `docker-compose.yml`
  - current default stack definition
- `README.md`
  - local runtime/operator instructions
- `docs/product-specs/action-orchestration-backend-service.md`
  - current public claim model for ordinary actions
- `docs/product-specs/managed-agentic-workflows.md`
  - managed-agent runtime ownership expectations that now need correction

Key architectural constraint: managed agents should become Seer-owned while ordinary actions remain externally claimable. This change must not break the shared actions lifecycle, the existing action visibility APIs, or the agentic-workflow query surfaces.

## Plan of Work

Phase 1 changes the backend claim model and adds a Seer-owned managed-agent runner. The shared actions table remains the source of truth, but claiming splits into two channels: public external claim for ordinary actions only, and an internal runner claim for `agentic_workflow` rows across users. This phase also adds a dedicated managed-agent runner CLI/process, service wiring, and regression coverage proving managed-agent runs are no longer externally claimable but are internally claimable and executable.

Phase 2 wires the new runner into the default compose stack and updates the canonical docs/specs so repository truth matches the delivered runtime. Validation must prove the default stack now picks up managed-agent runs automatically while ordinary actions still follow the old claim contract. The plan then archives cleanly.

## Concrete Steps

1. Create the active execution plan and register it in `docs/exec-plans/active/index.md`.
2. Run baseline validation before code changes:
   ```bash
   cd /workspaces/seer-python/seer-backend && .venv/bin/ruff check src/seer_backend/actions src/seer_backend/agent_orchestration src/seer_backend/api
   cd /workspaces/seer-python/seer-backend && .venv/bin/pytest tests/test_agent_orchestration_phase4.py
   cd /workspaces/seer-python/seer-ui && node --test tests/agentic-workflows.contract.test.mjs
   ```
3. Implement backend claim-path split and Seer-owned managed-agent runner service/CLI.
4. Add targeted backend tests for:
   - public claim excludes managed agents
   - internal managed-agent claim works across users
   - managed-agent runner claims and executes queued managed-agent runs
5. Wire the runner into `docker-compose.yml` and any required settings/docs.
6. Re-run targeted backend/frontend validation plus any compose-safe runtime checks.
7. Update canonical docs/specs and archive the completed plan.

Expected observable milestones:

- After Phase 1, a queued managed-agent action can be picked up by the Seer-owned runner path, while `/api/v1/actions/claim` never returns `agentic_workflow` rows.
- After Phase 2, the default Seer stack includes the runner service, and the docs/specs no longer imply that managed-agent execution depends on external claim workers.

## Validation and Acceptance

Baseline validation:

- `cd /workspaces/seer-python/seer-backend && .venv/bin/ruff check src/seer_backend/actions src/seer_backend/agent_orchestration src/seer_backend/api`
- `cd /workspaces/seer-python/seer-backend && .venv/bin/pytest tests/test_agent_orchestration_phase4.py`
- `cd /workspaces/seer-python/seer-ui && node --test tests/agentic-workflows.contract.test.mjs`

Phase 1 acceptance:

- Public `POST /api/v1/actions/claim` does not lease managed-agent runs.
- Internal Seer-managed-agent claim can lease `agentic_workflow` rows regardless of submitter `user_id`.
- A managed-agent runner loop can claim a queued managed-agent action and drive it into execution using the existing lifecycle/transcript paths.
- Ordinary action claim behavior remains intact.

Phase 2 acceptance:

- Default stack definition includes a Seer-owned managed-agent runner service.
- Docs/specs clearly state that managed-agent runs are Seer-owned and ordinary actions remain externally claimable.
- Targeted backend validation passes, and frontend contract/build remains green if touched.

Final acceptance:

- A managed-agent submitted in the default stack is automatically picked up by Seer without any external worker.
- The plan is archived to `docs/exec-plans/completed/`.
- Active/completed indexes and references are consistent.

Known baseline failures before implementation: none recorded for the targeted commands yet. Update this section if the baseline commands reveal unrelated failures.

Recorded validation after implementation:

- `cd /workspaces/seer-python/seer-backend && .venv/bin/ruff check src/seer_backend/actions src/seer_backend/agent_orchestration tests/test_actions_claim.py tests/test_agent_orchestration_phase4.py tests/test_managed_agent_runner.py`
  - passed (`All checks passed!`)
- `cd /workspaces/seer-python/seer-backend && .venv/bin/pytest tests/test_actions_claim.py tests/test_agent_orchestration_phase4.py tests/test_managed_agent_runner.py`
  - passed (`14 passed`)
- `cd /workspaces/seer-python/seer-backend && .venv/bin/pytest tests/test_actions_repository.py tests/test_actions_faults.py tests/test_actions_status_api.py tests/test_actions_submit.py`
  - passed (`20 passed`)

## Idempotence and Recovery

The new runner must remain idempotent with respect to the existing action control plane. Recovery should reuse the current lease, retry, and dead-letter semantics already encoded in the actions table rather than inventing a separate retry model for managed agents.

If execution stops mid-phase:

- use the `Progress` checklist as the source of truth for phase status
- inspect the relevant `Phase Handoff` subsection for restart context
- rerun the phase validation commands before resuming edits
- do not revert unrelated local changes in `.env.example`, `README.md`, `docker-compose.yml`, or `seer-backend/src/seer_backend/config/settings.py`; work around them unless they directly block this task

If the new runner service claims work but fails before lifecycle callback completion, lease expiry and the existing sweeper must remain the recovery path.

## Artifacts and Notes

- Example stuck managed-agent run observed before implementation:
  - `action_id`: `e747b3d7-1c15-476c-9f03-dd068349839c`
  - `action_uri`: `urn:seer:managed-agent:create_and_close_sales_order`
  - `status`: `queued`
  - `attempt_count`: `0`
  - `lease_owner_instance_id`: `null`
- Current default stack lacks a managed-agent executor service but does include:
  - `seer-backend`
  - `seer-actions-sweeper`
  - `seer-ui`
  - `fuseki`
  - `clickhouse`
  - `postgres`

## Interfaces and Dependencies

Important modules and interfaces:

- `ActionsService.claim_actions(...)`
- `ActionsRepository.claim_actions(...)`
- new internal managed-agent claim service/repository method(s)
- new managed-agent runner CLI/process module
- `AgentTranscriptService`
- `AgentOrchestrationService`
- `POST /api/v1/actions/claim`
- existing `POST /api/v1/actions/{action_id}/complete`
- existing `POST /api/v1/actions/{action_id}/fail`

Expected end-state interfaces:

- public action claim remains stable for ordinary actions
- managed-agent runner uses a non-public/internal claim path
- default stack can run the Seer-owned managed-agent runner without extra operator setup

## Phase 1

### Phase Handoff

**Goal**

Implement the backend claim-model split and Seer-owned managed-agent runner, with targeted regression coverage proving managed agents are internal-only and ordinary actions still use the public claim path.

**Scope Boundary**

Backend/domain/runtime/test work only. Do not change the managed-agent UI beyond any tiny test-contract adjustments strictly required by runtime wiring.

**Read First**

1. `AGENTS.md`
2. `PLANS.md`
3. `docs/exec-plans/completed/seer-owned-managed-agent-runner.md`
4. `seer-backend/src/seer_backend/actions/service.py`
5. `seer-backend/src/seer_backend/actions/repository.py`
6. `seer-backend/src/seer_backend/api/actions.py`
7. `seer-backend/src/seer_backend/actions/maintenance.py`
8. `seer-backend/src/seer_backend/agent_orchestration/`

**Files Expected To Change**

- `seer-backend/src/seer_backend/actions/service.py`
- `seer-backend/src/seer_backend/actions/repository.py`
- `seer-backend/src/seer_backend/api/actions.py`
- `seer-backend/src/seer_backend/config/settings.py`
- new runner module(s) under `seer-backend/src/seer_backend/agent_orchestration/` or adjacent runtime area
- `seer-backend/pyproject.toml`
- new or updated targeted backend tests
- this plan file

**Validation**

- `cd /workspaces/seer-python/seer-backend && .venv/bin/ruff check src/seer_backend/actions src/seer_backend/agent_orchestration src/seer_backend/api tests`
- `cd /workspaces/seer-python/seer-backend && .venv/bin/pytest tests/test_agent_orchestration_phase4.py <new targeted tests>`

**Plan / Docs To Update**

- `Progress`
- `Surprises & Discoveries`
- `Decision Log`
- `Outcomes & Retrospective`
- this phase handoff subsection with `Status`, `Completion Notes`, and `Next Starter Context`

**Deliverables**

- internal-only managed-agent claim path
- public claim exclusion for managed agents
- Seer-owned managed-agent runner CLI/process
- targeted backend tests and validation evidence

**Commit Expectation**

- One phase commit with subject: `Add Seer-owned managed-agent runner service`

**Known Constraints / Baseline Failures**

- Managed agents must stay in the shared actions table and lifecycle model.
- Ordinary actions must remain externally claimable.
- Do not revert unrelated OpenAI-default changes already present in the worktree.

**Status**

Completed on 2026-03-16.

**Completion Notes**

Implemented `claim_managed_agent_actions(...)` in the action service/repositories, restricted public claim to ordinary actions, added `seer_backend.agent_orchestration.runner`, introduced managed-agent runner settings plus CLI entrypoint, and added regression coverage for public-claim exclusion, global internal managed-agent claim, and first-pass end-to-end managed-agent execution.

**Next Starter Context**

The delivered runner is intentionally first-pass: it proves Seer-owned managed-agent pickup, transcript persistence, and output-event emission. Broader managed-agent tool/action invocation policy remains a follow-up product/runtime track.

## Phase 2

### Phase Handoff

**Goal**

Wire the new Seer-owned managed-agent runner into the default stack, validate end-to-end behavior, update canonical docs/specs, and archive the plan.

**Scope Boundary**

Compose/runtime wiring, docs/spec updates, final validation, and archive/index work. Only make backend changes here if a Phase 1 gap blocks stack integration.

**Read First**

1. `AGENTS.md`
2. `PLANS.md`
3. `docs/exec-plans/completed/seer-owned-managed-agent-runner.md`
4. `docker-compose.yml`
5. `README.md`
6. `docs/product-specs/action-orchestration-backend-service.md`
7. `docs/product-specs/managed-agentic-workflows.md`
8. `ARCHITECTURE.md`

**Files Expected To Change**

- `docker-compose.yml`
- `README.md`
- relevant docs/specs under `docs/product-specs/`
- `ARCHITECTURE.md`
- `docs/exec-plans/active/index.md`
- `docs/exec-plans/completed/README.md`
- move this plan to `docs/exec-plans/completed/`

**Validation**

- rerun the key backend validation commands from Phase 1
- `cd /workspaces/seer-python/seer-ui && node --test tests/agentic-workflows.contract.test.mjs`
- any safe runtime smoke check that proves the runner service is defined and the docs match the delivered model

**Plan / Docs To Update**

- all living sections of this plan
- active/completed indexes
- any references that still point to the active plan path

**Deliverables**

- default stack includes a Seer-owned managed-agent runner service
- docs/specs reflect Seer-owned managed-agent execution
- archived completed plan with final validation ledger

**Commit Expectation**

- One phase commit with subject: `Wire Seer-managed-agent runner into stack and docs`

**Known Constraints / Baseline Failures**

- Preserve unrelated local config-default edits.
- Do not change ordinary-action ownership semantics.

**Status**

Completed on 2026-03-16.

**Completion Notes**

Added `seer-managed-agent-runner` to `docker-compose.yml`, updated `README.md`, ratified the relevant product/architecture docs, and prepared the plan for archive with the final validation ledger.

**Next Starter Context**

If follow-on work expands managed-agent runtime capabilities, start from `seer-backend/src/seer_backend/agent_orchestration/runner.py`, the updated action claim split in `seer-backend/src/seer_backend/actions/`, and the managed-agent product specs updated in this plan.
