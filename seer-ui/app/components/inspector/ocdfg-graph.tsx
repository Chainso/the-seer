'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  BaseEdge,
  Controls,
  Edge,
  EdgeLabelRenderer,
  EdgeProps,
  EdgeTypes,
  Handle,
  MarkerType,
  MiniMap,
  Node,
  Position,
  ReactFlow,
  ReactFlowProvider,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { GraphNodeCard } from '@/app/components/graph/graph-node-card';
import {
  buildOcdfgLayout,
  OCDFG_NODE_HEIGHT,
  OCDFG_NODE_WIDTH,
  OCDFG_OBJECT_NODE_HEIGHT,
  OCDFG_OBJECT_NODE_WIDTH,
  colorSetForKey,
  colorSetForObjectType,
  colorForObjectType,
  type LayoutPoint,
  type OcdfgLayoutResult,
} from '@/app/lib/process-mining/ocdfg-layout';
import type { OcdfgGraph } from '@/app/types/process-mining';

interface OcdfgGraphProps {
  graph: OcdfgGraph;
  modelLabels?: Record<string, string>;
  eventLabels?: Record<string, string>;
  selectedNodeId?: string | null;
  onNodeSelect?: (nodeId: string) => void;
}

interface EdgeData extends Record<string, unknown> {
  kind: 'flow' | 'start';
  points: LayoutPoint[];
  count: number;
  share: number;
  objectType: string;
  objectTypeLabel: string;
  p50Seconds: number | null;
  p95Seconds: number | null;
}

interface ActivityNodeData extends Record<string, unknown> {
  kind: 'activity';
  label: string;
  count: number;
  objectTypes: string[];
  objectTypeUris: string[];
  track: number;
  backgroundColor: string;
  borderColor: string;
}

interface ObjectNodeData extends Record<string, unknown> {
  kind: 'object';
  label: string;
  count: number;
  objectTypeLabel: string;
  track: number;
  backgroundColor: string;
  borderColor: string;
}

function iriLocalName(value: string): string {
  const hashIndex = value.lastIndexOf('#');
  if (hashIndex >= 0 && hashIndex < value.length - 1) {
    return value.slice(hashIndex + 1);
  }
  const slashIndex = value.lastIndexOf('/');
  if (slashIndex >= 0 && slashIndex < value.length - 1) {
    return value.slice(slashIndex + 1);
  }
  return value;
}

function conceptLabel(value: string | null | undefined): string {
  if (!value) {
    return 'Unknown';
  }
  return iriLocalName(value);
}

function buildPolylinePath(points: LayoutPoint[]): string {
  if (points.length <= 1) {
    return '';
  }
  return points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`)
    .join(' ');
}

function ElkEdge(props: EdgeProps<Edge<EdgeData>>) {
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
              zIndex: 50,
            }}
          >
            <span style={labelStyle}>{label}</span>
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

function ActivityNode({ data }: { data: ActivityNodeData }) {
  const objectTypeSummary =
    data.objectTypes.length > 0 ? data.objectTypes.slice(0, 3).join(' • ') : 'Unscoped activity';

  return (
    <>
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <GraphNodeCard
        header="Event"
        headerRight={`${data.count} occurrences`}
        title={data.label}
        description={objectTypeSummary}
        bgColor={data.backgroundColor}
        borderColor={data.borderColor}
        widthPx={OCDFG_NODE_WIDTH}
        heightPx={OCDFG_NODE_HEIGHT}
      />
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
      <div className="sr-only">{data.objectTypes.map((objectType) => conceptLabel(objectType)).join(', ')}</div>
    </>
  );
}

function ObjectNode({ data }: { data: ObjectNodeData }) {
  return (
    <>
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <GraphNodeCard
        header="Object"
        headerRight={data.count > 0 ? `${data.count} starts` : undefined}
        title={data.label}
        bgColor={data.backgroundColor}
        borderColor={data.borderColor}
        widthPx={OCDFG_OBJECT_NODE_WIDTH}
        heightPx={OCDFG_OBJECT_NODE_HEIGHT}
      />
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
    </>
  );
}

function OcdfgGraphInner({ graph, modelLabels, eventLabels, selectedNodeId, onNodeSelect }: OcdfgGraphProps) {
  const [layout, setLayout] = useState<OcdfgLayoutResult | null>(null);
  const [layoutError, setLayoutError] = useState<string | null>(null);
  const [edgeTooltip, setEdgeTooltip] = useState<{
    kind: 'flow' | 'start';
    x: number;
    y: number;
    count: number;
    share: number;
    objectTypeLabel: string;
    p50Seconds: number | null;
    p95Seconds: number | null;
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
      try {
        const nextLayout = await buildOcdfgLayout(graph);
        if (canceled) {
          return;
        }
        setLayoutError(null);
        setLayout(nextLayout);
      } catch (error) {
        if (canceled) {
          return;
        }
        setLayout(null);
        setLayoutError(error instanceof Error ? error.message : 'Failed to layout OC-DFG graph.');
      }
    };

    runLayout();

    return () => {
      canceled = true;
    };
  }, [graph]);

  const nodes = useMemo<Array<Node<ActivityNodeData | ObjectNodeData>>>(() => {
    if (!layout) {
      return [];
    }

    return layout.nodes.map((node) => {
      const className = node.kind === 'activity' && node.id === selectedNodeId ? 'ring-2 ring-foreground/70' : undefined;
      if (node.kind === 'object') {
        const rawObjectType = node.objectType ?? '';
        const displayObjectType = modelLabels?.[rawObjectType] ?? conceptLabel(rawObjectType);
        const colorSet = colorSetForObjectType(rawObjectType);
        return {
          id: node.id,
          type: 'objectNode',
          position: { x: node.x, y: node.y },
          style: { width: node.width, height: node.height },
          zIndex: 20,
          className,
          data: {
            kind: 'object',
            label: displayObjectType,
            count: node.count,
            objectTypeLabel: displayObjectType,
            track: node.partition,
            backgroundColor: colorSet.objectBackground,
            borderColor: colorSet.objectBorder,
          },
        };
      }

      const activity = node.activity ?? node.id;
      const label = eventLabels?.[activity] ?? conceptLabel(activity);
      const objectTypeUris = node.objectTypes;
      const eventColorSet =
        objectTypeUris.length === 1
          ? colorSetForObjectType(objectTypeUris[0])
          : colorSetForKey(`activity:${activity}:${[...objectTypeUris].sort((a, b) => a.localeCompare(b)).join('|')}`);
      const objectTypes = node.objectTypes.map((objectType) => modelLabels?.[objectType] ?? conceptLabel(objectType));
      return {
        id: node.id,
        type: 'activityNode',
        position: { x: node.x, y: node.y },
        style: { width: node.width, height: node.height },
        zIndex: 20,
        className,
        data: {
          kind: 'activity',
          label,
          count: node.count,
          objectTypes,
          objectTypeUris,
          track: node.partition,
          backgroundColor: eventColorSet.eventBackground,
          borderColor: eventColorSet.eventBorder,
        },
      };
    });
  }, [eventLabels, layout, modelLabels, selectedNodeId]);

  const edges = useMemo<Array<Edge<EdgeData>>>(() => {
    if (!layout) {
      return [];
    }

    return layout.edges.map((edge) => {
      const objectTypeLabel = modelLabels?.[edge.objectType] ?? conceptLabel(edge.objectType);
      const stroke = colorForObjectType(edge.objectType);
      const isStartEdge = edge.kind === 'start';
      const strokeWidth = isStartEdge ? 2 : Math.max(1.5, 1.5 + edge.share * 6);
      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: 'elk',
        zIndex: 10,
        label: isStartEdge ? `${edge.count} start` : `${edge.count} • ${(edge.share * 100).toFixed(0)}%`,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: stroke,
        },
        style: {
          stroke,
          strokeWidth,
          strokeOpacity: 0.9,
          strokeDasharray: isStartEdge ? '6 4' : undefined,
        },
        labelStyle: {
          fontSize: 10,
          fill: stroke,
          fontWeight: 600,
        },
        data: {
          kind: edge.kind,
          points: edge.points,
          count: edge.count,
          share: edge.share,
          objectType: edge.objectType,
          objectTypeLabel,
          p50Seconds: edge.p50Seconds,
          p95Seconds: edge.p95Seconds,
        },
      };
    });
  }, [layout, modelLabels]);

  if (layoutError) {
    return (
      <div className="flex h-[680px] items-center justify-center rounded-2xl border border-destructive/40 bg-destructive/10 px-6 text-sm text-destructive">
        {layoutError}
      </div>
    );
  }

  return (
    <div className="relative h-[680px] w-full rounded-2xl border border-border bg-card">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={{ activityNode: ActivityNode, objectNode: ObjectNode }}
        edgeTypes={edgeTypes}
        fitView
        minZoom={0.2}
        maxZoom={1.8}
        fitViewOptions={{ padding: 0.2 }}
        nodesDraggable
        nodesConnectable={false}
        onNodeClick={(_, node) => {
          if (onNodeSelect && node.type === 'activityNode') {
            onNodeSelect(node.id);
          }
        }}
        onEdgeMouseEnter={(event, edge) => {
          const data = edge.data;
          if (!data) {
            return;
          }
          const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
          setEdgeTooltip({
            kind: data.kind,
            x: event.clientX - rect.left,
            y: event.clientY - rect.top,
            count: data.count,
            share: data.share,
            objectTypeLabel: data.objectTypeLabel,
            p50Seconds: data.p50Seconds,
            p95Seconds: data.p95Seconds,
          });
        }}
        onEdgeMouseLeave={() => setEdgeTooltip(null)}
      >
        <Background variant={BackgroundVariant.Dots} gap={18} size={1} />
        <Controls />
        <MiniMap />
      </ReactFlow>
      {edgeTooltip && (
        <div
          className="pointer-events-none absolute z-10 -translate-y-full rounded-lg border border-border bg-background px-3 py-2 text-xs shadow-lg"
          style={{ left: edgeTooltip.x, top: edgeTooltip.y }}
        >
          <div className="text-[0.65rem] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            {edgeTooltip.kind === 'start' ? 'Start edge' : 'Flow edge'}
          </div>
          <div className="mt-2 space-y-1 text-[0.7rem] text-muted-foreground">
            <div>{edgeTooltip.objectTypeLabel}</div>
            <div className="flex items-center gap-2">
              <span className="rounded-full border border-border px-2 py-0.5 text-[0.6rem] font-semibold uppercase tracking-[0.2em]">
                {edgeTooltip.count} total
              </span>
              <span className="rounded-full border border-border px-2 py-0.5 text-[0.6rem] font-semibold uppercase tracking-[0.2em]">
                {(edgeTooltip.share * 100).toFixed(1)}% share
              </span>
            </div>
            {edgeTooltip.kind === 'flow' && edgeTooltip.p50Seconds != null && edgeTooltip.p95Seconds != null ? (
              <div className="flex items-center gap-2">
                <span className="rounded-full border border-border px-2 py-0.5 text-[0.6rem] font-semibold uppercase tracking-[0.2em]">
                  p50 {Math.round(edgeTooltip.p50Seconds)}s
                </span>
                <span className="rounded-full border border-border px-2 py-0.5 text-[0.6rem] font-semibold uppercase tracking-[0.2em]">
                  p95 {Math.round(edgeTooltip.p95Seconds)}s
                </span>
              </div>
            ) : null}
          </div>
        </div>
      )}
      {layout && layout.trackOrder.length > 0 && (
        <div className="pointer-events-none absolute left-3 top-3 z-10 flex flex-wrap gap-1.5">
          {layout.trackOrder.map((objectType, index) => {
            const label = modelLabels?.[objectType] ?? conceptLabel(objectType);
            return (
              <span
                key={objectType}
                className="rounded-full border border-border/70 bg-background/90 px-2 py-0.5 text-[0.58rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground"
              >
                L{index + 1} {label}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function OcdfgGraph(props: OcdfgGraphProps) {
  return (
    <ReactFlowProvider>
      <OcdfgGraphInner {...props} />
    </ReactFlowProvider>
  );
}
