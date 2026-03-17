# Foundation Module Shell (Phase 0)

**Status:** completed
**Linked plan:** `docs/exec-plans/completed/mvp-phase-0-foundation-skeleton.md`

## Purpose

Define user-visible behavior for the Phase 0 UI shell and backend connectivity status.

## User-Facing Routes

1. `/` - MVP module index and backend health summary.
2. `/catalog` - catalog workspace shell that hosts Objects, Actions, Events, and Triggers via a tab rail plus `/catalog/[kind]` list pages.
3. `/catalog/[kind]/[catalogKey]` - dedicated concept detail pages with Summary documentation/runtime panes and the `<Object Name> Lifecycle` tab for objects.
4. `/inspector/history` and `/inspector/history/object` - object-store and object-detail shell surfaces.
5. `/inspector/insights` - analytics shell for process mining and process insights.
6. `/assistant` - dedicated assistant workspace.
7. `/ontology` and `/ontology/[tab]` - deprecated reference shells that now redirect to catalog while remaining available for expert-level diagnostics.

## Behavior Requirements

1. Home route renders module cards for all five module placeholders.
2. Home route attempts backend health fetch from `${SEER_BACKEND_INTERNAL_URL}/api/v1/health` (fallback to `NEXT_PUBLIC_API_BASE_URL` then `http://localhost:8000`).
3. If backend health fetch succeeds, UI displays service status plus Fuseki and ClickHouse reachability indicators.
4. If backend health fetch fails, UI displays degraded connectivity messaging with HTTP status or error details.
5. Each placeholder route displays module name, planned phase, and link back to `/`.
6. The shared shell uses a persistent left navigation rail on desktop widths and a dismissible drawer navigation pattern on narrow/mobile widths.
7. Narrow/mobile widths must preserve readable primary content without shell chrome clipping or squeezing the main pane.
8. Shell overlays, including assistant entry, must stay subordinate to higher-priority navigation overlays on narrow/mobile widths.
9. Route navigation from the shared drawer must close the drawer and restore page scrolling.
10. The shell must preserve reachable navigation, visible focus styles, and touch-sized controls across desktop and mobile widths.
11. Shared shell routes must avoid major horizontal overflow or clipped primary content at common mobile widths.
12. The shell should default to `/catalog/objects`, expose `Catalog` as the primary navigation entry, and keep the lifecycle tab on object detail in the same layout so that documentation, related concepts, and runtime evidence remain visible without exposing RDF/ontology details.

## Acceptance Checks

1. `npm run lint` passes in `seer-ui`.
2. `npm run build` passes in `seer-ui`.
3. Generated app routes include the shared shell-bearing routes.
4. Desktop and mobile Playwright checks cover shell navigation, drawer open/close, and assistant layering behavior.
5. Mobile-width route content remains readable without rendering behind the drawer or fixed shell affordances.

## Out of Scope

1. Domain workflows beyond placeholder content.
2. Ontology mutation UI.
3. Process/RCA analytics rendering.
