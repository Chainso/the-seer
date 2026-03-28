# Foundation Module Shell (Phase 0)

**Status:** completed
**Linked plan:** `.ultrakit/exec-plans/completed/mvp-phase-0-foundation-skeleton.md`

## Purpose

Define user-visible behavior for the shared shell, default routing, and
responsive navigation.

## User-Facing Surfaces

1. The default landing experience opens the catalog discovery workspace.
2. The catalog discovery workspace supports browsing objects, actions, events, and triggers, then drilling into concept detail.
3. The object detail experience combines documentation, related concepts, and lifecycle-oriented runtime evidence in one place.
4. Expert history and analytics surfaces remain available for deeper diagnostics.
5. A dedicated assistant workspace remains available alongside the shell.
6. Older ontology-first entry points remain as compatibility surfaces that hand users back into the catalog-first experience.

## Behavior Requirements

1. The default landing experience takes the user directly into catalog discovery rather than a separate shell home.
2. The shared shell exposes catalog, managed-agent operations, and assistant investigation as the primary navigation choices.
3. Older inspector and ontology entry points hand users into the current history, analytics, or catalog experiences rather than acting as the primary wayfinding model.
4. The shared shell uses a persistent left navigation rail on desktop widths and
   a dismissible drawer navigation pattern on narrow/mobile widths.
5. Narrow/mobile widths must preserve readable primary content without shell
   chrome clipping or squeezing the main pane.
6. Shell overlays, including assistant entry, must stay subordinate to
   higher-priority navigation overlays on narrow/mobile widths.
7. Navigation from the shared drawer must close the drawer and restore
   page scrolling.
8. The shell must preserve reachable navigation, visible focus styles, and
    touch-sized controls across desktop and mobile widths.
9. Shared shell surfaces must avoid major horizontal overflow or clipped primary
    content at common mobile widths.
10. The shell should default to catalog discovery, expose catalog as the
    primary navigation entry, and keep lifecycle evidence in the same layout so that documentation, related concepts, and runtime
    evidence remain visible without exposing RDF/ontology details.

## Acceptance Checks

1. `npm run lint` passes in `seer-ui`.
2. `npm run build` passes in `seer-ui`.
3. `npm run test:contracts` passes in `seer-ui`.
4. The delivered shell includes the catalog-first landing flow plus compatibility entry points for older expert surfaces.
5. Mobile-width shell content remains readable without rendering behind the drawer or fixed shell affordances.

## Out of Scope

1. Domain workflows beyond the shell, default entry behavior, and shared navigation.
2. Ontology mutation UI.
3. Process/RCA analytics rendering.
