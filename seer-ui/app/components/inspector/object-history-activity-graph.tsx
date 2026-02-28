"use client";

import { useMemo } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  Edge,
  MarkerType,
  MiniMap,
  Node,
  ReactFlow,
  ReactFlowProvider,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { Card } from "../ui/card";

export type ObjectHistoryGraphObjectNode = {
  key: string;
  label: string;
  subtitle: string;
  isAnchor?: boolean;
};

export type ObjectHistoryGraphEventNode = {
  eventId: string;
  label: string;
  subtitle: string;
  occurredAtSortKey: number;
};

export type ObjectHistoryGraphEdge = {
  id: string;
  eventId: string;
  objectKey: string;
  role: string;
};

interface ObjectHistoryActivityGraphProps {
  objects: ObjectHistoryGraphObjectNode[];
  events: ObjectHistoryGraphEventNode[];
  edges: ObjectHistoryGraphEdge[];
}

function ObjectNode({ data }: { data: { label: string; subtitle: string; isAnchor: boolean } }) {
  return (
    <Card
      className="min-w-[220px] border-2 px-4 py-3 shadow-sm"
      style={{
        borderColor: data.isAnchor ? "var(--foreground)" : "var(--border)",
        backgroundColor: data.isAnchor ? "var(--muted)" : "var(--graph-node-object-bg)",
      }}
    >
      <div className="text-[0.62rem] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
        {data.isAnchor ? "Anchor Object" : "Object"}
      </div>
      <div className="mt-1 font-display text-sm">{data.label}</div>
      <div className="mt-1 text-xs text-muted-foreground break-all">{data.subtitle}</div>
    </Card>
  );
}

function EventNode({ data }: { data: { label: string; subtitle: string } }) {
  return (
    <Card className="min-w-[240px] border-2 border-border bg-[color:var(--graph-node-signal-bg)] px-4 py-3 shadow-sm">
      <div className="text-[0.62rem] font-semibold uppercase tracking-[0.2em] text-muted-foreground">Event</div>
      <div className="mt-1 font-display text-sm">{data.label}</div>
      <div className="mt-1 text-xs text-muted-foreground">{data.subtitle}</div>
    </Card>
  );
}

function buildGraph(
  objects: ObjectHistoryGraphObjectNode[],
  events: ObjectHistoryGraphEventNode[],
  edges: ObjectHistoryGraphEdge[]
) {
  const sortedObjects = [...objects].sort((a, b) => {
    if (a.isAnchor && !b.isAnchor) {
      return -1;
    }
    if (!a.isAnchor && b.isAnchor) {
      return 1;
    }
    return a.label.localeCompare(b.label);
  });

  const objectNodes: Node[] = sortedObjects.map((objectNode, index) => ({
    id: `object:${objectNode.key}`,
    type: "objectNode",
    position: { x: 0, y: index * 130 },
    data: {
      label: objectNode.label,
      subtitle: objectNode.subtitle,
      isAnchor: Boolean(objectNode.isAnchor),
    },
  }));

  const sortedEvents = [...events].sort((a, b) => b.occurredAtSortKey - a.occurredAtSortKey);
  const eventNodes: Node[] = sortedEvents.map((eventNode, index) => ({
    id: `event:${eventNode.eventId}`,
    type: "eventNode",
    position: { x: 420, y: index * 130 },
    data: {
      label: eventNode.label,
      subtitle: eventNode.subtitle,
    },
  }));

  const graphEdges: Edge[] = edges.map((edge, index) => ({
    id: edge.id || `edge-${index}`,
    source: `event:${edge.eventId}`,
    target: `object:${edge.objectKey}`,
    label: edge.role,
    type: "smoothstep",
    markerEnd: {
      type: MarkerType.ArrowClosed,
      color: "#7c6f64",
    },
    style: {
      stroke: "#7c6f64",
      strokeWidth: 1.2,
    },
    labelStyle: {
      fontSize: 10,
      fill: "#6b5f55",
    },
  }));

  return { nodes: [...objectNodes, ...eventNodes], edges: graphEdges };
}

function ObjectHistoryActivityGraphInner({ objects, events, edges }: ObjectHistoryActivityGraphProps) {
  const { nodes, edges: graphEdges } = useMemo(
    () => buildGraph(objects, events, edges),
    [objects, events, edges]
  );

  return (
    <div className="h-[560px] w-full rounded-2xl border border-border bg-card">
      <ReactFlow
        nodes={nodes}
        edges={graphEdges}
        nodeTypes={{ objectNode: ObjectNode, eventNode: EventNode }}
        fitView
        minZoom={0.2}
        maxZoom={1.6}
      >
        <Background variant={BackgroundVariant.Dots} gap={18} size={1} />
        <Controls />
        <MiniMap />
      </ReactFlow>
    </div>
  );
}

export function ObjectHistoryActivityGraph(props: ObjectHistoryActivityGraphProps) {
  return (
    <ReactFlowProvider>
      <ObjectHistoryActivityGraphInner {...props} />
    </ReactFlowProvider>
  );
}
