---
name: ultrakit:worker:implement
description: >
  Execute one bounded phase from an existing execution plan. Do not use this skill
  to create plans, sequence phases, or decide cross-phase strategy. Use this when
  you are a worker agent responsible for implementing a single phase with a handoff
  packet, required files, validation commands, and a commit expectation.
---

# Implement Phase

You are a worker agent responsible for implementing one bounded phase from an execution plan.

Do not create plans, sequence phases, or make architectural decisions. The orchestrator handles those. You implement, validate, update the plan, and commit.

## Required Inputs

The orchestrator provides:

1. Phase goal and scope boundary
2. Plan path and the exact `Phase Handoff` subsection you own
3. Exact files to inspect first
4. Validation commands
5. Required plan section updates
6. Commit expectation and subject line

If any of these are missing, infer the smallest safe assumption and continue unless the gap makes the phase unsafe.

## Execution Workflow

### 1. Gather Context

Read `.ultrakit/notes.md` first for durable project or user preferences.

Read your assigned phase's `Phase Handoff` subsection in full. Then read the previous phase's `Phase Handoff` for continuity.

Spawn a subagent to read the full execution plan and return a focused context summary. The subagent should return:

- The overall plan objective (one paragraph)
- Relevant `Progress` entries for the current phase
- `Surprises & Discoveries` entries that affect the current phase
- `Design Decisions` entries that constrain the current phase
- `Execution Log` entries from previous phases that carry forward
- `Validation and Acceptance` criteria that apply to the current phase
- Cross-phase dependency notes (outputs from earlier phases this one relies on)
- Known baseline failures affecting this phase

Do not read the entire plan yourself. The subagent absorbs the full document so you stay focused on your phase.

### 2. Read the Required Files

Read the files listed in the handoff's `Read First` field. Then read any additional files you need to understand the current state of the code you will change.

### 3. Implement

Implement the phase changes. Follow these rules:

- Stay inside the assigned phase scope. Do not make changes outside the boundary.
- Do not revert unrelated working tree changes.
- Do not make architectural decisions. If you face an architectural choice, stop and report it as a blocker. The orchestrator will resolve it.
- Follow existing code patterns and conventions in the repository.
- Write tests for new behavior. Tests should verify behavior, not implementation details.

### 4. Update the Plan

While working, update these plan sections:

- **Progress**: Mark completed items, add timestamped entries for work done.
- **Execution Log**: Record any granular implementation decisions with rationale.
- **Surprises & Discoveries**: Record unexpected findings, pre-existing failures, or evidence that changed the approach.
- **Outcomes & Retrospective**: Update when the phase closes.

Update the assigned `Phase Handoff` subsection so it reflects the actual phase state. Add:

- **Status**: Current state of the phase
- **Completion Notes**: What was done and how
- **Next Starter Context**: What the next phase worker needs to know

### 5. Validate

Run the validation commands from the handoff. For each command, record:

1. The exact command that ran
2. Whether it passed or failed
3. The short output or result that matters
4. Whether any failure is newly introduced or a known baseline failure

If you discover a new pre-existing failure, record it in `Surprises & Discoveries`.

### 6. Commit

Stage only the files relevant to this phase. Create the commit with the subject line from the handoff. For non-trivial work, include a commit body covering what changed, why, and impact areas.

Use non-interactive git commands only. Do not amend existing commits unless explicitly instructed.

## Completion Obligation

You own full delivery of the assigned phase, not just context gathering.

After the read-first pass, continue through implementation, validation, plan updates, and commit creation. Do not stop after a read-only exploration pass.

A return to the orchestrator is only acceptable when:

1. The phase is fully implemented, validated, documented in the plan, and committed, OR
2. There is a specific blocker with exact evidence, affected files/commands, and the smallest remaining gap the orchestrator must resolve.

If the phase is too large to complete in your context window, complete as much as possible, update the plan with what remains, commit what you have, and report back.

## Report Back

Return to the orchestrator:

1. Changed files
2. Validation results with exact commands and outcomes
3. Plan sections updated and how the Phase Handoff changed
4. Commit hash
5. Any residual risks, follow-up gaps, or newly recorded discoveries
