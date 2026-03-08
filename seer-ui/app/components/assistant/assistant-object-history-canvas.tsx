"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { listObjectEvents } from "@/app/lib/api/history";
import type { ObjectEventItem } from "@/app/types/history";
import { Card } from "@/app/components/ui/card";
import { ObjectHistoryDisplaySurface } from "@/app/components/inspector/object-history-display-surface";
import {
  deriveFollowTimeWindow,
  OBJECT_HISTORY_TIMELINE_PAGE_SIZE,
  parseCanonicalRef,
  type ObjectHistoryIdentity,
  useObjectHistoryDisplayData,
} from "@/app/components/inspector/use-object-history-display-data";

type HistoryTimelineSnapshot = {
  object_type: string;
  object_ref_canonical: string;
  object_ref_hash: number;
  object_ref: Record<string, unknown>;
};

interface AssistantObjectHistoryCanvasProps {
  timelineSnapshots: HistoryTimelineSnapshot[];
}

export function AssistantObjectHistoryCanvas({
  timelineSnapshots,
}: AssistantObjectHistoryCanvasProps) {
  const [timelineItems, setTimelineItems] = useState<ObjectEventItem[]>([]);
  const [timelinePage, setTimelinePage] = useState(0);
  const [timelineTotalPages, setTimelineTotalPages] = useState(0);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [timelineError, setTimelineError] = useState<string | null>(null);
  const [timelineReady, setTimelineReady] = useState(false);

  const anchorIdentity = useMemo<ObjectHistoryIdentity | null>(() => {
    const first = timelineSnapshots[0];
    if (!first) {
      return null;
    }
    return {
      objectType: first.object_type,
      objectRefCanonical: first.object_ref_canonical,
      objectRefHash: first.object_ref_hash,
      objectRef: first.object_ref || parseCanonicalRef(first.object_ref_canonical),
    };
  }, [timelineSnapshots]);
  const objectType = anchorIdentity?.objectType || "";
  const objectRefCanonical = anchorIdentity?.objectRefCanonical || "";

  const loadTimelinePage = useCallback(
    async (page: number, mode: "replace" | "append") => {
      if (!anchorIdentity) {
        return;
      }

      setTimelineLoading(true);
      setTimelineError(null);

      try {
        const response = await listObjectEvents({
          objectType: anchorIdentity.objectType,
          objectRefCanonical: anchorIdentity.objectRefCanonical,
          objectRefHash: anchorIdentity.objectRefHash,
          page,
          size: OBJECT_HISTORY_TIMELINE_PAGE_SIZE,
        });

        setTimelinePage(response.page);
        setTimelineTotalPages(response.total_pages);
        setTimelineItems((previous) => {
          const source = mode === "append" ? [...previous, ...response.items] : response.items;
          const deduped: ObjectEventItem[] = [];
          const seen = new Set<string>();
          source.forEach((item) => {
            const key = `${item.event_id}:${item.object_history_id}`;
            if (seen.has(key)) {
              return;
            }
            seen.add(key);
            deduped.push(item);
          });
          return deduped;
        });
        setTimelineReady(true);
      } catch (cause) {
        setTimelineError(cause instanceof Error ? cause.message : "Failed to load timeline");
        if (mode === "replace") {
          setTimelineItems([]);
          setTimelinePage(0);
          setTimelineTotalPages(0);
        }
      } finally {
        setTimelineLoading(false);
      }
    },
    [anchorIdentity]
  );

  useEffect(() => {
    setTimelineItems([]);
    setTimelinePage(0);
    setTimelineTotalPages(0);
    setTimelineError(null);
    setTimelineReady(false);

    if (!anchorIdentity) {
      return;
    }

    void loadTimelinePage(0, "replace");
  }, [anchorIdentity, loadTimelinePage]);

  const activeGraphWindow = useMemo(
    () => deriveFollowTimeWindow(timelineItems),
    [timelineItems]
  );
  const canLoadOlder = timelineReady && !timelineLoading && timelinePage + 1 < timelineTotalPages;
  const displayData = useObjectHistoryDisplayData({
    anchorIdentity,
    objectType,
    objectRefCanonical,
    timelineItems,
    timelineReady,
    activeGraphWindow,
    graphDepth: 1,
  });

  if (!anchorIdentity) {
    return (
      <div className="flex h-full min-h-0 flex-col overflow-y-auto p-5" data-assistant-object-history-canvas>
        <Card className="rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground shadow-sm">
          The history artifact is missing a concrete object identity, so the assistant cannot load the shared history display yet.
        </Card>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto p-5" data-assistant-object-history-canvas>
      <ObjectHistoryDisplaySurface
        objectTypeLabel={displayData.objectTypeLabel}
        anchorSummary={displayData.displayAnchorSummary}
        graphObjects={displayData.graphObjects}
        graphEvents={displayData.graphEvents}
        graphEdges={displayData.graphEdges}
        graphLoading={displayData.graphLoading}
        graphError={displayData.graphError}
        graphCapMessages={displayData.graphCapMessages}
        timelineGroups={displayData.timelineGroups}
        timelineItemsCount={timelineItems.length}
        timelineLoading={timelineLoading}
        timelineError={timelineError}
        timelinePage={timelinePage}
        timelineTotalPages={timelineTotalPages}
        canLoadOlder={canLoadOlder}
        onLoadOlder={() => void loadTimelinePage(timelinePage + 1, "append")}
      />
    </div>
  );
}
