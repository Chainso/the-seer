import { fetchApi } from './client';
import type { OcpnEdge, OcpnGraph, OcpnNode } from '@/app/types/process-mining';

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

interface ProcessMineRequestContract {
  anchor_object_type: string;
  anchor_object_type_uri?: string;
  start_at: string;
  end_at: string;
  include_object_types?: string[];
  include_object_type_uris?: string[];
  max_events?: number;
  max_relations?: number;
  max_traces_per_handle?: number;
}

interface ProcessMineNodeContract {
  id: string;
  label: string;
  node_type: string;
  frequency: number;
  trace_handle: string;
}

interface ProcessMineEdgeContract {
  id: string;
  source: string;
  target: string;
  object_type: string;
  count: number;
  trace_handle: string;
}

interface ProcessPathStatContract {
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

function iriLocalName(iri: string): string {
  const hashIndex = iri.lastIndexOf('#');
  if (hashIndex >= 0 && hashIndex < iri.length - 1) {
    return iri.slice(hashIndex + 1);
  }
  const slashIndex = iri.lastIndexOf('/');
  if (slashIndex >= 0 && slashIndex < iri.length - 1) {
    return iri.slice(slashIndex + 1);
  }
  return iri;
}

function fallbackObjectTypeFromModelUri(modelUri: string): string {
  const localName = iriLocalName(modelUri).replace(/^obj[_:-]?/i, '');
  const tokens = localName
    .split(/[^a-zA-Z0-9]+/)
    .map((token) => token.trim())
    .filter(Boolean);

  if (tokens.length === 0) {
    return modelUri;
  }

  return tokens
    .map((token) => token[0].toUpperCase() + token.slice(1))
    .join('');
}

function normalizeModelUris(modelUris: string[] | undefined): string[] | undefined {
  if (!Array.isArray(modelUris) || modelUris.length === 0) {
    return undefined;
  }

  const normalized = Array.from(new Set(modelUris.map((value) => value.trim()).filter(Boolean)));
  return normalized.length > 0 ? normalized : undefined;
}

function resolveIncludeObjectTypes(modelUris: string[] | undefined): string[] | undefined {
  const normalizedModelUris = normalizeModelUris(modelUris);
  if (!normalizedModelUris) {
    return undefined;
  }

  const unique = Array.from(
    new Set(normalizedModelUris.map((modelUri) => fallbackObjectTypeFromModelUri(modelUri)))
  );
  return unique.length > 0 ? unique : undefined;
}

function toTransitionNode(node: ProcessMineNodeContract): OcpnNode {
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

function buildObjectTypeCounts(run: ProcessMineResponseContract): Map<string, number> {
  const counts = new Map<string, number>();
  run.edges.forEach((edge) => {
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
  const totalsByObjectType = buildObjectTypeCounts(run);
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
  const countsByObjectType = buildObjectTypeCounts(run);
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

function toMineRequestContract(payload: ProcessMiningRequest): ProcessMineRequestContract {
  const modelUri = payload.modelUri || payload.modelUris?.[0];
  if (!modelUri) {
    throw new Error('Process mining requires an ontology object model selection.');
  }

  const anchorObjectType = fallbackObjectTypeFromModelUri(modelUri);
  const includeObjectTypeUris = normalizeModelUris(payload.modelUris);
  const includeObjectTypes = resolveIncludeObjectTypes(includeObjectTypeUris);
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
    anchor_object_type: anchorObjectType,
    anchor_object_type_uri: modelUri,
    start_at: startAt,
    end_at: endAt,
    include_object_types: includeObjectTypes,
    include_object_type_uris: includeObjectTypeUris,
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
