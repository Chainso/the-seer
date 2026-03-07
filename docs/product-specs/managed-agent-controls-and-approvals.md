# Managed Agent Runtime Controls

**Status:** draft  
**Owner plan:** `docs/exec-plans/active/ai-first-investigation-and-managed-agents.md`  
**Last updated:** 2026-03-07

---

## What This Is

This spec defines the user-facing control surface for operating managed agents safely in the current trusted-mode phase.

If the previous spec is about creating and activating agents, this spec is about trust:

1. what an agent is configured to do,
2. what it already did,
3. which runtime limits constrain it,
4. and how a user stays in control after activation.

## Why It Exists

Managed agents are only useful if users trust them enough to let them operate.

That trust does not come from model quality claims alone.

In the current phase, that trust comes from product controls such as:

1. visibility,
2. runtime guardrails,
3. audit trails,
4. pause/resume/revoke controls,
5. and evidence for important decisions.

## Core User Promise

At any point, the user should be able to answer:

1. what is this agent trying to do,
2. what has it done recently,
3. what is it waiting on,
4. what can it do next,
5. and how do I stop or constrain it?

## Primary User Flows

### Inspect Guardrail Event

1. User opens the managed-agent operations surface.
2. User sees that an agent stopped, deferred, or failed because of a runtime guardrail.
3. The guardrail event shows:
   - agent identity,
   - attempted action or step,
   - target business object(s),
   - rationale,
   - evidence summary,
   - triggered limit or stop condition.
4. User can:
   - inspect the run,
   - adjust runtime settings,
   - retry,
   - or pause/revoke the agent.

### Inspect Agent Run History

1. User opens one managed agent.
2. User sees:
   - objective,
   - current lifecycle state,
   - recent decisions,
   - executed actions,
   - outcomes,
   - failures,
   - guardrail events.
3. User can inspect the evidence behind a major decision.

### Change Runtime Controls

1. User updates runtime settings.
2. User narrows or expands:
   - allowed actions,
   - budget/cadence settings,
   - step/time/retry limits,
   - or stop conditions.
3. Seer records the change and applies it to future decisions.

### Emergency Stop

1. User pauses or revokes the agent.
2. No new autonomous actions are started after the pause/revoke is acknowledged.
3. The UI makes it clear whether in-flight work still needs cleanup or follow-up.

## Control Surface Requirements

The control surface should expose:

1. current lifecycle state,
2. recent guardrail events,
3. last meaningful action,
4. last meaningful evidence set,
5. current runtime guardrails,
6. trusted-mode execution state,
7. pause/resume/revoke controls,
8. and outcome summaries.

## Trusted-Mode Scope

This spec does not define final organizational authz or approval workflows.

Current phase assumptions:

1. Seer runs in a trusted/internal environment.
2. Managed agents operate with runtime guardrails rather than finalized role-based authorization.
3. Final authz and approval semantics are intentionally deferred.

## Audit UX Requirements

Users should be able to reconstruct the agent's behavior over time.

Audit records should show:

1. investigation steps that materially informed a decision,
2. recommended actions,
3. executed actions,
4. guardrail-triggered stops or failures,
5. returned results,
6. failures and retries,
7. policy changes,
8. and user interventions.

## Default Safety Posture

The draft product direction assumes trusted-mode execution plus conservative runtime guardrails.

Examples:

1. agents should not silently expand their allowed action set,
2. long-running or looping behavior should be bounded by runtime limits,
3. low-confidence recommendations should not auto-execute,
4. and users should be able to pause an agent quickly from multiple surfaces.

## Relationship To Investigation UX

The product should connect investigation and control.

That means:

1. a user can promote a repeated investigation pattern into a managed agent,
2. a user can inspect an agent's reasoning as an investigation thread,
3. and a user can jump from a guardrail-triggered stop into the evidence that led to it.

## Acceptance Expectations

1. Users can inspect recent agent decisions without reading raw logs.
2. Users can see when runtime guardrails stopped, deferred, or constrained an agent.
3. Users can pause, resume, or revoke an agent from the control surface.
4. Runtime guardrails are visible and editable after activation.
5. Audit history is sufficient to explain what happened to a non-author of the agent.
6. The control model is understandable to someone who does not already know Seer's internal architecture.

## Out Of Scope For This Spec

1. Final organization/role model for authz or approvals.
2. Final alerting and notification channels.
3. Final storage schema for audit records.
4. Final legal/compliance packaging.

## Open Questions

1. Which runtime guardrails are essential before platform authz exists?
2. Which guardrail events need dedicated UX versus just audit logging?
3. How should pause versus revoke semantics differ for in-flight work?
4. How much of an agent's internal reasoning should be visible by default?
