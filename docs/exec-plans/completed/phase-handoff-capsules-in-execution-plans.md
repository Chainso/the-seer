# Phase Handoff Capsules In Execution Plans

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document is maintained in accordance with `PLANS.md` from the repository root.

## Purpose / Big Picture

Seer's execution plans already break work into phases, but the controller-to-worker handoff details still risk living mostly in agent prompts instead of in the checked-in plan. After this change, a contributor should be able to open a multi-phase execution plan and find a compact, durable handoff capsule inside each phase that says what that phase is for, what to read first, what files are expected to change, what validation is required, and what evidence must come back. The result should be observable by reading `PLANS.md`, `plan-and-execute`, and `execute-phase` and seeing that handoff content now belongs in the plan itself.

## Progress

- [x] 2026-03-15 00:30Z Reviewed the current `PLANS.md`, `plan-and-execute`, and `execute-phase` guidance to identify where per-phase handoff information should become a checked-in plan requirement.
- [x] 2026-03-15 00:36Z Updated `PLANS.md` so multi-phase plans require a per-phase `Phase Handoff` subsection with a fixed compact schema and explicit dynamic resume fields.
- [x] 2026-03-15 00:40Z Updated `.agents/skills/plan-and-execute/SKILL.md` so the controller writes or refreshes the phase handoff capsule in the plan before spawning a worker and treats the worker prompt as a projection of that plan content.
- [x] 2026-03-15 00:42Z Updated `.agents/skills/execute-phase/SKILL.md` so the worker reads the assigned phase handoff capsule first and writes completion evidence or starter context back into the plan.
- [x] 2026-03-15 00:46Z Validated coherence, archived this plan to `docs/exec-plans/completed/`, and updated active/completed indexes.

## Surprises & Discoveries

- Observation: The current repository policy already says plans must be self-contained and resume-safe, so leaving phase handoffs only in controller chat is the main remaining gap in that promise for multi-agent work.
  Evidence: `PLANS.md` requires a plan to survive interruption, while `.agents/skills/plan-and-execute/SKILL.md` still describes a handoff packet without explicitly saying the durable source of that packet must live in the plan.

- Observation: Naming the handoff fields only in `PLANS.md` was not enough; the controller template also needed to enumerate them directly or the worker prompt pattern stayed too abstract to use consistently.
  Evidence: The first policy edit added the `Phase Handoff` requirement, and a second pass tightened `.agents/skills/plan-and-execute/SKILL.md` so its handoff template now lists `Goal`, `Scope Boundary`, `Read First`, `Files Expected To Change`, `Validation`, `Plan / Docs To Update`, `Deliverables`, `Commit Expectation`, and `Known Constraints / Baseline Failures`.

## Decision Log

- Decision: Require handoff details as compact per-phase capsules in the plan rather than as one large top-level handoff section.
  Rationale: Handoffs are phase-specific; keeping them inline with each phase preserves local context and reduces drift between the narrative phase description and the worker-facing execution packet.
  Date/Author: 2026-03-15 / Codex

- Decision: Split phase handoff content into required static fields plus lightweight dynamic resume fields rather than turning the handoff subsection into a running log.
  Rationale: The plan already has global living sections for narrative history. The handoff capsule should stay compact and operational, while still carrying `Status`, `Completion Notes`, and `Next Starter Context` when those facts matter for resumption.
  Date/Author: 2026-03-15 / Codex

## Outcomes & Retrospective

- Outcome: `PLANS.md` now requires durable `Phase Handoff` subsections for multi-phase plans and states that controller prompts are projections of those checked-in handoff capsules rather than canonical artifacts.
- Outcome: `plan-and-execute` now requires the controller to repair or refresh the phase handoff capsule before delegation and verify that it remains accurate enough for resumption.
- Outcome: `execute-phase` now requires the worker to read and update the assigned phase handoff capsule, including `Status`, `Completion Notes`, and `Next Starter Context` when relevant.
- Lesson: The most reliable split is to keep facts in the plan and procedures in the skills; once that principle was applied, the handoff design became straightforward.

## Context and Orientation

`PLANS.md` is now the canonical execution-plan contract for this repository. It already requires living sections, validation guidance, and resume-safe plans, but it does not yet explicitly require each phase to carry its own durable handoff block.

`.agents/skills/plan-and-execute/SKILL.md` is the controller workflow. It already tells the controller to build a phase handoff packet, but that packet currently looks like a prompt template rather than a required section of the plan.

`.agents/skills/execute-phase/SKILL.md` is the worker workflow. It already tells the worker to read `PLANS.md` and the assigned plan, but it does not yet tell the worker to treat a phase-local handoff subsection as the authoritative worker brief.

For this work, a "phase handoff capsule" means a compact subsection inside a specific phase that includes the worker-facing execution facts needed to start and complete that phase without relying on outside chat context.

## Plan of Work

First, update `PLANS.md` so the `Milestones and Phases` section requires a `Phase Handoff` subsection for each phase in any multi-phase plan. Define the minimum fields of that subsection: `Goal`, `Scope Boundary`, `Read First`, `Files Expected To Change`, `Validation`, `Plan / Docs To Update`, `Deliverables`, `Commit Expectation`, and `Known Constraints / Baseline Failures`. Also define the dynamic fields the phase should accumulate as work proceeds, such as `Status`, `Completion Notes`, or `Next Starter Context`, without forcing every phase to become a giant transcript.

Next, update `plan-and-execute` so the controller must refresh the phase handoff capsule in the plan before spawning a worker. The skill should say that the worker prompt is a projection of the checked-in handoff capsule rather than a separate canonical artifact.

Then update `execute-phase` so the worker reads the assigned phase's `Phase Handoff` subsection first, uses it as the default execution contract, and writes any resulting evidence, changed assumptions, or next-starter context back into the plan.

Finally, validate the references and archive the finished plan.

## Concrete Steps

From the repository root:

1. Update `PLANS.md` to require per-phase `Phase Handoff` subsections in multi-phase plans.
2. Update `.agents/skills/plan-and-execute/SKILL.md` to require writing or refreshing the phase handoff capsule before worker delegation.
3. Update `.agents/skills/execute-phase/SKILL.md` to require reading and updating the assigned phase handoff capsule.
4. Update `docs/exec-plans/active/index.md` while this plan is active, then archive the plan to `docs/exec-plans/completed/` and update indexes again.

Expected verification snippets:

    rg -n "Phase Handoff|Next Starter Context|Files Expected To Change" PLANS.md .agents/skills/plan-and-execute/SKILL.md .agents/skills/execute-phase/SKILL.md

should show the handoff capsule concept and the core fields in the policy file and both skills.

## Validation and Acceptance

Acceptance is met when `PLANS.md` clearly requires per-phase handoff capsules for multi-phase plans, `plan-and-execute` clearly says the controller must maintain those capsules before worker handoff, and `execute-phase` clearly says the worker must use and update them.

Run the following checks from the repository root:

1. `rg -n "Phase Handoff|Next Starter Context|Files Expected To Change" PLANS.md .agents/skills/plan-and-execute/SKILL.md .agents/skills/execute-phase/SKILL.md`
2. `git diff -- PLANS.md .agents/skills/plan-and-execute/SKILL.md .agents/skills/execute-phase/SKILL.md docs/exec-plans/active/index.md docs/exec-plans/completed/README.md docs/exec-plans/completed/phase-handoff-capsules-in-execution-plans.md`

The grep should show a single coherent handoff model across the canonical policy and both skills. The diff should show that the durable handoff moved into the plan contract rather than remaining an ephemeral controller-only prompt concept.

## Idempotence and Recovery

These edits are documentation-only and safe to repeat. If the work stops midway, update the `Progress` section before stopping so the next contributor can tell whether the active plan has already been reflected into `PLANS.md` and both skills.

This plan is now archived under `docs/exec-plans/completed/`. Future refinements to the handoff schema should open a new active plan rather than editing the archived lifecycle record unless the archival record itself is incorrect.

## Artifacts and Notes

Important repository paths for this task:

    PLANS.md
    .agents/skills/plan-and-execute/SKILL.md
    .agents/skills/execute-phase/SKILL.md
    docs/exec-plans/active/index.md

## Interfaces and Dependencies

`PLANS.md` must define the durable per-phase handoff contract for multi-phase plans.

`.agents/skills/plan-and-execute/SKILL.md` must require the controller to derive worker handoffs from the checked-in phase handoff capsule rather than inventing a separate authoritative prompt.

`.agents/skills/execute-phase/SKILL.md` must require the worker to read and update the phase handoff capsule as part of maintaining the plan.
