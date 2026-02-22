# Foundation Module Shell (Phase 0)

**Status:** active
**Linked plan:** `/home/chanzo/code/large-projects/seer-python/docs/exec-plans/active/mvp-phase-0-foundation-skeleton.md`

## Purpose

Define user-visible behavior for the Phase 0 UI shell and backend connectivity status.

## User-Facing Routes

1. `/` - MVP module index and backend health summary.
2. `/ontology` - Ontology explorer placeholder shell.
3. `/ingestion` - Ingestion monitor placeholder shell.
4. `/process` - Process explorer placeholder shell.
5. `/root-cause` - Root-cause lab placeholder shell.
6. `/insights` - Insights dashboard placeholder shell.

## Behavior Requirements

1. Home route renders module cards for all five module placeholders.
2. Home route attempts backend health fetch from `${SEER_BACKEND_INTERNAL_URL}/api/v1/health` (fallback to `NEXT_PUBLIC_API_BASE_URL` then `http://localhost:8000`).
3. If backend health fetch succeeds, UI displays service status plus Fuseki and ClickHouse reachability indicators.
4. If backend health fetch fails, UI displays degraded connectivity messaging with HTTP status or error details.
5. Each placeholder route displays module name, planned phase, and link back to `/`.

## Acceptance Checks

1. `npm run lint` passes in `seer-ui`.
2. `npm run build` passes in `seer-ui`.
3. Generated app routes include all module placeholders.

## Out of Scope

1. Domain workflows beyond placeholder content.
2. Ontology mutation UI.
3. Process/RCA analytics rendering.
