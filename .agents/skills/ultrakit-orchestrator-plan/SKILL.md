---
name: ultrakit:orchestrator:plan
description: >
  Planning stage for ultrakit. Writes the execution plan after discovery is complete
  and prepares the work for execution approval.
---

# Planning Stage

You are in the planning stage of the pipeline. Discovery is complete. You have resolved all architectural and design decisions. Now write the execution plan.

Do not write implementation code during this stage.

## Read First

Read `.ultrakit/notes.md` before drafting the plan. Use it for durable project or user preferences, not task-state.

Read `.ultrakit/exec-plans/plan-contract.md` before writing the plan. It defines the required sections, maintenance rules, and quality bar.

## Creating the Plan

### 1. Choose a Filename

Use a descriptive kebab-case name: `.ultrakit/exec-plans/active/<feature-name>.md`

### 2. Write the Required Sections

Follow the plan contract. Every section marked as required must be present. Key sections to get right:

**Purpose / Big Picture**: Write this from the user's perspective. What can they do after this work that they cannot do now?

**Backward Compatibility**: Record what you resolved during discovery. Explicit statement of whether backward compat is required and what the constraints are.

**Design Decisions**: Record every architectural and pattern decision from discovery. Each entry needs: the decision, the rationale, alternatives considered, and the date. These are the decisions that constrain workers. Workers should never need to revisit these.

**Context and Orientation**: Write this for someone with zero context. Name the exact files, modules, and patterns that matter. If a worker needs to understand something to do their job, it goes here.

**Plan of Work**: Describe the sequence in prose. This is the narrative of what will happen and why, in order.

### 3. Define Phase Boundaries

This is the most important part of planning. Each phase must satisfy the granularity constraint: **completable by a single agent within its context window**.

Rules for phase boundaries:

- Each phase has a single clear goal
- Each phase produces a testable, committable result
- Each phase's scope can be understood by reading its Phase Handoff subsection alone
- Phases are ordered so later phases can build on earlier ones
- If a phase seems too large, split it. Err on the side of smaller phases.

Common phase patterns:

- **Foundation phases**: Set up infrastructure, create types/interfaces, establish patterns
- **Implementation phases**: Build one feature or component per phase
- **Integration phases**: Wire components together
- **Validation phases**: End-to-end testing, performance verification
- **Documentation phases**: Update developer docs, user docs, and skills (always last)

### 4. Write Phase Handoffs

For each phase, write a `Phase Handoff` subsection. This is the durable worker brief. The plan contract specifies the required fields:

1. `Goal` — one sentence, what this phase delivers
2. `Scope Boundary` — what is in scope and explicitly what is NOT
3. `Read First` — exact files the worker should read before coding
4. `Files Expected To Change` — specific file paths
5. `Validation` — exact commands to run and what success looks like
6. `Plan / Docs To Update` — which plan sections the worker must update
7. `Deliverables` — what the worker must produce
8. `Commit Expectation` — commit subject line
9. `Known Constraints / Baseline Failures` — what the worker should expect to fail or work around

Make handoffs prescriptive. The worker should be able to execute from the handoff alone without making design decisions. If a handoff requires the worker to choose between approaches, the plan is not detailed enough — resolve it now.

### 5. Run a Baseline

Before execution begins, run the project's broad test, lint, and build commands once. Record known pre-existing failures in the plan so workers can distinguish regressions from baseline noise.

### 6. Register the Plan

Update `.ultrakit/exec-plans/active/index.md` to include the new plan.

## Present to the User

Before beginning execution, present the plan to the user. Show:

1. The overall goal and approach
2. The phase sequence with one-line summaries
3. The key design decisions and their rationale
4. The backward compatibility stance
5. How many phases there are and roughly what each delivers

Get explicit approval before moving to execution. The user should understand what is about to happen and agree with the approach.

## Transition to Execution

Once the user approves the plan, use `ultrakit:orchestrator:execute` and begin the execute-review-fix loop.
