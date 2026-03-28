# Assistant, Actions, And Managed Agents

## Purpose

Describe how assistant investigation, generic action execution, and managed-agent orchestration share runtime infrastructure while keeping clear ownership boundaries.

This doc is for engineers who need to reason about AI runtime modes, transcript persistence, execution governance, and how these systems fit together.

## Shared Runtime Principle

Seer does not maintain completely separate platforms for conversational investigation and managed-agent execution.

Instead, the system reuses a shared copilot/runtime foundation with different policy modes:

1. assistant investigation mode,
2. workbench-style investigation mode,
3. and managed-agent execution mode.

The mode changes prompts, tool policy, and governance expectations. It does not change the core idea that AI behavior is grounded in ontology and history.

## Assistant Investigation

The assistant domain owns conversational investigation.

Its key responsibilities are:

1. accepting persisted completion-message history,
2. loading deeper skills only when needed,
3. packaging evidence and caveats,
4. and emitting tool-driven artifact contracts for UI canvas rendering.

Assistant investigation is user-driven and conversational. It is not a background execution plane.

## Generic Actions

The `actions` domain is the generic control plane for executable ontology-backed capabilities.

It owns:

1. submit-time ontology validation,
2. queueing and dedupe,
3. leasing and heartbeat semantics,
4. completion/failure callbacks,
5. and retry/dead-letter lifecycle behavior.

This plane is intentionally generic. It exists whether or not the action is executed by a managed agent.

## Managed Agents

Managed agents are ontology-defined actions executed by Seer in a bounded runtime.

The important architectural point is that a managed-agent run is still an action record in the shared control plane.

What `agent_orchestration` adds is:

1. Seer-owned claiming for managed-agent runs,
2. transcript persistence,
3. execution-detail composition,
4. produced-event provenance,
5. and audit-oriented inspection contracts.

## Transcript And Resume Semantics

Canonical transcript state is append-only completion-message history stored outside volatile executor memory.

That enables:

1. inspection of what happened,
2. replay/resume from persisted state,
3. alignment between UI-visible audit history and backend runtime behavior,
4. and a stable contract between managed-agent execution and assistant-style message tooling.

## Governance Boundary

Runtime governance stays on the backend.

That includes:

1. tool access policy,
2. managed-agent versus assistant prompt differences,
3. self-recursive guardrails,
4. lease ownership,
5. and terminal-state transitions.

The UI can inspect these outcomes, but it should not own or duplicate the policy.

## Risks Of Misunderstanding

1. Treating managed agents as a separate workflow platform obscures their dependence on the shared actions plane.
2. Treating assistant completion history as a UI-only artifact obscures its role as canonical transcript state for execution inspection and resume.
3. Treating AI mode differences as separate products leads to unnecessary duplication of runtime plumbing.
4. Treating tool policy as a frontend concern weakens execution governance and auditability.

## Extension Guidance

1. Add new execution-safe capability through the shared ontology and actions model first.
2. Add new managed-agent behavior in `agent_orchestration` only when it changes transcript, execution, or audit semantics beyond generic actions.
3. Add new assistant-facing skills and artifacts in the AI layer when they extend investigation rather than execution governance.
4. Update this doc when runtime ownership or transcript semantics change, not when a single prompt or tool is tweaked.
