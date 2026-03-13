"use client";

import { Clock3, GitBranch } from "lucide-react";

import {
  ObjectHistoryActivityGraph,
  type ObjectHistoryGraphEdge,
  type ObjectHistoryGraphEventNode,
  type ObjectHistoryGraphObjectNode,
} from "./object-history-activity-graph";
import {
  ObjectHistoryTimeline,
  type ObjectHistoryTimelineGroup,
} from "./object-history-timeline";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card } from "../ui/card";

interface ObjectHistoryDisplaySurfaceProps {
  objectTypeLabel: string;
  anchorSummary: string;
  headerAction?: React.ReactNode;
  controls?: React.ReactNode;
  graphObjects: ObjectHistoryGraphObjectNode[];
  graphEvents: ObjectHistoryGraphEventNode[];
  graphEdges: ObjectHistoryGraphEdge[];
  graphLoading: boolean;
  graphError: string | null;
  graphCapMessages: string[];
  timelineGroups: ObjectHistoryTimelineGroup[];
  timelineItemsCount: number;
  timelineLoading: boolean;
  timelineError: string | null;
  timelinePage: number;
  timelineTotalPages: number;
  canLoadOlder: boolean;
  onLoadOlder: () => void;
}

export function ObjectHistoryDisplaySurface({
  objectTypeLabel,
  anchorSummary,
  headerAction,
  controls,
  graphObjects,
  graphEvents,
  graphEdges,
  graphLoading,
  graphError,
  graphCapMessages,
  timelineGroups,
  timelineItemsCount,
  timelineLoading,
  timelineError,
  timelinePage,
  timelineTotalPages,
  canLoadOlder,
  onLoadOlder,
}: ObjectHistoryDisplaySurfaceProps) {
  return (
    <div className="space-y-6" data-object-history-display-surface>
      {(objectTypeLabel || anchorSummary || headerAction) && (
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-wrap gap-2">
            {objectTypeLabel ? (
              <Badge variant="outline" className="rounded-full">
                {objectTypeLabel}
              </Badge>
            ) : null}
            {anchorSummary ? (
              <Badge variant="outline" className="max-w-[820px] rounded-full truncate">
                {anchorSummary}
              </Badge>
            ) : null}
          </div>
          {headerAction}
        </div>
      )}

      {controls}

      <div className="grid gap-6 xl:grid-cols-[1.25fr_1fr]">
        <Card className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              <GitBranch className="h-4 w-4" />
              Graph View
            </div>
            <Badge variant="outline" className="rounded-full">
              {graphObjects.length} objects / {graphEvents.length} events
            </Badge>
          </div>

          {graphError ? (
            <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
              {graphError}
            </div>
          ) : graphLoading ? (
            <div className="flex h-[560px] items-center justify-center rounded-2xl border border-dashed border-border text-sm text-muted-foreground">
              Building graph...
            </div>
          ) : graphEvents.length === 0 || graphEdges.length === 0 ? (
            <div className="flex h-[560px] items-center justify-center rounded-2xl border border-dashed border-border text-sm text-muted-foreground">
              No graphable relations in the active time window.
            </div>
          ) : (
            <ObjectHistoryActivityGraph objects={graphObjects} events={graphEvents} edges={graphEdges} />
          )}

          {graphCapMessages.length > 0 && (
            <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-xs text-amber-900">
              {graphCapMessages.join(" ")}
            </div>
          )}
        </Card>

        <Card className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              <Clock3 className="h-4 w-4" />
              Timeline by Day
            </div>
            <Badge variant="outline" className="rounded-full">
              {timelineItemsCount} loaded
            </Badge>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Event cards prioritize ontology-aware summaries, highlights, and state changes for this object identity.
          </p>

          {timelineError && (
            <div className="mt-4 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {timelineError}
            </div>
          )}

          <div className="mt-4 space-y-5">
            <ObjectHistoryTimeline
              groups={timelineGroups}
              hasAnyEvents={timelineItemsCount > 0}
              loading={timelineLoading}
            />
          </div>

          <div className="mt-4 flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              Page {timelineTotalPages === 0 ? 0 : timelinePage + 1} of {timelineTotalPages}
            </p>
            <Button type="button" variant="outline" disabled={!canLoadOlder} onClick={onLoadOlder}>
              {timelineLoading ? "Loading..." : "Load older"}
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
