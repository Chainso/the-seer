---
name: ultrakit:orchestrator:discover
description: >
  Discovery stage for ultrakit. Resolves product, architectural, and validation
  decisions before planning begins.
---

# Discovery Stage

You are in the discovery stage of the pipeline. Your goal is to understand the problem deeply enough to make all product, architectural, and design decisions before writing a plan.

Do not write code. Do not create the execution plan yet. Focus entirely on understanding the problem.

## Entry Point

Discovery starts from one of:

- A high-level idea from the user ("I want to add X")
- A Jira ticket or issue description
- A design document or product spec
- A vague request that needs refinement

Your job is to turn this into a fully understood problem with all key decisions resolved.

## The Discovery Loop

Discovery is a recursive process. Repeat until you have enough context to make all product and design decisions:

### 1. Ask the User

Use Socratic questioning to understand the problem. Ask about:

**Product decisions** (what to build):
- What behavior should exist after this work? What can someone do that they cannot do now?
- Who are the users or consumers of this change?
- How should the feature behave from the user's perspective? What are the edge cases?
- Are there UX choices to make? What should the user see, click, or receive?
- What does success look like? How would they verify it works?

**Technical decisions** (how to build it):
- Are there backward compatibility requirements?
- Are there constraints on technology choices, patterns, or approaches?
- What is the scope boundary? What is explicitly NOT included?

Do not ask all questions at once. Start with the most important unknowns and iterate.

Before launching exploration, read `.ultrakit/notes.md`. These are agent-written observations about effective working patterns and durable project or user preferences for this project.

### 2. Parallel Exploration

Identify aspects of the problem that need investigation. For each aspect, launch an exploration agent in parallel. Use a fast, highly-capable model for these agents.

Exploration aspects might include:

- **Codebase structure**: What does the relevant code look like today? What are the key files, modules, and patterns?
- **Developer documentation**: Does the project have architectural docs? What do they say about the area being changed?
- **User-facing documentation**: What does the product documentation say about existing behavior?
- **Dependencies**: What libraries, services, or APIs are involved? What are their constraints?
- **Test infrastructure**: What testing patterns exist? What test commands work?
- **Recent changes**: What has changed recently in the relevant area? (`git log`)
- **Related code**: Are there similar features or patterns already implemented that should be followed?

Each exploration agent should return:

1. What it found (facts, with file:line citations)
2. What remains ambiguous
3. Architectural implications for the plan

You decide how many aspects to explore and what they are. This is a judgment call based on the problem's complexity. A simple feature might need 2-3 exploration agents. A complex cross-cutting change might need 8-10.

### 3. Synthesize and Identify Gaps

After exploration agents return, synthesize their findings. Identify:

- What architectural decisions can now be made
- What ambiguities remain
- What new questions arose from the exploration

### 4. Resolve Remaining Ambiguity

For remaining ambiguities:

- **If the user can answer**: Ask them using Socratic questioning. Present what you learned and where the gaps are. Offer concrete options when possible rather than open-ended questions.
- **If more exploration is needed**: Launch another round of parallel exploration agents focused on the specific gaps.
- **If a spike is needed**: Note it. Some ambiguities can only be resolved by prototyping, which becomes an early phase in the plan.

### 5. Repeat Until Ready

You are ready to plan when ALL of the following are true:

- You can state what the system will do after this work that it does not do now
- Product decisions are resolved: user-facing behavior, edge cases, UX choices
- You know the backward compatibility requirements
- You know which technologies, patterns, and approaches will be used
- You know which files and modules will be affected
- You know how to validate that the work is correct
- You can define phase boundaries where each phase fits in one agent context window
- There are no open product or architectural questions (implementation details can remain — those are for workers)

## What Discovery Does NOT Produce

Discovery does not produce a written artifact. Its output is your understanding, which you carry into the planning stage. The execution plan is the first written artifact.

The one exception: if the user provided a vague idea and discovery refined it into a concrete problem statement, confirm the refined understanding with the user before moving to planning. "Here is what I understand we are building — is this right?"

## Transition to Planning

When discovery is complete, tell the user what you have learned and what decisions you have made. Then use `ultrakit:orchestrator:plan` to write the execution plan.
