'use client';

import { useMemo, useState } from 'react';
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
import type { OntologyEdge, OntologyGraph, OntologyNode } from '@/app/types/ontology';
import type { FlowMetric, StateDurationMetric } from '@/app/types/analytics';

interface AnalyticsGraphProps {
  graph: OntologyGraph;
  modelUri: string;
  flows: FlowMetric[];
  durations: StateDurationMetric[];
  edgeMetricMode: "share" | "count";
  stateDurationMetric: "avgSeconds" | "p50Seconds" | "p95Seconds";
}

function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds)) return '—';
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = seconds / 60;
  return `${minutes.toFixed(1)}m`;
}

function StateNode({
  data,
}: {
  data: {
    label: string;
    subtitle: string;
    stats?: StateDurationMetric;
    durationMetric: "avgSeconds" | "p50Seconds" | "p95Seconds";
  };
}) {
  const tooltip = data.stats
    ? `avg ${formatDuration(data.stats.avgSeconds)} | p50 ${formatDuration(data.stats.p50Seconds)} | p95 ${formatDuration(
        data.stats.p95Seconds
      )} | ${data.stats.count} samples`
    : "No duration data yet.";
  const durationMetricLabel =
    data.durationMetric === "avgSeconds"
      ? "avg"
      : data.durationMetric === "p50Seconds"
      ? "p50"
      : "p95";
  const durationMetricValue = data.stats ? formatDuration(data.stats[data.durationMetric]) : "—";

  return (
    <Card
      className="min-w-[180px] border-2 border-border bg-[color:var(--graph-node-state-bg)] px-4 py-3 shadow-sm"
      title={tooltip}
    >
      <div className="text-[0.65rem] font-semibold uppercase tracking-[0.2em] text-muted-foreground">State</div>
      <div className="font-display text-sm">{data.label}</div>
      <div className="text-xs text-muted-foreground">{data.subtitle}</div>
      {data.stats ? (
        <div className="mt-3 grid grid-cols-3 gap-2 text-[0.65rem] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          <div>
            <div className="text-[0.6rem]">avg</div>
            <div className="text-foreground">{formatDuration(data.stats.avgSeconds)}</div>
          </div>
          <div>
            <div className="text-[0.6rem]">p50</div>
            <div className="text-foreground">{formatDuration(data.stats.p50Seconds)}</div>
          </div>
          <div>
            <div className="text-[0.6rem]">p95</div>
            <div className="text-foreground">{formatDuration(data.stats.p95Seconds)}</div>
          </div>
        </div>
      ) : (
        <div className="mt-3 text-xs text-muted-foreground">No duration data yet.</div>
      )}
      <div className="mt-3 rounded-lg border border-border/70 bg-background/80 px-2 py-1 text-[0.65rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        Active: {durationMetricLabel} <span className="text-foreground">{durationMetricValue}</span>
      </div>
    </Card>
  );
}

function buildStateGraph(
  graph: OntologyGraph,
  modelUri: string,
  flows: FlowMetric[],
  durations: StateDurationMetric[],
  edgeMetricMode: "share" | "count",
  stateDurationMetric: "avgSeconds" | "p50Seconds" | "p95Seconds"
) {
  const nodesByUri = new Map<string, OntologyNode>();
  graph.nodes.forEach(node => nodesByUri.set(node.uri, node));

  const edgesByType = new Map<string, OntologyEdge[]>();
  graph.edges.forEach(edge => {
    if (!edgesByType.has(edge.type)) {
      edgesByType.set(edge.type, []);
    }
    edgesByType.get(edge.type)?.push(edge);
  });

  const stateUris = new Set(
    (edgesByType.get('hasPossibleState') || [])
      .filter(edge => edge.fromUri === modelUri)
      .map(edge => edge.toUri)
  );

  const resolveStateName = (uri: string) => {
    const node = nodesByUri.get(uri);
    return (node?.properties?.name as string) || uri;
  };

  const transitionNodes = graph.nodes.filter(
    node =>
      node.label === 'Transition' &&
      (edgesByType.get('transitionOf') || []).some(
        edge => edge.fromUri === node.uri && edge.toUri === modelUri
      )
  );

  const stateList = Array.from(stateUris);
  const columns = Math.max(1, Math.ceil(Math.sqrt(stateList.length)));
  const columnWidth = 260;
  const rowHeight = 220;

  const stateNodes: Node[] = stateList.map((uri, index) => {
    const node = nodesByUri.get(uri);
    const name = (node?.properties?.name as string) || uri;
    const description = (node?.properties?.description as string) || 'State';
    const stats = durations.find(metric => metric.stateUri === uri);
    return {
      id: uri,
      type: 'stateNode',
      position: {
        x: (index % columns) * columnWidth,
        y: Math.floor(index / columns) * rowHeight,
      },
      data: {
        label: name,
        subtitle: description,
        stats,
        durationMetric: stateDurationMetric,
      },
    };
  });

  const flowMap = new Map<string, FlowMetric>();
  flows.forEach(flow => {
    flowMap.set(`${flow.fromState}::${flow.toState}`, flow);
  });
  const maxFlowCount = Math.max(1, ...flows.map(flow => flow.count));

  const transitionEdges: Edge[] = transitionNodes
    .map((transition, index) => {
      const fromEdge = (edgesByType.get('fromState') || []).find(edge => edge.fromUri === transition.uri);
      const toEdge = (edgesByType.get('toState') || []).find(edge => edge.fromUri === transition.uri);
      if (!fromEdge || !toEdge) return null;
      if (!stateUris.has(fromEdge.toUri) || !stateUris.has(toEdge.toUri)) return null;
      const flow = flowMap.get(`${fromEdge.toUri}::${toEdge.toUri}`);
      const metricShare = flow?.share ?? 0;
      const metricCount = flow?.count ?? 0;
      const modeValue = edgeMetricMode === "share" ? metricShare : metricCount / maxFlowCount;
      const label = flow
        ? edgeMetricMode === "share"
          ? `${flow.count} • ${(flow.share * 100).toFixed(0)}%`
          : `${flow.count} events`
        : "0";
      const strokeWidth = flow ? Math.max(1, 1 + modeValue * 6) : 1;
      const tooltip = flow
        ? edgeMetricMode === "share"
          ? `Flow ${flow.count} • ${(flow.share * 100).toFixed(1)}% share`
          : `Flow ${flow.count} events`
        : "No flow data yet.";

      return {
        id: `${transition.uri}-${index}`,
        source: fromEdge.toUri,
        target: toEdge.toUri,
        label,
        type: 'smoothstep',
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: '#7c6f64',
        },
        style: {
          stroke: '#7c6f64',
          strokeWidth,
        },
        labelStyle: {
          fontSize: 10,
          fill: '#6b5f55',
          fontWeight: 600,
        },
        data: {
          tooltip,
          share: flow?.share ?? 0,
          count: flow?.count ?? 0,
          fromName: resolveStateName(fromEdge.toUri),
          toName: resolveStateName(toEdge.toUri),
        },
      };
    })
    .filter(Boolean) as Edge[];

  return { nodes: stateNodes, edges: transitionEdges };
}

function AnalyticsGraphInner({
  graph,
  modelUri,
  flows,
  durations,
  edgeMetricMode,
  stateDurationMetric,
}: AnalyticsGraphProps) {
  const { nodes, edges } = useMemo(
    () => buildStateGraph(graph, modelUri, flows, durations, edgeMetricMode, stateDurationMetric),
    [durations, edgeMetricMode, flows, graph, modelUri, stateDurationMetric]
  );
  const [edgeTooltip, setEdgeTooltip] = useState<{
    x: number;
    y: number;
    label: string;
    fromName: string;
    toName: string;
    count: number;
    share: number;
  } | null>(null);

  return (
    <div className="relative h-[640px] w-full rounded-2xl border border-border bg-card">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={{ stateNode: StateNode }}
        fitView
        minZoom={0.2}
        maxZoom={1.8}
        onEdgeMouseEnter={(event, edge) => {
          const data = edge.data as {
            tooltip?: string;
            fromName?: string;
            toName?: string;
            count?: number;
            share?: number;
          } | undefined;
          const tooltip = data?.tooltip;
          if (!tooltip) return;
          const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
          setEdgeTooltip({
            x: event.clientX - rect.left,
            y: event.clientY - rect.top,
            label: tooltip,
            fromName: data?.fromName ?? edge.source,
            toName: data?.toName ?? edge.target,
            count: data?.count ?? 0,
            share: data?.share ?? 0,
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
            Transition flow
          </div>
          <div className="mt-1 text-sm font-display">
            {edgeTooltip.fromName} → {edgeTooltip.toName}
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

export function OntologyAnalyticsGraph(props: AnalyticsGraphProps) {
  return (
    <ReactFlowProvider>
      <AnalyticsGraphInner {...props} />
    </ReactFlowProvider>
  );
}
