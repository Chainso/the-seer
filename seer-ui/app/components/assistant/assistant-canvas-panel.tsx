'use client';

import type {
  AssistantArtifact,
  AssistantArtifactType,
  AssistantCanvasState,
} from '@/app/lib/assistant-canvas-state';

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

export function AssistantCanvasPanel({
  state,
  compact = false,
}: AssistantCanvasPanelProps) {
  if (!state.visible || !state.artifact) {
    return null;
  }

  const artifact = state.artifact;
  const summaryItems = summarizeArtifact(artifact);
  const surfacePadding = compact ? 'p-4' : 'p-5';
  const compactSummaryItems = summaryItems.slice(0, 2);

  return (
    <section
      data-assistant-canvas-panel
      data-artifact-type={artifact.artifact_type}
      className={`flex ${compact ? 'h-auto' : 'h-full min-h-0'} flex-col bg-background/96 ${surfacePadding}`}
    >
      <div className="rounded-3xl border border-border/70 bg-card/80 p-4 shadow-sm">
        {compact ? (
          <div className="space-y-3">
            <div className="rounded-full border border-border/70 bg-background px-3 py-1 text-xs font-medium text-foreground w-fit">
              {ARTIFACT_TYPE_LABELS[artifact.artifact_type]}
            </div>
            <div>
              <p className="text-[11px] font-medium uppercase tracking-[0.24em] text-muted-foreground">
                Canvas
              </p>
              <h3 className="mt-2 text-lg font-semibold text-foreground">
                {state.title || artifact.title}
              </h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {artifact.summary ||
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
                {state.title || artifact.title}
              </h3>
              <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
                {artifact.summary ||
                  'The assistant can update or replace this panel as the conversation continues.'}
              </p>
            </div>
            <div className="rounded-full border border-border/70 bg-background px-3 py-1 text-xs font-medium text-foreground">
              {ARTIFACT_TYPE_LABELS[artifact.artifact_type]}
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
              {previewArtifactData(artifact.data)}
            </pre>
          </div>
        ) : null}
      </div>
    </section>
  );
}
