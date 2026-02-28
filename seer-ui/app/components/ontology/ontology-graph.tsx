'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Node,
  Edge,
  NodeTypes,
  EdgeTypes,
  MarkerType,
  ReactFlowProvider,
  BaseEdge,
  EdgeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import type { OntologyGraph, OntologyNode as OntologyGraphNode } from '@/app/types/ontology';
import { OntologyNode, OntologyNodeData } from './ontology-node';
import { OntologyToolbar } from './ontology-toolbar';
import ELK from 'elkjs/lib/elk.bundled.js';

interface OntologyGraphVisualizationProps {
  data: OntologyGraph;
  allowedLabels?: string[];
  onNodeSelect?: (nodeUri: string) => void;
  displayNodeName?: (node: OntologyGraphNode) => string;
}

interface ElkEdgePoint {
  x: number;
  y: number;
}

interface ElkEdgeData {
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

function ElkEdge(props: EdgeProps<ElkEdgeData>) {
  const { data, style, markerEnd } = props;
  const points = data?.points;
  if (!points || points.length < 2) {
    return null;
  }
  const path = buildPolylinePath(points);
  return (
    <BaseEdge path={path} style={style} markerEnd={markerEnd} />
  );
}

const ELK_NODE_WIDTH = 200;
const ELK_NODE_HEIGHT = 100;
const elk = new ELK();

function forceIterations(nodeCount: number) {
  if (nodeCount <= 50) {
    return 600;
  }
  if (nodeCount <= 120) {
    return 320;
  }
  if (nodeCount <= 220) {
    return 180;
  }
  return 100;
}

function fallbackGridLayout(nodes: Node<OntologyNodeData>[]) {
  const columns = 8;
  return nodes.map((node, index) => ({
    ...node,
    position: {
      x: (index % columns) * (ELK_NODE_WIDTH + 48),
      y: Math.floor(index / columns) * (ELK_NODE_HEIGHT + 56),
    },
  }));
}

async function layoutNodes(
  data: OntologyGraph,
  allowedLabelsOverride?: string[],
  displayNodeName?: (node: OntologyGraphNode) => string
): Promise<{ nodes: Node<OntologyNodeData>[]; edges: Edge[] }> {
  const edgeColors = {
    default: 'var(--graph-edge-default)',
    reference: 'var(--graph-edge-reference)',
    transition: 'var(--graph-edge-transition)',
    labelDefault: 'var(--graph-edge-label-default)',
    labelReference: 'var(--graph-edge-label-reference)',
    labelTransition: 'var(--graph-edge-label-transition)',
    labelBg: 'var(--graph-edge-label-bg)',
    labelBorder: 'var(--graph-edge-label-border)',
  };

  const defaultAllowedLabels = [
    'ObjectModel',
    'Action', 'Process', 'Workflow',
    'Signal',
    'Transition',
  ];
  const allowedLabels = new Set(allowedLabelsOverride ?? defaultAllowedLabels);

  const visibleNodes = data.nodes.filter(node => allowedLabels.has(node.label));
  if (visibleNodes.length === 0) {
    return { nodes: [], edges: [] };
  }

  const nodes: Node<OntologyNodeData>[] = [];
  visibleNodes.forEach((node) => {
    nodes.push({
      id: node.uri,
      type: 'ontologyNode',
      position: { x: 0, y: 0 },
      data: {
        label: node.label,
        uri: node.uri,
        name:
          displayNodeName?.(node) ||
          (typeof node.properties.name === 'string' ? node.properties.name : node.uri),
        description: node.properties.description as string,
      },
    });
  });

  // Create edges
  const visibleNodeIds = new Set(visibleNodes.map(node => node.uri));
  const visibleEdges = data.edges.filter(edge => visibleNodeIds.has(edge.fromUri) && visibleNodeIds.has(edge.toUri));

  const edges: Edge<ElkEdgeData>[] = visibleEdges.map((edge, index) => {
    const isReference = edge.type === 'referencesObjectModel';
    const isInitialEdge = edge.type === 'initialState';
    const isTransitionEdge = ['hasPossibleState', 'fromState', 'toState', 'transitionOf', 'transition'].includes(edge.type);
    const isTriggerEdge = edge.type === 'eventTrigger';
    const strokeColor = isInitialEdge || isReference || isTriggerEdge
      ? edgeColors.reference
      : isTransitionEdge
      ? edgeColors.transition
      : edgeColors.default;
    const labelColor = isInitialEdge || isReference
      ? edgeColors.labelReference
      : isTransitionEdge
      ? edgeColors.labelTransition
      : edgeColors.labelDefault;
    return {
      id: `${edge.fromUri}-${edge.toUri}-${index}`,
      source: edge.fromUri,
      target: edge.toUri,
      type: 'elk',
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: strokeColor,
      },
      style: {
        stroke: strokeColor,
        strokeDasharray: isReference ? '6 4' : isTransitionEdge ? '2 3' : isTriggerEdge ? '1 4' : undefined,
        strokeWidth: isInitialEdge || isReference ? 1.6 : isTransitionEdge ? 1.4 : isTriggerEdge ? 1.4 : 1.2,
      },
      labelStyle: {
        fontSize: 10,
        fill: labelColor,
        fontWeight: isInitialEdge || isReference || isTransitionEdge ? 600 : 400,
      },
      labelBgStyle: {
        fill: edgeColors.labelBg,
        stroke: edgeColors.labelBorder,
        strokeWidth: 0.8,
      },
      labelBgPadding: [6, 3],
      labelBgBorderRadius: 6,
    };
  });

  try {
    const { nodes: layoutedNodes, edgePoints } = await applyElkLayout(nodes, edges);
    const layoutedEdges = edges.map((edge) => ({
      ...edge,
      data: {
        ...(edge.data || {}),
        points: edgePoints.get(edge.id),
      },
    }));
    return { nodes: layoutedNodes, edges: layoutedEdges };
  } catch {
    return { nodes: fallbackGridLayout(nodes), edges };
  }
}

async function applyElkLayout(nodes: Node<OntologyNodeData>[], edges: Edge[]) {
  const portMap = new Map<string, { left: string; right: string }>();
  const graph = {
    id: 'ontology-overview',
    layoutOptions: {
      'elk.algorithm': 'force',
      'elk.force.iterations': String(forceIterations(nodes.length)),
    },
    children: nodes.map((node) => {
      const leftPort = `${node.id}__left`;
      const rightPort = `${node.id}__right`;
      portMap.set(node.id, { left: leftPort, right: rightPort });
      return {
        id: node.id,
        width: ELK_NODE_WIDTH,
        height: ELK_NODE_HEIGHT,
        ports: [
          {
            id: leftPort,
            width: 1,
            height: 1,
            x: 0,
            y: ELK_NODE_HEIGHT / 2,
            properties: {
              'elk.port.side': 'WEST',
            },
          },
          {
            id: rightPort,
            width: 1,
            height: 1,
            x: ELK_NODE_WIDTH,
            y: ELK_NODE_HEIGHT / 2,
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

function OntologyGraphVisualizationInner({
  data,
  allowedLabels,
  onNodeSelect,
  displayNodeName,
}: OntologyGraphVisualizationProps) {
  const [nodes, setNodes] = useState<Node<OntologyNodeData>[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);

  const nodeTypes = useMemo<NodeTypes>(
    () => ({
      ontologyNode: OntologyNode,
    }),
    []
  );

  const edgeTypes = useMemo<EdgeTypes>(
    () => ({
      elk: ElkEdge,
    }),
    []
  );

  useEffect(() => {
    let canceled = false;
    const runLayout = async () => {
      const { nodes: layoutedNodes, edges: layoutedEdges } = await layoutNodes(
        data,
        allowedLabels,
        displayNodeName
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
  }, [data, allowedLabels, displayNodeName]);

  return (
    <div className="w-full h-full relative">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
        fitView
        minZoom={0.1}
        maxZoom={2}
        onNodeClick={(_, node) => onNodeSelect?.(node.id)}
      >
        <Background variant="dots" gap={18} size={1} />
        <Controls />
        <MiniMap />
        <OntologyToolbar />
      </ReactFlow>
    </div>
  );
}

export function OntologyGraphVisualization({
  data,
  allowedLabels,
  onNodeSelect,
  displayNodeName,
}: OntologyGraphVisualizationProps) {
  return (
    <ReactFlowProvider>
      <OntologyGraphVisualizationInner
        data={data}
        allowedLabels={allowedLabels}
        onNodeSelect={onNodeSelect}
        displayNodeName={displayNodeName}
      />
    </ReactFlowProvider>
  );
}
