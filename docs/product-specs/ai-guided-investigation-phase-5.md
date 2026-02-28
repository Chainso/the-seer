# AI Guided Investigation Phase 5 Spec

**Status:** completed  
**Owner phase:** `/home/chanzo/code/large-projects/seer-python/docs/exec-plans/completed/mvp-phase-5-ai-hardening-release.md`  
**Last updated:** 2026-02-22

---

## Purpose

Define user-facing behavior for unified AI interactions and the guided ontology -> process -> RCA investigation flow.

## Primary User Flow

1. User opens `/insights`.
2. User enters investigation question, anchor object type, time window, and RCA depth.
3. User runs guided flow.
4. Backend executes, in order:
   - ontology question through AI gateway,
   - process mining run,
   - process interpretation,
   - RCA setup assist,
   - RCA run,
   - RCA interpretation.
5. UI renders unified evidence/caveat cards for ontology, process, and RCA outputs.
6. User follows recommended next actions and drills into process/RCA module routes as needed.

## Backend Contracts Consumed by UI

1. `POST /api/v1/ai/ontology/question`
2. `POST /api/v1/ai/process/interpret`
3. `POST /api/v1/ai/root-cause/setup`
4. `POST /api/v1/ai/root-cause/interpret`
5. `POST /api/v1/ai/guided-investigation`
6. `POST /api/v1/ai/assistant/chat` (global shell assistant, route-independent context)

## Acceptance Expectations

1. AI responses expose module-scoped tool permissions.
2. Ontology responses follow `informational` policy and may be concise.
3. Process/RCA responses follow `analytical` policy and include evidence + caveats.
4. Guided flow returns both process and RCA run artifacts without manual DB intervention.
5. Shared UI run-state semantics (`queued`, `running`, `completed`, `error`) are used across ontology/process/RCA interactions.
6. Assistant conversations are shared across both assistant surfaces:
   - shell-level slide-over panel, and
   - dedicated `/assistant` page workspace.

## Out of Scope (Phase 5)

1. Autonomous mutation actions against ontology or history stores.
2. New governance/trust-center modules.
3. Multi-tenant AI policy partitioning.
