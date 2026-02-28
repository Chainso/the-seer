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

## Step 1: Define The Phase Map

Create or update an execution plan doc that includes:

1. Objective and invariant(s).
2. Numbered phases with explicit scope boundaries.
3. Exit criteria per phase.
4. Validation commands per phase.
5. Required documentation updates.
6. Progress checklist and decision log.
7. Explicit UI/backend legacy behavior removals and rationale.

Rules:

1. One phase in progress at a time.
2. Later phases cannot start until current phase commit is verified.

## Step 2: Build A Phase Handoff Packet

Before spawning each worker, include:

1. Work-so-far summary (commits + files + current plan state).
2. Initial lookup list (exact files to read first).
3. Phase-only scope constraints.
4. Required outputs:
   - code changes,
   - tests/validation evidence,
   - plan/doc updates,
   - commit hash.
5. Explicit instruction to ignore unrelated edits and never revert others' work.

Template snippet:

```text
Work-so-far summary:
- Phase N-1 commit: <hash>
- Files landed: ...
- Plan status: ...

Initial lookup (required):
1) ...
2) ...

Phase N goals:
- ...

Scope constraints:
- ...
- no default legacy-compatibility retention for UI/backend behavior

Validation required:
- <commands>

Plan/doc update required:
- <exact file + expected updates>

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
4. Plan doc updated with dated progress/decision entry.
5. Phase checkbox/status updated accurately.

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
3. Move active plan to completed (if lifecycle requires).
4. Update active/completed indexes.
5. Verify links and status coherence.

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
   - Worker report must include: changed files, validation output summary, exact plan updates, commit hash.
   - Controller verifies with local git/log/test checks before advancing.

5. Plan-log discipline:
   - One dated decision/progress entry per phase completion.
   - Include rationale for any accepted pre-existing failures.

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

If any condition fails, phase remains open.
