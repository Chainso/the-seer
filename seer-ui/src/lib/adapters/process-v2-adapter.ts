import { buildViewModelMeta, type ViewModelMeta } from "@/lib/adapters/common";
import type {
  ProcessMiningResponse,
  ProcessModelEdge,
  ProcessModelNode,
  ProcessPathStat,
  ProcessTraceDrilldownResponse,
  ProcessTraceRecord,
} from "@/lib/backend-process";

export type ProcessDrilldownSelectorKind = "node" | "edge" | "path";

export type ProcessRunKpisViewModel = {
  node_count: number;
  edge_count: number;
  path_count: number;
  total_node_frequency: number;
  total_edge_observations: number;
  total_path_observations: number;
};

export type ProcessNodeViewModel = {
  id: string;
  label: string;
  node_type: string;
  frequency: number;
  trace_handle: string;
};

export type ProcessEdgeViewModel = {
  id: string;
  source: string;
  target: string;
  source_label: string;
  target_label: string;
  object_type: string;
  count: number;
  share: number;
  trace_handle: string;
};

export type ProcessPathViewModel = {
  id: string;
  object_type: string;
  path: string;
  count: number;
  step_count: number;
  trace_handle: string;
};

export type ProcessGraphLaneViewModel = {
  object_type: string;
  total_count: number;
  edge_count: number;
  edges: ProcessEdgeViewModel[];
};

export type ProcessDrilldownSelectorViewModel = {
  id: string;
  kind: ProcessDrilldownSelectorKind;
  label: string;
  detail: string;
  count: number;
  object_type: string | null;
  trace_handle: string;
};

export type ProcessRunViewModelV2 = {
  run_id: string;
  anchor_object_type: string;
  start_at: string;
  end_at: string;
  window_label: string;
  object_types: string[];
  warnings: string[];
  kpis: ProcessRunKpisViewModel;
  nodes: ProcessNodeViewModel[];
  edges: ProcessEdgeViewModel[];
  paths: ProcessPathViewModel[];
  lanes: ProcessGraphLaneViewModel[];
  selectors: ProcessDrilldownSelectorViewModel[];
  meta: ViewModelMeta;
};

export type ProcessTraceItemViewModel = {
  id: string;
  object_type: string;
  object_ref_hash: number;
  object_ref_canonical: string;
  trace_id: string | null;
  event_count: number;
  event_types: string[];
  event_path_label: string;
  start_at: string;
  end_at: string;
  duration_ms: number;
};

export type ProcessTraceDrilldownViewModelV2 = {
  handle: string;
  selector_type: string;
  matched_count: number;
  truncated: boolean;
  traces: ProcessTraceItemViewModel[];
  object_types: string[];
  meta: ViewModelMeta;
};

export function adaptProcessRunV2(dto: ProcessMiningResponse): ProcessRunViewModelV2 {
  const nodes = dto.nodes.map(adaptNode).sort(compareNodes);
  const edges = dto.edges.map(adaptEdge).sort(compareEdges);
  const paths = dto.path_stats.map(adaptPath).sort(comparePaths);
  const lanes = buildEdgeLanes(edges);
  const selectors = buildSelectors(nodes, edges, paths);

  const kpis: ProcessRunKpisViewModel = {
    node_count: nodes.length,
    edge_count: edges.length,
    path_count: paths.length,
    total_node_frequency: nodes.reduce((total, node) => total + node.frequency, 0),
    total_edge_observations: edges.reduce((total, edge) => total + edge.count, 0),
    total_path_observations: paths.reduce((total, path) => total + path.count, 0),
  };

  return {
    run_id: dto.run_id,
    anchor_object_type: dto.anchor_object_type,
    start_at: dto.start_at,
    end_at: dto.end_at,
    window_label: `${formatUtcTimestamp(dto.start_at)} to ${formatUtcTimestamp(dto.end_at)}`,
    object_types: [...dto.object_types].sort((left, right) => left.localeCompare(right)),
    warnings: [...dto.warnings],
    kpis,
    nodes,
    edges,
    paths,
    lanes,
    selectors,
    meta: buildViewModelMeta(),
  };
}

export function adaptProcessTraceDrilldownV2(
  dto: ProcessTraceDrilldownResponse
): ProcessTraceDrilldownViewModelV2 {
  const traces = dto.traces.map(adaptTrace).sort(compareTraces);
  const objectTypes = Array.from(new Set(traces.map((trace) => trace.object_type))).sort((left, right) =>
    left.localeCompare(right)
  );

  return {
    handle: dto.handle,
    selector_type: dto.selector_type,
    matched_count: dto.matched_count,
    truncated: dto.truncated,
    traces,
    object_types: objectTypes,
    meta: buildViewModelMeta(),
  };
}

export function filterSelectorsByText(
  selectors: ProcessDrilldownSelectorViewModel[],
  query: string
): ProcessDrilldownSelectorViewModel[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return selectors;
  }
  return selectors.filter((selector) =>
    `${selector.label} ${selector.detail} ${selector.object_type ?? ""}`
      .toLowerCase()
      .includes(normalized)
  );
}

function adaptNode(node: ProcessModelNode): ProcessNodeViewModel {
  return {
    id: node.id,
    label: normalizeEventNodeLabel(node.label || node.id),
    node_type: node.node_type,
    frequency: node.frequency,
    trace_handle: node.trace_handle,
  };
}

function adaptEdge(edge: ProcessModelEdge): ProcessEdgeViewModel {
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    source_label: normalizeEventNodeLabel(edge.source),
    target_label: normalizeEventNodeLabel(edge.target),
    object_type: edge.object_type,
    count: edge.count,
    share: 0,
    trace_handle: edge.trace_handle,
  };
}

function adaptPath(path: ProcessPathStat): ProcessPathViewModel {
  const steps = path.path
    .split("->")
    .map((step) => step.trim())
    .filter(Boolean);
  return {
    id: `${path.object_type}:${path.path}`,
    object_type: path.object_type,
    path: path.path,
    count: path.count,
    step_count: steps.length,
    trace_handle: path.trace_handle,
  };
}

function buildEdgeLanes(edges: ProcessEdgeViewModel[]): ProcessGraphLaneViewModel[] {
  const grouped = new Map<string, ProcessEdgeViewModel[]>();
  for (const edge of edges) {
    const existing = grouped.get(edge.object_type);
    if (existing) {
      existing.push(edge);
      continue;
    }
    grouped.set(edge.object_type, [edge]);
  }

  const maxCount = edges.reduce((currentMax, edge) => Math.max(currentMax, edge.count), 0);

  return Array.from(grouped.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([objectType, laneEdges]): ProcessGraphLaneViewModel => {
      const ordered = laneEdges.sort(compareEdges).map((edge) => ({
        ...edge,
        share: maxCount === 0 ? 0 : edge.count / maxCount,
      }));
      return {
        object_type: objectType,
        total_count: ordered.reduce((total, edge) => total + edge.count, 0),
        edge_count: ordered.length,
        edges: ordered,
      };
    });
}

function buildSelectors(
  nodes: ProcessNodeViewModel[],
  edges: ProcessEdgeViewModel[],
  paths: ProcessPathViewModel[]
): ProcessDrilldownSelectorViewModel[] {
  const fromNodes = nodes.map((node): ProcessDrilldownSelectorViewModel => ({
    id: `node:${node.id}`,
    kind: "node",
    label: node.label,
    detail: `${node.node_type} node`,
    count: node.frequency,
    object_type: null,
    trace_handle: node.trace_handle,
  }));
  const fromEdges = edges.map((edge): ProcessDrilldownSelectorViewModel => ({
    id: `edge:${edge.id}`,
    kind: "edge",
    label: `${edge.source_label} -> ${edge.target_label}`,
    detail: edge.object_type,
    count: edge.count,
    object_type: edge.object_type,
    trace_handle: edge.trace_handle,
  }));
  const fromPaths = paths.map((path): ProcessDrilldownSelectorViewModel => ({
    id: `path:${path.id}`,
    kind: "path",
    label: path.path,
    detail: `${path.object_type} (${path.step_count} steps)`,
    count: path.count,
    object_type: path.object_type,
    trace_handle: path.trace_handle,
  }));

  return [...fromNodes, ...fromEdges, ...fromPaths].sort(compareSelectors);
}

function adaptTrace(trace: ProcessTraceRecord): ProcessTraceItemViewModel {
  return {
    id: `${trace.object_type}:${trace.object_ref_hash}:${trace.start_at}`,
    object_type: trace.object_type,
    object_ref_hash: trace.object_ref_hash,
    object_ref_canonical: trace.object_ref_canonical,
    trace_id: trace.trace_id,
    event_count: trace.event_types.length,
    event_types: [...trace.event_types],
    event_path_label: trace.event_types.join(" -> "),
    start_at: trace.start_at,
    end_at: trace.end_at,
    duration_ms: millisecondsBetween(trace.start_at, trace.end_at),
  };
}

function compareNodes(left: ProcessNodeViewModel, right: ProcessNodeViewModel): number {
  return (
    right.frequency - left.frequency ||
    left.label.localeCompare(right.label) ||
    left.id.localeCompare(right.id)
  );
}

function compareEdges(left: ProcessEdgeViewModel, right: ProcessEdgeViewModel): number {
  return (
    right.count - left.count ||
    left.object_type.localeCompare(right.object_type) ||
    left.source_label.localeCompare(right.source_label) ||
    left.target_label.localeCompare(right.target_label) ||
    left.id.localeCompare(right.id)
  );
}

function comparePaths(left: ProcessPathViewModel, right: ProcessPathViewModel): number {
  return (
    right.count - left.count ||
    left.object_type.localeCompare(right.object_type) ||
    left.path.localeCompare(right.path)
  );
}

function compareSelectors(
  left: ProcessDrilldownSelectorViewModel,
  right: ProcessDrilldownSelectorViewModel
): number {
  return (
    right.count - left.count ||
    selectorKindRank(left.kind) - selectorKindRank(right.kind) ||
    left.label.localeCompare(right.label) ||
    left.id.localeCompare(right.id)
  );
}

function selectorKindRank(kind: ProcessDrilldownSelectorKind): number {
  if (kind === "edge") {
    return 0;
  }
  if (kind === "path") {
    return 1;
  }
  return 2;
}

function compareTraces(left: ProcessTraceItemViewModel, right: ProcessTraceItemViewModel): number {
  return (
    compareTimestamp(left.start_at, right.start_at) ||
    left.object_type.localeCompare(right.object_type) ||
    left.object_ref_canonical.localeCompare(right.object_ref_canonical)
  );
}

function compareTimestamp(left: string, right: string): number {
  return new Date(left).valueOf() - new Date(right).valueOf();
}

function normalizeEventNodeLabel(value: string): string {
  return value.replace(/^event:/, "");
}

function formatUtcTimestamp(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) {
    return value;
  }
  return parsed.toLocaleString();
}

function millisecondsBetween(startAt: string, endAt: string): number {
  const start = new Date(startAt).valueOf();
  const end = new Date(endAt).valueOf();
  if (Number.isNaN(start) || Number.isNaN(end)) {
    return 0;
  }
  return Math.max(0, end - start);
}
