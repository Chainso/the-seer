import { fetchApi } from './client';
import type {
  OcdfgBoundaryActivity,
  OcdfgBoundaryActivityContract,
  OcdfgEdge,
  OcdfgEdgeContract,
  OcdfgGraph,
  OcdfgMiningResponseContract,
  OcdfgNode,
  OcdfgNodeContract,
  OcpnEdge,
  OcpnGraph,
  OcpnNode,
  ProcessMineResponseContract,
  ProcessMiningRequestContract,
  ProcessTraceDrilldownResponseContract,
} from '@/app/types/process-mining';

export interface ProcessMiningRequest {
  modelUri?: string;
  modelUris?: string[];
  from?: string;
  to?: string;
  traceId?: string;
  workflowId?: string;
  filters?: Record<string, string>;
  minShare?: number;
  collapseObjects?: boolean;
  maxEvents?: number;
  maxRelations?: number;
  maxTracesPerHandle?: number;
}

const DEFAULT_WINDOW_MS = 24 * 60 * 60 * 1000;
const MIN_WINDOW_MS = 60 * 1000;

function toIsoOrNull(value: string | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) {
    return null;
  }
  return parsed.toISOString();
}

function resolveCanonicalWindow(from: string | undefined, to: string | undefined): {
  startAt: string;
  endAt: string;
} {
  let startAt = toIsoOrNull(from);
  let endAt = toIsoOrNull(to);

  if (!startAt && !endAt) {
    const now = new Date();
    endAt = now.toISOString();
    startAt = new Date(now.valueOf() - DEFAULT_WINDOW_MS).toISOString();
  } else if (!startAt && endAt) {
    startAt = new Date(new Date(endAt).valueOf() - DEFAULT_WINDOW_MS).toISOString();
  } else if (startAt && !endAt) {
    endAt = new Date(new Date(startAt).valueOf() + DEFAULT_WINDOW_MS).toISOString();
  }

  const startMillis = new Date(startAt as string).valueOf();
  const endMillis = new Date(endAt as string).valueOf();
  if (!Number.isFinite(startMillis) || !Number.isFinite(endMillis)) {
    throw new Error('Unable to resolve a valid process-mining time window.');
  }
  if (startMillis >= endMillis) {
    endAt = new Date(startMillis + MIN_WINDOW_MS).toISOString();
  }

  return {
    startAt: startAt as string,
    endAt: endAt as string,
  };
}

function normalizeModelUris(modelUris: string[] | undefined): string[] | undefined {
  if (!Array.isArray(modelUris) || modelUris.length === 0) {
    return undefined;
  }

  const normalized = Array.from(new Set(modelUris.map((value) => value.trim()).filter(Boolean)));
  return normalized.length > 0 ? normalized : undefined;
}

function toTransitionNode(node: ProcessMineResponseContract['nodes'][number]): OcpnNode {
  return {
    id: node.id,
    label: node.label,
    type: 'TRANSITION',
    eventUri: node.label,
    count: Number(node.frequency) || 0,
    firstSeen: null,
    lastSeen: null,
    medianSeen: null,
    modelUri: null,
    stateUri: null,
    avgSeconds: null,
    p50Seconds: null,
    p95Seconds: null,
  };
}

function buildObjectTypeCounts(
  edges: Array<{ object_type: string; count: number }>
): Map<string, number> {
  const counts = new Map<string, number>();
  edges.forEach((edge) => {
    counts.set(edge.object_type, (counts.get(edge.object_type) || 0) + (Number(edge.count) || 0));
  });
  return counts;
}

function buildOcpnEdges(
  run: ProcessMineResponseContract,
  options: {
    collapseObjects: boolean;
    minShare: number | undefined;
  }
): OcpnEdge[] {
  const { collapseObjects, minShare } = options;
  const totalsByObjectType = buildObjectTypeCounts(run.edges);
  const minShareThreshold = typeof minShare === 'number' ? Math.max(0, minShare) : 0;
  const edges: OcpnEdge[] = [];

  run.edges.forEach((edge) => {
    const total = totalsByObjectType.get(edge.object_type) || 0;
    const share = total > 0 ? edge.count / total : 0;
    if (share < minShareThreshold) {
      return;
    }

    if (collapseObjects) {
      edges.push({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        modelUri: edge.object_type,
        count: Number(edge.count) || 0,
        share,
      });
      return;
    }

    const objectNodeId = `object:${edge.object_type}`;
    edges.push(
      {
        id: `${edge.id}:in`,
        source: edge.source,
        target: objectNodeId,
        modelUri: edge.object_type,
        count: Number(edge.count) || 0,
        share,
      },
      {
        id: `${edge.id}:out`,
        source: objectNodeId,
        target: edge.target,
        modelUri: edge.object_type,
        count: Number(edge.count) || 0,
        share,
      }
    );
  });

  return edges;
}

function buildPlaceNodes(run: ProcessMineResponseContract): OcpnNode[] {
  const countsByObjectType = buildObjectTypeCounts(run.edges);
  return run.object_types.map((objectType) => ({
    id: `object:${objectType}`,
    label: objectType,
    type: 'PLACE',
    modelUri: objectType,
    count: countsByObjectType.get(objectType) || 0,
    firstSeen: null,
    lastSeen: null,
    medianSeen: null,
    stateUri: null,
    eventUri: null,
    avgSeconds: null,
    p50Seconds: null,
    p95Seconds: null,
  }));
}

function toMineRequestContract(payload: ProcessMiningRequest): ProcessMiningRequestContract {
  const modelUri = payload.modelUri || payload.modelUris?.[0];
  if (!modelUri) {
    throw new Error('Process mining requires an ontology object model selection.');
  }

  const includeObjectTypes = normalizeModelUris(payload.modelUris);
  const { startAt, endAt } = resolveCanonicalWindow(payload.from, payload.to);
  const maxEvents =
    typeof payload.maxEvents === 'number' && Number.isFinite(payload.maxEvents)
      ? Math.max(1, Math.floor(payload.maxEvents))
      : undefined;
  const maxRelations =
    typeof payload.maxRelations === 'number' && Number.isFinite(payload.maxRelations)
      ? Math.max(1, Math.floor(payload.maxRelations))
      : undefined;
  const maxTracesPerHandle =
    typeof payload.maxTracesPerHandle === 'number' && Number.isFinite(payload.maxTracesPerHandle)
      ? Math.max(1, Math.floor(payload.maxTracesPerHandle))
      : undefined;

  return {
    anchor_object_type: modelUri,
    start_at: startAt,
    end_at: endAt,
    include_object_types: includeObjectTypes,
    max_events: maxEvents,
    max_relations: maxRelations,
    max_traces_per_handle: maxTracesPerHandle,
  };
}

export async function mineProcess(payload: ProcessMiningRequest): Promise<ProcessMineResponseContract> {
  const contract = toMineRequestContract(payload);
  return fetchApi<ProcessMineResponseContract>('/process/mine', {
    method: 'POST',
    body: JSON.stringify(contract),
  });
}

export async function mineOcdfg(payload: ProcessMiningRequest): Promise<OcdfgMiningResponseContract> {
  const contract = toMineRequestContract(payload);
  return fetchApi<OcdfgMiningResponseContract>('/process/ocdfg/mine', {
    method: 'POST',
    body: JSON.stringify(contract),
  });
}

function toOcdfgNode(node: OcdfgNodeContract): OcdfgNode {
  return {
    id: node.id,
    activity: node.activity,
    count: Number(node.count) || 0,
    traceHandle: node.trace_handle,
  };
}

function toOcdfgEdge(edge: OcdfgEdgeContract): OcdfgEdge {
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceActivity: edge.source_activity,
    targetActivity: edge.target_activity,
    objectType: edge.object_type,
    count: Number(edge.count) || 0,
    share: Number(edge.share) || 0,
    p50Seconds: edge.p50_seconds,
    p95Seconds: edge.p95_seconds,
    traceHandle: edge.trace_handle,
  };
}

function toOcdfgBoundaryActivity(item: OcdfgBoundaryActivityContract): OcdfgBoundaryActivity {
  return {
    id: item.id,
    objectType: item.object_type,
    activity: item.activity,
    count: Number(item.count) || 0,
    traceHandle: item.trace_handle,
  };
}

function filterOcdfgEdges(
  edges: OcdfgEdgeContract[],
  minShare: number | undefined
): OcdfgEdgeContract[] {
  const minShareThreshold = typeof minShare === 'number' ? Math.max(0, minShare) : 0;
  return edges.filter((edge) => (Number(edge.share) || 0) >= minShareThreshold);
}

export async function getOcdfgGraph(payload: ProcessMiningRequest): Promise<OcdfgGraph> {
  const run = await mineOcdfg(payload);
  const filteredEdges = filterOcdfgEdges(run.edges, payload.minShare);
  return {
    runId: run.run_id,
    anchorObjectType: run.anchor_object_type,
    startAt: run.start_at,
    endAt: run.end_at,
    nodes: run.nodes.map(toOcdfgNode),
    edges: filteredEdges.map(toOcdfgEdge),
    startActivities: run.start_activities.map(toOcdfgBoundaryActivity),
    endActivities: run.end_activities.map(toOcdfgBoundaryActivity),
    objectTypes: run.object_types,
    warnings: run.warnings,
  };
}

export function toOcpnGraphFromOcdfg(graph: OcdfgGraph): OcpnGraph {
  return {
    nodes: graph.nodes.map((node) => ({
      id: node.id,
      label: node.activity,
      type: 'TRANSITION',
      eventUri: node.activity,
      count: node.count,
      firstSeen: null,
      lastSeen: null,
      medianSeen: null,
      modelUri: null,
      stateUri: null,
      avgSeconds: null,
      p50Seconds: null,
      p95Seconds: null,
    })),
    edges: graph.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      modelUri: edge.objectType,
      count: edge.count,
      share: edge.share,
    })),
  };
}

export async function getOcpnGraph(payload: ProcessMiningRequest): Promise<OcpnGraph> {
  const run = await mineProcess(payload);
  const collapseObjects = payload.collapseObjects ?? true;

  const transitionNodes = run.nodes.map(toTransitionNode);
  const placeNodes = collapseObjects ? [] : buildPlaceNodes(run);
  const edges = buildOcpnEdges(run, {
    collapseObjects,
    minShare: payload.minShare,
  });

  return {
    nodes: [...placeNodes, ...transitionNodes],
    edges,
  };
}

export async function getProcessTraceDrilldown(
  handle: string,
  limit = 25
): Promise<ProcessTraceDrilldownResponseContract> {
  const query = new URLSearchParams({
    handle,
    limit: String(limit),
  }).toString();
  return fetchApi<ProcessTraceDrilldownResponseContract>(`/process/traces?${query}`);
}

export async function interpretProcessRun(run: ProcessMineResponseContract) {
  return fetchApi<unknown>('/ai/process/interpret', {
    method: 'POST',
    body: JSON.stringify({ run }),
  });
}
