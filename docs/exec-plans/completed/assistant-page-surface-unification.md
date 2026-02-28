# Post-MVP Exec Plan: Assistant Dedicated Page Rewrite + Surface Unification

**Status:** completed  
**Target order:** post-MVP track 5 (assistant UX consolidation)  
**Agent slot:** AI-UX-G2  
**Predecessor:** `/home/chanzo/code/large-projects/seer-python/docs/exec-plans/completed/global-assistant-layer-and-generic-ai-endpoint.md`  
**Successor:** TBD  
**Last updated:** 2026-02-28

---

## Objective

Rewrite `/assistant` as a dedicated assistant page that delivers the same core UX as the global popup panel, while sharing one conversation system across both surfaces.

Required outcomes:

1. `/assistant` is no longer a separate "mission control" pattern.
2. Panel and page use one shared assistant runtime/state model.
3. Conversations stay synchronized between panel and page in real time.
4. Legacy assistant-page-specific data model and adapters are retired.
5. Backward compatibility is optional; UX quality is prioritized over preserving legacy local state.

---

## Current Gap Summary

1. Global panel (`GlobalAssistantLayer`) uses `assistant-ui` primitives and persists under `seer_global_assistant_threads_v1`.
2. `/assistant` route (`MissionControlPanel`) uses a different conversation model (`seer_assistant_conversations_v2`) and different UI contract.
3. Panel and page are not synchronized because they are separate state systems.
4. Duplicate assistant paradigms increase cognitive overhead and maintenance risk.

---

## Scope

1. Create a shared assistant domain module for thread/message state, persistence, and runtime wiring.
2. Build one reusable assistant surface UI that can render as:
   - panel variant (global launcher slide-over), and
   - page variant (full dedicated route experience).
3. Rewrite `/assistant` to consume the shared surface/runtime.
4. Refactor global panel to consume the same shared surface/runtime.
5. Add deterministic sync behavior between panel and page, including cross-tab propagation.
6. Enforce one canonical persisted conversation key for the unified experience.
7. Add/update frontend tests for shared contract and synchronization behavior.
8. Update execution, architecture, and product/spec docs for the consolidated assistant experience.

## Non-Goals

1. Backend assistant endpoint redesign (`POST /api/v1/ai/assistant/chat` stays canonical).
2. New assistant capabilities (tooling/policy changes, autonomous actions, ontology authoring).
3. Cross-device/server-side conversation persistence.
4. Streaming protocol migration.
5. Backward-compatible migration of legacy assistant localStorage payloads.

---

## Sync Strategy (Design Decision)

If `assistant-ui` does not provide automatic synchronization between independently mounted surfaces, implement synchronization explicitly through a shared local domain layer:

1. Create one canonical persisted thread store (new versioned key).
2. Derive both panel and page runtimes from that same store abstraction.
3. Emit updates via:
   - in-app shared state notifications, and
   - browser `storage` event / `BroadcastChannel` for multi-tab propagation.
4. Keep one canonical `activeThreadId` so both surfaces select the same active thread by default.
5. Ignore legacy payload compatibility requirements and initialize from the canonical model only.

---

## Baseline Failure Ledger

Baseline verification is a mandatory first phase and must capture pre-existing failures before feature delivery:

1. `cd seer-ui && npm run lint`
2. `cd seer-ui && npm run test:contracts`
3. `cd seer-ui && npm run build`

Any unrelated failures discovered in baseline runs must be recorded in the plan log and treated as non-regressions unless touched by this scope.

Baseline results (2026-02-28):

1. `cd seer-ui && npm run lint` failed with pre-existing errors outside assistant scope:
   - `app/components/inspector/bpmn-graph.tsx:256:33` (`@typescript-eslint/no-explicit-any`)
   - `app/components/ontology/object-state-graph.tsx:326:33` (`@typescript-eslint/no-explicit-any`)
   - `app/components/ontology/object-state-graph.tsx:327:33` (`@typescript-eslint/no-explicit-any`)
2. `cd seer-ui && npm run test:contracts` passed (`pass 6`, `fail 0`).
3. `cd seer-ui && npm run build` failed with pre-existing error outside assistant scope:
   - `app/components/ontology/dialogs/edit-object-dialog.tsx:334:74` (`Cannot find name 'uri'`).

---

## Unified UX Contract (Frozen 2026-02-28)

1. Shared conversation model:
   - panel and page read/write one canonical thread store.
   - active thread selection is shared across both surfaces.
2. Shared interaction model:
   - same thread list behavior (create, switch, rename/delete where enabled),
   - same message rendering and loading semantics,
   - same composer behavior (Enter send, Shift+Enter newline).
3. Surface differences are layout-only:
   - panel remains slide-over with launcher + close affordance,
   - `/assistant` is full-page dedicated workspace.
4. Route affordance rule:
   - hide launcher button on `/assistant` to avoid duplicate entry affordances.
5. Prompt seed contract:
   - `/assistant?q=...` must be preserved by the new page flow and converted into an immediate assistant turn exactly once per distinct query value.
6. Storage policy:
   - use only one canonical versioned key,
   - do not migrate legacy assistant storage payloads,
   - if canonical payload is missing/invalid, initialize a fresh thread store.

---

## Sequential Phase Plan

## Phase 0: Baseline + UX Contract Freeze

**Goal:** lock baseline quality signal and final UX contract before implementation.

Deliverables:

1. Baseline failure ledger captured with command outputs.
2. Final interaction contract for unified assistant surface documented in this plan (header, thread list behavior, composer behavior, mobile/desktop expectations).
3. Canonical storage reset policy documented (no legacy migration requirement).

Exit criteria:

1. Baseline failures are explicitly labeled pre-existing or in-scope.
2. UI contract is concrete enough to implement without ambiguity.

## Phase 1: Shared Assistant Domain Layer

**Goal:** create one source of truth for assistant conversations.

Deliverables:

1. Shared assistant state module (threads, active thread, persistence, migration).
2. Shared runtime adapter hook for `assistant-ui` consumers.
3. Context wiring so both surfaces can subscribe to the same data.

Validation:

1. Targeted lint for touched files.
2. Contract tests for canonical thread operations.

Exit criteria:

1. Panel and page can both read/write the same thread state through one API.
2. Canonical storage behavior is deterministic and covered by tests.

## Phase 2: Reusable Assistant Surface Component

**Goal:** consolidate UI primitives into one reusable assistant surface.

Deliverables:

1. Extract shared assistant conversation UI into a single component family.
2. Implement panel/page variants through layout props or wrappers, not separate conversation logic.
3. Keep panel UX parity with current production interaction quality.

Validation:

1. Targeted lint/tests for extracted components.
2. Existing assistant global contract tests pass.

Exit criteria:

1. One conversation UI implementation powers both form factors.
2. No duplicate composer/thread/message rendering code paths remain.

## Phase 3: Dedicated `/assistant` Rewrite

**Goal:** replace mission control with the unified dedicated assistant page.

Deliverables:

1. `/assistant` route migrated to the shared assistant surface (page variant).
2. Legacy mission control features removed from route-level UX.
3. Deep-link prompt seed (`?q=`) retained in the new flow.
4. Global launcher behavior adjusted on `/assistant` to avoid redundant dual-entry confusion.

Validation:

1. Targeted route + component lint.
2. Contract tests updated for new page contract.

Exit criteria:

1. `/assistant` feels like a first-class dedicated assistant workspace.
2. UX parity with panel interaction model is achieved.

## Phase 4: Cross-Surface Sync Hardening

**Goal:** guarantee synchronization across panel and page surfaces.

Deliverables:

1. Real-time sync between surfaces in one tab.
2. Cross-tab sync using browser propagation mechanisms.
3. Guardrails for edge cases:
   - thread deletion while another surface is open,
   - active thread switching conflicts,
   - simultaneous sends.

Validation:

1. Add/expand tests to verify panel/page state convergence.
2. Run `npm run test:contracts` for full frontend contract suite.

Exit criteria:

1. Sending/editing/switching on one surface is reflected on the other.
2. Sync remains stable across refreshes and navigation.

## Phase 5: Cleanup, Docs, and Completion Transition

**Goal:** remove dead paths and align canonical docs.

Deliverables:

1. Remove deprecated assistant page implementation artifacts (for example `mission-control-panel` path if unused).
2. Update docs:
   - `ARCHITECTURE.md` (assistant surfaces and shared runtime boundary),
   - `docs/product-specs/*` (assistant user-facing behavior),
   - `docs/exec-plans/active/index.md` (status updates).
3. Record deferred items in `docs/exec-plans/tech-debt-tracker.md` if needed.
4. Move this plan to `docs/exec-plans/completed/` after acceptance is fully met.

Validation:

1. `cd seer-ui && npm run lint` (or scoped lint with rationale for scope).
2. `cd seer-ui && npm run test:contracts`.
3. `cd seer-ui && npm run build`.

Exit criteria:

1. Legacy assistant-page architecture is removed or explicitly deprecated with no active dependencies.
2. Documentation and indexes are coherent and current.

---

## Acceptance Criteria

1. `/assistant` uses the same assistant interaction paradigm as the global panel.
2. Panel and page share one canonical conversation/thread store.
3. Conversations synchronize bidirectionally between panel and page.
4. Legacy route-specific mission-control architecture is no longer the active assistant page path.
5. Frontend validation commands pass or have explicitly logged pre-existing failures.
6. Canonical docs and execution indexes reflect the new architecture.

---

## Completion Summary

1. Replaced the legacy `/assistant` mission-control implementation with a dedicated assistant workspace built from the same shared UI primitives as the global panel.
2. Introduced a shared assistant state provider and runtime adapter so panel and page run on one canonical conversation model.
3. Added real-time synchronization through shared in-app state plus browser synchronization mechanisms (`storage` + `BroadcastChannel`).
4. Simplified persistence strategy to one canonical storage key (`seer_assistant_threads_v3`) with no legacy compatibility/migration path, per updated UX-first directive.
5. Removed deprecated assistant artifacts:
   - `seer-ui/app/components/assistant/mission-control-panel.tsx`
   - `seer-ui/app/lib/api/assistant.ts`
6. Updated assistant contract tests to enforce shared workspace usage and canonical storage rules.
7. Synced architecture and product-spec docs for the unified assistant experience.

## Acceptance Evidence

1. Scoped assistant lint (pass):  
   `cd seer-ui && npm run lint -- app/components/assistant/shared-assistant-state.tsx app/components/assistant/use-shared-assistant-runtime.ts app/components/assistant/assistant-workspace.tsx app/components/assistant/assistant-page-workspace.tsx app/components/assistant/global-assistant-layer.tsx app/components/layout/app-shell.tsx app/assistant/page.tsx tests/assistant-global.contract.test.mjs`
2. Frontend contract tests (pass):  
   `cd seer-ui && npm run test:contracts` (`pass 6`, `fail 0`)
3. Broad baseline checks rerun for reference:
   - `cd seer-ui && npm run lint` (pre-existing failures outside assistant scope remain)
   - `cd seer-ui && npm run build` (pre-existing TypeScript failure outside assistant scope remains)

---

## Risks and Mitigations

1. Risk: behavior regressions while extracting shared UI/runtime.  
   Mitigation: phase-gated extraction with contract tests after each phase.
2. Risk: local conversation history reset for users with legacy payloads.  
   Mitigation: explicitly accept breakage for UX simplification and communicate this in release notes/changelog.
3. Risk: sync race conditions between surfaces/tabs.  
   Mitigation: deterministic update ordering, monotonic timestamps, and cross-surface conflict tests.
4. Risk: UX confusion from simultaneous panel + dedicated page affordances.  
   Mitigation: explicit launcher behavior rules on `/assistant` and unified naming/copy.

---

## Progress Tracking

- [x] Phase 0 complete
- [x] Phase 1 complete
- [x] Phase 2 complete
- [x] Phase 3 complete
- [x] Phase 4 complete
- [x] Phase 5 complete

Current execution state:

- `completed`: all phases delivered on 2026-02-28.

## Progress / Decision Log

1. 2026-02-28: Plan created to fully rewrite `/assistant` into a dedicated page using the same UX paradigm as the global panel.
2. 2026-02-28: Decision - conversation synchronization is a hard requirement; shared domain-layer state will be implemented if runtime-level sync is not automatic.
3. 2026-02-28: Phase 0 completed. Baseline ledger captured: frontend contracts pass, while lint/build failures are pre-existing and outside assistant rewrite scope.
4. 2026-02-28: UX contract frozen - panel/page differ only by layout shell; conversation behavior and data model are unified.
5. 2026-02-28: User directive update - backward compatibility is not required; plan now prioritizes best possible assistant UX with a clean canonical storage model and no legacy migration path.
6. 2026-02-28: Phases 1-4 completed by shipping a shared assistant provider/runtime + unified workspace component used by both the global panel and dedicated `/assistant` page.
7. 2026-02-28: Phase 5 completed by removing deprecated mission-control implementation paths and syncing architecture/spec/execution docs.
