# New User Onboarding

**Status:** completed  
**Owner phase:** `/home/chanzo/code/large-projects/seer-python/docs/exec-plans/completed/mvp-phase-5-ai-hardening-release.md`  
**Last updated:** 2026-02-22

---

## Objective

Get a new team from zero to first evidence-backed Seer insight without manual database intervention.

## MVP Onboarding Flow

1. Start platform locally.
2. Ingest Prophet local ontology Turtle file.
3. Validate and upsert ontology.
4. Ingest sample events.
5. Explore ontology in read-only UI.
6. Ask ontology questions via the unified AI gateway.
7. Run process mining and inspect trace drill-down.
8. Run RCA with explicit outcome definition.
9. Run guided investigation (`/insights`) to traverse ontology -> process -> RCA in one flow.

## Success Signals

1. User completes flow end-to-end with no manual DB intervention.
2. User inspects at least one analytical response that includes evidence and caveats.
3. User can move from guided flow output to module drill-down (`/process` or `/root-cause`) for verification.
