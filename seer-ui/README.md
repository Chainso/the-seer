# Seer UI

Read-first ontology explorer and digital twin interface for Seer.

## Product Surfaces

- `\/ontology/[tab]`: ontology explorer (graph-first, deep-linkable)
- `\/changes`: semantic diff, blast radius, governance scorecard, perf budgets
- `\/inspector` and `\/inspector/analytics`: runtime/process mining views
- `\/assistant`: evidence-grounded mission control with redacted audit logging
- `\/object-store`: object state browsing

## Local Development

```bash
cd seer-ui
npm run dev
```

Default API base URL:
- `NEXT_PUBLIC_API_BASE_URL` (recommended: `http://localhost:8000/api/v1`)
- `NEXT_PUBLIC_API_URL` is still accepted for legacy compatibility.

## Validation

Lint all:

```bash
cd seer-ui
npm run lint
```

Contract + smoke suite:

```bash
cd seer-ui
npm run test:contracts
```

## Table System

Table components under `app/components/ui/table.tsx` follow a Radix Themes-compatible shape:

- `Table.Root`
- `Table.Header`
- `Table.Body`
- `Table.Row`
- `Table.Cell`
- `Table.ColumnHeaderCell`
- `Table.RowHeaderCell`

Legacy aliases remain exported for incremental migration, but new code should use the namespaced API.
Implementation note: this is a local compatibility layer matching Radix Themes table semantics. Full package-level adoption in `seer-ui/package.json` is pending network access for lockfile updates.

## Security and Trust Notes

- Assistant safe mode is ON by default.
- Audit entries are persisted with redaction policy for prompts/answers/evidence.
- Redaction logic lives in `app/lib/security-redaction.ts`.

## Performance Budget Notes

Budgeted load metrics are tracked in browser local storage and surfaced on `\/changes`:
- `ontology_graph_load_ms`
- `semantic_diff_load_ms`
- `runtime_overlay_load_ms`

Implementation is in `app/lib/performance-budget.ts`.
