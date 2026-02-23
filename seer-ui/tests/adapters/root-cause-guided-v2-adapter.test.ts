import assert from "node:assert/strict";
import test from "node:test";

import {
  adaptGuidedInvestigationV2,
  buildGuidedInvestigationStages,
} from "@/lib/adapters/root-cause-guided-v2-adapter";
import type { GuidedInvestigationResponse } from "@/lib/backend-ai";

function buildFixture(): GuidedInvestigationResponse {
  return {
    investigation_id: "investigation-1",
    anchor_object_type: "Order",
    start_at: "2026-02-20T00:00:00.000Z",
    end_at: "2026-02-21T00:00:00.000Z",
    ontology: {
      module: "ontology",
      task: "question",
      response_policy: "informational",
      tool_permissions: ["sparql_read_only_query"],
      summary: "Ontology summary",
      evidence: [{ label: "Concept", detail: "Order -> Shipment", uri: null }],
      caveats: [],
      next_actions: ["Check relation density"],
      copilot: {
        mode: "direct_answer",
        answer: "Investigate transitions around delayed fulfillment.",
        evidence: [{ concept_iri: "seer:Order", query: "SELECT ... WHERE {}" }],
        current_release_id: "release-1",
        tool_call: null,
        tool_result: null,
      },
    },
    process_run: {
      run_id: "process-run-1",
      anchor_object_type: "Order",
      start_at: "2026-02-20T00:00:00.000Z",
      end_at: "2026-02-21T00:00:00.000Z",
      nodes: [{ id: "n1", label: "created", node_type: "event", frequency: 10, trace_handle: "th1" }],
      edges: [
        {
          id: "e1",
          source: "n1",
          target: "n2",
          object_type: "Order",
          count: 8,
          trace_handle: "th2",
        },
      ],
      object_types: ["Order"],
      path_stats: [{ object_type: "Order", path: "created -> packed", count: 8, trace_handle: "ph1" }],
      warnings: [],
    },
    process_ai: {
      module: "process",
      task: "interpret",
      response_policy: "analytical",
      tool_permissions: ["process:interpret"],
      summary: "Process summary",
      evidence: [],
      caveats: ["Sample size was narrow"],
      next_actions: ["Inspect packed -> delayed edge"],
    },
    root_cause_setup: {
      module: "root_cause",
      task: "setup",
      response_policy: "analytical",
      tool_permissions: ["root-cause:setup"],
      summary: "Setup summary",
      evidence: [],
      caveats: [],
      next_actions: [],
      setup: {
        suggested_depth: 2,
        suggestions: [
          {
            outcome: {
              event_type: "order.delayed",
              object_type: "Order",
            },
            rationale: "Most delayed events attach to orders.",
          },
        ],
        notes: [],
      },
    },
    root_cause_run: {
      run_id: "rca-run-1",
      anchor_object_type: "Order",
      start_at: "2026-02-20T00:00:00.000Z",
      end_at: "2026-02-21T00:00:00.000Z",
      depth: 2,
      outcome: {
        event_type: "order.delayed",
        object_type: "Order",
      },
      cohort_size: 100,
      positive_count: 25,
      baseline_rate: 0.25,
      feature_count: 14,
      insights: [
        {
          insight_id: "insight-1",
          rank: 1,
          title: "Delay after payment retry",
          conditions: [{ feature: "retry", op: "eq", value: "true" }],
          score: {
            wracc: 0.12,
            mutual_information: 0.03,
            coverage: 0.2,
            support: 20,
            positives: 15,
            subgroup_rate: 0.75,
            baseline_rate: 0.25,
            lift: 3,
          },
          evidence_handle: "ev-1",
          evidence: {
            matched_anchor_count: 20,
            matched_positive_count: 15,
            sample_anchor_keys: ["order-1"],
            top_event_types: ["order.delayed"],
          },
          caveat: "Correlational only",
        },
      ],
      warnings: [],
      interpretation_caveat: "Use with analyst review",
    },
    root_cause_ai: {
      module: "root_cause",
      task: "interpret",
      response_policy: "analytical",
      tool_permissions: ["root-cause:interpret"],
      summary: "RCA summary",
      evidence: [],
      caveats: [],
      next_actions: ["Validate shipment SLA events"],
      interpretation: {
        summary: "Interpretation summary",
        caveats: [],
        next_steps: [],
      },
    },
  };
}

test("buildGuidedInvestigationStages tracks running and error transitions", () => {
  const running = buildGuidedInvestigationStages("running", null, null, 2);
  assert.equal(running[0]?.state, "completed");
  assert.equal(running[1]?.state, "completed");
  assert.equal(running[2]?.state, "running");
  assert.equal(running[5]?.state, "queued");

  const errored = buildGuidedInvestigationStages("error", null, "Pipeline timeout", 4);
  assert.equal(errored[3]?.state, "completed");
  assert.equal(errored[4]?.state, "error");
  assert.equal(errored[4]?.detail, "Pipeline timeout");
  assert.equal(errored[5]?.state, "queued");
});

test("completed stage and view-model adaptation preserve handoff fidelity", () => {
  const fixture = buildFixture();
  const stages = buildGuidedInvestigationStages("completed", fixture, null, 0);
  assert.ok(stages.every((stage) => stage.state === "completed"));
  assert.match(stages[1]?.detail ?? "", /Run process-run-1/);
  assert.match(stages[4]?.detail ?? "", /Run rca-run-1/);

  const view = adaptGuidedInvestigationV2(fixture);
  assert.equal(view.baseline_rate_label, "25.00%");
  assert.equal(view.action_items.length, 3);
  assert.equal(view.insight_count, 1);

  const rootCauseHref = new URL(view.handoff_links[0]!.href, "http://localhost");
  assert.equal(rootCauseHref.pathname, "/root-cause");
  assert.equal(rootCauseHref.searchParams.get("depth"), "2");
  assert.equal(rootCauseHref.searchParams.get("outcome_event_type"), "order.delayed");
  assert.equal(rootCauseHref.searchParams.get("outcome_object_type"), "Order");

  const restartHref = new URL(view.handoff_links[1]!.href, "http://localhost");
  assert.equal(restartHref.pathname, "/insights");
  assert.equal(
    restartHref.searchParams.get("question"),
    "Investigate transitions around delayed fulfillment."
  );
});
