import { recordPerformanceMetric } from '@/app/lib/performance-budget';
import { getOntologyGraph } from './ontology';
import { mineProcess, type ProcessMineResponseContract } from './process-mining';
import type {
  FlowMetric,
  OntologyRuntimeOverlay,
  RuntimeOverlayQuery,
  StateDurationMetric,
} from '@/app/types/analytics';
import type { OntologyEdge, OntologyGraph, OntologyNode } from '@/app/types/ontology';

interface TransitionStateMapping {
  fromState: string;
  toState: string;
}

interface TransitionIndex {
  byKey: Map<string, TransitionStateMapping>;
  stateUris: Set<string>;
}

function normalizeFlowMetric(metric: FlowMetric): FlowMetric {
  return {
    fromState: metric.fromState,
    toState: metric.toState,
    count: Number(metric.count) || 0,
    share: Number(metric.share) || 0,
  };
}

function normalizeDurationMetric(metric: StateDurationMetric): StateDurationMetric {
  return {
    stateUri: metric.stateUri,
    count: Number(metric.count) || 0,
    avgSeconds: Number(metric.avgSeconds) || 0,
    p50Seconds: Number(metric.p50Seconds) || 0,
    p95Seconds: Number(metric.p95Seconds) || 0,
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

function normalizeMatchKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function toEdgeLookup(edges: OntologyEdge[]): Map<string, OntologyEdge[]> {
  const lookup = new Map<string, OntologyEdge[]>();
  edges.forEach((edge) => {
    if (!lookup.has(edge.type)) {
      lookup.set(edge.type, []);
    }
    lookup.get(edge.type)?.push(edge);
  });
  return lookup;
}

function transitionCandidateKeys(
  transition: OntologyNode,
  nodeByUri: Map<string, OntologyNode>,
  graph: OntologyGraph
): string[] {
  const keys = new Set<string>();
  const transitionName = transition.properties?.name;
  if (typeof transitionName === 'string' && transitionName.trim()) {
    keys.add(normalizeMatchKey(transitionName));
  }
  keys.add(normalizeMatchKey(iriLocalName(transition.uri)));

  graph.edges
    .filter((edge) => edge.fromUri === transition.uri || edge.toUri === transition.uri)
    .forEach((edge) => {
      const peerUri = edge.fromUri === transition.uri ? edge.toUri : edge.fromUri;
      const peerNode = nodeByUri.get(peerUri);
      if (!peerNode) return;
      if (peerNode.label !== 'Event' && peerNode.label !== 'Signal') return;
      const peerName = peerNode.properties?.name;
      if (typeof peerName === 'string' && peerName.trim()) {
        keys.add(normalizeMatchKey(peerName));
      }
      keys.add(normalizeMatchKey(iriLocalName(peerUri)));
    });

  return Array.from(keys).filter(Boolean);
}

function buildTransitionIndex(graph: OntologyGraph, modelUri: string): TransitionIndex {
  const nodeByUri = new Map<string, OntologyNode>();
  graph.nodes.forEach((node) => nodeByUri.set(node.uri, node));
  const edgesByType = toEdgeLookup(graph.edges);

  const modelTransitionUris = new Set(
    (edgesByType.get('transitionOf') || [])
      .filter((edge) => edge.toUri === modelUri)
      .map((edge) => edge.fromUri)
  );

  const stateUris = new Set(
    (edgesByType.get('hasPossibleState') || [])
      .filter((edge) => edge.fromUri === modelUri)
      .map((edge) => edge.toUri)
  );

  const fromStateByTransition = new Map<string, string>();
  (edgesByType.get('fromState') || []).forEach((edge) => {
    fromStateByTransition.set(edge.fromUri, edge.toUri);
  });

  const toStateByTransition = new Map<string, string>();
  (edgesByType.get('toState') || []).forEach((edge) => {
    toStateByTransition.set(edge.fromUri, edge.toUri);
  });

  const byKey = new Map<string, TransitionStateMapping>();

  graph.nodes
    .filter((node) => node.label === 'Transition' && modelTransitionUris.has(node.uri))
    .forEach((transition) => {
      const fromState = fromStateByTransition.get(transition.uri);
      const toState = toStateByTransition.get(transition.uri);
      if (!fromState || !toState) {
        return;
      }
      transitionCandidateKeys(transition, nodeByUri, graph).forEach((key) => {
        if (!byKey.has(key)) {
          byKey.set(key, { fromState, toState });
        }
      });
    });

  return {
    byKey,
    stateUris,
  };
}

function deriveFlowMetrics(
  run: ProcessMineResponseContract,
  transitionIndex: TransitionIndex
): FlowMetric[] {
  const counts = new Map<string, number>();

  run.nodes.forEach((node) => {
    const count = Number(node.frequency) || 0;
    if (count <= 0) {
      return;
    }

    const candidates = [
      normalizeMatchKey(node.label),
      normalizeMatchKey(node.id.replace(/^event:/i, '')),
    ];

    let mapping: TransitionStateMapping | undefined;
    for (const candidate of candidates) {
      mapping = transitionIndex.byKey.get(candidate);
      if (mapping) {
        break;
      }
    }
    if (!mapping) {
      return;
    }

    const key = `${mapping.fromState}::${mapping.toState}`;
    counts.set(key, (counts.get(key) || 0) + count);
  });

  const total = Array.from(counts.values()).reduce((sum, count) => sum + count, 0);
  if (total <= 0) {
    return [];
  }

  return Array.from(counts.entries())
    .map(([key, count]) => {
      const [fromState, toState] = key.split('::');
      return normalizeFlowMetric({
        fromState,
        toState,
        count,
        share: count / total,
      });
    })
    .sort((a, b) => b.count - a.count);
}

function deriveStateDurations(
  run: ProcessMineResponseContract,
  transitionIndex: TransitionIndex,
  flows: FlowMetric[]
): StateDurationMetric[] {
  const startMillis = new Date(run.start_at).valueOf();
  const endMillis = new Date(run.end_at).valueOf();
  const windowSeconds =
    Number.isFinite(startMillis) && Number.isFinite(endMillis) && endMillis > startMillis
      ? (endMillis - startMillis) / 1000
      : 0;

  const stateUris =
    transitionIndex.stateUris.size > 0
      ? Array.from(transitionIndex.stateUris)
      : Array.from(
          new Set([
            ...flows.map((flow) => flow.fromState),
            ...flows.map((flow) => flow.toState),
          ])
        );

  return stateUris.map((stateUri) => {
    const outgoing = flows
      .filter((flow) => flow.fromState === stateUri)
      .reduce((sum, flow) => sum + flow.count, 0);
    const incoming = flows
      .filter((flow) => flow.toState === stateUri)
      .reduce((sum, flow) => sum + flow.count, 0);
    const count = Math.max(outgoing, incoming);
    const avgSeconds = count > 0 && windowSeconds > 0 ? windowSeconds / count : 0;
    return normalizeDurationMetric({
      stateUri,
      count,
      avgSeconds,
      p50Seconds: avgSeconds * 0.75,
      p95Seconds: avgSeconds * 1.5,
    });
  });
}

async function deriveCanonicalOverlayData(query: RuntimeOverlayQuery): Promise<{
  flows: FlowMetric[];
  stateDurations: StateDurationMetric[];
}> {
  const [graph, run] = await Promise.all([
    getOntologyGraph(),
    mineProcess({
      modelUri: query.modelUri,
      from: query.from,
      to: query.to,
      traceId: query.traceId,
      workflowId: query.workflowId,
      filters: query.filters,
      collapseObjects: true,
    }),
  ]);

  const transitionIndex = buildTransitionIndex(graph, query.modelUri);
  const flows = deriveFlowMetrics(run, transitionIndex);
  const stateDurations = deriveStateDurations(run, transitionIndex, flows);
  return { flows, stateDurations };
}

export async function getFlowMetrics(options: RuntimeOverlayQuery): Promise<FlowMetric[]> {
  const overlay = await getOntologyRuntimeOverlay(options);
  return overlay.flows.map(normalizeFlowMetric);
}

export async function getStateDurations(options: RuntimeOverlayQuery): Promise<StateDurationMetric[]> {
  const overlay = await getOntologyRuntimeOverlay(options);
  return overlay.stateDurations.map(normalizeDurationMetric);
}

export async function getOntologyRuntimeOverlay(
  query: RuntimeOverlayQuery
): Promise<OntologyRuntimeOverlay> {
  const startedAt =
    typeof window !== 'undefined' && typeof window.performance !== 'undefined'
      ? window.performance.now()
      : null;
  try {
    const { flows, stateDurations } = await deriveCanonicalOverlayData(query);
    const totalFlowCount = flows.reduce((sum, metric) => sum + metric.count, 0);
    return {
      query,
      generatedAt: new Date().toISOString(),
      flows: flows.map(normalizeFlowMetric),
      stateDurations: stateDurations.map(normalizeDurationMetric),
      stats: {
        totalFlowCount,
        transitionPairCount: flows.length,
        stateDurationCount: stateDurations.length,
      },
    };
  } finally {
    if (
      startedAt !== null &&
      typeof window !== 'undefined' &&
      typeof window.performance !== 'undefined'
    ) {
      recordPerformanceMetric("runtime_overlay_load_ms", window.performance.now() - startedAt);
    }
  }
}
