'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Background,
  Controls,
  Edge,
  EdgeLabelRenderer,
  EdgeTypes,
  EdgeProps,
  BaseEdge,
  Handle,
  MarkerType,
  MiniMap,
  Node,
  Position,
  ReactFlow,
  ReactFlowProvider,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { Card } from '../ui/card';
import type { OcpnGraph } from '@/app/types/process-mining';
import ELK from 'elkjs/lib/elk.bundled.js';

interface OcpnGraphProps {
  graph: OcpnGraph;
  modelLabels?: Record<string, string>;
  eventLabels?: Record<string, string>;
  selectedNodeId?: string | null;
  onNodeSelect?: (nodeId: string) => void;
  collapseObjects?: boolean;
}

interface ElkEdgePoint {
  x: number;
  y: number;
}

interface ElkEdgeData {
  points?: ElkEdgePoint[];
}

function iriLocalName(value: string): string {
  const hashIndex = value.lastIndexOf("#");
  if (hashIndex >= 0 && hashIndex < value.length - 1) {
    return value.slice(hashIndex + 1);
  }
  const slashIndex = value.lastIndexOf("/");
  if (slashIndex >= 0 && slashIndex < value.length - 1) {
    return value.slice(slashIndex + 1);
  }
  return value;
}

function conceptLabel(value: string | null | undefined): string {
  if (!value) {
    return "Unknown";
  }
  return iriLocalName(value);
}

function buildPolylinePath(points: ElkEdgePoint[]) {
  if (points.length <= 1) {
    return '';
  }
  return points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`)
    .join(' ');
}

function ElkEdge(props: EdgeProps<ElkEdgeData>) {
  const { data, style, markerEnd, label, labelStyle } = props;
  const points = data?.points;
  if (!points || points.length < 2) {
    return null;
  }
  const path = buildPolylinePath(points);
  const labelPoint = points[Math.floor(points.length / 2)];
  return (
    <>
      <BaseEdge path={path} style={style} markerEnd={markerEnd} />
      {label ? (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan"
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelPoint.x}px, ${labelPoint.y}px)`,
            }}
          >
            <span style={labelStyle}>{label}</span>
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

function PlaceNode({ data }: { data: { label: string; count?: number | null } }) {
  const tooltip = data.count != null ? `${data.count} linked event relations` : 'No linked events yet.';

  return (
    <Card
      className="min-w-[200px] border-2 border-border bg-[color:var(--graph-node-state-bg)] px-4 py-3 shadow-sm"
      title={tooltip}
    >
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
      <div className="text-[0.65rem] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
        Object type
      </div>
      <div className="font-display text-sm">{data.label}</div>
      <div className="mt-2 text-xs text-muted-foreground">
        {data.count != null ? `${data.count} relations` : 'No relations yet'}
      </div>
    </Card>
  );
}

function TransitionNode({ data }: { data: { label: string; count?: number | null } }) {
  return (
    <Card className="min-w-[180px] border border-border bg-background px-4 py-3 shadow-sm">
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
      <div className="text-[0.65rem] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
        Event
      </div>
      <div className="font-display text-sm">{data.label}</div>
      <div className="mt-2 text-xs text-muted-foreground">
        {data.count != null ? `${data.count} occurrences` : 'No occurrences yet'}
      </div>
    </Card>
  );
}

const PLACE_NODE_SIZE = { width: 220, height: 120 };
const TRANSITION_NODE_SIZE = { width: 200, height: 100 };
const elk = new ELK();

async function buildLayout(
  graph: OcpnGraph,
  modelLabels?: Record<string, string>,
  eventLabels?: Record<string, string>,
  selectedNodeId?: string | null,
  collapseObjects?: boolean
): Promise<{ nodes: Node[]; edges: Edge[] }> {
  const placeNodes = graph.nodes.filter(node => node.type === 'PLACE');
  const transitionNodes = graph.nodes.filter(node => node.type === 'TRANSITION');

  const nodes: Node[] = [];
  const nodeSizes = new Map<string, { width: number; height: number }>();

  if (!collapseObjects) {
    placeNodes.forEach((node) => {
      const label = node.modelUri && modelLabels?.[node.modelUri]
        ? modelLabels[node.modelUri]
        : conceptLabel(node.label);
      nodes.push({
        id: node.id,
        type: 'placeNode',
        position: { x: 0, y: 0 },
        data: { label, count: node.count },
        className: node.id === selectedNodeId ? 'ring-2 ring-foreground/70' : undefined,
      });
      nodeSizes.set(node.id, PLACE_NODE_SIZE);
    });
  }

  transitionNodes.forEach((node) => {
    const label = node.eventUri && eventLabels?.[node.eventUri]
      ? eventLabels[node.eventUri]
      : conceptLabel(node.label);
    nodes.push({
      id: node.id,
      type: 'transitionNode',
      position: { x: 0, y: 0 },
      data: { label, count: node.count },
      className: node.id === selectedNodeId ? 'ring-2 ring-foreground/70' : undefined,
    });
    nodeSizes.set(node.id, TRANSITION_NODE_SIZE);
  });

  const edgeCounts = new Map<string, number>();
  const edges: Edge[] = graph.edges.map(edge => {
    const label = `${edge.count} • ${(edge.share * 100).toFixed(0)}%`;
    const strokeWidth = Math.max(1.5, 1.5 + edge.share * 6);
    const stroke = edge.modelUri ? colorForModel(edge.modelUri) : '#1f140e';
    const baseId = edge.id;
    const key = `${baseId}::${edge.modelUri ?? "default"}`;
    const seen = edgeCounts.get(key) ?? 0;
    edgeCounts.set(key, seen + 1);
    const edgeId = seen > 0 ? `${baseId}::${edge.modelUri ?? "default"}::${seen}` : key;
    return {
      id: edgeId,
      source: edge.source,
      target: edge.target,
      label,
      type: 'elk',
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: stroke,
      },
      style: {
        stroke,
        strokeWidth,
        strokeOpacity: 0.9,
      },
      labelStyle: {
        fontSize: 10,
        fill: stroke,
        fontWeight: 600,
      },
      data: {
        count: edge.count,
        share: edge.share,
        modelUri: edge.modelUri,
      },
    };
  });

  const { nodes: layoutedNodes, edgePoints } = await applyElkLayout(nodes, edges, nodeSizes);
  const layoutedEdges = edges.map((edge) => ({
    ...edge,
    data: {
      ...(edge.data || {}),
      points: edgePoints.get(edge.id),
    },
  }));

  return { nodes: layoutedNodes, edges: layoutedEdges };
}

function OcpnGraphInner({
  graph,
  modelLabels,
  eventLabels,
  selectedNodeId,
  onNodeSelect,
  collapseObjects,
}: OcpnGraphProps) {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [edgeTooltip, setEdgeTooltip] = useState<{
    x: number;
    y: number;
    count: number;
    share: number;
  } | null>(null);
  const edgeTypes = useMemo<EdgeTypes>(
    () => ({
      elk: ElkEdge,
    }),
    []
  );

  useEffect(() => {
    let canceled = false;
    const runLayout = async () => {
      const layout = await buildLayout(graph, modelLabels, eventLabels, selectedNodeId, collapseObjects);
      if (!canceled) {
        setNodes(layout.nodes);
        setEdges(layout.edges);
      }
    };
    runLayout();
    return () => {
      canceled = true;
    };
  }, [graph, modelLabels, eventLabels, selectedNodeId, collapseObjects]);

  return (
    <div className="relative h-[680px] w-full rounded-2xl border border-border bg-card">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={{ placeNode: PlaceNode, transitionNode: TransitionNode }}
        edgeTypes={edgeTypes}
        fitView
        minZoom={0.2}
        maxZoom={1.8}
        fitViewOptions={{ padding: 0.2 }}
        nodesDraggable
        nodesConnectable={false}
        onNodeClick={(_, node) => {
          if (onNodeSelect) {
            onNodeSelect(node.id);
          }
        }}
        onEdgeMouseEnter={(event, edge) => {
          const data = edge.data as { count?: number; share?: number } | undefined;
          if (!data) return;
          const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
          setEdgeTooltip({
            x: event.clientX - rect.left,
            y: event.clientY - rect.top,
            count: data.count ?? 0,
            share: data.share ?? 0,
          });
        }}
        onEdgeMouseLeave={() => setEdgeTooltip(null)}
      >
        <Background variant="dots" gap={18} size={1} />
        <Controls />
        <MiniMap />
      </ReactFlow>
      {edgeTooltip && (
        <div
          className="pointer-events-none absolute z-10 -translate-y-full rounded-lg border border-border bg-background px-3 py-2 text-xs shadow-lg"
          style={{ left: edgeTooltip.x, top: edgeTooltip.y }}
        >
          <div className="text-[0.65rem] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            Flow edge
          </div>
          <div className="mt-2 flex items-center gap-2 text-[0.7rem] text-muted-foreground">
            <span className="rounded-full border border-border px-2 py-0.5 text-[0.6rem] font-semibold uppercase tracking-[0.2em]">
              {edgeTooltip.count} total
            </span>
            <span className="rounded-full border border-border px-2 py-0.5 text-[0.6rem] font-semibold uppercase tracking-[0.2em]">
              {(edgeTooltip.share * 100).toFixed(1)}% share
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

export function OcpnGraph(props: OcpnGraphProps) {
  return (
    <ReactFlowProvider>
      <OcpnGraphInner {...props} />
    </ReactFlowProvider>
  );
}

async function applyElkLayout(
  nodes: Node[],
  edges: Edge[],
  nodeSizes: Map<string, { width: number; height: number }>
) {
  const portMap = new Map<string, { left: string; right: string }>();
  const graph = {
    id: 'ocpn-graph',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.layered.spacing.nodeNodeBetweenLayers': '130',
      'elk.spacing.nodeNode': '90',
      'elk.spacing.edgeNode': '48',
      'elk.spacing.edgeEdge': '24',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.portConstraints': 'FIXED_POS',
      'elk.layered.nodePlacement.bk.fixedAlignment': 'BALANCED',
      'elk.layered.cycleBreaking.strategy': 'INTERACTIVE',
      'elk.layered.crossingMinimization.semiInteractive': 'true',
      'elk.layered.mergeEdges': 'false',
    },
    children: nodes.map((node) => {
      const size = nodeSizes.get(node.id) || TRANSITION_NODE_SIZE;
      const leftPort = `${node.id}__left`;
      const rightPort = `${node.id}__right`;
      portMap.set(node.id, { left: leftPort, right: rightPort });
      return {
        id: node.id,
        width: size.width,
        height: size.height,
        ports: [
          {
            id: leftPort,
            width: 1,
            height: 1,
            x: 0,
            y: size.height / 2,
            properties: {
              'elk.port.side': 'WEST',
            },
          },
          {
            id: rightPort,
            width: 1,
            height: 1,
            x: size.width,
            y: size.height / 2,
            properties: {
              'elk.port.side': 'EAST',
            },
          },
        ],
      };
    }),
    edges: edges.map((edge) => {
      const sourcePorts = portMap.get(edge.source);
      const targetPorts = portMap.get(edge.target);
      return {
        id: edge.id,
        sources: [sourcePorts?.right || edge.source],
        targets: [targetPorts?.left || edge.target],
      };
    }),
  };

  const layout = await elk.layout(graph);
  const positions = new Map(
    (layout.children || []).map((child) => [child.id, { x: child.x || 0, y: child.y || 0 }])
  );
  const edgePoints = new Map<string, ElkEdgePoint[]>();
  (layout.edges || []).forEach((edge) => {
    const section = edge.sections?.[0];
    if (!section) {
      return;
    }
    const points: ElkEdgePoint[] = [];
    if (section.startPoint) {
      points.push({ x: section.startPoint.x, y: section.startPoint.y });
    }
    section.bendPoints?.forEach((point) => points.push({ x: point.x, y: point.y }));
    if (section.endPoint) {
      points.push({ x: section.endPoint.x, y: section.endPoint.y });
    }
    edgePoints.set(edge.id, points);
  });

  const layoutedNodes = nodes.map((node) => {
    const pos = positions.get(node.id);
    if (!pos) {
      return node;
    }
    return {
      ...node,
      position: pos,
    };
  });
  return { nodes: layoutedNodes, edgePoints };
}

function colorForModel(modelUri: string) {
  let hash = 0;
  for (let i = 0; i < modelUri.length; i += 1) {
    hash = (hash * 31 + modelUri.charCodeAt(i)) % 360;
  }
  return `hsl(${hash}, 55%, 35%)`;
}
