# Post-MVP Exec Plan: AI-First Investigation and Managed Agents

**Status:** completed  
**Target order:** post-MVP track 11  
**Agent slot:** STRAT-AI-1  
**Predecessor:** none  
**Successor:** none  
**Last updated:** 2026-03-07

---

## Objective

Reframe Seer around a clearer product model before concrete implementation resumes:

1. AI-first investigation is the default analytics experience.
2. The ontology is the executable capability catalog.
3. Managed agentic workflows are ontology-defined workflows/actions run by Seer inside a safe runtime.
4. Process mining and root-cause analysis remain important, but as tools the AI investigator and managed agents can use rather than the primary product identity.

## Why Now

The current repository documents a strong analytics and orchestration substrate, but the product story still reads too much like a set of expert surfaces:

1. process mining,
2. root-cause analysis,
3. action orchestration,
4. assistant experiences.

That is not yet the clearest explanation of what Seer is becoming.

The new direction needs to be documented first so future implementation work is aligned to one product model that a new reader can understand quickly.

## Scope

1. Rewrite canonical strategy docs so the product is explained in plain language for readers without prior context.
2. Update design and architecture guidance to reflect ontology-defined capabilities, AI-first investigation, and managed agent runtime boundaries.
3. Add draft product specs for the new product surfaces before implementation work starts.
4. Close the product-doc phase cleanly so a future plan can focus on how Seer achieves the vision rather than re-establishing product intent.

## Non-Goals

1. Implementing the managed agent runtime in this plan.
2. Implementing Seer ontology extension classes in backend code in this plan.
3. Finalizing authz, approval, or multi-tenant behavior in this plan.
4. Rewriting the entire repository around final terminology in one pass.

## Legacy Framing To Remove

1. Do not position Seer primarily as a process-mining UI with AI layered on top.
2. Do not describe workflow authoring as compilation into a fixed workflow spec.
3. Do not imply a separate action catalog outside the ontology.
4. Do not treat manual expert configuration as the intended default user experience for investigation.

## Implementation Phases

## Phase 1: Canonical Product Reframe

**Goal:** update the source-of-truth docs so the product model is explicit and newcomer-friendly.

Deliverables:

1. `VISION.md` rewritten around AI-first investigation, ontology-defined capabilities, and managed agents.
2. `DESIGN.md` updated with the new design themes and terminology.
3. `ARCHITECTURE.md` updated to reflect the new experience and runtime boundaries.

Exit criteria:

1. A new reader can understand what Seer is, what the ontology does, what agents are, and where analytics fit.
2. Canonical docs no longer depend on repo-specific history to explain the product.

## Phase 2: Draft Product Spec Set

**Goal:** add pre-implementation product specs for the new surfaces.

Deliverables:

1. Draft spec for AI-first investigation.
2. Draft spec for managed agentic workflows as ontology-defined actions.
3. Draft spec for runtime controls, observability, and operator control surfaces for managed agents.
4. Updated spec index showing these as draft/unfinished.

Exit criteria:

1. The product surfaces are documented before feature implementation starts.
2. Open questions and deferred decisions are explicit in the specs rather than implicit in chat context.

## Acceptance Criteria

1. Canonical strategy docs reflect the new product direction consistently.
2. Product docs explain the concepts clearly to readers without prior Seer context.
3. Draft specs exist for investigation, managed agents, and control surfaces.
4. The finished plan clearly records what product work was completed and what follow-on work remains for future planning.

## Risks and Mitigations

1. Risk: new terminology becomes more confusing than the old one.  
   Mitigation: write concept-first explanations in plain language before describing implementation details.
2. Risk: docs drift between vision, architecture, and specs.  
   Mitigation: update all three layers in one pass and keep the product-spec index current.
3. Risk: future implementation work starts without a concrete follow-on plan.  
   Mitigation: close this plan explicitly as a product-doc plan and create a new execution/design plan for ontology extension and trusted-mode runtime work.

## Validation Commands

1. `rg -n "workflow compiler|action catalog|process mining" VISION.md DESIGN.md ARCHITECTURE.md docs/product-specs`
2. Manual link/reference review for touched documentation

## Docs Impact

1. `VISION.md`
2. `DESIGN.md`
3. `ARCHITECTURE.md`
4. `docs/product-specs/index.md`
5. new draft specs under `docs/product-specs/`
6. `docs/exec-plans/active/index.md`
7. `docs/exec-plans/completed/README.md`

## Decision Log

1. 2026-03-07: Reframe Seer around AI-first investigation and managed agents rather than expert-first analytics surfaces.
2. 2026-03-07: Treat the ontology as the executable capability catalog; do not introduce a separate action catalog concept.
3. 2026-03-07: Treat managed agentic workflows as ontology-defined workflows/actions executed by Seer rather than compiled workflow graphs.
4. 2026-03-07: Optimize the docs for readers without existing Seer context.
5. 2026-03-07: Close this plan after the product reframing and draft-spec work; defer ontology-extension and runtime-design planning to a future plan.

## Progress Log

1. 2026-03-07: Opened the active plan and locked the new framing before implementation work.
2. 2026-03-07: Rewrote `VISION.md`, `DESIGN.md`, and `ARCHITECTURE.md` around AI-first investigation, ontology-defined capabilities, and managed agents.
3. 2026-03-07: Added draft product specs for AI investigation, managed agent workflows, and managed-agent runtime controls, and updated the product-spec index.
4. 2026-03-07: Revised the new docs to use trusted-mode execution and runtime guardrails as the current model, with authz and approval semantics explicitly deferred.
5. 2026-03-07: Closed the plan as a completed product-doc phase and moved it to `docs/exec-plans/completed/`.

## Completion Summary

1. Reframed Seer in the canonical docs around AI-first investigation, ontology-defined executable capabilities, and managed agents.
2. Added draft product specs that explain the new user-facing surfaces to readers without prior repository context.
3. Explicitly deferred ontology-extension design and trusted-mode runtime-design work into future planning rather than keeping them half-open in this product-doc plan.

## Acceptance Evidence

1. `VISION.md`, `DESIGN.md`, and `ARCHITECTURE.md` now align on the new product framing.
2. Draft specs exist for AI investigation, managed agents, and trusted-mode runtime controls.
3. Product-spec and execution-plan indexes were updated to reflect the new docs and completed-plan state.

## Known Follow-Up

1. Define the Seer ontology extension over Prophet workflow/action primitives.
2. Define the trusted-mode managed-agent runtime and runtime-guardrail model.
3. Create a separate execution/design plan for how Seer achieves the vision technically.

## Progress Tracking

- [x] Phase 1 complete
- [x] Phase 2 complete

Current status:

1. Completed.
2. Canonical docs and draft specs are landed.
3. Follow-on ontology-extension and runtime-design work is intentionally deferred to a future plan.
