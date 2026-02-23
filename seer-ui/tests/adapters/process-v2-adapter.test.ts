import assert from "node:assert/strict";
import test from "node:test";

import {
  adaptProcessRunV2,
  adaptProcessTraceDrilldownV2,
  filterSelectorsByText,
} from "@/lib/adapters/process-v2-adapter";
import type { ProcessMiningResponse, ProcessTraceDrilldownResponse } from "@/lib/backend-process";

test("adaptProcessRunV2 builds stable KPIs, selectors, and lane shares", () => {
  const dto: ProcessMiningResponse = {
    run_id: "proc-run-1",
    anchor_object_type: "Order",
    start_at: "2026-02-20T00:00:00.000Z",
    end_at: "2026-02-21T00:00:00.000Z",
    nodes: [
      { id: "event:packed", label: "event:packed", node_type: "event", frequency: 6, trace_handle: "n2" },
      { id: "event:created", label: "event:created", node_type: "event", frequency: 10, trace_handle: "n1" },
    ],
    edges: [
      {
        id: "e2",
        source: "event:packed",
        target: "event:shipped",
        object_type: "Shipment",
        count: 3,
        trace_handle: "h2",
      },
      {
        id: "e1",
        source: "event:created",
        target: "event:packed",
        object_type: "Order",
        count: 8,
        trace_handle: "h1",
      },
    ],
    object_types: ["Shipment", "Order"],
    path_stats: [{ object_type: "Order", path: "created -> packed", count: 5, trace_handle: "p1" }],
    warnings: [],
  };

  const view = adaptProcessRunV2(dto);

  assert.deepEqual(view.object_types, ["Order", "Shipment"]);
  assert.equal(view.kpis.total_node_frequency, 16);
  assert.equal(view.kpis.total_edge_observations, 11);
  assert.equal(view.kpis.total_path_observations, 5);
  assert.equal(view.selectors[0]?.kind, "node");
  assert.equal(view.selectors[0]?.label, "created");
  assert.equal(view.lanes[0]?.edges[0]?.share, 1);
  assert.equal(view.lanes[1]?.edges[0]?.share, 0.375);

  const filtered = filterSelectorsByText(view.selectors, "shipment");
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0]?.kind, "edge");
});

test("adaptProcessTraceDrilldownV2 sorts traces and computes duration safely", () => {
  const dto: ProcessTraceDrilldownResponse = {
    handle: "trace-handle-1",
    selector_type: "edge",
    matched_count: 2,
    truncated: false,
    traces: [
      {
        object_type: "Order",
        object_ref_hash: 1,
        object_ref_canonical: "order-1",
        event_ids: ["e2"],
        event_types: ["packed"],
        start_at: "2026-02-20T03:00:00.000Z",
        end_at: "2026-02-20T03:05:00.000Z",
        trace_id: "t2",
      },
      {
        object_type: "Order",
        object_ref_hash: 2,
        object_ref_canonical: "order-2",
        event_ids: ["e1"],
        event_types: ["created", "packed"],
        start_at: "2026-02-20T01:00:00.000Z",
        end_at: "2026-02-20T01:15:00.000Z",
        trace_id: "t1",
      },
    ],
  };

  const view = adaptProcessTraceDrilldownV2(dto);
  assert.equal(view.traces[0]?.object_ref_canonical, "order-2");
  assert.equal(view.traces[0]?.duration_ms, 900000);
  assert.equal(view.traces[1]?.duration_ms, 300000);
  assert.deepEqual(view.object_types, ["Order"]);
});
