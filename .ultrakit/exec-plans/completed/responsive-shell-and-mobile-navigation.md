# Post-MVP Exec Plan: Responsive Shell + Mobile Navigation

**Status:** completed  
**Target order:** post-MVP track 8 (shell responsiveness)  
**Agent slot:** UX-SHELL-1  
**Predecessor:** `docs/exec-plans/completed/devcontainer-codex-workspace.md`  
**Successor:** `docs/exec-plans/completed/analytics-run-results-discoverability.md`  
**Last updated:** 2026-03-07

---

## Objective

Replace the current desktop-only shell behavior with a responsive application shell that:

1. preserves clear module navigation on desktop,
2. collapses navigation into a touch-appropriate mobile pattern,
3. keeps main content fully readable and interactive at narrow widths,
4. maintains the global assistant entry affordance without obscuring primary content.

## Why Now

The current shell blocks basic product use on mobile-sized viewports:

1. the fixed left rail consumes most of the viewport width,
2. main content compresses into a narrow unreadable column,
3. the product cannot meet the documented goal of fast access to usable process intelligence from the current shell alone.

This plan establishes a usable baseline for every module before deeper workflow polish.

## Scope

1. Rework the shared app shell layout for responsive breakpoints and narrow-screen content fit.
2. Replace the permanently visible sidebar on small screens with an explicit navigation drawer or equivalent responsive pattern.
3. Ensure the ontology, object-store, insights, and assistant routes all render without clipped primary content on mobile widths.
4. Reposition or adapt shell-level assistant affordances for mobile-safe use.
5. Add validation coverage for representative desktop and mobile shell states.

## Non-Goals

1. Redesigning individual module internals beyond what is required for shell fit.
2. Reworking analytics information architecture.
3. Changing backend APIs.
4. Replacing the module list or route taxonomy.

## Legacy Behavior To Remove

1. Do not preserve the permanently visible `w-72` sidebar on narrow screens.
2. Do not preserve clipped two-pane layouts as an acceptable mobile fallback.
3. Do not preserve desktop-only spacing assumptions in shared shell containers.

## Implementation Phases

## Phase 1: Shared Shell Responsiveness

**Goal:** make the shared shell structurally responsive.

Deliverables:

1. Responsive app-shell width/flex behavior with mobile-safe content sizing.
2. Collapsible mobile navigation surface with keyboard and touch support.
3. Updated dark-mode and assistant triggers positioned to avoid content obstruction.

Exit criteria:

1. At 390px width, the current route content remains readable without horizontal clipping.
2. Navigation remains reachable from every route.
3. Desktop navigation remains stable and visually consistent.

## Phase 2: Cross-Route Mobile Fit Hardening

**Goal:** validate shell behavior across major product surfaces.

Deliverables:

1. Mobile-fit adjustments for ontology, object store, insights, and assistant entry surfaces where needed.
2. Focus, layering, and scroll-behavior fixes for drawer/overlay interactions.
3. Route-level visual QA evidence for desktop and mobile.

Exit criteria:

1. Major routes render without clipped hero text, hidden controls, or obstructed primary actions on mobile.
2. Drawer open/close behavior is predictable with touch, keyboard, and route navigation.

## Acceptance Criteria

1. `Ontology Explorer`, `Object Store`, `Insights`, and `Assistant` remain navigable on desktop and mobile.
2. Main content does not render under or behind the mobile navigation surface.
3. No major horizontal overflow occurs at common mobile widths.
4. Shell-level actions retain visible focus styles and clear touch targets.
5. Playwright validation covers at least one desktop width and one mobile width for the shared shell.

## Risks and Mitigations

1. Risk: mobile drawer layering conflicts with graph canvases and assistant overlay.  
   Mitigation: centralize shell overlay stacking and verify route-level layering in Playwright.
2. Risk: per-route content still assumes desktop padding after shell changes.  
   Mitigation: explicitly audit each main route after the shared shell lands.
3. Risk: responsive fixes regress desktop information density.  
   Mitigation: keep desktop layout behavior as a separate validated breakpoint.

## Validation Commands

1. `npm run lint`
2. `npm run build`
3. `npm run test:contracts`
4. Playwright route checks for desktop and mobile shell states

## Docs Impact

1. `DESIGN.md`: record responsive shell behavior as a design-level invariant.
2. `docs/product-specs/foundation-module-shell-phase-0.md`: update shell expectations for responsive navigation and assistant entry behavior.
3. `docs/exec-plans/active/index.md` and `docs/exec-plans/completed/README.md`: archive this plan and update post-MVP plan status references.

## Decision Log

1. 2026-03-07: Prioritize shell responsiveness ahead of module-specific UI polish because the current shell blocks basic use on mobile.
2. 2026-03-07: Treat the fixed desktop rail as legacy behavior on narrow screens and remove it rather than preserving it for compatibility.
3. 2026-03-07: Use a dismissible drawer-style navigation pattern on narrow/mobile widths rather than a compressed inline rail so primary content can keep full usable width.

## Progress Log

1. 2026-03-07: Reworked the shared shell to use a desktop rail plus mobile drawer, reduced narrow-screen content padding, and moved the assistant overlay behind higher-priority navigation surfaces.
2. 2026-03-07: Added drawer resize cleanup so mobile navigation cannot leave desktop layouts scroll-locked after breakpoint changes.
3. 2026-03-07: Validated desktop/mobile shell behavior with Playwright plus clean `npm run lint` and `npm run build` gates.

## Progress Tracking

- [x] Phase 1 complete
- [x] Phase 2 complete

Current status:

1. Completed.
2. Responsive shell, drawer lifecycle cleanup, and shell-layer validation are landed and ratified.
