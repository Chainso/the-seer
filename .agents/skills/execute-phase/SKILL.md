---
name: execute-phase
description: Execute one scoped implementation phase from an existing execution plan. Use this for worker/subagent delivery when the phase already has a handoff packet, required files, validation commands, documentation targets, and a commit expectation.
---

# Execute Phase

Use this skill when you are a worker/subagent responsible for one bounded phase from an existing execution plan.

Do not use this skill to create the plan, sequence phases, or decide cross-phase strategy. That remains the controller's job.

## Required Inputs

Before you start, make sure the handoff includes:

1. Phase goal and scope boundary.
2. Exact files to inspect first.
3. Validation commands.
4. Required doc or plan updates.
5. Commit expectation and subject line.

If any of these are missing, infer the smallest safe assumption and continue unless the gap makes the phase unsafe.

## Worker Rules

1. Stay inside the assigned phase scope.
2. Do not revert unrelated working tree changes.
3. Do not preserve legacy UI or backend behavior by default unless the handoff explicitly says to.
4. Prefer the best current UX, contract clarity, and product correctness over compatibility inertia.
5. Read the named files first before editing.

## Execution Workflow

1. Inspect the handoff files and confirm the phase boundary.
2. Implement the phase changes.
3. Update the referenced plan doc while working:
   - progress log,
   - decision log,
   - phase checklist/status.
4. Update any required canonical docs/specs in the same change if behavior changed.
5. Run the required validation commands.
6. Stage only the files relevant to this phase.
7. Create the requested commit.

## Validation Bar

Treat the phase as incomplete unless all of the following are true:

1. The scoped code/doc changes are landed.
2. Required validation ran, or failures are explicitly identified as pre-existing/unrelated.
3. Plan/doc updates are included when required.
4. The commit was created successfully.

## Git Rules

1. Use non-interactive git commands only.
2. Stage only phase-relevant files.
3. Do not amend existing commits unless explicitly instructed.
4. Do not create a vague commit message.
5. For non-trivial work, include a commit body covering:
   - what changed,
   - why,
   - impact areas.

## Final Report Back To Controller

Return:

1. Changed files.
2. Validation results.
3. Plan/doc updates made.
4. Commit hash.
5. Any residual risks or follow-up gaps.
