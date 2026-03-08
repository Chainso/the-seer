"use client";

import { useMemo } from "react";
import { AlertCircle, Loader2 } from "lucide-react";

import { OntologyExplorerTabs } from "@/app/components/ontology/ontology-explorer-tabs";
import { useOntologyGraphContext } from "@/app/components/providers/ontology-graph-provider";
import { Button } from "@/app/components/ui/button";
import { Card } from "@/app/components/ui/card";
import type { OntologyGraph } from "@/app/types/ontology";

interface AssistantOntologyCanvasProps {
  focusConceptUri?: string | null;
  initialTab?: string | null;
  visibleConceptUris?: string[] | null;
}

function deriveFocusNeighborhoodUris(
  graph: OntologyGraph | null,
  focusConceptUri: string | null | undefined
): string[] | null {
  if (!graph || !focusConceptUri) {
    return null;
  }

  const visibleUris = new Set<string>([focusConceptUri]);
  for (const edge of graph.edges) {
    if (edge.fromUri === focusConceptUri || edge.toUri === focusConceptUri) {
      visibleUris.add(edge.fromUri);
      visibleUris.add(edge.toUri);
    }
  }

  return Array.from(visibleUris);
}

export function AssistantOntologyCanvas({
  focusConceptUri,
  initialTab,
  visibleConceptUris,
}: AssistantOntologyCanvasProps) {
  const { graph, loading, error, refresh } = useOntologyGraphContext();
  const scopedVisibleConceptUris = useMemo(
    () =>
      visibleConceptUris && visibleConceptUris.length > 0
        ? visibleConceptUris
        : deriveFocusNeighborhoodUris(graph, focusConceptUri),
    [focusConceptUri, graph, visibleConceptUris]
  );

  if (loading) {
    return (
      <div className="flex h-full min-h-0 flex-col items-center justify-center overflow-y-auto p-5" data-assistant-ontology-canvas>
        <div className="flex flex-col items-center gap-2">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Loading ontology graph...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full min-h-0 flex-col items-center justify-center overflow-y-auto p-5" data-assistant-ontology-canvas>
        <Card className="max-w-md rounded-2xl border border-border bg-card p-6 shadow-sm">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 h-5 w-5 text-destructive" />
            <div>
              <h3 className="font-semibold text-foreground">Failed to load ontology</h3>
              <p className="mt-1 text-sm text-muted-foreground">{error}</p>
              <Button className="mt-4" size="sm" onClick={() => void refresh()}>
                Retry
              </Button>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  if (!graph) {
    return (
      <div className="flex h-full min-h-0 flex-col overflow-y-auto p-5" data-assistant-ontology-canvas>
        <Card className="rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground shadow-sm">
          The ontology graph is not available yet, so the assistant cannot mount the shared explorer surface.
        </Card>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto p-5" data-assistant-ontology-canvas>
      <OntologyExplorerTabs
        key={`${initialTab || "overview"}:${focusConceptUri || "all"}:${scopedVisibleConceptUris?.join("|") || "auto"}`}
        graphData={graph}
        initialTab={initialTab || undefined}
        initialConceptUri={focusConceptUri || undefined}
        visibleConceptUris={scopedVisibleConceptUris}
        initialFocusNeighborhoodOnly={!scopedVisibleConceptUris && Boolean(focusConceptUri)}
      />
    </div>
  );
}
