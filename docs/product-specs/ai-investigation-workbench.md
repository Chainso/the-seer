# AI Investigation Workbench

**Status:** completed (`delivered workbench snapshot; active `/assistant` supersession in progress`)
**Owner plan:** `docs/exec-plans/completed/ai-investigation-workbench-execution.md`
**Active supersession plan:** `docs/exec-plans/active/assistant-conversation-canvas-and-skills.md`
**Last updated:** 2026-03-07

---

## Current Status

This spec captures the delivered AI investigation workbench behavior that shipped under the archived workbench execution plan.

It is not the forward product target for `/assistant`.

The active `/assistant` redesign now lives in `docs/exec-plans/active/assistant-conversation-canvas-and-skills.md`, which restores a canonical conversational assistant contract and adds dynamic skill loading plus an optional right-side artifact canvas.

---

## What This Is

This spec defines the delivered workbench-first analytics experience that temporarily became Seer's primary `/assistant` surface.

The core idea is simple:

1. the user asks a business question in plain language,
2. Seer investigates using ontology and operational history,
3. Seer calls analytical tools when useful,
4. and Seer returns findings with evidence, caveats, and recommended next actions.

This is not a "chatbot on top of dashboards."

It was the delivered default investigation workflow for the initial workbench track.

## Why It Exists

Today many operational tools make the user do the analytical setup work:

1. pick the right dataset,
2. choose the right drill-down,
3. configure the right filters,
4. infer the right business entities,
5. and decide which analytics method to run.

Seer should take on more of that burden.

The workbench exists so the user can start from intent, not from analytics mechanics.

## Core User Promise

If the user can describe an operational question, Seer should be able to:

1. understand the business entities involved,
2. inspect relevant evidence,
3. choose the right analytical path,
4. explain what it found,
5. make uncertainty visible,
6. and propose a next action or managed-agent follow-up when appropriate.

## Primary Users

1. operations leaders,
2. analysts,
3. operations managers,
4. and domain experts who need answers without manually building every analysis path.

## Source Inputs

The workbench may use:

1. ontology context from Prophet plus Seer extensions,
2. immutable event history,
3. immutable object history,
4. event-object relationships,
5. process-mining results,
6. root-cause results,
7. current action and managed-agent state,
8. and prior investigation context in the current thread/session.

## Primary User Flow

1. User opens the primary investigation surface.
2. User asks a question in business language.
3. Seer resolves the question against ontology concepts, recent context, and available evidence sources.
4. If needed, Seer asks a small number of clarifying questions.
   Clarifying turns should collect missing anchor-object and time-window scope without breaking the active investigation thread.
5. Seer begins investigating and shows what it is checking in plain language.
6. Seer may:
   - query history,
   - inspect object timelines,
   - compare cohorts,
   - run process mining,
   - run RCA,
   - inspect current agent or action state.
7. Seer returns a markdown-first investigation answer with:
   - concise narrative summary,
   - semantic evidence, caveat, next-action, follow-up, and linked-surface regions when supported,
   - explicit drill-down links into expert surfaces,
   - and lightweight clarification controls when missing scope needs a rerun.
8. User can continue the conversation, refine the question, or launch a follow-up action/agent flow.

## Investigation Response Contract

Delivered workbench answers are markdown-first rather than a rigid field-by-field schema.

The stable V1 contract is:

1. Narrative markdown answer content.
2. Optional semantic blocks:
   - `:::evidence`
   - `:::caveat`
   - `:::next-action`
   - `:::follow-up`
   - `:::linked-surface`
3. Typed linked-surface metadata that mirrors rendered drill-down targets so deep links remain dependable.
4. Clarifying turns that reuse the same thread and render follow-up/caveat semantics without forcing a wizard-specific payload.

Plain markdown remains a valid fallback when only part of the semantic block set is present.

## Evidence UX Expectations

The workbench must make it clear:

1. what evidence was used,
2. what Seer inferred,
3. what remains uncertain,
4. and where the user can verify the conclusion.

Evidence examples:

1. object cohorts,
2. trace samples,
3. metric shifts,
4. event counts,
5. process path dominance,
6. top RCA factors,
7. current action or agent state.

## Caveat UX Expectations

The workbench should explicitly say when:

1. evidence is weak,
2. data coverage is partial,
3. the answer is associative rather than causal,
4. time-window assumptions matter,
5. or action recommendations exceed current runtime guardrails.

## Relationship To Expert Surfaces

Expert surfaces still matter.

The workbench must be able to hand off into:

1. ontology exploration,
2. history inspection,
3. process mining,
4. RCA,
5. action status,
6. and managed-agent operations.

Those handoffs should carry the resolved investigation scope when Seer has it.

If Seer cannot safely infer a specific history object or there is no dedicated live action-status page yet, the handoff must still land on a real expert surface and say what the user needs to verify next.

Those handoffs are for verification and deeper analysis, not because the default experience failed.

## AI Behavior Expectations

The investigation AI should:

1. prefer ontology-grounded interpretation over string matching,
2. prefer direct evidence over generic language-model guessing,
3. use tools when needed rather than pretending certainty,
4. keep analytical explanations concise but inspectable,
5. and propose execution paths only when they are clearly tied to the evidence.

## Acceptance Expectations

1. A user can start from a natural-language business question without preselecting a specific analytics module.
2. Seer can investigate using ontology and history before asking the user to manually configure process or RCA controls.
3. Investigation responses include evidence and caveats for analytical claims.
4. The surface exposes a clear handoff into expert drill-down modules when deeper inspection is needed.
5. Follow-up questions preserve investigation context rather than restarting from scratch.
6. Recommended actions and managed-agent suggestions are clearly distinguished from established facts.
7. Clarifying turns collect missing scope with lightweight controls and allow the user to rerun the investigation in the same thread.

## Out Of Scope For This Spec

1. Additional route aliases and detailed page-layout variants beyond the delivered `/assistant` workbench surface.
2. Final prompt/runtime implementation.
3. Final auth and multi-tenant policy model.
4. Final authz and approval flows for execution-triggering recommendations.

## Follow-On Questions

1. When should the workbench ask clarifying questions versus making a best-effort investigation directly?
2. How much of the internal investigation plan should be visible to the user?
3. When should Seer automatically suggest a managed agent instead of a one-off action?
4. What is the minimum expert evidence set required before recommending execution?
