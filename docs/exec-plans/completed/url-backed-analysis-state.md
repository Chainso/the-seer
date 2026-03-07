# Post-MVP Exec Plan: URL-Backed Analysis State

**Status:** completed  
**Target order:** post-MVP track 10 (deep-linkable analysis state)  
**Agent slot:** UX-STATE-1  
**Predecessor:** `docs/exec-plans/completed/analytics-run-results-discoverability.md`  
**Successor:** TBD  
**Last updated:** 2026-03-07

---

## Objective

Make key analysis state addressable and restorable from the URL so users can:

1. share exact investigation views,
2. refresh without losing current working context,
3. move between routes with less state loss,
4. return directly to meaningful analysis results rather than generic defaults.

## Why Now

The current product exposes major analysis state only in client memory in several places.

That weakens core analytics workflows:

1. users cannot reliably bookmark or share the current investigation state,
2. tabs and filters reset too easily,
3. deep-linking into process or RCA workflows is weaker than the product’s investigation-oriented positioning requires.

This plan converts high-value ephemeral state into stable route state.

## Scope

1. URL-back the `Insights` mode selection (`Process Insights` vs `Process Mining`).
2. URL-back high-value analytics configuration state for process mining and RCA where it materially affects the visible view.
3. URL-back selected result panel or item state where practical and user-visible.
4. Define a clear allowlist of shareable query params and a normalization strategy.
5. Preserve readable, stable URLs rather than encoding every transient UI detail.

## Non-Goals

1. Encoding every local control toggle into the URL.
2. Persisting draft assistant conversations in route state.
3. Reworking backend request contracts solely for URL state.
4. Replacing server persistence with query params.

## Legacy Behavior To Remove

1. Do not preserve major analysis tabs as purely local UI state.
2. Do not preserve analysis filters and selected result views as refresh-unsafe by default.
3. Do not preserve generic `/inspector/insights` links that lose the user’s chosen investigation mode.

## Implementation Phases

## Phase 1: URL State Contract

**Goal:** define the public query-param contract for analysis routes.

Deliverables:

1. Param schema for analysis mode, core filters, and selected result view state.
2. Route normalization rules for invalid, missing, or conflicting params.
3. Clear distinction between shareable route state and transient local state.

Exit criteria:

1. The product has an explicit contract for which analysis state belongs in the URL.
2. Invalid query params degrade safely to deterministic defaults.

## Phase 2: Insights Mode + Filter Synchronization

**Goal:** synchronize high-value analysis controls with the URL.

Deliverables:

1. Insights tab state reflected in query params.
2. Core process mining and RCA scope controls restored from URL on load.
3. Forward/back navigation preserves the user’s active analysis mode and major filters.

Exit criteria:

1. Copying the URL preserves the visible analysis mode and core scope.
2. Refreshing the page keeps the user in the same meaningful investigation context.

## Phase 3: Result Selection Deep-Linking

**Goal:** make result-focused collaboration possible.

Deliverables:

1. Selected result item or primary panel state encoded where practical.
2. Restored focus into the relevant result surface when loading a deep link.
3. Focused Playwright coverage for share/refresh/restore flows.

Exit criteria:

1. Users can share links that open directly to the relevant analysis context.
2. Result deep links do not break when optional state is missing.

## Acceptance Criteria

1. `Insights` mode selection is represented in the URL.
2. Core process mining and RCA scope filters survive refresh and direct linking.
3. At least one meaningful result-selection state is deep-linkable.
4. Invalid or partial query params resolve to safe defaults without broken UI.
5. Browser back/forward behavior remains coherent.

## Risks and Mitigations

1. Risk: query param sprawl makes URLs unreadable.  
   Mitigation: keep a strict allowlist and omit low-value transient UI state.
2. Risk: route state and local state diverge during partial loads.  
   Mitigation: define URL as the source of truth for included state and normalize eagerly.
3. Risk: result identifiers are unstable.  
   Mitigation: deep-link only to stable route-safe identifiers or documented fallback focus behavior.

## Validation Commands

1. `npm run lint`
2. `npm run build`
3. `npm run test:contracts`
4. Playwright navigation checks for refresh, back/forward, and shared-link restore flows

## Docs Impact

1. `docs/product-specs/process-explorer-phase-3.md`: document shareable/deep-linkable process exploration state.
2. `docs/product-specs/root-cause-lab-phase-4.md`: document shareable/deep-linkable RCA state.
3. `docs/product-specs/ai-guided-investigation-phase-5.md`: update guided investigation expectations if URLs become part of handoff/share flows.
4. `DESIGN.md`: update design-level guidance if URL-backed state becomes a cross-surface invariant.
5. `docs/exec-plans/active/index.md` and `docs/exec-plans/completed/README.md`: archive this plan and update post-MVP plan status references.

## Decision Log

1. 2026-03-07: Sequence URL-backed state after result-discoverability work so the shared-link contract reflects the improved analytics information architecture rather than the current one.
2. 2026-03-07: Encode only analysis state that changes the visible investigation outcome, not every transient interaction.
3. 2026-03-07: Normalize malformed filter, boolean, and datetime params to safe defaults instead of allowing query-derived crashes or stale state drift.

## Progress Log

1. 2026-03-07: URL-backed the Insights mode selection plus high-value Process Mining and RCA scope state.
2. 2026-03-07: Added safe query-param decoding, deterministic datetime normalization, stale-result clearing when `*_run` is absent, and autorun restore for valid deep links.
3. 2026-03-07: Validated Process Mining and RCA refresh/direct-link restore flows in Playwright plus clean `npm run lint` and `npm run build` gates.

## Progress Tracking

- [x] Phase 1 complete
- [x] Phase 2 complete
- [x] Phase 3 complete

Current status:

1. Completed.
2. URL-backed analysis state contract, restore behavior, and normalization hardening are landed and ratified.
