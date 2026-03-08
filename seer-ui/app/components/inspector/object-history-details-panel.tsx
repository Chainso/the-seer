"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Network } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";

import { listObjectEvents } from "@/app/lib/api/history";
import type { ObjectEventItem } from "@/app/types/history";

import { ObjectHistoryDisplaySurface } from "./object-history-display-surface";
import {
  deriveFollowTimeWindow,
  formatDateTime,
  localDateTimeToIso,
  OBJECT_HISTORY_GRAPH_MAX_DEPTH,
  OBJECT_HISTORY_TIMELINE_PAGE_SIZE,
  parseCanonicalRef,
  parseQueryNumber,
  toDateTimeLocalValue,
  type ObjectHistoryIdentity,
  type TimeWindow,
  useObjectHistoryDisplayData,
} from "./use-object-history-display-data";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";

type GraphTimeSource = "follow" | "custom";

function timelineIdentityKey(item: ObjectEventItem): string {
  return `${item.event_id}:${item.object_history_id}`;
}

export function ObjectHistoryDetailsPanel() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const objectType = searchParams.get("object_type")?.trim() || "";
  const objectRefCanonical = searchParams.get("object_ref_canonical")?.trim() || "";
  const objectRefHash = parseQueryNumber(searchParams.get("object_ref_hash"));
  const hasRequiredIdentity = Boolean(objectType && objectRefCanonical);

  const anchorObjectRef = useMemo(
    () => parseCanonicalRef(objectRefCanonical),
    [objectRefCanonical]
  );
  const anchorIdentity = useMemo<ObjectHistoryIdentity | null>(() => {
    if (!hasRequiredIdentity) {
      return null;
    }
    return {
      objectType,
      objectRefCanonical,
      objectRefHash,
      objectRef: anchorObjectRef,
    };
  }, [anchorObjectRef, hasRequiredIdentity, objectRefCanonical, objectRefHash, objectType]);

  const [timelineItems, setTimelineItems] = useState<ObjectEventItem[]>([]);
  const [timelinePage, setTimelinePage] = useState(0);
  const [timelineTotalPages, setTimelineTotalPages] = useState(0);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [timelineError, setTimelineError] = useState<string | null>(null);
  const [timelineReady, setTimelineReady] = useState(false);

  const [graphTimeSource, setGraphTimeSource] = useState<GraphTimeSource>("follow");
  const [graphDepthInput, setGraphDepthInput] = useState("1");
  const [customFromDraft, setCustomFromDraft] = useState("");
  const [customToDraft, setCustomToDraft] = useState("");
  const [appliedCustomRange, setAppliedCustomRange] = useState<TimeWindow | null>(null);
  const [customRangeError, setCustomRangeError] = useState<string | null>(null);

  const graphDepth = useMemo(() => {
    const parsed = Number.parseInt(graphDepthInput, 10);
    if (Number.isNaN(parsed) || parsed < 1) {
      return 1;
    }
    return Math.min(parsed, OBJECT_HISTORY_GRAPH_MAX_DEPTH);
  }, [graphDepthInput]);

  const followWindow = useMemo(
    () => deriveFollowTimeWindow(timelineItems),
    [timelineItems]
  );

  useEffect(() => {
    if (!followWindow) {
      return;
    }
    setCustomFromDraft((previous) => previous || toDateTimeLocalValue(followWindow.startAt));
    setCustomToDraft((previous) => previous || toDateTimeLocalValue(followWindow.endAt));
    setAppliedCustomRange((previous) => previous || followWindow);
  }, [followWindow]);

  const activeGraphWindow = useMemo<TimeWindow | null>(() => {
    if (graphTimeSource === "follow") {
      return followWindow;
    }
    return appliedCustomRange;
  }, [appliedCustomRange, followWindow, graphTimeSource]);

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
            const key = timelineIdentityKey(item);
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
          setTimelineTotalPages(0);
          setTimelinePage(0);
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

  const canLoadOlder = timelineReady && !timelineLoading && timelinePage + 1 < timelineTotalPages;

  const applyCustomRange = () => {
    const startAt = localDateTimeToIso(customFromDraft);
    const endAt = localDateTimeToIso(customToDraft);

    if (!startAt || !endAt) {
      setCustomRangeError("Custom range requires both From and To values.");
      return;
    }

    if (startAt > endAt) {
      setCustomRangeError("Custom range From must be earlier than To.");
      return;
    }

    setCustomRangeError(null);
    setAppliedCustomRange({ startAt, endAt });
  };

  const displayData = useObjectHistoryDisplayData({
    anchorIdentity,
    objectType,
    objectRefCanonical,
    timelineItems,
    timelineReady,
    activeGraphWindow,
    graphDepth,
  });

  if (!hasRequiredIdentity) {
    return (
      <Card className="rounded-2xl border border-destructive/40 bg-destructive/10 p-6 text-sm text-destructive">
        Missing required query params: <code>object_type</code> and <code>object_ref_canonical</code>.
      </Card>
    );
  }

  return (
    <ObjectHistoryDisplaySurface
      objectTypeLabel={displayData.objectTypeLabel}
      anchorSummary={displayData.displayAnchorSummary}
      headerAction={
        <Button type="button" variant="outline" onClick={() => router.push("/inspector/history")}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Object Store
        </Button>
      }
      controls={
        <Card className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            <Network className="h-4 w-4" />
            Graph Controls
          </div>

          <div className="mt-5 grid gap-4 lg:grid-cols-[1.1fr_1fr_1.2fr]">
            <div className="space-y-2">
              <Label htmlFor="graph-time-source">Graph time source</Label>
              <Select
                value={graphTimeSource}
                onValueChange={(value) => setGraphTimeSource(value as GraphTimeSource)}
              >
                <SelectTrigger id="graph-time-source">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="follow">Follow Timeline</SelectItem>
                  <SelectItem value="custom">Custom Range</SelectItem>
                </SelectContent>
              </Select>
              {graphTimeSource === "follow" && (
                <p className="text-xs text-muted-foreground">
                  Graph uses the loaded timeline window and expands automatically when older pages are loaded.
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="graph-depth">Graph depth</Label>
              <Input
                id="graph-depth"
                type="number"
                min={1}
                max={OBJECT_HISTORY_GRAPH_MAX_DEPTH}
                value={graphDepthInput}
                onChange={(event) => setGraphDepthInput(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Depth defaults to 1 and can be increased to {OBJECT_HISTORY_GRAPH_MAX_DEPTH}.
              </p>
            </div>

            <div className="space-y-2">
              <Label>Active graph window</Label>
              {activeGraphWindow ? (
                <div className="rounded-xl border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                  {formatDateTime(activeGraphWindow.startAt)} to {formatDateTime(activeGraphWindow.endAt)}
                </div>
              ) : (
                <div className="rounded-xl border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                  Waiting for timeline data.
                </div>
              )}
            </div>
          </div>

          {graphTimeSource === "custom" && (
            <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_1fr_auto]">
              <div className="space-y-2">
                <Label htmlFor="graph-custom-from">From</Label>
                <Input
                  id="graph-custom-from"
                  type="datetime-local"
                  value={customFromDraft}
                  onChange={(event) => setCustomFromDraft(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="graph-custom-to">To</Label>
                <Input
                  id="graph-custom-to"
                  type="datetime-local"
                  value={customToDraft}
                  onChange={(event) => setCustomToDraft(event.target.value)}
                />
              </div>
              <div className="flex items-end">
                <Button type="button" className="w-full" onClick={applyCustomRange}>
                  Apply Range
                </Button>
              </div>
            </div>
          )}

          {customRangeError && (
            <div className="mt-4 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {customRangeError}
            </div>
          )}
        </Card>
      }
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
  );
}
