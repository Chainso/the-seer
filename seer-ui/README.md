# Seer UI

Next.js App Router shell for Seer MVP.

## Local Development

```bash
npm ci
npm run dev
```

## Sanity Checks

```bash
npm run lint
npm run build
```

## Routes

1. `/` module index + backend health summary
2. `/ontology`
3. `/ingestion`
4. `/process`
5. `/root-cause`
6. `/insights`

`/root-cause` now includes Phase 4 RCA run setup, ranked insights, evidence drill-down, and
MVP-thin AI assist actions for setup/interpretation.

## Environment

Copy `.env.example` to `.env` for local overrides.
