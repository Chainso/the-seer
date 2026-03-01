export type OcpnNodeType = "PLACE" | "TRANSITION";

export interface OcpnNode {
  id: string;
  label: string;
  type: OcpnNodeType;
  modelUri?: string | null;
  stateUri?: string | null;
  eventUri?: string | null;
  firstSeen?: string | null;
  lastSeen?: string | null;
  medianSeen?: string | null;
  count?: number | null;
  avgSeconds?: number | null;
  p50Seconds?: number | null;
  p95Seconds?: number | null;
}

export interface OcpnEdge {
  id: string;
  source: string;
  target: string;
  modelUri?: string | null;
  count: number;
  share: number;
}

export interface OcpnGraph {
  nodes: OcpnNode[];
  edges: OcpnEdge[];
}

export interface ProcessMiningRequestContract {
  anchor_object_type: string;
  start_at: string;
  end_at: string;
  include_object_types?: string[];
  max_events?: number;
  max_relations?: number;
  max_traces_per_handle?: number;
}

export interface ProcessMineNodeContract {
  id: string;
  label: string;
  node_type: string;
  frequency: number;
  trace_handle: string;
}

export interface ProcessMineEdgeContract {
  id: string;
  source: string;
  target: string;
  object_type: string;
  count: number;
  trace_handle: string;
}

export interface ProcessPathStatContract {
  object_type: string;
  path: string;
  count: number;
  trace_handle: string;
}

export interface ProcessMineResponseContract {
  run_id: string;
  anchor_object_type: string;
  start_at: string;
  end_at: string;
  nodes: ProcessMineNodeContract[];
  edges: ProcessMineEdgeContract[];
  object_types: string[];
  path_stats: ProcessPathStatContract[];
  warnings: string[];
}

export interface OcdfgNodeContract {
  id: string;
  activity: string;
  count: number;
  trace_handle: string;
}

export interface OcdfgEdgeContract {
  id: string;
  source: string;
  target: string;
  source_activity: string;
  target_activity: string;
  object_type: string;
  count: number;
  share: number;
  p50_seconds: number | null;
  p95_seconds: number | null;
  trace_handle: string;
}

export interface OcdfgBoundaryActivityContract {
  id: string;
  object_type: string;
  activity: string;
  count: number;
  trace_handle: string;
}

export interface OcdfgMiningResponseContract {
  run_id: string;
  anchor_object_type: string;
  start_at: string;
  end_at: string;
  nodes: OcdfgNodeContract[];
  edges: OcdfgEdgeContract[];
  start_activities: OcdfgBoundaryActivityContract[];
  end_activities: OcdfgBoundaryActivityContract[];
  object_types: string[];
  warnings: string[];
}

export interface ProcessTraceRecordContract {
  object_type: string;
  object_ref_hash: number;
  object_ref_canonical: string;
  event_ids: string[];
  event_types: string[];
  start_at: string;
  end_at: string;
  trace_id: string | null;
}

export interface ProcessTraceDrilldownResponseContract {
  handle: string;
  selector_type: string;
  traces: ProcessTraceRecordContract[];
  matched_count: number;
  truncated: boolean;
}

export interface OcdfgNode {
  id: string;
  kind: "activity" | "object";
  activity: string | null;
  objectType: string | null;
  count: number;
  traceHandle: string | null;
}

export interface OcdfgEdge {
  id: string;
  kind: "flow" | "start";
  source: string;
  target: string;
  sourceActivity: string | null;
  targetActivity: string | null;
  objectType: string;
  count: number;
  share: number;
  p50Seconds: number | null;
  p95Seconds: number | null;
  traceHandle: string;
}

export interface OcdfgBoundaryActivity {
  id: string;
  objectType: string;
  activity: string;
  count: number;
  traceHandle: string;
}

export interface OcdfgGraph {
  runId: string;
  anchorObjectType: string;
  startAt: string;
  endAt: string;
  nodes: OcdfgNode[];
  edges: OcdfgEdge[];
  startActivities: OcdfgBoundaryActivity[];
  endActivities: OcdfgBoundaryActivity[];
  objectTypes: string[];
  warnings: string[];
}
