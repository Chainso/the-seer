'use client';

import { useMemo } from 'react';

import type {
  AssistantArtifact,
  AssistantArtifactType,
  AssistantCanvasState,
} from '@/app/lib/assistant-canvas-state';
import { OcdfgGraph as OcdfgGraphView } from '@/app/components/inspector/ocdfg-graph';
import { toOcdfgGraphFromContract } from '@/app/lib/api/process-mining';
import { useOntologyDisplay } from '@/app/lib/ontology-display';
import type { OcdfgMiningResponseContract } from '@/app/types/process-mining';

const ARTIFACT_TYPE_LABELS: Record<AssistantArtifactType, string> = {
  ocdfg: 'OC-DFG',
  process: 'Process view',
  rca: 'Root cause',
  'object-timeline': 'Object timeline',
  table: 'Table',
};

function summarizeArtifact(artifact: AssistantArtifact): string[] {
  const keys = Object.keys(artifact.data);
  if (keys.length === 0) {
    return ['No structured payload fields are available yet.'];
  }

  const summary = keys.slice(0, 4).map((key) => {
    const value = artifact.data[key];
    if (Array.isArray(value)) {
      return `${key}: ${value.length} item${value.length === 1 ? '' : 's'}`;
    }
    if (value && typeof value === 'object') {
      return `${key}: ${Object.keys(value as Record<string, unknown>).length} fields`;
    }
    return `${key}: ready`;
  });

  if (keys.length > 4) {
    summary.push(`${keys.length - 4} more field${keys.length - 4 === 1 ? '' : 's'}`);
  }

  return summary;
}

function previewArtifactData(data: Record<string, unknown>): string {
  const serialized = JSON.stringify(data, null, 2) || '{}';
  if (serialized.length <= 1800) {
    return serialized;
  }
  return `${serialized.slice(0, 1797)}...`;
}

interface AssistantCanvasPanelProps {
  state: AssistantCanvasState;
  compact?: boolean;
}

function parseOcdfgContract(artifact: AssistantArtifact): OcdfgMiningResponseContract | null {
  if (artifact.artifact_type !== 'ocdfg') {
    return null;
  }

  const result = artifact.data.result;
  if (!result || typeof result !== 'object') {
    return null;
  }

  const typedResult = result as Record<string, unknown>;
  if (typedResult.analysis_kind !== 'ocdfg') {
    return null;
  }

  const run = typedResult.run;
  if (!run || typeof run !== 'object') {
    return null;
  }

  const candidate = run as Record<string, unknown>;
  if (
    typeof candidate.run_id !== 'string' ||
    typeof candidate.anchor_object_type !== 'string' ||
    !Array.isArray(candidate.nodes) ||
    !Array.isArray(candidate.edges) ||
    !Array.isArray(candidate.start_activities) ||
    !Array.isArray(candidate.end_activities) ||
    !Array.isArray(candidate.object_types) ||
    !Array.isArray(candidate.warnings)
  ) {
    return null;
  }

  return candidate as unknown as OcdfgMiningResponseContract;
}

export function AssistantCanvasPanel({
  state,
  compact = false,
}: AssistantCanvasPanelProps) {
  const ontologyDisplay = useOntologyDisplay();
  const artifact = state.artifact;
  const ocdfgContract = useMemo(
    () => (artifact ? parseOcdfgContract(artifact) : null),
    [artifact]
  );
  const ocdfgGraph = useMemo(
    () => (ocdfgContract ? toOcdfgGraphFromContract(ocdfgContract) : null),
    [ocdfgContract]
  );
  const ocdfgModelLabels = useMemo(() => {
    if (!ocdfgGraph) return {};
    return ocdfgGraph.objectTypes.reduce<Record<string, string>>((acc, objectType) => {
      acc[objectType] = ontologyDisplay.displayObjectType(objectType);
      return acc;
    }, {});
  }, [ocdfgGraph, ontologyDisplay]);
  const ocdfgEventLabels = useMemo(() => {
    if (!ocdfgGraph) return {};
    return ocdfgGraph.nodes.reduce<Record<string, string>>((acc, node) => {
      if (node.kind !== 'activity' || !node.activity) {
        return acc;
      }
      acc[node.activity] = ontologyDisplay.displayEventType(node.activity);
      return acc;
    }, {});
  }, [ocdfgGraph, ontologyDisplay]);

  if (!state.visible || !state.artifact) {
    return null;
  }

  const visibleArtifact = state.artifact;

  const summaryItems = summarizeArtifact(visibleArtifact);
  const surfacePadding = compact ? 'p-4' : 'p-5';
  const compactSummaryItems = summaryItems.slice(0, 2);
  const ocdfgWindowLabel = ocdfgGraph
    ? `${new Date(ocdfgGraph.startAt).toLocaleString()} to ${new Date(ocdfgGraph.endAt).toLocaleString()}`
    : null;

  if (ocdfgGraph && !compact) {
    return (
      <section
        data-assistant-canvas-panel
        data-assistant-ocdfg-canvas
        data-artifact-type={visibleArtifact.artifact_type}
        className={`flex h-full min-h-0 flex-col bg-background/96 ${surfacePadding}`}
      >
        <div className="rounded-3xl border border-border/70 bg-card/80 p-4 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-[0.24em] text-muted-foreground">
                Canvas
              </p>
              <h3 className="mt-2 text-lg font-semibold text-foreground">
                {state.title || visibleArtifact.title}
              </h3>
              <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
                {visibleArtifact.summary ||
                  'Inspect the object-centric graph while continuing the conversation.'}
              </p>
            </div>
            <div className="rounded-full border border-border/70 bg-background px-3 py-1 text-xs font-medium text-foreground">
              {ARTIFACT_TYPE_LABELS[visibleArtifact.artifact_type]}
            </div>
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-3xl border border-border/70 bg-card/70 p-4">
            <p className="text-[11px] font-medium uppercase tracking-[0.24em] text-muted-foreground">
              Anchor object
            </p>
            <p className="mt-2 text-sm font-semibold text-foreground">
              {ontologyDisplay.displayObjectType(ocdfgGraph.anchorObjectType)}
            </p>
          </div>
          <div className="rounded-3xl border border-border/70 bg-card/70 p-4">
            <p className="text-[11px] font-medium uppercase tracking-[0.24em] text-muted-foreground">
              Activity nodes
            </p>
            <p className="mt-2 text-sm font-semibold text-foreground">
              {ocdfgGraph.nodes.filter((node) => node.kind === 'activity').length}
            </p>
          </div>
          <div className="rounded-3xl border border-border/70 bg-card/70 p-4">
            <p className="text-[11px] font-medium uppercase tracking-[0.24em] text-muted-foreground">
              Edges
            </p>
            <p className="mt-2 text-sm font-semibold text-foreground">{ocdfgGraph.edges.length}</p>
          </div>
          <div className="rounded-3xl border border-border/70 bg-card/70 p-4">
            <p className="text-[11px] font-medium uppercase tracking-[0.24em] text-muted-foreground">
              Warnings
            </p>
            <p className="mt-2 text-sm font-semibold text-foreground">{ocdfgGraph.warnings.length}</p>
          </div>
        </div>

        <div className="mt-4 rounded-3xl border border-border/70 bg-card/70 p-4">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="rounded-full border border-border/60 bg-background/80 px-2.5 py-1 font-medium">
              {ontologyDisplay.displayObjectType(ocdfgGraph.anchorObjectType)}
            </span>
            {ocdfgWindowLabel ? (
              <span className="rounded-full border border-border/60 bg-background/80 px-2.5 py-1">
                {ocdfgWindowLabel}
              </span>
            ) : null}
            {ocdfgGraph.objectTypes.slice(0, 3).map((objectType) => (
              <span
                key={objectType}
                className="rounded-full border border-border/60 bg-background/80 px-2.5 py-1"
              >
                {ocdfgModelLabels[objectType] ?? objectType}
              </span>
            ))}
          </div>
          <div className="mt-4 overflow-hidden rounded-3xl border border-border/70 bg-background/70 p-3">
            <OcdfgGraphView
              graph={ocdfgGraph}
              modelLabels={ocdfgModelLabels}
              eventLabels={ocdfgEventLabels}
            />
          </div>
          {ocdfgGraph.warnings.length > 0 ? (
            <div className="mt-4 rounded-2xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-950/80">
              {ocdfgGraph.warnings.join(' ')}
            </div>
          ) : null}
        </div>
      </section>
    );
  }

  return (
    <section
      data-assistant-canvas-panel
      data-artifact-type={visibleArtifact.artifact_type}
      className={`flex ${compact ? 'h-auto' : 'h-full min-h-0'} flex-col bg-background/96 ${surfacePadding}`}
    >
      <div className="rounded-3xl border border-border/70 bg-card/80 p-4 shadow-sm">
        {compact ? (
          <div className="space-y-3">
            <div className="rounded-full border border-border/70 bg-background px-3 py-1 text-xs font-medium text-foreground w-fit">
              {ARTIFACT_TYPE_LABELS[visibleArtifact.artifact_type]}
            </div>
            <div>
              <p className="text-[11px] font-medium uppercase tracking-[0.24em] text-muted-foreground">
                Canvas
              </p>
              <h3 className="mt-2 text-lg font-semibold text-foreground">
                {state.title || visibleArtifact.title}
              </h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {visibleArtifact.summary ||
                  'The assistant can update or replace this panel as the conversation continues.'}
              </p>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-[0.24em] text-muted-foreground">
                Canvas
              </p>
              <h3 className="mt-2 text-lg font-semibold text-foreground">
                {state.title || visibleArtifact.title}
              </h3>
              <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
                {visibleArtifact.summary ||
                  'The assistant can update or replace this panel as the conversation continues.'}
              </p>
            </div>
            <div className="rounded-full border border-border/70 bg-background px-3 py-1 text-xs font-medium text-foreground">
              {ARTIFACT_TYPE_LABELS[visibleArtifact.artifact_type]}
            </div>
          </div>
        )}
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)]">
        <div className="rounded-3xl border border-border/70 bg-card/70 p-4">
          <p className="text-[11px] font-medium uppercase tracking-[0.24em] text-muted-foreground">
            Ready for rendering
          </p>
          <ul className="mt-3 space-y-2 text-sm text-foreground">
            {(compact ? compactSummaryItems : summaryItems).map((item) => (
              <li key={item} className="rounded-2xl border border-border/60 bg-background/70 px-3 py-2">
                {item}
              </li>
            ))}
          </ul>
        </div>

        {!compact ? (
          <div className="min-h-0 rounded-3xl border border-border/70 bg-card/70 p-4">
            <p className="text-[11px] font-medium uppercase tracking-[0.24em] text-muted-foreground">
              Artifact payload
            </p>
            <pre className="mt-3 max-h-[28rem] overflow-auto rounded-2xl border border-border/60 bg-background/80 p-3 text-xs leading-6 text-muted-foreground">
              {previewArtifactData(visibleArtifact.data)}
            </pre>
          </div>
        ) : null}
      </div>
    </section>
  );
}
