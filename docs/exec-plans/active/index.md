# MVP Phase Execution Index

**Status:** Canonical per-phase execution map  
**Date:** 2026-02-23  
**Parent roadmap:** `/home/chanzo/code/large-projects/seer-python/docs/exec-plans/active/mvp-roadmap-2026.md`

---

## Purpose

This file defines the sequential phase order for MVP delivery.

Each phase is owned by a different agent and must run in strict sequence.

## Execution Rules

1. Exactly one phase can be `in_progress` at a time.
2. Each phase has a unique `agent slot` owner.
3. A phase may start only after the predecessor phase is marked complete.
4. Handoff artifacts listed in the predecessor plan are mandatory inputs for the next phase.
5. If a blocker changes product/design/architecture truth, update `VISION.md`, `DESIGN.md`, or `ARCHITECTURE.md` before proceeding.

## Sequence

1. Phase 0: `/home/chanzo/code/large-projects/seer-python/docs/exec-plans/completed/mvp-phase-0-foundation-skeleton.md` (`agent_slot: A1`, completed)
2. Phase 1: `/home/chanzo/code/large-projects/seer-python/docs/exec-plans/completed/mvp-phase-1-ontology-copilot-v1.md` (`agent_slot: A2`, completed)
3. Phase 2: `/home/chanzo/code/large-projects/seer-python/docs/exec-plans/completed/mvp-phase-2-event-history-ingestion.md` (`agent_slot: A3`, completed)
4. Phase 3: `/home/chanzo/code/large-projects/seer-python/docs/exec-plans/completed/mvp-phase-3-process-mining-ocpn.md` (`agent_slot: A4`, completed)
5. Phase 4: `/home/chanzo/code/large-projects/seer-python/docs/exec-plans/completed/mvp-phase-4-root-cause-analysis-v1.md` (`agent_slot: A5`, completed)
6. Phase 5: `/home/chanzo/code/large-projects/seer-python/docs/exec-plans/completed/mvp-phase-5-ai-hardening-release.md` (`agent_slot: A6`, completed)

## Shared Handoff Contract

Every completed phase must provide:

1. `Completion summary`: what was delivered versus planned scope.
2. `Acceptance evidence`: command outputs, test results, and screenshots where relevant.
3. `Doc updates`: list of changed docs and why.
4. `Known issues`: blockers, deferred work, and risk notes.
5. `Next-phase starter context`: exact pointers to code paths, APIs, and fixtures needed by the next phase.

## Status Tracking

Use this checklist to track phase completion in order:

- [x] Phase 0 complete
- [x] Phase 1 complete
- [x] Phase 2 complete
- [x] Phase 3 complete
- [x] Phase 4 complete
- [x] Phase 5 complete

Current execution state:
- `in_progress`: none (MVP phase sequence complete as of 2026-02-22)

## Phase 5 Kickoff Checklist

- [x] Phase 4 completion summary and evidence package available.
- [x] RCA API contract + InsightResult schema handed off.
- [x] Root-Cause Lab UI and AI-assist starter context documented.
- [x] Integrated cross-module AI hardening execution started.

---

## Post-MVP Active Plans

1. None currently.

## Post-MVP Status Tracking

- [x] UI Experience Replatform complete
- [x] Ontology Copilot OpenAI client migration complete

Current post-MVP execution state:

- `in_progress`: none
- `completed`: `/home/chanzo/code/large-projects/seer-python/docs/exec-plans/completed/ui-experience-replatform-2026.md` (all phases complete as of 2026-02-22)
- `completed`: `/home/chanzo/code/large-projects/seer-python/docs/exec-plans/completed/post-mvp-ontology-copilot-openai-client-migration.md` (all phases complete as of 2026-02-23)
