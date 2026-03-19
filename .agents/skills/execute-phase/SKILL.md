---
name: execute-phase
description: "Use this skill when you are a worker/subagent responsible for one bounded phase from an existing execution plan. Do not use this skill to create the plan, sequence phases, or decide cross-phase strategy. That remains the controller's job. Use this for worker/subagent delivery when the phase already has a handoff packet, required files, validation commands, documentation targets, and a commit expectation."
---

# Execute Phase

Use this skill when you are a worker/subagent responsible for one bounded phase from an existing execution plan.

Do not use this skill to create the plan, sequence phases, or decide cross-phase strategy. That remains the controller's job.

Read `PLANS.md` and the assigned active execution plan before editing. `PLANS.md` is the canonical source for what the plan must contain and how its living sections must be maintained.

## Required Inputs

Before you start, make sure the handoff includes:

1. Phase goal and scope boundary.
2. Plan path and the exact `Phase Handoff` subsection you own.
3. Exact files to inspect first.
4. Validation commands.
5. Required doc or plan updates.
6. Commit expectation and subject line.

If any of these are missing, infer the smallest safe assumption and continue unless the gap makes the phase unsafe. If the assigned `Phase Handoff` subsection is present but missing fields required by `PLANS.md`, repair the subsection in the plan before or while executing the phase.

## Worker Rules

1. Stay inside the assigned phase scope.
2. Do not revert unrelated working tree changes.
3. Do not preserve legacy UI or backend behavior by default unless the handoff explicitly says to.
4. Prefer the best current UX, contract clarity, and product correctness over compatibility inertia.
5. Read `PLANS.md`, the assigned plan, and the named files first before editing.
6. Preserve the plan as a resume-safe document. If you change the meaning of the work, update all affected plan sections, not only the log.
7. Treat the assigned `Phase Handoff` subsection as the authoritative worker brief unless the controller explicitly updates it.

## Execution Workflow

1. Inspect the handoff files and confirm the phase boundary.
2. Read the assigned phase's `Phase Handoff` subsection first, then read the active plan's `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Validation and Acceptance` sections before making changes.
3. Implement the phase changes.
4. Update the referenced plan doc while working:
   - `Progress`,
   - `Surprises & Discoveries` for unexpected findings, pre-existing failures, or evidence that changed the approach,
   - `Decision Log` for meaningful implementation decisions,
   - `Outcomes & Retrospective` when the phase or a major milestone closes.
5. Update the assigned `Phase Handoff` subsection so it reflects the actual phase state. If the scope, expected files, validation, or constraints changed, correct the handoff capsule itself instead of leaving it stale.
6. Add `Status`, `Completion Notes`, and `Next Starter Context` to the handoff capsule when they become relevant to phase closure or resumption.
7. Update any other affected plan sections if the implementation changed scope, acceptance, commands, or recovery guidance.
8. Update any required canonical docs/specs in the same change if behavior changed.
9. Run the required validation commands and capture exact evidence.
10. Stage only the files relevant to this phase.
11. Create the requested commit.

## Validation Evidence Rules

When reporting validation, include:

1. the exact command that ran,
2. whether it passed or failed,
3. the short output or result that matters,
4. whether any failure is newly introduced or already recorded in the plan's baseline ledger or discoveries.

If you discover a new pre-existing failure or an unexpected behavior that affects the phase, record it in the plan before finishing.

## Validation Bar

Treat the phase as incomplete unless all of the following are true:

1. The scoped code/doc changes are landed.
2. Required validation ran, or failures are explicitly identified as pre-existing/unrelated.
3. Plan/doc updates are included when required.
4. The assigned `Phase Handoff` subsection matches the actual state of the phase.
5. The plan remains internally consistent and resume-safe after your edits.
6. The commit was created successfully.

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
2. Validation results with exact commands and outcomes.
3. Plan/doc updates made, including which living sections were updated and how the `Phase Handoff` subsection changed.
4. Commit hash.
5. Any residual risks, follow-up gaps, or newly recorded discoveries.
