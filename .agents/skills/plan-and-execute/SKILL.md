---
name: plan-and-execute
description: Plan work and execute it end-to-end with clear phases, strict handoffs, validation gates, and documentation updates. Use this whenever a user asks to plan out work and then execute it, prioritizing the best current UI and backend outcomes over legacy compatibility.
---

# Plan And Execute

Use this skill when the user wants:

1. A concrete implementation plan before coding.
2. Execution immediately after planning (single-phase or multi-phase).
3. Worker-agent delegation with controlled sequencing when scope is large.
4. Strong handoffs, validation gates, and phase-level commits.
5. Plan/doc updates as part of delivery, not an afterthought.

Read `AGENTS.md` and `PLANS.md` before creating or revising an execution plan. `PLANS.md` is the canonical source for plan structure and maintenance rules. This skill governs controller behavior, not the plan document format.

## Compatibility Stance

1. Default to forward-only delivery: do not preserve legacy implementation behavior unless explicitly requested.
2. Choose the best current UX, backend contracts, and invariant-aligned behavior, even when it differs from legacy flows.
3. If a tradeoff is required, document why the new behavior is superior and what legacy behavior is intentionally dropped.

## Agent Roles

1. The main agent is the orchestrator (controller), not the primary implementer.
2. The orchestrator owns phase planning, worker handoffs, gating, verification, and user status updates.
3. Workers own only their assigned phase scope and must report deliverables/evidence back to the orchestrator.
4. Keep execution sequential by default: one worker-active phase at a time unless the plan explicitly authorizes safe parallelism.

## Core Workflow

## Step 1: Create Or Refresh The Active Plan

Create or update a plan under `docs/exec-plans/active/` that conforms to `PLANS.md`.

At minimum, verify that the plan already contains or is updated to contain:

1. the required living sections from `PLANS.md`,
2. the relevant repository context and file paths,
3. numbered phases or milestones with explicit scope boundaries,
4. a `Phase Handoff` subsection for each phase in a multi-phase plan you intend to execute,
5. validation and acceptance guidance,
6. idempotence and recovery guidance,
7. required documentation updates,
8. explicit legacy behavior removals and rationale when behavior changes.

Rules:

1. One phase in progress at a time.
2. Later phases cannot start until current phase evidence is verified.
3. Update `docs/exec-plans/active/index.md` when a new active plan is opened or its status changes materially.

## Step 2: Build A Phase Handoff Packet

Before spawning each worker, refresh the assigned phase's `Phase Handoff` subsection in the plan. If it is missing required fields from `PLANS.md`, repair it before delegation. The worker prompt is a projection of that checked-in handoff capsule, not an independent source of truth.

Before spawning each worker, include:

1. Work-so-far summary (commits + files + current plan state).
2. Plan path and explicit instruction to read `PLANS.md` plus the active plan first.
3. Initial lookup list (exact files to read first).
4. Phase-only scope constraints.
5. Reference to the exact `Phase Handoff` subsection to execute.
6. Required outputs:
   - code changes,
   - tests/validation evidence,
   - plan/doc updates,
   - commit hash.
7. Exact plan sections that must be updated during the phase.
8. Explicit instruction to ignore unrelated edits and never revert others' work.

Template snippet:

```text
Work-so-far summary:
- Phase N-1 commit: <hash>
- Files landed: ...
- Plan status: ...

Read first:
- AGENTS.md
- PLANS.md
- <active plan path>
- <Phase Handoff subsection location>

Initial lookup (required):
1) ...
2) ...

Phase Handoff:
- Goal: ...
- Scope Boundary: ...
- Read First: ...
- Files Expected To Change: ...
- Validation: ...
- Plan / Docs To Update: ...
- Deliverables: ...
- Commit Expectation: ...
- Known Constraints / Baseline Failures: ...

Scope constraints:
- ...
- no default legacy-compatibility retention for UI/backend behavior

Git requirements:
- stage only phase-relevant files
- commit message: <subject>
```

## Step 3: Spawn One Worker Per Phase

1. Spawn `worker` for implementation.
2. Wait long enough for completion.
3. Do not interrupt unless the worker is clearly stuck or off-scope.
4. If interrupted/failure occurs, recover partial state before respawning.

## Step 4: Monitor And Gate

After each worker run, verify locally:

1. Commit exists and message matches phase intent.
2. Only expected files changed.
3. Required tests ran (or failures documented as pre-existing).
4. Plan doc updated with dated `Progress`, `Decision Log`, and any newly relevant `Surprises & Discoveries` or `Outcomes & Retrospective` entries required by `PLANS.md`.
5. The assigned `Phase Handoff` subsection reflects the actual phase state, including status and next-starter context when relevant.
6. Other plan sections remain internally consistent after the phase changes.
7. Phase checkbox/status updated accurately.

If a gate fails, spawn a phase-finisher worker with only the gap list.

## Step 5: Close And Transition

1. Close completed worker agent.
2. Update user with phase result.
3. Spawn next phase worker with refreshed summary.

Repeat until all phases are complete.

## Step 6: Final Ratification Phase

For workflows that change behavior/invariants, final phase must:

1. Update canonical product/design/architecture docs.
2. Update relevant specs.
3. Update active/completed indexes.
4. Confirm the plan's living sections reflect final state.
5. Verify links and status coherence.

## Step 7: Archive The Plan

When the plan lifecycle is complete:

1. Move the finished plan from `docs/exec-plans/active/` to `docs/exec-plans/completed/`.
2. Update all references that still point to the active-path location.
3. Confirm completed indexes include the moved file and active indexes no longer list it as active.

## Critical Improvements To Apply (Based On Real Execution)

1. Baseline failure ledger first:
   - Run broad test/lint/build once early.
   - Record known unrelated failures in plan log.
   - Require workers to reference that ledger to avoid repeated ambiguity.

2. Stronger interruption policy:
   - Avoid routine status-check interrupts.
   - Prefer passive waiting unless off-track evidence exists.
   - If interrupted, immediately harvest partial artifacts (`git status`, changed files, diffs) before respawn.

3. Gap-focused retries:
   - Retry workers should receive only unresolved gaps, not full phase scope.
   - Prevent duplicated work and drift.

4. Mandatory phase-close proof:
   - Worker report must include: changed files, validation output summary, exact plan updates, exact `Phase Handoff` updates, commit hash.
   - Controller verifies with local git/log/test checks before advancing.

5. Plan-log discipline:
   - One dated decision/progress entry per phase completion.
   - Include rationale for any accepted pre-existing failures.
   - Capture surprises and final outcomes in the plan, not only in agent chat.

6. Cleaner validation strategy:
   - Require targeted tests every phase.
   - Require full-suite checks at milestone phases (e.g., phase 1, phase 3/4, final).
   - This reduces noisy repetition while maintaining confidence.

7. Use awaiter for long waits/tests:
   - For long-running commands/monitoring, route through an `awaiter` agent so controller remains responsive and avoids premature interruptions.

## Quality Bar

A phase is complete only when all are true:

1. Scope-deliverables done.
2. Validation evidence provided.
3. Plan/doc updates made.
4. Commit created.
5. Controller verification passes.
6. Legacy behavior removals are documented for both UI and backend impact.
7. The active plan remains resume-safe and internally consistent per `PLANS.md`.
8. The assigned `Phase Handoff` subsection is accurate enough for the next worker to resume from the plan alone.

If any condition fails, phase remains open.
