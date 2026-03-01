# UI Experience Replatform Phase F Hardening and Rollout Spec

**Status:** completed  
**Owner phase:** `docs/exec-plans/completed/ui-experience-replatform-2026.md`  
**Last updated:** 2026-02-23

---

## Purpose

Define release-readiness expectations for replatformed UI experiences after phases A-E and G feature delivery.

## Scope Guardrails

1. No Change Intelligence scope is introduced in this phase.
2. Ontology interactions remain strictly read-only.
3. Hardening targets verification, rollout safety, and post-launch response quality.

## Verification Harness Expectations

Automated checks:

1. `cd seer-ui && npm run lint`
2. `cd seer-ui && npm run build`
3. `cd seer-ui && npm run test`

Automated test coverage areas:

1. Adapter logic correctness for ontology/process/root-cause guided view-model transformations.
2. Key UI flow link construction for guided investigation shortcuts and handoff continuity.
3. Shared rendering primitives that gate run-state visibility and safe-mode AI redaction behavior.

Manual smoke checklist:

1. `/` loads and module navigation links are visible.
2. `/ontology` allows tab + concept navigation without edit controls and excludes Prophet base/property/custom-type concepts from graph-oriented concept navigation.
3. `/process` supports mining run, selector drill-down, and AI interpret action.
4. `/root-cause` supports run, evidence lookup, and insight compare interactions.
5. `/insights` runs guided orchestration and shows stage progression.
6. `/ingestion` opens object explorer context and relation/event detail panes.

## Rollout Checklist

Pre-cut checklist:

1. All verification harness checks pass in CI.
2. No open P0/P1 UI regressions in tracked release issue set.
3. Active exec plan has current progress and evidence links.

Canary checklist:

1. Deploy to canary environment with production-like backend.
2. Execute manual smoke checklist once end-to-end.
3. Capture route-level runtime errors and hydration warnings.

Production rollout checklist:

1. Promote build after canary passes.
2. Monitor first-hour error and latency trends on core routes.
3. Run abbreviated smoke on `/ontology`, `/process`, `/root-cause`, `/insights`, `/ingestion`.

## Rollback Strategy

1. Trigger rollback if any of the following occur:
   - sustained P0/P1 user-visible regression,
   - route crash loop or hydration failure on core modules,
   - critical AI panel redaction failure.
2. Roll back to the previous stable frontend artifact.
3. Re-run manual smoke checklist after rollback confirmation.
4. File triage entry with root cause and containment action.

## Post-Launch Triage Template

Required bug ticket fields:

1. Severity (`P0`, `P1`, `P2`, `P3`).
2. Route and module (`/ontology`, `/process`, `/root-cause`, `/insights`, `/ingestion`).
3. Reproduction steps and expected vs actual behavior.
4. User impact and workaround availability.
5. Evidence links (logs, screenshots, run IDs).
6. Owner and SLA target.

Severity response targets:

1. `P0`: immediate mitigation or rollback.
2. `P1`: fix plan within 1 business day.
3. `P2/P3`: scheduled in normal backlog cadence.

## UI Quality Metrics (SLO-Style)

1. Availability: core routes render without fatal error on first load.
2. Reliability: zero unresolved P0/P1 issues at release cut.
3. Interaction quality: no severe jank during representative process/RCA/guided interactions.
4. Safety: no leakage of sensitive strings in safe-mode AI panels.
