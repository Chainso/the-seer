'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Background,
  Controls,
  MiniMap,
  Node,
  Edge,
  MarkerType,
  ReactFlow,
  ReactFlowProvider,
  NodeProps,
  Handle,
  Position,
  Connection,
  BaseEdge,
  EdgeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Plus } from 'lucide-react';
import { Card } from '@/app/components/ui/card';
import type { OntologyGraph } from '@/app/types/ontology';
import ELK from 'elkjs/lib/elk.bundled.js';

interface ObjectStateGraphProps {
  data: OntologyGraph;
  objectUri: string;
  canAddInitialState: boolean;
  onAddInitialState: () => void;
  onAddFromState: (stateUri: string) => void;
  onSelectState: (stateUri: string) => void;
  onSelectTransition: (transitionUri: string) => void;
  onCreateTransition: (fromStateUri: string, toStateUri: string) => void;
}

interface StateGraphNodeData {
  label: string;
  uri: string;
  name?: string;
  description?: string;
  canAdd: boolean;
  actionLabel: string;
  helperText?: string;
  onAdd?: () => void;
}

interface ElkEdgePoint {
  x: number;
  y: number;
}

interface ElkEdgeData {
  transitionUri?: string;
  points?: ElkEdgePoint[];
}

function buildPolylinePath(points: ElkEdgePoint[]) {
  if (points.length <= 1) {
    return '';
  }
  return points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`)
    .join(' ');
}

function ElkEdge({ data, style, markerEnd }: EdgeProps<ElkEdgeData>) {
  const points = data?.points;
  if (!points || points.length < 2) {
    return null;
  }
  const path = buildPolylinePath(points);
  return <BaseEdge path={path} style={style} markerEnd={markerEnd} />;
}

const NODE_COLORS: Record<string, { bg: string; border: string }> = {
  ObjectModel: { bg: '--graph-node-object-bg', border: '--graph-node-object-border' },
  State: { bg: '--graph-node-state-bg', border: '--graph-node-state-border' },
  Process: { bg: '--graph-node-action-bg', border: '--graph-node-action-border' },
  Workflow: { bg: '--graph-node-action-bg', border: '--graph-node-action-border' },
  Action: { bg: '--graph-node-action-bg', border: '--graph-node-action-border' },
  Signal: { bg: '--graph-node-signal-bg', border: '--graph-node-signal-border' },
  Transition: { bg: '--graph-node-transition-bg', border: '--graph-node-transition-border' },
  EventTrigger: { bg: '--graph-node-trigger-bg', border: '--graph-node-trigger-border' },
};

function StateGraphNode({ data }: NodeProps<StateGraphNodeData>) {
  const colors = NODE_COLORS[data.label] || {
    bg: '--graph-node-default-bg',
    border: '--graph-node-default-border',
  };
  const showAdd = Boolean(data.onAdd);
  return (
    <div className="relative">
      <Handle
        type="target"
        position={Position.Left}
        className="z-10 opacity-0"
        style={{ top: '50%', transform: 'translateY(-50%)' }}
      />
      <Card
        className="relative w-[180px] min-h-[90px] border-2 px-4 py-3 shadow-sm"
        style={{
          backgroundColor: `var(${colors.bg})`,
          borderColor: `var(${colors.border})`,
        }}
      >
        {showAdd && (
          <button
            type="button"
            className="absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-full border border-border bg-background text-muted-foreground shadow-sm transition hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
            onClick={(event) => {
              event.stopPropagation();
              data.onAdd?.();
            }}
            disabled={!data.canAdd}
            aria-label={data.actionLabel}
            title={data.helperText || data.actionLabel}
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        )}
        <div className="text-[0.65rem] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          {data.label}
        </div>
        <div className="mt-1 text-sm font-display">{data.name || data.uri}</div>
        {data.description && (
          <div className="mt-1 text-xs text-muted-foreground line-clamp-2">{data.description}</div>
        )}
      </Card>
      <Handle
        type="source"
        position={Position.Right}
        className="z-10 opacity-0"
        style={{ top: '50%', transform: 'translateY(-50%)' }}
      />
    </div>
  );
}

const ELK_NODE_WIDTH = 180;
const ELK_NODE_HEIGHT = 90;
const elk = new ELK();

async function layoutStateGraph(
  data: OntologyGraph,
  objectUri: string,
  canAddInitialState: boolean,
  onAddInitialState: () => void,
  onAddFromState: (stateUri: string) => void
): Promise<{ nodes: Node<StateGraphNodeData>[]; edges: Edge[] }> {
  const nodes: Node<StateGraphNodeData>[] = [];

  data.nodes.forEach((node) => {
    const isState = node.label === 'State';
    const isObjectNode = node.uri === objectUri;
    const canAdd =
      (isObjectNode && canAddInitialState) || isState;
    const actionLabel = isObjectNode
      ? 'Add initial state'
      : isState
      ? 'Add state + transition'
      : '';
    const helperText = isObjectNode
      ? canAddInitialState
        ? 'Add initial state'
        : 'Initial state already set'
      : undefined;
    nodes.push({
      id: node.uri,
      type: 'stateGraphNode',
      position: { x: 0, y: 0 },
      data: {
        label: isObjectNode ? 'ObjectModel' : node.label,
        uri: node.uri,
        name: node.properties.name as string,
        description: node.properties.description as string,
        canAdd,
        actionLabel,
        helperText,
        onAdd: isObjectNode
          ? onAddInitialState
          : isState
          ? () => onAddFromState(node.uri)
          : undefined,
      },
    });
  });

  const edgeColors = {
    default: 'var(--graph-edge-default)',
    transition: 'var(--graph-edge-transition)',
    reference: 'var(--graph-edge-reference)',
  };

  const visibleNodeIds = new Set(nodes.map((node) => node.id));
  const edgeCandidates = data.edges.filter(
    (edge) => visibleNodeIds.has(edge.fromUri) && visibleNodeIds.has(edge.toUri)
  );
  const directionCounts = new Map<string, number>();
  edgeCandidates.forEach((edge) => {
    const key = `${edge.fromUri}|${edge.toUri}`;
    directionCounts.set(key, (directionCounts.get(key) || 0) + 1);
  });

  const edges: Edge<ElkEdgeData>[] = edgeCandidates
    .filter((edge) => visibleNodeIds.has(edge.fromUri) && visibleNodeIds.has(edge.toUri))
    .map((edge, index) => {
      const transitionUri = (edge as { data?: { transitionUri?: string } }).data?.transitionUri;
      const isInitial = edge.type === 'initialState';
      const isTransition = edge.type === 'transition';
      const isReference = edge.type === 'referencesObjectModel';
      const strokeColor = isTransition
        ? edgeColors.transition
        : isReference
        ? edgeColors.reference
        : edgeColors.default;
      return {
        id: `${edge.fromUri}-${edge.toUri}-${index}`,
        source: edge.fromUri,
        target: edge.toUri,
        type: 'elk',
        data: transitionUri ? { transitionUri } : undefined,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: strokeColor,
        },
        style: {
          stroke: strokeColor,
          strokeDasharray: isReference ? '6 4' : isInitial ? '4 3' : isTransition ? '2 3' : undefined,
          strokeWidth: isInitial ? 1.8 : isTransition ? 1.4 : 1.2,
        },
      };
    });

  const { nodes: layoutedNodes, edgePoints } = await applyElkLayout(nodes, edges);
  const layoutedEdges = edges.map((edge) => ({
    ...edge,
    data: {
      ...(edge.data || {}),
      points: edgePoints.get(edge.id),
    },
  }));
  return { nodes: layoutedNodes, edges: layoutedEdges };
}

function ObjectStateGraphInner({
  data,
  objectUri,
  canAddInitialState,
  onAddInitialState,
  onAddFromState,
  onSelectState,
  onSelectTransition,
  onCreateTransition,
}: ObjectStateGraphProps) {
  const [nodes, setNodes] = useState<Node<StateGraphNodeData>[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);

  const nodeTypes = useMemo(
    () => ({
      stateGraphNode: StateGraphNode,
    }),
    []
  );
  const edgeTypes = useMemo(
    () => ({
      elk: ElkEdge,
    }),
    []
  );

  useEffect(() => {
    let canceled = false;
    const runLayout = async () => {
      const { nodes: layoutedNodes, edges: layoutedEdges } = await layoutStateGraph(
        data,
        objectUri,
        canAddInitialState,
        onAddInitialState,
        onAddFromState
      );
      if (!canceled) {
        setNodes(layoutedNodes);
        setEdges(layoutedEdges);
      }
    };
    runLayout();
    return () => {
      canceled = true;
    };
  }, [data, objectUri, canAddInitialState, onAddInitialState, onAddFromState]);

  const nodeMap = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);

  const handleConnect = (connection: Connection) => {
    if (!connection.source || !connection.target) {
      return;
    }
    const source = nodeMap.get(connection.source);
    const target = nodeMap.get(connection.target);
    const sourceLabel = source?.data?.label;
    const targetLabel = target?.data?.label;
    if (sourceLabel === 'State' && targetLabel === 'State') {
      onCreateTransition(connection.source, connection.target);
    }
  };

  return (
    <div className="h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes as any}
        edgeTypes={edgeTypes as any}
        fitView
        minZoom={0.1}
        maxZoom={2}
        onConnect={handleConnect}
        onNodeClick={(_, node) => {
          const nodeData = node.data as StateGraphNodeData | undefined;
          if (nodeData?.label === 'State') {
            onSelectState(node.id);
          }
        }}
        onEdgeClick={(_, edge) => {
          const transitionUri = (edge.data as { transitionUri?: string } | undefined)?.transitionUri;
          if (transitionUri) {
            onSelectTransition(transitionUri);
          }
        }}
      >
        <Background variant="dots" gap={18} size={1} />
        <Controls />
        <MiniMap />
      </ReactFlow>
    </div>
  );
}

export function ObjectStateGraph(props: ObjectStateGraphProps) {
  return (
    <ReactFlowProvider>
      <ObjectStateGraphInner {...props} />
    </ReactFlowProvider>
  );
}

async function applyElkLayout(
  nodes: Node<StateGraphNodeData>[],
  edges: Edge[]
) {
  const portMap = new Map<string, { left: string; right: string }>();
  const graph = {
    id: 'object-state-graph',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.layered.spacing.nodeNodeBetweenLayers': '120',
      'elk.spacing.nodeNode': '80',
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
      const width = ELK_NODE_WIDTH;
      const height = ELK_NODE_HEIGHT;
      const leftPort = `${node.id}__left`;
      const rightPort = `${node.id}__right`;
      portMap.set(node.id, { left: leftPort, right: rightPort });
      return {
        id: node.id,
        width,
        height,
        ports: [
          {
            id: leftPort,
            width: 1,
            height: 1,
            x: 0,
            y: height / 2,
            properties: {
              'elk.port.side': 'WEST',
            },
          },
          {
            id: rightPort,
            width: 1,
            height: 1,
            x: width,
            y: height / 2,
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
