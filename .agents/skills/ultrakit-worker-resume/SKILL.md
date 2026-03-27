---
name: ultrakit:worker:resume
description: >
  Regather context and continue work after context loss (compaction, session restart,
  or handoff from another agent). Use this skill when you are a worker agent resuming
  a phase that was started but not completed by a previous agent or session.
---

# Resume Phase

You are a worker agent resuming a phase that was started but not completed. A previous agent (or your prior session) was implementing this phase and lost context. Your job is to regather context from the plan and working tree, then continue where the previous work left off.

## When This Applies

- Your session was compacted and you lost context mid-implementation
- You are a new agent spawned to continue a partially completed phase
- The orchestrator told you to resume using this skill

## Resume Protocol

### 1. Read the Plan

Read `.ultrakit/notes.md` first for durable project or user preferences.

Read the execution plan's `Phase Handoff` subsection for your assigned phase. Look for:

- **Status**: Is it marked in-progress? Partially complete?
- **Completion Notes**: What was already done?
- **Next Starter Context**: What did the previous agent leave for you?

Then read the previous phase's `Phase Handoff` for continuity.

### 2. Spawn a Context Subagent

Spawn a subagent to read the full execution plan and return:

- The overall plan objective (one paragraph)
- The full `Progress` section showing what is complete vs remaining
- `Surprises & Discoveries` entries relevant to your phase
- `Design Decisions` entries that constrain your phase
- `Execution Log` entries from your phase (decisions already made)
- `Validation and Acceptance` criteria for your phase
- Known baseline failures

### 3. Check the Working Tree

Examine the current state of the code:

- `git status` — what files are modified, staged, or untracked?
- `git log --oneline -5` — what were the recent commits? Did the previous agent commit anything?
- `git diff` — what uncommitted changes exist?

Read the files listed in the handoff's `Files Expected To Change`. Compare their current state to the phase deliverables. Identify what is done vs what remains.

### 4. Validate Current State

Run the phase's validation commands against the current state. This tells you whether the work so far passes or fails, and helps you understand what still needs to be done.

### 5. Identify Remaining Work

From steps 1-4, determine:

- What deliverables are complete
- What deliverables remain
- Whether any previous work needs to be corrected
- Whether the phase handoff is still accurate or needs updating

### 6. Continue Implementation

Continue with the normal implementation workflow from the `ultrakit:worker:implement` skill. You now have enough context to pick up where the previous agent left off.

If the phase handoff is outdated (e.g., expected files have changed, validation commands are different), update it as part of your work.

## Rules

1. Trust the plan over any chat memory. The plan is the source of truth.
2. Trust `git log` and `git status` over assumptions about what was done.
3. Do not redo work that is already committed and passing validation.
4. If the previous agent's partial work is broken or going in the wrong direction, report this to the orchestrator rather than silently fixing it.
5. Update the plan's living sections with what you discover during resume.
