# Seer UI

Catalog-first investigation and managed-agent interface for Seer.

## Product Surfaces

- `\/`: redirects to `\/catalog/objects`
- `\/catalog`, `\/catalog/[kind]`, and `\/catalog/[kind]/[catalogKey]`: primary discovery workspace for objects, actions, events, and triggers
- `\/inspector/managed-agents`: managed-agent authoring, run visibility, and nested execution drill-down
- global shell assistant: bottom-right launcher + panel powered by assistant-ui
- `\/assistant`: dedicated investigation workspace with optional artifact canvas
- `\/ontology`, `\/inspector/history`, and `\/inspector/insights`: retained reference surfaces for expert diagnostics

## Related Specs

1. `../docs/product-specs/foundation-module-shell-phase-0.md`
2. `../docs/product-specs/assistant-primary-surface.md`
3. `../docs/product-specs/managed-agentic-workflows.md`

## Local Development

```bash
cd seer-ui
npm run dev
```

Default API base URL:
- `NEXT_PUBLIC_API_BASE_URL` (recommended: `http://localhost:8000/api/v1`)
- `NEXT_PUBLIC_API_URL` is also accepted for legacy compatibility.

The primary shell navigation exposes `Catalog`, `Managed Agents`, and `Assistant`.

## Validation

Build:

```bash
cd seer-ui
npm run build
```

Lint:

```bash
cd seer-ui
npm run lint
```

Contract suite:

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

## Security Utilities

Sensitive assistant text and evidence references can be redacted with the helpers
in `app/lib/security-redaction.ts`.

## Performance Budget Notes

Budgeted load metrics are tracked in browser local storage:
- `ontology_graph_load_ms`
- `runtime_overlay_load_ms`

Implementation is in `app/lib/performance-budget.ts`.
