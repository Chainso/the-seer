# Assistant Primary Surface

**Status:** completed
**Owner plan:** `docs/exec-plans/completed/assistant-conversation-canvas-and-skills.md`
**Last updated:** 2026-03-08

---

## What This Is

This spec defines the current `/assistant` product surface.

`/assistant` is Seer's primary AI-first investigation experience:

1. one conversational assistant thread,
2. one canonical `completion_messages` contract,
3. dynamic skill loading when the task needs deeper capability,
4. and an optional attached canvas for inspectable artifacts such as OC-DFG.

This replaces the delivered workbench-first `/assistant` snapshot documented separately in `ai-investigation-workbench.md`.

## Core User Promise

The user should be able to:

1. ask a business question in plain language,
2. receive an evidence-grounded conversational answer,
3. let Seer decide when to load deeper analytical capability,
4. inspect visual artifacts without leaving the conversation,
5. and continue the same thread while the canvas stays attached.

## Primary Interaction Model

1. `/assistant` opens as a calm full-width conversation surface by default.
2. The assistant starts with lightweight ontology grounding and ontology tools only.
3. If the task requires deeper capability, the assistant calls `load_skill`.
4. Skill activation expands instructions and tool access in the same thread rather than switching routes or protocols.
5. Tool results may create typed artifacts.
6. The assistant may present those artifacts in the right-side canvas through canvas tools.
7. The conversation remains primary while the canvas is open.

## Conversation Contract

The canonical durable state is the saved conversation history.

The stable contract is:

1. `completion_messages` as the assistant thread source of truth,
2. ordinary assistant/tool messages for skill activation, domain tool calls, artifact creation, and canvas actions,
3. markdown-first assistant responses, including semantic `:::` blocks where trust or drill-down semantics matter.

The assistant should not rely on a second workflow-specific response protocol for `/assistant`.

## Skill Loading Expectations

The assistant must:

1. begin generic,
2. unlock deeper capability only when relevant,
3. keep skill activation visible through normal tool history,
4. and preserve the same conversation thread while skills are loaded.

Initial delivered skill families are:

1. process mining,
2. root cause,
3. object history,
4. object store,
5. and deep ontology guidance.

## Canvas Expectations

Canvas behavior is tool-driven, not markdown-driven.

Delivered expectations:

1. desktop `/assistant` opens a right-side split canvas when an artifact is presented,
2. the thread shrinks but remains fully usable,
3. canvas state is derived from persisted tool history,
4. the assistant can present, update, or close the canvas in-thread.

Mobile and compact variants may fall back to an inline compact canvas treatment when a desktop split is not appropriate.

## Delivered Artifact Coverage

Current delivered artifact behavior:

1. `ocdfg` renders with the shipped OC-DFG graph component in the desktop canvas,
2. `rca` renders with the shared RCA results surface used by `/inspector/insights`,
3. `object-timeline` renders with the shared object-history display surface used by `/inspector/history/object`,
4. `ontology-graph` renders with the shared ontology explorer display used by `/ontology/[tab]`,
5. other artifact families currently use the generic artifact panel,
6. non-visual artifact fallback remains available even when no specialized renderer exists.

## Acceptance Expectations

1. `/assistant` uses one conversational assistant contract based on `completion_messages`.
2. The assistant starts generic and ontology-grounded.
3. The assistant can dynamically load skills to expand tools and instructions.
4. The assistant can open a right-side canvas without leaving the thread.
5. Canvas state is driven by tool calls/results stored in the conversation history.
6. Desktop OC-DFG artifacts render with the existing Seer graphing component.
7. `/assistant` keeps a calmer generic assistant identity instead of the earlier workbench dashboard treatment.
