# Managed-Agent Shared Copilot Runtime And Prompt Split

**Status:** active  
**Target order:** post-MVP follow-on  
**Agent slot:** AGENT-MANAGED-COPILOT-1  
**Predecessor:** `docs/exec-plans/completed/managed-agent-runtime-and-agentic-workflows.md`, `docs/exec-plans/completed/seer-owned-managed-agent-runner.md`  
**Successor:** none  
**Last updated:** 2026-03-16

---

## Purpose / Big Picture

Managed agents are now authorable in Seer and the Seer-owned runner automatically picks them up, but the current runtime is still a prompt-only OpenAI call. That is not the architecture the repository already committed to. After this plan lands, managed agents will execute through the shared copilot/tool loop, with access to `load_skill`, `load_action`, and the same durable `completion_messages` model, while still keeping a tighter runtime policy than `/assistant`.

The observable outcome should be:

1. `/assistant` keeps its conversational assistant workflow and assistant-oriented prompt.
2. Managed-agent executions use a separate managed-agent system prompt optimized for accurate, precise task completion against the authored instruction and input/output contract.
3. Managed agents can load only the approved skill subset: `deep-ontology`, `object-store`, and `object-history`.
4. Managed agents cannot access `process-mining` or `root-cause`.
5. Managed agents can dynamically expose ontology-defined actions through a real production `load_action` tool instead of staying prompt-only.

## Progress

- [x] 2026-03-16 Re-read canonical docs, managed-agent specs, prior execution plans, and the current runner/copilot implementation to rebuild full context before opening this plan.
- [x] 2026-03-16 Create this active execution plan and register it in `docs/exec-plans/active/index.md` before any implementation work.
- [x] 2026-03-16 Phase 1: refactor the shared copilot runtime so `/assistant` and managed-agent execution can share the tool loop while using different prompt/workflow policies.
- [x] 2026-03-16 Phase 2: implement managed-agent runtime tool policy, including restricted visible skills and a production `load_action` tool.
- [ ] Phase 3: wire the managed-agent runner onto the shared copilot path, extend regression coverage, ratify docs/specs, and archive the plan.

## Surprises & Discoveries

- 2026-03-16: The current managed-agent runner in `seer-backend/src/seer_backend/agent_orchestration/runner.py` bypasses `OntologyCopilotService` entirely and performs a direct `chat.completions.create(...)` call with only `system` and `user` messages. No tools are passed today.
- 2026-03-16: The repository docs already encode the desired runtime policy. `DESIGN.md`, `ARCHITECTURE.md`, and `docs/exec-plans/completed/managed-agent-runtime-and-agentic-workflows.md` all still say managed-agent runtime should use restricted `load_skill` plus `load_action`.
- 2026-03-16: The assistant skill gating mechanism is already real production code. `seer-backend/src/seer_backend/ai/skills.py` parses `allowed-tools`, and `seer-backend/src/seer_backend/ai/ontology_copilot.py` expands tool schemas based on loaded-skill tool results.
- 2026-03-16: `load_action` is still documentation/test intent rather than a production runtime tool in `seer-backend/src`. The earlier plan described it in detail, but the current codebase does not implement it yet.
- 2026-03-16: There is already a dirty worktree in `seer-backend/src/seer_backend/ai/ontology_copilot.py` and `seer-backend/src/seer_backend/ontology/service.py`. This plan must avoid assuming those changes belong to this track and must not revert them.
- 2026-03-16: `OntologyCopilotService.answer_stream(...)` now assumes the ontology service exposes `copilot_seer_data_turtle()`. The `_SkillAwareOntologyService` test double in `seer-backend/tests/test_ai_phase5.py` did not implement it, which initially broke both the new prompt tests and existing assistant-tool-flow tests until the stub was updated.
- 2026-03-16: The shared action-validation path requires `ontology_service.current()` to return `OntologyCurrentResponse`, not just `CurrentReleasePointer`. The managed-agent `load_action` test stub initially returned the narrower pointer shape, which caused `load_action` to fail resolution until the stub was updated.

## Decision Log

- 2026-03-16, Codex: Treat the current prompt-only managed-agent runner as an implementation drift, not a new architecture decision. Rationale: the canonical docs and earlier runtime plan already specify shared copilot execution with restricted tools.
- 2026-03-16, Codex: Keep `/assistant` and managed-agent execution on the same underlying copilot/tool infrastructure, but split their system prompt and workflow instructions explicitly. Rationale: they share model/tool machinery, but they serve different operational goals and should not compete for one prompt contract.
- 2026-03-16, Codex: Managed-agent runtime must expose only `deep-ontology`, `object-store`, and `object-history` through `load_skill`, and must not expose `process-mining` or `root-cause`. Rationale: this matches the original runtime plan and keeps managed-agent runtime narrower than the general assistant.
- 2026-03-16, Codex: `load_action` should be implemented as a production runtime tool on the shared copilot path rather than as bespoke runner logic. Rationale: ontology-defined executable actions belong in the shared tool loop so transcript history and runtime policy remain coherent.
- 2026-03-16, Codex: Phase 1 should extend `OntologyCopilotService` with an explicit runtime mode plus optional workflow-prompt override instead of introducing a second copilot class. Rationale: this keeps the shared tool loop intact, avoids duplicating orchestration code, and creates a narrow seam for the managed-agent runner to adopt in Phase 3.
- 2026-03-16, Codex: `load_action` should load only ordinary executable actions, not managed-agent actions. Rationale: Phase 2 is about enabling ontology action invocation from managed-agent runs while preserving a clear boundary between ordinary child actions and Seer-owned managed-agent executions.

## Outcomes & Retrospective

2026-03-16 plan opening state:

1. Repository truth has been re-read and the current implementation drift is now captured in one active plan instead of only in chat context.
2. No implementation has landed yet under this plan.
3. The next contributor should treat this plan as the canonical source of truth for restoring managed-agent shared-copilot execution and prompt separation.

2026-03-16 Phase 1 delivered state:

1. `OntologyCopilotService` now supports explicit `runtime_mode` selection plus `workflow_system_prompt_override`, which separates assistant-mode and managed-agent-mode prompt policy while keeping one shared tool loop.
2. `/assistant` call sites keep the default assistant mode, so no route- or gateway-level prompt migration was required in this phase.
3. `seer-backend/tests/test_ai_phase5.py` now covers assistant default mode, managed-agent mode, and workflow-prompt override behavior.
4. Phase 1 validation passed:
   - `cd /workspaces/seer-python/seer-backend && .venv/bin/pytest tests/test_ai_phase5.py` (`29 passed`)

2026-03-16 Phase 2 delivered state:

1. Managed-agent mode now filters the visible skill catalog down to `deep-ontology`, `object-store`, and `object-history`, and blocks `process-mining` / `root-cause` even if a model attempts to load them explicitly.
2. The shared copilot path now exposes a production `load_action` built-in for managed-agent mode, persists loaded-action metadata in tool messages, reconstructs dynamic loaded-action tool schemas from transcript history, and submits child actions through `ActionsService` with `parent_execution_id` preserved.
3. `ActionsService` now exposes reusable action-contract resolution and JSON-schema generation for dynamic action tools, and `submit_action(...)` accepts optional `parent_execution_id` so loaded action tools can preserve execution lineage.
4. `seer-backend/tests/test_ai_phase5.py` now covers managed-agent skill-catalog filtering, blocked disallowed skill loads, and `load_action` registering a callable tool that enqueues a child action.
5. Phase 2 validation passed:
   - `cd /workspaces/seer-python/seer-backend && .venv/bin/pytest tests/test_ai_phase5.py tests/test_agent_orchestration_phase3.py` (`35 passed`)
   - `cd /workspaces/seer-python/seer-backend && .venv/bin/ruff check src/seer_backend/actions/service.py src/seer_backend/ai/ontology_copilot.py src/seer_backend/ontology/models.py tests/test_ai_phase5.py` (`All checks passed!`)

## Context and Orientation

This repository currently has three relevant runtime layers:

1. `seer-backend/src/seer_backend/ai/ontology_copilot.py`
   - shared conversational copilot orchestration
   - base system prompt and assistant workflow prompt
   - tool-calling loop
   - skill discovery and loaded-skill permission gating
2. `seer-backend/src/seer_backend/ai/assistant_tools.py`
   - backend-owned domain tool registry keyed by permission name
   - currently includes history/process/root-cause tool schemas and handlers
3. `seer-backend/src/seer_backend/agent_orchestration/runner.py`
   - Seer-owned managed-agent claim/execute loop
   - currently direct prompt-only execution with no shared copilot/tool loop

Relevant product/runtime docs:

- `docs/product-specs/assistant-primary-surface.md`
- `docs/product-specs/managed-agentic-workflows.md`
- `docs/product-specs/managed-agent-controls-and-approvals.md`
- `docs/product-specs/action-orchestration-backend-service.md`
- `docs/exec-plans/completed/managed-agent-runtime-and-agentic-workflows.md`
- `ARCHITECTURE.md`
- `DESIGN.md`

Key current mismatch:

1. `/assistant` already has a shared copilot/tool architecture with `load_skill`.
2. Managed agents are supposed to reuse that machinery with a narrower policy.
3. The shipped managed-agent runner currently skips that machinery and uses a one-shot prompt-only completion.

Key architectural constraint:

1. This plan must not collapse the `/assistant` prompt into the managed-agent prompt.
2. This plan must not give managed agents the full assistant skill catalog.
3. This plan must not reintroduce a separate bespoke runtime loop for `load_action` outside the shared copilot/tool model.

## Plan of Work

Phase 1 establishes the shared runtime seam cleanly. The existing `OntologyCopilotService` is currently assistant-oriented in both prompt text and public API shape, so the first job is to extract or extend that shared loop so it can run in multiple modes. At the end of the phase, the repository should have an explicit distinction between the assistant conversation prompt/workflow and the managed-agent execution prompt/workflow, while still reusing the same model runtime, tool-call execution path, and transcript-friendly `completion_messages` contract.

Phase 2 adds the missing managed-agent runtime tool policy. Managed-agent execution should be able to call `load_skill`, but the visible catalog must be narrowed to `deep-ontology`, `object-store`, and `object-history`. It must not see `process-mining` or `root-cause`. This phase also implements a production `load_action` tool that looks up an ontology-defined executable action, derives a callable tool schema from `acceptsInput`, and allows the agent to invoke that action through the shared control plane while preserving parent-child execution lineage.

Phase 3 moves the managed-agent runner from prompt-only execution onto the new shared copilot runtime, extends regression coverage, updates canonical docs/specs so they match the delivered code again, and archives the plan. The runner should persist the same transcript state as before, but now that transcript should include managed-agent tool activity from the shared copilot path instead of only system/user/assistant text.

## Concrete Steps

1. Open this active execution plan and update `docs/exec-plans/active/index.md`.
2. Capture current baseline context:
   ```bash
   cd /workspaces/seer-python
   git status --short
   rg -n "load_skill|load_action|managed-agent|assistant" seer-backend/src/seer_backend/ai seer-backend/src/seer_backend/agent_orchestration docs
   ```
3. Refactor the shared copilot runtime so it can run with mode-specific prompts/workflows.
4. Add managed-agent runtime mode and prompt builder.
5. Implement managed-agent skill visibility filtering and production `load_action`.
6. Move `seer_backend.agent_orchestration.runner` onto the shared copilot path.
7. Add/update targeted backend tests for prompt separation, restricted skill visibility, `load_action`, and runner integration.
8. Update canonical docs/specs, rerun validation, and archive the plan.

Expected observable milestones:

- After Phase 1, the codebase has an explicit assistant-mode prompt/workflow and managed-agent-mode prompt/workflow on the same copilot engine.
- After Phase 2, managed agents can use `load_skill` and `load_action`, but cannot access process-mining or root-cause tools.
- After Phase 3, a managed-agent run in the default Seer stack executes through the shared copilot/tool path and the docs/specs describe that accurately.

## Validation and Acceptance

Baseline checks:

- `cd /workspaces/seer-python && git status --short`
- `cd /workspaces/seer-python && rg -n "load_skill|load_action|managed-agent|assistant" seer-backend/src/seer_backend/ai seer-backend/src/seer_backend/agent_orchestration docs`

Phase 1 acceptance:

- Shared copilot runtime supports at least two explicit modes or equivalent prompt-policy separation.
- `/assistant` continues to use the assistant-oriented workflow prompt.
- Managed-agent execution can supply a separate system/workflow prompt without forking a second bespoke tool loop.

Phase 2 acceptance:

- Managed-agent runtime can call `load_skill`.
- Managed-agent visible skills are limited to `deep-ontology`, `object-store`, and `object-history`.
- Managed-agent runtime cannot load `process-mining` or `root-cause`.
- Production `load_action` exists and exposes ontology-defined action input schema as a callable tool contract.
- Managed-agent-triggered ontology actions submit through the shared action control plane with lineage preserved.

Phase 3 acceptance:

- The managed-agent runner no longer performs direct prompt-only completion.
- Managed-agent transcript persistence includes shared copilot/tool messages.
- Targeted backend validation passes for the new shared runtime and runner path.
- Canonical docs/specs are updated in the same change.
- The plan is archived and indexes are consistent.

Known baseline failures before implementation:

1. There is already a dirty worktree in `seer-backend/src/seer_backend/ai/ontology_copilot.py` and `seer-backend/src/seer_backend/ontology/service.py`. That state must be inspected and worked around during implementation rather than overwritten blindly.

## Idempotence and Recovery

This plan changes runtime orchestration, so interruption safety matters.

If execution stops mid-phase:

1. Use the `Progress` checklist as the current-state ledger.
2. Re-read the phase's `Phase Handoff` subsection before resuming.
3. Re-run the phase validation commands before making new edits.
4. Do not revert unrelated worktree changes in dirty files unless the user explicitly asks for that.

If the runtime refactor lands partially:

1. keep `/assistant` on its current working path until managed-agent mode is proven,
2. gate runner migration behind targeted tests rather than swapping prompts and tools in one step,
3. and keep `load_action` behind the shared copilot tool interface instead of adding temporary bespoke action-call code to the runner.

## Artifacts and Notes

Key files likely involved:

- `seer-backend/src/seer_backend/ai/ontology_copilot.py`
- `seer-backend/src/seer_backend/ai/assistant_tools.py`
- `seer-backend/src/seer_backend/ai/skills.py`
- `seer-backend/src/seer_backend/ai/gateway.py`
- `seer-backend/src/seer_backend/api/ontology.py`
- `seer-backend/src/seer_backend/agent_orchestration/runner.py`
- `seer-backend/src/seer_backend/actions/service.py`
- `seer-backend/src/seer_backend/ontology/service.py`
- `seer-backend/src/seer_backend/ontology/models.py`
- `seer-backend/tests/test_ai_phase5.py`
- `seer-backend/tests/test_agent_orchestration_phase3.py`
- `seer-backend/tests/test_agent_orchestration_phase4.py`
- `seer-backend/tests/test_managed_agent_runner.py`

Key locked behavior for this plan:

1. `/assistant` prompt stays assistant-only.
2. Managed-agent prompt is separate and optimized for completion accuracy and precision.
3. Managed-agent runtime may use `deep-ontology`, `object-store`, and `object-history`.
4. Managed-agent runtime may not use `process-mining` or `root-cause`.
5. `load_action` becomes a real production tool.

## Interfaces and Dependencies

Important interfaces/modules today:

- `OntologyCopilotService.answer(...)`
- `OntologyCopilotService.answer_stream(...)`
- `AssistantDomainToolAdapter.tool_schemas(...)`
- `AssistantDomainToolAdapter.execute_tool_call(...)`
- `AssistantSkillRegistry.discover()` / `get()`
- `CopilotToolCall`
- `CopilotToolResult`
- `ManagedAgentExecutionService`
- `AgentTranscriptService`

Expected end-state interfaces:

1. a shared copilot execution entrypoint that accepts explicit runtime mode or equivalent prompt-policy configuration,
2. explicit assistant prompt/workflow instructions for `/assistant`,
3. explicit managed-agent prompt/workflow instructions for managed-agent execution,
4. managed-agent-visible skill filtering on top of the shared `load_skill` mechanism,
5. production `load_action` support in the shared copilot tool model,
6. runner integration that executes managed agents through the shared copilot path rather than a direct one-shot completion.

## Phase 1

### Phase Handoff

**Goal**

Refactor the shared copilot runtime so `/assistant` and managed-agent execution can share the same tool loop while using distinct prompt/workflow policies.

**Scope Boundary**

Only shared runtime/prompt architecture plus targeted tests proving prompt separation. Do not wire the managed-agent runner onto the new path yet, and do not implement full `load_action` in this phase.

**Read First**

1. `AGENTS.md`
2. `PLANS.md`
3. `docs/exec-plans/active/managed-agent-copilot-runtime-and-prompt-split.md`
4. `seer-backend/src/seer_backend/ai/ontology_copilot.py`
5. `seer-backend/src/seer_backend/api/ontology.py`
6. `seer-backend/src/seer_backend/ai/gateway.py`
7. `docs/product-specs/assistant-primary-surface.md`
8. `docs/exec-plans/completed/managed-agent-runtime-and-agentic-workflows.md`

**Files Expected To Change**

- `seer-backend/src/seer_backend/ai/ontology_copilot.py`
- `seer-backend/src/seer_backend/api/ontology.py`
- possibly `seer-backend/src/seer_backend/ontology/models.py`
- targeted tests under `seer-backend/tests/`
- this plan file

**Validation**

- `cd /workspaces/seer-python/seer-backend && .venv/bin/pytest tests/test_ai_phase5.py`
- any new targeted copilot/runtime test module added in this phase

**Plan / Docs To Update**

- `Progress`
- `Surprises & Discoveries`
- `Decision Log`
- `Outcomes & Retrospective`
- this phase handoff subsection with `Status`, `Completion Notes`, and `Next Starter Context`

**Deliverables**

- explicit assistant-vs-managed-agent prompt/workflow split on the shared copilot runtime
- no regression to `/assistant` prompt behavior
- targeted regression coverage for prompt separation

**Commit Expectation**

- One phase commit with subject: `Split shared copilot prompt policy for assistant and managed agents`

**Known Constraints / Baseline Failures**

- Do not overwrite unrelated dirty changes in `ontology_copilot.py` or `ontology/service.py`.
- Managed-agent mode must not become a copy of the assistant conversational prompt.

**Status**

Completed on 2026-03-16.

**Completion Notes**

Phase 1 landed the prompt-policy seam inside `OntologyCopilotService` itself by adding `runtime_mode` and `workflow_system_prompt_override`, renaming the existing assistant workflow prompt constant to make its scope explicit, and adding a dedicated managed-agent workflow prompt. No runner migration or `load_action` work landed in this phase.

**Next Starter Context**

Phase 2 should build directly on the new `runtime_mode="managed_agent"` seam in `seer-backend/src/seer_backend/ai/ontology_copilot.py`. The next work should stay inside shared tool/runtime contracts and add managed-agent-visible skill filtering plus production `load_action` without yet moving `seer_backend.agent_orchestration.runner` onto the shared copilot path.

## Phase 2

### Phase Handoff

**Goal**

Implement managed-agent runtime tool policy on the shared copilot path: restricted visible skills plus production `load_action`.

**Scope Boundary**

Stay inside shared tooling/runtime/model contracts and targeted tests. Do not migrate the runner to the new path until these tool semantics are proven.

**Read First**

1. `AGENTS.md`
2. `PLANS.md`
3. `docs/exec-plans/active/managed-agent-copilot-runtime-and-prompt-split.md`
4. `seer-backend/src/seer_backend/ai/assistant_tools.py`
5. `seer-backend/src/seer_backend/ai/skills.py`
6. `seer-backend/src/seer_backend/ai/ontology_copilot.py`
7. `seer-backend/src/seer_backend/actions/service.py`
8. `docs/exec-plans/completed/managed-agent-runtime-and-agentic-workflows.md`

**Files Expected To Change**

- `seer-backend/src/seer_backend/ai/ontology_copilot.py`
- `seer-backend/src/seer_backend/ai/assistant_tools.py`
- possibly `seer-backend/src/seer_backend/ontology/models.py`
- `seer-backend/src/seer_backend/actions/service.py`
- targeted tests under `seer-backend/tests/`
- this plan file

**Validation**

- `cd /workspaces/seer-python/seer-backend && .venv/bin/pytest tests/test_ai_phase5.py tests/test_agent_orchestration_phase3.py`
- any new targeted tests covering skill visibility and `load_action`

**Plan / Docs To Update**

- `Progress`
- `Surprises & Discoveries`
- `Decision Log`
- `Outcomes & Retrospective`
- this phase handoff subsection with `Status`, `Completion Notes`, and `Next Starter Context`

**Deliverables**

- managed-agent visible-skill allowlist
- hard exclusion of `process-mining` and `root-cause` from managed-agent mode
- production `load_action` tool support
- targeted tests for tool visibility and action-tool behavior

**Commit Expectation**

- One phase commit with subject: `Add managed-agent skill gating and load_action tool`

**Known Constraints / Baseline Failures**

- `load_action` must use the shared action control plane rather than direct bespoke runner code.
- Managed-agent runtime policy must remain narrower than `/assistant`.

**Status**

Completed on 2026-03-16.

**Completion Notes**

Phase 2 kept the shared copilot loop intact and added the managed-agent runtime policy on top of it: runtime-specific skill filtering, disallowed-skill blocking, production `load_action`, transcript-reconstructable loaded action tools, and child action submission with preserved `parent_execution_id`. The Seer-owned runner itself still has not been migrated onto this path.

**Next Starter Context**

Phase 3 should wire `seer-backend/src/seer_backend/agent_orchestration/runner.py` onto the new managed-agent copilot path by passing `runtime_mode="managed_agent"`, the managed-agent workflow prompt override, an `ActionsService` runtime for `load_action`, and an execution context carrying the parent run's `user_id` / `action_id`. The plan-opening edit in `docs/exec-plans/active/index.md` is still controller-owned worktree state and should be handled alongside archive/index cleanup at the end of Phase 3 rather than absorbed into a phase-scoped backend commit.

## Phase 3

### Phase Handoff

**Goal**

Move the Seer-owned managed-agent runner onto the shared copilot path, ratify docs/specs, validate end-to-end behavior, and archive the plan.

**Scope Boundary**

Runner integration, regression coverage, canonical doc/spec updates, final validation, and archive/index work. Only make additional shared-runtime changes here if a Phase 1 or 2 gap blocks integration.

**Read First**

1. `AGENTS.md`
2. `PLANS.md`
3. `docs/exec-plans/active/managed-agent-copilot-runtime-and-prompt-split.md`
4. `seer-backend/src/seer_backend/agent_orchestration/runner.py`
5. `seer-backend/tests/test_managed_agent_runner.py`
6. `docs/product-specs/managed-agentic-workflows.md`
7. `docs/product-specs/action-orchestration-backend-service.md`
8. `DESIGN.md`
9. `ARCHITECTURE.md`

**Files Expected To Change**

- `seer-backend/src/seer_backend/agent_orchestration/runner.py`
- targeted backend tests under `seer-backend/tests/`
- `DESIGN.md`
- `ARCHITECTURE.md`
- `docs/product-specs/managed-agentic-workflows.md`
- `docs/product-specs/action-orchestration-backend-service.md`
- `docs/product-specs/managed-agent-controls-and-approvals.md`
- `docs/exec-plans/active/index.md`
- `docs/exec-plans/completed/README.md`
- move this plan to `docs/exec-plans/completed/`

**Validation**

- `cd /workspaces/seer-python/seer-backend && .venv/bin/ruff check src/seer_backend/ai src/seer_backend/agent_orchestration tests/test_ai_phase5.py tests/test_agent_orchestration_phase3.py tests/test_managed_agent_runner.py`
- `cd /workspaces/seer-python/seer-backend && .venv/bin/pytest tests/test_ai_phase5.py tests/test_agent_orchestration_phase3.py tests/test_managed_agent_runner.py tests/test_agent_orchestration_phase4.py`

**Plan / Docs To Update**

- all living sections
- phase handoff status/completion notes
- active/completed indexes

**Deliverables**

- runner migrated from prompt-only execution to shared copilot execution
- transcript/tool activity persisted through the managed-agent path
- canonical docs/specs updated to match delivered behavior
- archived completed plan

**Commit Expectation**

- One phase commit with subject: `Move managed-agent runner onto shared copilot runtime`

**Known Constraints / Baseline Failures**

- Preserve `/assistant` behavior while changing managed-agent execution internals.
- Do not archive until docs/specs and validation evidence are current.

**Status**

Pending.
