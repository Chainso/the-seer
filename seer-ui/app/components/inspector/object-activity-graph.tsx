'use client';

import { useMemo } from 'react';
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
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { Card } from '../ui/card';
import type { ActivityGraphNode, ActivityObjectEdge, ObjectGraphNode } from '@/app/types/activity';

interface ObjectActivityGraphProps {
  objects: ObjectGraphNode[];
  activities: ActivityGraphNode[];
  edges: ActivityObjectEdge[];
  modelLookup: Record<string, string>;
  activityLookup: Record<string, string>;
}

function ObjectNode({ data }: { data: { label: string; subtitle: string } }) {
  return (
    <Card className="min-w-[180px] border-2 border-border bg-[color:var(--graph-node-object-bg)] px-4 py-3 shadow-sm">
      <div className="text-[0.65rem] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
        Object
      </div>
      <div className="font-display text-sm">{data.label}</div>
      <div className="text-xs text-muted-foreground">{data.subtitle}</div>
    </Card>
  );
}

function ActivityNode({ data }: { data: { label: string; subtitle: string; kind: string } }) {
  const color =
    data.kind === 'event'
      ? 'var(--graph-node-signal-bg)'
      : 'var(--graph-node-action-bg)';

  return (
    <Card className="min-w-[200px] border-2 border-border px-4 py-3 shadow-sm" style={{ backgroundColor: color }}>
      <div className="text-[0.65rem] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
        {data.kind}
      </div>
      <div className="font-display text-sm">{data.label}</div>
      <div className="text-xs text-muted-foreground">{data.subtitle}</div>
    </Card>
  );
}

function buildGraph(
  objects: ObjectGraphNode[],
  activities: ActivityGraphNode[],
  edges: ActivityObjectEdge[],
  modelLookup: Record<string, string>,
  activityLookup: Record<string, string>
) {
  const objectNodes: Node[] = objects.map((object, index) => ({
    id: `object-${object.id}`,
    type: 'objectNode',
    position: { x: 0, y: index * 140 },
    data: {
      label: modelLookup[object.modelUri] ?? "Unknown model",
      subtitle: object.id.slice(0, 8),
    },
  }));

  const sortedActivities = [...activities].sort((a, b) =>
    a.activityTime.localeCompare(b.activityTime)
  );
  const activityNodes: Node[] = sortedActivities.map((activity, index) => ({
    id: `activity-${activity.activityType}-${activity.id}`,
    type: 'activityNode',
    position: { x: 340, y: index * 140 },
    data: {
      label: activityLookup[activity.typeUri] ?? "Unknown activity",
      subtitle: new Date(activity.activityTime).toLocaleString(),
      kind: activity.activityType,
    },
  }));

  const edgeList: Edge[] = edges.map((edge, index) => ({
    id: `edge-${edge.activityType}-${edge.activityId}-${edge.objectId}-${index}`,
    source: `activity-${edge.activityType}-${edge.activityId}`,
    target: `object-${edge.objectId}`,
    label: edge.role,
    type: 'smoothstep',
    markerEnd: {
      type: MarkerType.ArrowClosed,
      color: '#7c6f64',
    },
    style: {
      stroke: '#7c6f64',
      strokeWidth: 1.2,
    },
    labelStyle: {
      fontSize: 10,
      fill: '#6b5f55',
    },
  }));

  return { nodes: [...objectNodes, ...activityNodes], edges: edgeList };
}

function ObjectActivityGraphInner({ objects, activities, edges, modelLookup, activityLookup }: ObjectActivityGraphProps) {
  const { nodes, edges: graphEdges } = useMemo(
    () => buildGraph(objects, activities, edges, modelLookup, activityLookup),
    [objects, activities, edges, modelLookup, activityLookup]
  );

  return (
    <div className="h-[540px] w-full rounded-2xl border border-border bg-card">
      <ReactFlow
        nodes={nodes}
        edges={graphEdges}
        nodeTypes={{ objectNode: ObjectNode, activityNode: ActivityNode }}
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

export function ObjectActivityGraph(props: ObjectActivityGraphProps) {
  return (
    <ReactFlowProvider>
      <ObjectActivityGraphInner {...props} />
    </ReactFlowProvider>
  );
}
