# Managed Agentic Workflows

**Status:** draft  
**Owner plan:** `docs/exec-plans/completed/ai-first-investigation-and-managed-agents.md`  
**Last updated:** 2026-03-07

---

## What This Is

This spec defines how Seer should let users register and run managed AI agents.

The key model is:

1. the ontology defines executable workflows and actions,
2. some workflows are agentic and adaptive,
3. Seer runs those workflows inside a managed runtime,
4. and the rest of the platform treats them as executable capabilities.

This is not a low-code workflow builder.

It is a managed-agent product surface built on ontology-defined workflows.

## Why It Exists

Businesses do not only need answers.

They also need persistent operational behavior such as:

1. watching for risk,
2. triaging exceptions,
3. deciding what to do,
4. invoking allowed actions,
5. and reporting outcomes.

That behavior should live in the product as managed agents, not as ad hoc scripts outside the platform.

## Product Model

Managed agentic workflows have three layers:

1. `Ontology-defined workflow capability`
   - source of truth for the executable workflow concept
   - part of the ontology/action catalog
2. `Operating instruction`
   - natural-language guidance describing the objective, priorities, and decision style
3. `Runtime guardrails`
   - execution limits, budgets, stop conditions, and allowed actions/tools

The managed agent is the combination of those layers running in Seer.

## Authoring Boundary

Ontology authoring remains outside Seer.

That means:

1. workflow/action definitions originate in Prophet plus Seer ontology extensions,
2. Seer ingests those definitions,
3. and Seer provides registration, activation, monitoring, and control.

Seer should not require users to build a separate execution graph in the UI.

## Primary User Flow

1. User opens the managed-agent workflow surface.
2. User selects an ontology-defined workflow/action capability to activate as a managed agent.
3. User provides or edits the operating instruction in plain language.
4. User configures runtime guardrails:
   - allowed actions,
   - allowed evidence/tools,
   - budget, cadence, and step limits,
   - stop conditions,
   - success criteria.
5. Seer shows a clear preview of what the agent can do.
6. User activates the managed agent.
7. Seer runs the agent over time:
   - inspect evidence,
   - decide next steps,
   - invoke allowed actions,
   - track outcomes.
8. User monitors current state, recent decisions, guardrail events, and business results.

## Agent Runtime Expectations

The managed agent should be able to:

1. inspect object and event history,
2. use analytical tools such as process mining and RCA when helpful,
3. invoke ontology-defined actions within its runtime guardrails,
4. adapt to new evidence,
5. explain what it did and why,
6. and stop or defer when confidence or runtime limits require it.

## What Seer Must Persist

1. ontology workflow/action identity,
2. current instruction text,
3. runtime guardrail configuration,
4. current lifecycle state,
5. run history,
6. executed actions,
7. evidence used for major decisions,
8. and outcome metrics.

## What Seer Must Not Require

1. A compiled DAG as the canonical representation.
2. A separate action registry detached from the ontology.
3. Manual flowchart authoring as the default setup path.

## Relationship To The Ontology

The ontology is the capability catalog.

That means:

1. atomic actions and agentic workflows are both discoverable through ontology concepts,
2. typing and produced-event expectations come from ontology definitions,
3. Seer runtime guardrails may further narrow what is allowed,
4. but Seer should not invent a conflicting capability model.

## User Trust Requirements

The product must make the following clear before activation:

1. what the agent is trying to achieve,
2. what evidence it may inspect,
3. what actions it may invoke,
4. how often it runs,
5. what limits can stop it,
6. what success looks like,
7. and how it can be paused or revoked.

## Outcome Expectations

Managed agents are not useful if they only generate logs.

The product should show:

1. what the agent did,
2. what changed in the business,
3. whether the target metric improved,
4. and whether the agent is helping or harming.

## Acceptance Expectations

1. Users can activate ontology-defined workflow capabilities as managed agents without building a separate flow graph.
2. Managed agents can inspect history and invoke allowed ontology-defined actions.
3. Runtime guardrails can narrow execution below the ontology-defined capability envelope.
4. Managed agents expose clear lifecycle state, recent decisions, and guardrail-triggered stops or failures.
5. Managed agents are auditable and can be paused, resumed, or revoked.
6. Managed-agent setup makes the capability and runtime guardrails understandable to a user without ontology expertise.

## Out Of Scope For This Spec

1. Final backend schema for managed-agent runtime state.
2. Final billing, quotas, or multi-tenant packaging.
3. Final UI interaction details for every control.
4. Final ontology extension vocabulary names.

## Open Questions

1. Which parts of the operating instruction belong in ontology versus runtime configuration?
2. How should recurring triggers versus continuous monitoring be expressed in the user experience?
3. How should Seer differentiate "recommended action", "one-off action execution", and "managed agent activation" in the UI?
4. What are the right default runtime limits before platform authz exists?
