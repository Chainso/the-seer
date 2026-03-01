import ELK from 'elkjs/lib/elk.bundled.js';

import type { OcdfgGraph, OcdfgNode } from '@/app/types/process-mining';

export const OCDFG_NODE_WIDTH = 220;
export const OCDFG_NODE_HEIGHT = 82;
export const OCDFG_OBJECT_NODE_WIDTH = 200;
export const OCDFG_OBJECT_NODE_HEIGHT = 88;
export const OCDFG_TRACK_SPACING = 180;
const OCDFG_PORT_EDGE_OFFSET = 4;

export interface LayoutPoint {
  x: number;
  y: number;
}

export interface OcdfgLayoutNode {
  id: string;
  kind: 'activity' | 'object';
  activity: string | null;
  objectType: string | null;
  count: number;
  x: number;
  y: number;
  width: number;
  height: number;
  objectTypes: string[];
  partition: number;
  centroidY: number;
}

export interface OcdfgLayoutEdge {
  id: string;
  kind: 'flow' | 'start';
  source: string;
  target: string;
  objectType: string;
  count: number;
  share: number;
  p50Seconds: number | null;
  p95Seconds: number | null;
  points: LayoutPoint[];
}

export interface OcdfgLayoutResult {
  nodes: OcdfgLayoutNode[];
  edges: OcdfgLayoutEdge[];
  trackOrder: string[];
  nodeObjectTypes: Record<string, string[]>;
}

export interface ObjectTypeNodeColorSet {
  objectBackground: string;
  objectBorder: string;
  eventBackground: string;
  eventBorder: string;
  edgeStroke: string;
}

interface HeldKarpState {
  score: number;
  path: number[];
}

interface NodeLanePlacement {
  objectTypes: string[];
  partition: number;
  centroidY: number;
}

interface LayoutGraphNode {
  id: string;
  kind: 'activity' | 'object';
  activity: string | null;
  objectType: string | null;
  count: number;
  width: number;
  height: number;
}

interface LayoutGraphEdge {
  id: string;
  renderId: string;
  kind: 'flow' | 'start';
  source: string;
  target: string;
  objectType: string;
  count: number;
  share: number;
  p50Seconds: number | null;
  p95Seconds: number | null;
}

interface ElkEdgeSection {
  startPoint?: LayoutPoint;
  bendPoints?: LayoutPoint[];
  endPoint?: LayoutPoint;
}

interface ElkLayoutEdge {
  id: string;
  sections?: ElkEdgeSection[];
}

const elk = new ELK();

function compareTrackPaths(a: number[], b: number[], objectTypes: string[]): number {
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    const byName = objectTypes[a[i]].localeCompare(objectTypes[b[i]]);
    if (byName !== 0) {
      return byName;
    }
    if (a[i] !== b[i]) {
      return a[i] - b[i];
    }
  }
  return a.length - b.length;
}

function assignUniqueEdgeIds<T extends { id: string; objectType: string }>(edges: T[]): Array<T & { renderId: string }> {
  const countsByBaseId = new Map<string, number>();
  return edges.map((edge) => {
    const baseId = `${edge.id}::${edge.objectType}`;
    const seen = countsByBaseId.get(baseId) ?? 0;
    countsByBaseId.set(baseId, seen + 1);
    return {
      ...edge,
      renderId: seen === 0 ? baseId : `${baseId}::${seen}`,
    };
  });
}

function deriveObjectTypes(graph: OcdfgGraph): string[] {
  const ordered = graph.objectTypes.map((value) => value.trim()).filter(Boolean);
  const seen = new Set<string>(ordered);
  const extras = new Set<string>();

  graph.nodes.forEach((node) => {
    const objectType = node.objectType?.trim();
    if (!objectType || seen.has(objectType)) {
      return;
    }
    extras.add(objectType);
  });

  graph.edges.forEach((edge) => {
    const objectType = edge.objectType.trim();
    if (!objectType || seen.has(objectType)) {
      return;
    }
    extras.add(objectType);
  });

  return [...ordered, ...Array.from(extras).sort((a, b) => a.localeCompare(b))];
}

function deriveNodeObjectTypes(graph: OcdfgGraph): Map<string, string[]> {
  const nodeObjectTypes = new Map<string, Set<string>>();
  graph.nodes.forEach((node) => {
    const scoped = new Set<string>();
    if (node.objectType) {
      scoped.add(node.objectType);
    }
    nodeObjectTypes.set(node.id, scoped);
  });

  graph.edges.forEach((edge) => {
    const sourceSet = nodeObjectTypes.get(edge.source) ?? new Set<string>();
    sourceSet.add(edge.objectType);
    nodeObjectTypes.set(edge.source, sourceSet);

    const targetSet = nodeObjectTypes.get(edge.target) ?? new Set<string>();
    targetSet.add(edge.objectType);
    nodeObjectTypes.set(edge.target, targetSet);
  });

  const normalized = new Map<string, string[]>();
  nodeObjectTypes.forEach((objectTypes, nodeId) => {
    normalized.set(nodeId, Array.from(objectTypes).sort((a, b) => a.localeCompare(b)));
  });

  return normalized;
}

function buildInteractionMatrix(objectTypes: string[], nodeObjectTypes: Map<string, string[]>): number[][] {
  const typeIndex = new Map(objectTypes.map((objectType, index) => [objectType, index] as const));
  const matrix = Array.from({ length: objectTypes.length }, () => Array.from({ length: objectTypes.length }, () => 0));

  nodeObjectTypes.forEach((nodeTypes) => {
    if (nodeTypes.length <= 1) {
      return;
    }
    const indices = nodeTypes
      .map((objectType) => typeIndex.get(objectType))
      .filter((value): value is number => typeof value === 'number')
      .sort((a, b) => a - b);

    for (let i = 0; i < indices.length; i += 1) {
      for (let j = i + 1; j < indices.length; j += 1) {
        const left = indices[i];
        const right = indices[j];
        matrix[left][right] += 1;
        matrix[right][left] += 1;
      }
    }
  });

  return matrix;
}

function updateHeldKarpState(options: {
  bucket: Map<number, HeldKarpState>;
  endIndex: number;
  candidate: HeldKarpState;
  objectTypes: string[];
}): void {
  const { bucket, endIndex, candidate, objectTypes } = options;
  const existing = bucket.get(endIndex);
  if (!existing) {
    bucket.set(endIndex, candidate);
    return;
  }

  if (candidate.score > existing.score) {
    bucket.set(endIndex, candidate);
    return;
  }

  if (candidate.score === existing.score && compareTrackPaths(candidate.path, existing.path, objectTypes) < 0) {
    bucket.set(endIndex, candidate);
  }
}

function heldKarpTrackOrdering(objectTypes: string[], interaction: number[][]): string[] {
  const count = objectTypes.length;
  if (count <= 1) {
    return [...objectTypes];
  }

  let frontier = new Map<number, Map<number, HeldKarpState>>();
  const bitAt = (index: number) => 2 ** index;
  const hasBit = (mask: number, bit: number) => Math.floor(mask / bit) % 2 === 1;

  for (let start = 0; start < count; start += 1) {
    const mask = bitAt(start);
    const states = frontier.get(mask) ?? new Map<number, HeldKarpState>();
    states.set(start, { score: 0, path: [start] });
    frontier.set(mask, states);
  }

  for (let step = 1; step < count; step += 1) {
    const nextFrontier = new Map<number, Map<number, HeldKarpState>>();

    frontier.forEach((states, mask) => {
      states.forEach((state, endIndex) => {
        for (let candidate = 0; candidate < count; candidate += 1) {
          const candidateBit = bitAt(candidate);
          if (hasBit(mask, candidateBit)) {
            continue;
          }

          const nextMask = mask + candidateBit;
          const nextStates = nextFrontier.get(nextMask) ?? new Map<number, HeldKarpState>();
          const nextState: HeldKarpState = {
            score: state.score + interaction[endIndex][candidate],
            path: [...state.path, candidate],
          };

          updateHeldKarpState({
            bucket: nextStates,
            endIndex: candidate,
            candidate: nextState,
            objectTypes,
          });
          nextFrontier.set(nextMask, nextStates);
        }
      });
    });

    frontier = nextFrontier;
  }

  const fullMask = 2 ** count - 1;

  const completed = frontier.get(fullMask);
  if (!completed || completed.size === 0) {
    return [...objectTypes].sort((a, b) => a.localeCompare(b));
  }

  let best: HeldKarpState | null = null;
  for (const state of completed.values()) {
    if (!best) {
      best = state;
      continue;
    }

    if (state.score > best.score) {
      best = state;
      continue;
    }

    if (state.score === best.score && compareTrackPaths(state.path, best.path, objectTypes) < 0) {
      best = state;
    }
  }

  if (!best) {
    return [...objectTypes].sort((a, b) => a.localeCompare(b));
  }

  return best.path.map((index) => objectTypes[index]);
}

function buildLanePlacements(options: {
  trackOrder: string[];
  nodes: OcdfgNode[];
  nodeObjectTypes: Map<string, string[]>;
}): Map<string, NodeLanePlacement> {
  const { trackOrder, nodes, nodeObjectTypes } = options;
  const trackIndex = new Map(trackOrder.map((objectType, index) => [objectType, index] as const));
  const globalCentroid = trackOrder.length > 1 ? (trackOrder.length - 1) / 2 : 0;

  const placements = new Map<string, NodeLanePlacement>();
  nodes.forEach((node) => {
    const baseTypes =
      node.kind === 'object' && node.objectType
        ? [node.objectType]
        : (nodeObjectTypes.get(node.id) ?? []);
    const objectTypes = baseTypes
      .filter((objectType) => trackIndex.has(objectType))
      .sort((left, right) => {
        const leftIndex = trackIndex.get(left) ?? Number.MAX_SAFE_INTEGER;
        const rightIndex = trackIndex.get(right) ?? Number.MAX_SAFE_INTEGER;
        if (leftIndex !== rightIndex) {
          return leftIndex - rightIndex;
        }
        return left.localeCompare(right);
      });

    let centroidTrack = globalCentroid;
    if (objectTypes.length === 1) {
      centroidTrack = trackIndex.get(objectTypes[0]) ?? globalCentroid;
    } else if (objectTypes.length > 1) {
      const total = objectTypes.reduce((sum, objectType) => sum + (trackIndex.get(objectType) ?? globalCentroid), 0);
      centroidTrack = total / objectTypes.length;
    }

    const partition = Math.max(0, Math.min(trackOrder.length - 1, Math.round(centroidTrack)));
    placements.set(node.id, {
      objectTypes,
      partition,
      centroidY: centroidTrack * OCDFG_TRACK_SPACING,
    });
  });

  return placements;
}

function toNodeObjectTypeRecord(nodeObjectTypes: Map<string, string[]>): Record<string, string[]> {
  const orderedEntries = Array.from(nodeObjectTypes.entries()).sort((left, right) => left[0].localeCompare(right[0]));
  return orderedEntries.reduce<Record<string, string[]>>((acc, [nodeId, objectTypes]) => {
    acc[nodeId] = objectTypes;
    return acc;
  }, {});
}

function collectEdgePoints(layoutEdges: ElkLayoutEdge[]): Map<string, LayoutPoint[]> {
  const edgePoints = new Map<string, LayoutPoint[]>();
  layoutEdges.forEach((edge) => {
    const firstSection = edge.sections?.[0];
    if (!firstSection) {
      return;
    }

    const points: LayoutPoint[] = [];
    if (firstSection.startPoint) {
      points.push({ x: firstSection.startPoint.x, y: firstSection.startPoint.y });
    }
    firstSection.bendPoints?.forEach((point) => {
      points.push({ x: point.x, y: point.y });
    });
    if (firstSection.endPoint) {
      points.push({ x: firstSection.endPoint.x, y: firstSection.endPoint.y });
    }

    edgePoints.set(edge.id, points);
  });
  return edgePoints;
}

function sortNodesByLaneAndCentroid(nodes: OcdfgNode[], placements: Map<string, NodeLanePlacement>): OcdfgNode[] {
  return [...nodes].sort((left, right) => {
    const leftPlacement = placements.get(left.id);
    const rightPlacement = placements.get(right.id);

    const byPartition = (leftPlacement?.partition ?? 0) - (rightPlacement?.partition ?? 0);
    if (byPartition !== 0) {
      return byPartition;
    }

    const byCentroid = (leftPlacement?.centroidY ?? 0) - (rightPlacement?.centroidY ?? 0);
    if (byCentroid !== 0) {
      return byCentroid;
    }

    const byKind =
      (left.kind === 'object' ? 0 : 1) -
      (right.kind === 'object' ? 0 : 1);
    if (byKind !== 0) {
      return byKind;
    }

    return left.id.localeCompare(right.id);
  });
}

export async function buildOcdfgLayout(graph: OcdfgGraph): Promise<OcdfgLayoutResult> {
  const objectTypes = deriveObjectTypes(graph);
  const nodeObjectTypes = deriveNodeObjectTypes(graph);
  const interaction = buildInteractionMatrix(objectTypes, nodeObjectTypes);
  const trackOrder = heldKarpTrackOrdering(objectTypes, interaction);
  const trackIndex = new Map(trackOrder.map((objectType, index) => [objectType, index] as const));
  const lanePlacements = buildLanePlacements({
    trackOrder,
    nodes: graph.nodes,
    nodeObjectTypes,
  });

  const orderedNodes = sortNodesByLaneAndCentroid(graph.nodes, lanePlacements);
  const allNodes: LayoutGraphNode[] = orderedNodes.map((node) => ({
    id: node.id,
    kind: node.kind,
    activity: node.activity,
    objectType: node.objectType,
    count: node.count,
    width: node.kind === 'object' ? OCDFG_OBJECT_NODE_WIDTH : OCDFG_NODE_WIDTH,
    height: node.kind === 'object' ? OCDFG_OBJECT_NODE_HEIGHT : OCDFG_NODE_HEIGHT,
  }));

  const sortedEdges = [...graph.edges].sort((left, right) => {
    const bySource = left.source.localeCompare(right.source);
    if (bySource !== 0) {
      return bySource;
    }
    const byTarget = left.target.localeCompare(right.target);
    if (byTarget !== 0) {
      return byTarget;
    }
    const byType = left.objectType.localeCompare(right.objectType);
    if (byType !== 0) {
      return byType;
    }
    return left.id.localeCompare(right.id);
  });
  const allEdges: LayoutGraphEdge[] = assignUniqueEdgeIds(sortedEdges).map((edge) => ({
    id: edge.id,
    renderId: edge.renderId,
    kind: edge.kind,
    source: edge.source,
    target: edge.target,
    objectType: edge.objectType,
    count: edge.count,
    share: edge.share,
    p50Seconds: edge.p50Seconds,
    p95Seconds: edge.p95Seconds,
  }));

  const portMap = new Map<string, { left: string; right: string }>();

  const elkGraph = {
    id: 'ocdfg-graph',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.layered.partitioning.activation': 'TRUE',
      'elk.layered.layering.strategy': 'NETWORK_SIMPLEX',
      'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
      'elk.layered.crossingMinimization.maxIterations': '24',
      'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
      'elk.layered.nodePlacement.bk.fixedAlignment': 'BALANCED',
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
      'elk.layered.mergeEdges': 'false',
      'elk.portConstraints': 'FIXED_POS',
      'elk.layered.spacing.nodeNodeBetweenLayers': '180',
      'elk.spacing.nodeNode': '96',
      'elk.spacing.edgeNode': '52',
      'elk.spacing.edgeEdge': '28',
    },
    children: allNodes.map((node) => {
      const leftPort = `${node.id}__left`;
      const rightPort = `${node.id}__right`;
      portMap.set(node.id, { left: leftPort, right: rightPort });
      const activityLane = lanePlacements.get(node.id);
      const partition =
        node.kind === 'object'
          ? Math.max(0, trackIndex.get(node.objectType ?? '') ?? 0)
          : Math.max(0, activityLane?.partition ?? 0);
      return {
        id: node.id,
        width: node.width,
        height: node.height,
        layoutOptions: {
          'elk.layered.partitioning.partition': String(partition),
        },
        ports: [
          {
            id: leftPort,
            width: 1,
            height: 1,
            x: -OCDFG_PORT_EDGE_OFFSET,
            y: node.height / 2,
            properties: {
              'elk.port.side': 'WEST',
            },
          },
          {
            id: rightPort,
            width: 1,
            height: 1,
            x: node.width + OCDFG_PORT_EDGE_OFFSET,
            y: node.height / 2,
            properties: {
              'elk.port.side': 'EAST',
            },
          },
        ],
      };
    }),
    edges: allEdges.map((edge) => {
      const sourcePort = portMap.get(edge.source);
      const targetPort = portMap.get(edge.target);
      return {
        id: edge.renderId,
        sources: [sourcePort?.right ?? edge.source],
        targets: [targetPort?.left ?? edge.target],
      };
    }),
  };

  const layout = await elk.layout(elkGraph);
  const positions = new Map(
    (layout.children ?? []).map((child) => [
      child.id,
      {
        x: child.x ?? 0,
        y: child.y ?? 0,
      },
    ])
  );

  const edgePoints = collectEdgePoints((layout.edges ?? []) as ElkLayoutEdge[]);

  const layoutNodes = allNodes.map<OcdfgLayoutNode>((node) => {
    const position = positions.get(node.id) ?? { x: 0, y: 0 };
    const activityLane = lanePlacements.get(node.id);
    const partition =
      node.kind === 'object'
        ? Math.max(0, trackIndex.get(node.objectType ?? '') ?? 0)
        : Math.max(0, activityLane?.partition ?? 0);
    const objectTypes = node.kind === 'object' ? [node.objectType ?? ''] : activityLane?.objectTypes ?? [];
    const centroidY =
      node.kind === 'object'
        ? partition * OCDFG_TRACK_SPACING
        : activityLane?.centroidY ?? partition * OCDFG_TRACK_SPACING;
    return {
      id: node.id,
      kind: node.kind,
      activity: node.activity,
      objectType: node.objectType,
      count: node.count,
      x: position.x,
      y: position.y,
      width: node.width,
      height: node.height,
      objectTypes: objectTypes.filter(Boolean),
      partition,
      centroidY,
    };
  });

  const layoutEdges = allEdges.map<OcdfgLayoutEdge>((edge) => ({
    id: edge.renderId,
    kind: edge.kind,
    source: edge.source,
    target: edge.target,
    objectType: edge.objectType,
    count: edge.count,
    share: edge.share,
    p50Seconds: edge.p50Seconds,
    p95Seconds: edge.p95Seconds,
    points: edgePoints.get(edge.renderId) ?? [],
  }));

  return {
    nodes: layoutNodes,
    edges: layoutEdges,
    trackOrder,
    nodeObjectTypes: toNodeObjectTypeRecord(nodeObjectTypes),
  };
}

export function colorForObjectType(objectType: string): string {
  return colorSetForObjectType(objectType).edgeStroke;
}

function hueForKey(key: string): number {
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 31 + key.charCodeAt(index)) % 360;
  }
  return hash;
}

export function colorSetForObjectType(objectType: string): ObjectTypeNodeColorSet {
  const hue = hueForKey(objectType);
  return {
    objectBackground: `hsl(${hue}, 66%, 88%)`,
    objectBorder: `hsl(${hue}, 52%, 46%)`,
    eventBackground: `hsl(${hue}, 72%, 93%)`,
    eventBorder: `hsl(${hue}, 46%, 56%)`,
    edgeStroke: `hsl(${hue}, 55%, 35%)`,
  };
}

export function colorSetForKey(key: string): ObjectTypeNodeColorSet {
  const hue = hueForKey(key);
  return {
    objectBackground: `hsl(${hue}, 60%, 90%)`,
    objectBorder: `hsl(${hue}, 44%, 50%)`,
    eventBackground: `hsl(${hue}, 66%, 94%)`,
    eventBorder: `hsl(${hue}, 40%, 58%)`,
    edgeStroke: `hsl(${hue}, 48%, 38%)`,
  };
}
