"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  Edge,
  EdgeProps,
  EdgeLabelRenderer,
  BaseEdge,
  Handle,
  MarkerType,
  Node,
  Position,
  ReactFlow,
  ReactFlowProvider,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import ELK from "elkjs/lib/elk.bundled.js";

type BpmnNode = {
  id: string;
  name: string;
  type: string | null;
  incoming: Record<string, unknown>;
  outgoing: Record<string, unknown>;
  level?: number;
};

type BpmnEdge = {
  id: string;
  source: BpmnNode;
  target: BpmnNode;
};

type BpmnGraphType = {
  nodes: Record<string, BpmnNode>;
  edges: Record<string, BpmnEdge>;
  getOrderedNodesAndEdges?: () => {
    nodesId: string[];
    edgesId: [string, string][];
    invMap: Record<string, string>;
  };
};

interface BpmnGraphProps {
  graph: BpmnGraphType;
  labelMap?: Record<string, string>;
}

interface ElkEdgePoint {
  x: number;
  y: number;
}

interface ElkEdgeData extends Record<string, unknown> {
  points?: ElkEdgePoint[];
}

interface ElkLayoutEdgeSection {
  startPoint?: ElkEdgePoint;
  bendPoints?: ElkEdgePoint[];
  endPoint?: ElkEdgePoint;
}

interface ElkLayoutEdge {
  id: string;
  sections?: ElkLayoutEdgeSection[];
}

function buildPolylinePath(points: ElkEdgePoint[]) {
  if (points.length <= 1) {
    return "";
  }
  return points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
    .join(" ");
}

function ElkEdge(props: EdgeProps<Edge<ElkEdgeData>>) {
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
              position: "absolute",
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

function TaskNode({ data }: { data: { label: string } }) {
  return (
    <div className="min-w-[190px] rounded-2xl border border-[color:var(--graph-node-action-border)] bg-[color:var(--graph-node-action-bg)] px-4 py-3 shadow-sm">
      <Handle type="target" position={Position.Left} style={{ opacity: 0, left: -10 }} />
      <Handle type="source" position={Position.Right} style={{ opacity: 0, right: -10 }} />
      <div className="text-[0.6rem] font-semibold uppercase tracking-[0.25em] text-muted-foreground">
        Task
      </div>
      <div className="mt-1 font-display text-sm text-foreground">{data.label}</div>
    </div>
  );
}

function EventNode({ data }: { data: { label: string } }) {
  return (
    <div className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-[color:var(--graph-node-default-border)] bg-[color:var(--graph-node-default-bg)] text-[0.65rem] font-semibold text-muted-foreground">
      <Handle type="target" position={Position.Left} style={{ opacity: 0, left: -10 }} />
      <Handle type="source" position={Position.Right} style={{ opacity: 0, right: -10 }} />
      {data.label}
    </div>
  );
}

function GatewayNode({ data }: { data: { label: string } }) {
  return (
    <div className="relative h-16 w-16">
      <Handle type="target" position={Position.Left} style={{ opacity: 0, left: -12 }} />
      <Handle type="source" position={Position.Right} style={{ opacity: 0, right: -12 }} />
      <div className="absolute inset-0 rotate-45 rounded-lg border-2 border-[color:var(--graph-node-trigger-border)] bg-[color:var(--graph-node-trigger-bg)]" />
      <div className="absolute inset-0 flex items-center justify-center text-[0.7rem] font-semibold text-foreground">
        {data.label}
      </div>
    </div>
  );
}

const typeToLabel: Record<string, string> = {
  startEvent: "Start",
  endEvent: "End",
  exclusiveGateway: "X",
  parallelGateway: "+",
};

const typeToKind: Record<string, string> = {
  startEvent: "eventNode",
  endEvent: "eventNode",
  exclusiveGateway: "gatewayNode",
  parallelGateway: "gatewayNode",
  task: "taskNode",
};

const TASK_NODE_SIZE = { width: 210, height: 80 };
const EVENT_NODE_SIZE = { width: 56, height: 56 };
const GATEWAY_NODE_SIZE = { width: 64, height: 64 };
const elk = new ELK();

const buildLayout = async (graph: BpmnGraphType, labelMap?: Record<string, string>) => {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const nodeList = Object.values(graph.nodes);
  const nodeSizes = new Map<string, { width: number; height: number }>();

  nodeList.forEach(node => {
    const nodeType = typeToKind[node.type ?? ""] ?? "taskNode";
    const size =
      nodeType === "gatewayNode"
        ? GATEWAY_NODE_SIZE
        : nodeType === "eventNode"
          ? EVENT_NODE_SIZE
          : TASK_NODE_SIZE;
    nodeSizes.set(node.id, size);
  });

  nodeList.forEach(node => {
    const nodeType = typeToKind[node.type ?? ""] ?? "taskNode";
    const label =
      node.type === "task"
        ? labelMap?.[node.name] ?? node.name ?? "Task"
        : typeToLabel[node.type ?? ""] ?? "Gateway";
    nodes.push({
      id: node.id,
      type: nodeType,
      position: { x: 0, y: 0 },
      data: { label },
    });
  });

  Object.values(graph.edges).forEach(edge => {
    edges.push({
      id: edge.id,
      source: edge.source.id,
      target: edge.target.id,
      type: "elk",
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: "var(--foreground)",
      },
      style: {
        strokeWidth: 1.6,
        stroke: "var(--graph-edge-default)",
      },
    });
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
};

function BpmnGraphInner({ graph, labelMap }: BpmnGraphProps) {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const edgeTypes = useMemo(
    () => ({
      elk: ElkEdge,
    }),
    []
  );

  useEffect(() => {
    let canceled = false;
    const runLayout = async () => {
      const layout = await buildLayout(graph, labelMap);
      if (!canceled) {
        setNodes(layout.nodes);
        setEdges(layout.edges);
      }
    };
    runLayout();
    return () => {
      canceled = true;
    };
  }, [graph, labelMap]);

  return (
    <div className="relative h-[520px] w-full rounded-2xl border border-border bg-card">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={{ taskNode: TaskNode, eventNode: EventNode, gatewayNode: GatewayNode }}
        edgeTypes={edgeTypes as any}
        fitView
        minZoom={0.2}
        maxZoom={1.6}
        fitViewOptions={{ padding: 0.2 }}
        nodesDraggable
        nodesConnectable={false}
      >
        <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="var(--border)" />
        <Controls />
      </ReactFlow>
    </div>
  );
}

export function BpmnGraph(props: BpmnGraphProps) {
  return (
    <ReactFlowProvider>
      <BpmnGraphInner {...props} />
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
    id: "bpmn-graph",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.layered.spacing.nodeNodeBetweenLayers": "120",
      "elk.spacing.nodeNode": "80",
      "elk.spacing.edgeNode": "40",
      "elk.spacing.edgeEdge": "20",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.portConstraints": "FIXED_POS",
      "elk.layered.nodePlacement.bk.fixedAlignment": "BALANCED",
      "elk.layered.cycleBreaking.strategy": "INTERACTIVE",
      "elk.layered.crossingMinimization.semiInteractive": "true",
      "elk.layered.mergeEdges": "false",
    },
    children: nodes.map((node) => {
      const size = nodeSizes.get(node.id) || TASK_NODE_SIZE;
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
              "elk.port.side": "WEST",
            },
          },
          {
            id: rightPort,
            width: 1,
            height: 1,
            x: size.width,
            y: size.height / 2,
            properties: {
              "elk.port.side": "EAST",
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
  const layoutEdges = (layout.edges || []) as ElkLayoutEdge[];
  layoutEdges.forEach((edge) => {
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
