# Execution Plan Policy And Skill Alignment

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document is maintained in accordance with `PLANS.md` from the repository root.

## Purpose / Big Picture

Seer already uses checked-in execution plans, but the repository does not yet have one canonical file that defines what a valid plan must contain or how agents should keep plans current while implementing work. After this change, a contributor should be able to open `PLANS.md`, understand the required structure of an execution plan, then use the `plan-and-execute` and `execute-phase` skills without conflicting instructions. The result should be observable by reading `PLANS.md`, `AGENTS.md`, the two skill files, and the execution-plan directory docs and seeing that they all point at the same rules.

## Progress

- [x] 2026-03-15 00:00Z Reviewed current execution-plan lifecycle docs, `plan-and-execute`, and `execute-phase` to identify where repo policy exists today and where it is missing.
- [x] 2026-03-15 00:10Z Added canonical `PLANS.md` at the repository root with the required execution-plan sections, writing rules, maintenance rules, validation expectations, and archive requirements.
- [x] 2026-03-15 00:12Z Updated `AGENTS.md` and `docs/exec-plans/README.md` so the repository points contributors to `PLANS.md` as the plan-content authority.
- [x] 2026-03-15 00:14Z Rewrote `.agents/skills/plan-and-execute/SKILL.md` as a controller workflow that defers plan structure to `PLANS.md` while preserving phase gating, handoff packets, and archive flow.
- [x] 2026-03-15 00:16Z Updated `.agents/skills/execute-phase/SKILL.md` so worker agents read `PLANS.md`, maintain the required living sections, capture exact validation evidence, and preserve resume-safe plan state.
- [x] 2026-03-15 00:20Z Validated link coherence, updated active/completed indexes, and archived this plan to `docs/exec-plans/completed/`.

## Surprises & Discoveries

- Observation: The repository already behaves as if a `PLANS.md`-style contract exists, but that contract is spread across `AGENTS.md`, `docs/exec-plans/README.md`, and plan-by-plan habits instead of one canonical file.
  Evidence: `AGENTS.md` requires active plans and living updates, while newer completed plans independently contain validation ledgers, decision logs, and progress sections.

- Observation: The current `plan-and-execute` skill is stronger on orchestration than on document format, while `execute-phase` is stronger on scope discipline than on maintaining a plan as a fully self-contained recovery artifact.
  Evidence: `.agents/skills/plan-and-execute/SKILL.md` emphasizes handoffs and gating; `.agents/skills/execute-phase/SKILL.md` asks workers to update the plan, but does not name the canonical living sections or recovery expectations.

- Observation: The first validation pass exposed that `PLANS.md` described the living sections with code-formatted subsection titles, which made a heading-based grep check weaker than intended.
  Evidence: `rg -n "^## (Progress|Surprises & Discoveries|Decision Log|Outcomes & Retrospective)" PLANS.md docs/exec-plans/active/execution-plan-policy-and-skill-alignment.md` matched only the execution plan file before the headings in `PLANS.md` were normalized to plain subsection names.

## Decision Log

- Decision: Introduce `PLANS.md` as a repository-root canonical source instead of embedding the full plan spec inside a skill file.
  Rationale: Plan structure is repository policy, while skills should focus on how agents operate against that policy.
  Date/Author: 2026-03-15 / Codex

- Decision: Keep both `plan-and-execute` and `execute-phase`, but narrow their responsibilities around `PLANS.md`.
  Rationale: The controller and worker workflows are still useful, but they should stop duplicating plan-format rules that belong in one source of truth.
  Date/Author: 2026-03-15 / Codex

- Decision: Keep checked-in Seer execution plans as normal markdown files rather than adopting an outer single-fenced-block format.
  Rationale: The repository already stores plans as plain markdown documents, and preserving that format keeps the plan files readable in GitHub and consistent with the existing `docs/exec-plans/` corpus while still adopting the stronger self-contained and living-document requirements.
  Date/Author: 2026-03-15 / Codex

## Outcomes & Retrospective

- Outcome: Added `PLANS.md` as the canonical repository execution-plan contract, then aligned `AGENTS.md`, `docs/exec-plans/README.md`, `.agents/skills/plan-and-execute/SKILL.md`, and `.agents/skills/execute-phase/SKILL.md` to use it as the single source of truth for plan contents.
- Outcome: Preserved the useful split between controller and worker skills instead of collapsing all execution guidance into repository-global instructions.
- Lesson: The repo already had strong execution-plan habits, so the highest-value change was not inventing a new workflow; it was centralizing those habits and tightening the skill boundaries around them.
- Remaining gaps: No automated checker exists yet to enforce `PLANS.md` compliance across active plans; `AGENTS.md` now marks that as mechanical-enforcement intent rather than implemented tooling.

## Context and Orientation

Execution-plan lifecycle guidance currently lives in several places.

`AGENTS.md` is the repository entry map. It already says multi-step work must have a checked-in plan under `docs/exec-plans/active/`, that active plans are living documents, and that completed plans move to `docs/exec-plans/completed/`.

`docs/exec-plans/README.md` describes the execution-plan directory layout and basic workflow, but it does not define the full structure or writing standard of an execution plan.

`.agents/skills/plan-and-execute/SKILL.md` tells a controller agent how to sequence phases, build worker handoffs, and verify completion. `.agents/skills/execute-phase/SKILL.md` tells a worker agent how to stay inside a phase boundary and report back. Neither file should be the canonical definition of what an execution plan document must contain.

For this work, "living sections" means the parts of a plan that must be revised as work proceeds so another contributor can resume from only the plan file and the current working tree. The target living sections are `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective`.

## Plan of Work

First, add `PLANS.md` at the repository root. This file will define the required shape of any execution plan in this repository. It must combine the current Seer execution-plan lifecycle with the stronger self-contained and novice-guiding expectations discussed for ExecPlans. It should explicitly define the mandatory living sections, observable acceptance language, validation expectations, idempotence/recovery guidance, and how plans relate to `docs/exec-plans/active/` and `docs/exec-plans/completed/`.

Next, update `AGENTS.md` so `PLANS.md` appears in the canonical-source order and in the execution-plan lifecycle guidance. This keeps the repository table of contents aligned with the new root policy. Update `docs/exec-plans/README.md` so contributors entering the execution-plan directory see `PLANS.md` named as the plan-content authority.

Then rewrite `.agents/skills/plan-and-execute/SKILL.md` to stop specifying plan document structure directly. The skill should instruct the controller to read `AGENTS.md` and `PLANS.md`, create or update an active plan, keep one phase in progress at a time, build worker handoff packets, verify evidence locally, and close/archive the plan lifecycle.

Finally, update `.agents/skills/execute-phase/SKILL.md` so worker agents explicitly read `PLANS.md`, maintain the required living sections in the assigned plan, record discoveries and validation evidence in the plan itself, preserve a resume-safe state if interrupted, and report exact evidence back to the controller. After the content changes land, validate that all new references are coherent, then archive this plan and update the active/completed indexes.

## Concrete Steps

From the repository root:

1. Create `PLANS.md` with the canonical execution-plan format and maintenance rules.
2. Update `AGENTS.md` to reference `PLANS.md` in canonical sources, execution-plan lifecycle guidance, and skill usage.
3. Update `docs/exec-plans/README.md` to route readers to `PLANS.md`.
4. Update `.agents/skills/plan-and-execute/SKILL.md` to defer plan format to `PLANS.md` and keep only controller workflow guidance.
5. Update `.agents/skills/execute-phase/SKILL.md` to require maintenance of the living sections and evidence/recovery standards from `PLANS.md`.
6. Update `docs/exec-plans/active/index.md` while the plan is active, then move this file to `docs/exec-plans/completed/` and update indexes again when the work is finished.

Expected verification snippets after the edits:

    rg -n "PLANS.md" AGENTS.md docs/exec-plans/README.md .agents/skills/plan-and-execute/SKILL.md .agents/skills/execute-phase/SKILL.md

should show each file pointing to `PLANS.md` with role-appropriate guidance.

    rg -n "^(###|##) (Progress|Surprises & Discoveries|Decision Log|Outcomes & Retrospective)" PLANS.md docs/exec-plans/completed/execution-plan-policy-and-skill-alignment.md

should show the required living sections in both the policy file and this active plan.

## Validation and Acceptance

Acceptance is met when a contributor can read `PLANS.md` and understand how to write and maintain a plan without opening either skill file, and can read the two skill files and see that they clearly defer plan structure to `PLANS.md` while preserving controller-versus-worker responsibilities.

Run the following checks from the repository root:

1. `rg -n "PLANS.md" AGENTS.md docs/exec-plans/README.md .agents/skills/plan-and-execute/SKILL.md .agents/skills/execute-phase/SKILL.md`
2. `rg -n "^(###|##) (Progress|Surprises & Discoveries|Decision Log|Outcomes & Retrospective)" PLANS.md docs/exec-plans/completed/execution-plan-policy-and-skill-alignment.md`
3. `git diff -- AGENTS.md PLANS.md docs/exec-plans/README.md docs/exec-plans/active/index.md docs/exec-plans/completed/README.md .agents/skills/plan-and-execute/SKILL.md .agents/skills/execute-phase/SKILL.md docs/exec-plans/completed/execution-plan-policy-and-skill-alignment.md`

The first check should show aligned references to `PLANS.md`. The second should show the required living sections. The diff should show a coherent single-policy setup rather than duplicated or conflicting guidance.

## Idempotence and Recovery

These edits are documentation-only and are safe to repeat. If work stops midway, the plan must be updated before stopping so the next contributor can tell which files already changed, which sections still need alignment, and whether the plan is still active or ready to archive.

This plan is now archived under `docs/exec-plans/completed/`. Future changes to execution-plan policy should open a new active plan rather than editing the archived lifecycle record in place unless the archival record itself is incorrect.

## Artifacts and Notes

Important repository paths for this task:

    AGENTS.md
    PLANS.md
    docs/exec-plans/README.md
    docs/exec-plans/active/index.md
    .agents/skills/plan-and-execute/SKILL.md
    .agents/skills/execute-phase/SKILL.md

## Interfaces and Dependencies

`PLANS.md` will define the canonical sections and maintenance rules for execution plans in this repository.

`AGENTS.md` must point contributors to `PLANS.md` when work involves execution plans.

`.agents/skills/plan-and-execute/SKILL.md` must remain the controller skill. It should instruct the agent to read `PLANS.md`, manage phase sequencing, create handoff packets, verify evidence, and archive the plan lifecycle.

`.agents/skills/execute-phase/SKILL.md` must remain the worker skill. It should instruct the agent to read `PLANS.md` and the assigned plan, stay within the phase boundary, keep the plan's living sections current, capture evidence and surprises, and return exact validation and commit data to the controller.
