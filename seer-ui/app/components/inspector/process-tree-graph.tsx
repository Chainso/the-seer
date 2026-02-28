"use client";

import { useMemo } from "react";
import {
  Background,
  Controls,
  Edge,
  Handle,
  Node,
  Position,
  ReactFlow,
  ReactFlowProvider,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

type ProcessTreeNode = {
  id: string;
  operator: string | null;
  label: string | null;
  children: ProcessTreeNode[];
};

interface ProcessTreeGraphProps {
  processTree: ProcessTreeNode;
  eventLabels?: Record<string, string>;
}

function OperatorNode({ data }: { data: { label: string } }) {
  return (
    <div className="rounded-2xl border border-border bg-muted/40 px-4 py-3 text-center shadow-sm">
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
      <div className="text-[0.6rem] font-semibold uppercase tracking-[0.25em] text-muted-foreground">
        Operator
      </div>
      <div className="mt-1 text-sm font-semibold text-foreground">{data.label}</div>
    </div>
  );
}

function ActivityNode({ data }: { data: { label: string } }) {
  return (
    <div className="rounded-2xl border border-border bg-background px-4 py-3 shadow-sm">
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
      <div className="text-[0.6rem] font-semibold uppercase tracking-[0.25em] text-muted-foreground">
        Activity
      </div>
      <div className="mt-1 font-display text-sm">{data.label}</div>
    </div>
  );
}

function SilentNode() {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-background px-4 py-3 text-center text-xs text-muted-foreground">
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
      Silent step
    </div>
  );
}

const operatorLabels: Record<string, string> = {
  sequence: "Sequence",
  and: "Parallel",
  or: "Inclusive",
  xor: "Decision",
  xorLoop: "Loop",
};

const buildLayout = (root: ProcessTreeNode, eventLabels?: Record<string, string>) => {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  const positions = new Map<string, { x: number; y: number }>();
  const xSpacing = 200;
  const ySpacing = 150;
  let nextX = 0;

  const layout = (node: ProcessTreeNode, depth: number) => {
    if (!node.children || node.children.length === 0) {
      const x = nextX * xSpacing;
      positions.set(node.id, { x, y: depth * ySpacing });
      nextX += 1;
      return x;
    }
    const childXs = node.children.map(child => layout(child, depth + 1));
    const x = childXs.reduce((sum, value) => sum + value, 0) / childXs.length;
    positions.set(node.id, { x, y: depth * ySpacing });
    return x;
  };

  const visit = (node: ProcessTreeNode) => {
    const position = positions.get(node.id) ?? { x: 0, y: 0 };
    const isOperator = node.operator != null;
    const label = isOperator
      ? operatorLabels[node.operator ?? ""] ?? node.operator ?? "Operator"
      : node.label
        ? eventLabels?.[node.label] ?? node.label
        : "Silent";
    const nodeType = isOperator ? "operatorNode" : node.label ? "activityNode" : "silentNode";

    nodes.push({
      id: node.id,
      type: nodeType,
      position,
      data: { label },
    });

    node.children.forEach(child => {
      edges.push({
        id: `${node.id}:${child.id}`,
        source: node.id,
        target: child.id,
        type: "smoothstep",
      });
      visit(child);
    });
  };

  layout(root, 0);
  visit(root);

  return { nodes, edges };
};

function ProcessTreeGraphInner({ processTree, eventLabels }: ProcessTreeGraphProps) {
  const { nodes, edges } = useMemo(() => buildLayout(processTree, eventLabels), [processTree, eventLabels]);

  return (
    <div className="relative h-[520px] w-full rounded-2xl border border-border bg-card">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={{ operatorNode: OperatorNode, activityNode: ActivityNode, silentNode: SilentNode }}
        fitView
        minZoom={0.2}
        maxZoom={1.6}
        fitViewOptions={{ padding: 0.2 }}
        nodesDraggable
        nodesConnectable={false}
      >
        <Background variant="dots" gap={18} size={1} />
        <Controls />
      </ReactFlow>
    </div>
  );
}

export function ProcessTreeGraph(props: ProcessTreeGraphProps) {
  return (
    <ReactFlowProvider>
      <ProcessTreeGraphInner {...props} />
    </ReactFlowProvider>
  );
}
