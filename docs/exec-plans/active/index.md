# MVP Phase Execution Index

**Status:** Canonical per-phase execution map  
**Date:** 2026-03-08  
**Parent roadmap:** `docs/exec-plans/completed/mvp-roadmap-2026.md`

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

1. Phase 0: `docs/exec-plans/completed/mvp-phase-0-foundation-skeleton.md` (`agent_slot: A1`, completed)
2. Phase 1: `docs/exec-plans/completed/mvp-phase-1-ontology-copilot-v1.md` (`agent_slot: A2`, completed)
3. Phase 2: `docs/exec-plans/completed/mvp-phase-2-event-history-ingestion.md` (`agent_slot: A3`, completed)
4. Phase 3: `docs/exec-plans/completed/mvp-phase-3-process-mining-ocpn.md` (`agent_slot: A4`, completed)
5. Phase 4: `docs/exec-plans/completed/mvp-phase-4-root-cause-analysis-v1.md` (`agent_slot: A5`, completed)
6. Phase 5: `docs/exec-plans/completed/mvp-phase-5-ai-hardening-release.md` (`agent_slot: A6`, completed)

## Shared Handoff Contract

Every completed phase must provide:

1. `Completion summary`: what was delivered versus planned scope.
2. `Acceptance evidence`: command outputs, test results, and screenshots where relevant.
3. `Doc updates`: list of changed docs and why.
4. `Known issues`: blockers, deferred work, and risk notes.
5. `Next-phase starter context`: exact pointers to code paths, APIs, and fixtures needed by the next phase.
6. `Phase commit`: commit hash for the phase implementation commit (or explicit reason if intentionally deferred).

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

1. none

## Post-MVP Status Tracking

- [x] UI Experience Replatform complete
- [x] Ontology Copilot OpenAI client migration complete
- [x] Old UI adaptation for read-only ontology + process analytics complete
- [x] Adaptive lifecycle label display complete
- [x] Stable URI identifier migration across history/process/RCA complete
- [x] Assistant dedicated page rewrite + surface unification complete
- [x] Ontology-driven field display centralization complete
- [x] Global assistant shell layer + generic AI assistant endpoint complete
- [x] Action orchestration backend service complete
- [x] Devcontainer Codex workspace complete

Current post-MVP execution state:

- `in_progress`: none
- `blocked`: none
- `completed`: `docs/exec-plans/completed/managed-agent-runtime-and-agentic-workflows.md` (archived on 2026-03-08 after completing the Seer ontology extension binding, generic action control-plane reuse, ClickHouse transcript persistence, lineage/provenance fields, dedicated agentic workflow execution APIs/UI surfaces, ontology-aligned execution UX, and final canonical docs/spec ratification)
- `completed`: `docs/exec-plans/completed/backend-frontend-lint-build-stability-2026-03-08.md` (archived on 2026-03-08 after restoring canonical backend/frontend lint and build health; backend Ruff passed after wrapping an overlong ontology copilot validation string, and frontend ESLint passed after replacing the sidebar mount effect with a `useSyncExternalStore` mounted-state pattern)
- `completed`: `docs/exec-plans/completed/assistant-canvas-shared-display-surfaces.md` (archived on 2026-03-08 after extracting shared RCA, object-history, and ontology display surfaces so assistant canvas and expert pages now reuse the same displayed investigation UI while keeping host-specific orchestration separate)
- `completed`: `docs/exec-plans/completed/assistant-conversation-canvas-and-skills.md` (archived on 2026-03-07 after ratifying `/assistant` as the canonical conversational assistant surface with dynamic skill loading, artifact-backed canvas presentation, and OC-DFG canvas rendering)
- `completed`: `docs/exec-plans/completed/ai-investigation-workbench-execution.md` (first workbench delivery archived on 2026-03-07; product/spec ratification completed, and a broader `/assistant` redesign track opened the same day after confirming contract and UI regressions)
- `completed`: `docs/exec-plans/completed/ai-first-investigation-and-managed-agents.md` (product reframing and draft-spec phase closed on 2026-03-07; follow-on execution/runtime planning intentionally deferred)
- `completed`: `docs/exec-plans/completed/responsive-shell-and-mobile-navigation.md` (responsive shell, drawer lifecycle hardening, and mobile shell validation ratified on 2026-03-07)
- `completed`: `docs/exec-plans/completed/analytics-run-results-discoverability.md` (analytics completion summaries and result-reveal behavior ratified on 2026-03-07)
- `completed`: `docs/exec-plans/completed/url-backed-analysis-state.md` (deep-linkable insights state, restore flows, and query normalization ratified on 2026-03-07)
- `completed`: `docs/exec-plans/completed/action-orchestration-backend-service.md` (all phases complete; docs ratified and archived on 2026-03-01)
- `completed`: `docs/exec-plans/completed/assistant-turn-logging-and-zellij-debug-panel.md` (all phases complete; validation/docs/archive ratified on 2026-03-05)
- `completed`: `docs/exec-plans/completed/devcontainer-codex-workspace.md` (container build/docs/archive ratified on 2026-03-06)
- `completed`: `docs/exec-plans/completed/ocdfg-ui-layout-engine-upgrade.md` (all phases complete; validation/docs/archive ratified on 2026-03-01)
- `completed`: `docs/exec-plans/completed/ocdfg-multi-object-depth-scope.md` (all phases complete; ratified and archived on 2026-03-01)
- `completed`: `docs/exec-plans/completed/ocdfg-pm4py-backend-ui-first-diagram.md` (Phases A-C complete; validation/docs/archive ratified on 2026-03-01)
- `completed`: `docs/exec-plans/completed/clickhouse-connect-migration.md` (Phase 6 compliance audit and remediation validated on 2026-03-01)
- `completed`: `docs/exec-plans/completed/object-centric-history-inspector-consolidation.md` (all phases complete and ratified as of 2026-02-28)
- `completed`: `docs/exec-plans/completed/post-mvp-ontology-process-readonly-adaptation.md` (all phases complete and plan closed as of 2026-02-28)
- `completed`: `docs/exec-plans/completed/adaptive-lifecycle-label-display.md` (Phases 1-3 complete and validated as of 2026-02-28)
- `completed`: `docs/exec-plans/completed/stable-identifiers-uri-migration.md` (all phases complete and validated as of 2026-03-01)
- `completed`: `docs/exec-plans/completed/assistant-page-surface-unification.md` (all phases complete as of 2026-02-28)
- `completed`: `docs/exec-plans/completed/assistant-chat-sse-streaming-migration.md` (all phases complete and archived as of 2026-03-01)
- `completed`: `docs/exec-plans/completed/ui-experience-replatform-2026.md` (all phases complete as of 2026-02-22)
- `completed`: `docs/exec-plans/completed/post-mvp-ontology-copilot-openai-client-migration.md` (all phases complete as of 2026-02-23)
- `completed`: `docs/exec-plans/completed/global-assistant-layer-and-generic-ai-endpoint.md` (all phases complete as of 2026-02-28)
- `completed`: `docs/exec-plans/completed/ontology-driven-field-display-centralization.md` (all phases complete as of 2026-02-28)
