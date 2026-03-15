# Execution Plans

`PLANS.md` is the canonical source for how Seer execution plans are written, maintained, executed, and archived.

Use this file together with `AGENTS.md`. `AGENTS.md` tells contributors where repository truth lives. `PLANS.md` tells contributors what a valid execution plan must contain and how that plan must stay current while work is in flight.

## Purpose

An execution plan is a checked-in markdown document that lets a contributor deliver a multi-step change from the current working tree with minimal outside context. A good plan explains why the work matters, what files and commands are involved, how to prove the result works, and how another contributor can safely resume if work stops midway.

In this repository, execution plans live under `docs/exec-plans/active/` while work is in progress and move to `docs/exec-plans/completed/` when acceptance is met and recorded.

## Non-Negotiable Requirements

Every execution plan in Seer must satisfy all of the following:

1. It is self-contained. A contributor should be able to open the plan and understand the goal, relevant repository context, exact files to edit, exact commands to run, and what success looks like without relying on prior chat context.
2. It is a living document. The plan must be updated as progress is made, discoveries occur, validation runs complete, and design decisions change.
3. It is outcome-focused. The plan must describe what a human can observe after the work lands, not only what code structures will exist.
4. It is novice-guiding. If a term of art is necessary, define it in plain language and tie it to the actual files, modules, pages, or commands in this repository.
5. It is resume-safe. If execution stops, the next contributor must be able to continue from the plan and the working tree without guessing what happened.

## Repository Workflow

When work is multi-step or spans more than one tightly related edit, create or update a plan under `docs/exec-plans/active/` before making substantial changes.

The default lifecycle is:

1. Create or update an active plan in `docs/exec-plans/active/`.
2. Update `docs/exec-plans/active/index.md` so the active plan is discoverable.
3. Execute one phase at a time unless the plan explicitly authorizes safe parallel work with disjoint scope.
4. Keep the plan current while the work proceeds.
5. When acceptance is met, move the plan to `docs/exec-plans/completed/`.
6. Update indexes and any references that still point at the active-path location.
7. Record intentionally deferred work in `docs/exec-plans/tech-debt-tracker.md` when appropriate.

## Required Sections

Every active execution plan must contain the following sections with these exact headings unless a stronger repository convention supersedes them:

### Purpose / Big Picture

Explain why the work matters from a user or operator perspective. State what someone can do after the change that they could not do before, and how they can see it working.

### Progress

This section is mandatory and must use checklist items. It is the authoritative current-state ledger for the plan. Every stopping point must leave this section truthful, even if that means splitting a line into completed versus remaining work.

Prefer timestamped entries so later contributors can reconstruct execution order and pace.

### Surprises & Discoveries

Capture unexpected behavior, failed assumptions, performance tradeoffs, library quirks, or pre-existing failures that materially affect the work. Include concise evidence such as a command result, test name, or file reference.

### Decision Log

Record important decisions made while executing the plan. Each entry must include the decision, the rationale, and the date and author.

### Outcomes & Retrospective

Summarize what was achieved, what remains open, and any lessons learned when a phase closes or when the full plan completes.

### Context and Orientation

Describe the current state relevant to the task as if the reader knows nothing. Name the key repository paths, modules, routes, or scripts. If the plan depends on another checked-in plan, restate the needed context here instead of assuming the reader already knows it.

### Plan of Work

Describe, in prose, the sequence of edits and additions. Name the files and the parts of those files that matter. Resolve major ambiguities in the plan instead of pushing those decisions onto the implementer.

### Concrete Steps

List the exact commands to run, including the working directory when it matters. When a command has an important observable result, include a short expected transcript or summary so the reader can compare.

### Validation and Acceptance

Describe how to prove the change works. Phrase acceptance as observable behavior, targeted test results, or precise command outcomes. If failures are already known before the work starts, record them explicitly so later validation can classify them as pre-existing or regressions.

### Idempotence and Recovery

Explain how to retry the steps safely and how to recover if a phase stops halfway. If an operation is risky or destructive, describe the safe fallback or rollback path.

### Artifacts and Notes

Keep the most useful small transcripts, diffs, examples, or path references here. This section should help the next contributor orient quickly without scanning the full repository again.

### Interfaces and Dependencies

Name the important modules, services, APIs, commands, or traits/interfaces involved in the change. Be prescriptive about what should exist at the end of the work when that matters.

## Writing Standard

Use plain prose first. Lists are acceptable where they improve clarity, but the plan should read like a guided implementation document rather than a sparse checklist.

Prefer observable language:

- good: "After running `cd seer-ui && npm run build`, the build completes without contract errors."
- weak: "Build support added."

Name repository-relative paths precisely. Name functions, modules, routes, and scripts precisely when they matter.

Do not rely on external blogs, prior chat messages, or undocumented historical context. If knowledge is required to execute the plan, write that knowledge into the plan.

Do not use undefined jargon. If a non-obvious term is necessary, define it immediately in plain language and anchor it to this repository.

## Formatting Rules

Execution plans checked into this repository are plain markdown files. Do not wrap the whole file in a single outer code fence.

Use normal markdown headings. Use fenced code blocks or indented blocks only for short commands, transcripts, or snippets that materially help execution or validation.

Keep headings readable and stable. If you add extra sections beyond the required ones, do not rename or omit the required living sections.

## Maintenance Rules During Execution

Keeping the code current is not enough. Keeping the plan current is also part of the work.

When progress changes, update `Progress`.

When you learn something unexpected, update `Surprises & Discoveries`.

When you resolve an ambiguity or choose between meaningful implementation options, update `Decision Log`.

When a phase or the full plan closes, update `Outcomes & Retrospective`.

When a phase's worker brief changes or new resume context appears, update that phase's `Phase Handoff` subsection.

If a design choice changes the meaning of another section, update that section too. Do not leave the plan internally inconsistent.

## Milestones and Phases

Break larger efforts into phases or milestones that are independently verifiable. Each phase should say what will exist at the end of that phase, what commands to run, and what evidence proves the phase is done.

Default to one phase in progress at a time. If phases can safely run in parallel, the plan must say why the scopes do not conflict and what evidence each parallel lane must return.

Prototype or spike phases are acceptable when they reduce uncertainty. Label them clearly as prototyping, define the proof you need, and state the conditions for promoting or discarding the prototype.

For any multi-phase plan, each phase must include a `Phase Handoff` subsection. Treat this as the durable worker brief for that phase. A controller prompt may restate or compress it, but the prompt is not the canonical source of truth; the checked-in plan is.

Each `Phase Handoff` subsection must include, at minimum:

1. `Goal`
2. `Scope Boundary`
3. `Read First`
4. `Files Expected To Change`
5. `Validation`
6. `Plan / Docs To Update`
7. `Deliverables`
8. `Commit Expectation`
9. `Known Constraints / Baseline Failures`

As execution proceeds, update the phase handoff with the dynamic state that the next contributor would need to resume cleanly. This usually includes:

1. `Status`
2. `Completion Notes`
3. `Next Starter Context`

Keep the handoff capsule compact. It should contain the facts needed to execute or resume the phase, not a full transcript of every action taken.

## Validation and Evidence

Validation is required for every plan. At minimum, plans must identify:

1. the commands to run,
2. the working directory,
3. the expected result,
4. any known pre-existing failures that should not be treated as regressions.

When validation output matters, record concise evidence in the plan itself or in the phase report so the next contributor can tell what happened without rerunning everything blindly.

## Relationship To Skills

`plan-and-execute` is the controller skill. It should read `PLANS.md`, create or update the active plan, maintain each phase's `Phase Handoff` subsection before delegation, manage sequencing, verify evidence, and close/archive the plan lifecycle.

`execute-phase` is the worker skill. It should read `PLANS.md` and the assigned active plan, use the assigned phase's `Phase Handoff` subsection as the worker brief, stay within the assigned scope, keep the plan's living sections current, capture evidence and surprises, update the handoff capsule with completion state, and return exact results to the controller.

The skills should not redefine the structure of an execution plan. `PLANS.md` is the single source of truth for plan contents.

## Archive Requirements

Before moving a plan from `docs/exec-plans/active/` to `docs/exec-plans/completed/`, confirm all of the following:

1. acceptance has been met or any remaining gap is explicitly documented,
2. the living sections reflect the final state,
3. `docs/exec-plans/active/index.md` no longer presents the plan as active,
4. `docs/exec-plans/completed/README.md` or another relevant completed-plan index includes the archived file,
5. references to the active-path location are updated if the completed path matters.

## Minimal Quality Bar

A plan is healthy only when these are all true:

1. The plan can be read without prior chat context.
2. The next contributor can identify the current phase and remaining work from `Progress`.
3. Decisions and unexpected findings are recorded in the plan instead of living only in tool output.
4. Acceptance is described in terms of observable behavior or concrete validation results.
5. The plan can survive interruption without becoming misleading.
6. In a multi-phase plan, each phase's `Phase Handoff` subsection is accurate enough for a worker to resume from the checked-in plan alone.
