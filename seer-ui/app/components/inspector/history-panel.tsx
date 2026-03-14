"use client";

import { startTransition, useCallback, useEffect, useMemo } from "react";
import { Boxes, LineChart } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { useOntologyDisplay } from "@/app/lib/ontology-display";
import { mergeSearchParams } from "@/app/lib/url-state";
import { cn } from "@/app/lib/utils";

import { HistoryLiveObjectsPanel } from "./history-live-objects-panel";
import { InsightsPanel } from "./insights-panel";
import { Card } from "../ui/card";
import { Label } from "../ui/label";
import { SearchableSelect } from "../ui/searchable-select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";

type HistoryViewTab = "objects" | "insights";

function pluralizeLabel(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "Objects";
  }
  const lower = trimmed.toLowerCase();
  if (/(s|x|z|ch|sh)$/.test(lower)) {
    return `${trimmed}es`;
  }
  if (/[^aeiou]y$/.test(lower)) {
    return `${trimmed.slice(0, -1)}ies`;
  }
  return `${trimmed}s`;
}

export function HistoryPanel() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const ontologyDisplay = useOntologyDisplay();

  const modelOptions = useMemo(
    () =>
      [...ontologyDisplay.catalog.objectModels]
        .map((model) => ({
          value: model.uri,
          label: ontologyDisplay.displayObjectType(model.uri),
        }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [ontologyDisplay]
  );

  const rawObjectType = searchParams.get("object_type") ?? "";
  const selectedObjectType = useMemo(() => {
    if (modelOptions.some((option) => option.value === rawObjectType)) {
      return rawObjectType;
    }
    return modelOptions[0]?.value || "";
  }, [modelOptions, rawObjectType]);

  const activeTab = useMemo<HistoryViewTab>(() => {
    const rawTab = searchParams.get("tab");
    return rawTab === "insights" ? "insights" : "objects";
  }, [searchParams]);

  const replaceQuery = useCallback((updates: Record<string, string | string[] | null | undefined>) => {
    const nextQuery = mergeSearchParams(searchParams, updates);
    const nextUrl = nextQuery ? `${pathname}?${nextQuery}` : pathname;
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", nextUrl);
    }
    startTransition(() => {
      router.replace(nextUrl, { scroll: false });
    });
  }, [pathname, router, searchParams]);

  useEffect(() => {
    if (!selectedObjectType) {
      return;
    }
    const nextQuery = mergeSearchParams(searchParams, {
      object_type: selectedObjectType,
      tab: activeTab === "objects" ? null : activeTab,
      rca_anchor: selectedObjectType,
      pm_model: selectedObjectType,
    });
    const currentQuery = searchParams.toString();
    if (nextQuery === currentQuery) {
      return;
    }
    const nextUrl = nextQuery ? `${pathname}?${nextQuery}` : pathname;
    startTransition(() => {
      router.replace(nextUrl, { scroll: false });
    });
  }, [activeTab, pathname, router, searchParams, selectedObjectType]);

  const handleObjectTypeChange = (nextObjectType: string) => {
    replaceQuery({
      object_type: nextObjectType,
      rca_anchor: nextObjectType,
      pm_model: nextObjectType,
      rca_outcome: null,
      rca_filter: null,
      rca_run: null,
      rca_insight: null,
      pm_filter: null,
      pm_run: null,
      pm_node: null,
      pm_trace: null,
      pm_workflow: null,
    });
  };

  const handleTabChange = (nextTab: string) => {
    if (nextTab !== "objects" && nextTab !== "insights") {
      return;
    }
    replaceQuery({
      tab: nextTab === "objects" ? null : nextTab,
    });
  };

  const selectedObjectLabel = selectedObjectType
    ? ontologyDisplay.displayObjectType(selectedObjectType)
    : "Object";
  const objectsTabLabel = pluralizeLabel(selectedObjectLabel);

  if (!selectedObjectType) {
    return (
      <Card className="rounded-2xl border border-destructive/40 bg-destructive/10 p-6 text-sm text-destructive">
        No ontology object models are available for Object Store.
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="rounded-2xl border border-border bg-card p-6 shadow-sm">
        <div className="grid gap-4 lg:grid-cols-[1.2fr_2fr] lg:items-end">
          <div className="space-y-2">
            <Label htmlFor="history-object-type">Object model</Label>
            <SearchableSelect
              triggerId="history-object-type"
              value={selectedObjectType}
              onValueChange={handleObjectTypeChange}
              groups={[{ label: "Object models", options: modelOptions }]}
              placeholder="Select object model"
              searchPlaceholder="Search object models..."
              emptyMessage="No object models found."
            />
          </div>
          <div className="rounded-2xl border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
            Object Store always stays scoped to one object model. Live objects and embedded insights
            both follow this selection.
          </div>
        </div>
      </Card>

      <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-5">
        <TabsList variant="rail" className="grid grid-cols-2 gap-0">
          <TabsTrigger value="objects" variant="rail" className="min-h-[84px] px-1 py-0 transition-colors duration-200">
            <div className="flex w-full flex-col gap-1 px-3 pb-4 pt-3 text-left">
              <span
                className={cn(
                  "text-[11px] font-semibold uppercase tracking-[0.18em]",
                  activeTab === "objects" ? "text-primary" : "text-muted-foreground"
                )}
              >
                <Boxes className="mr-2 inline h-3.5 w-3.5" />
                Live Objects
              </span>
              <p className={cn("text-sm font-semibold leading-tight", activeTab === "objects" ? "text-foreground" : "text-foreground/80")}>
                {objectsTabLabel}
              </p>
              <p className="hidden text-xs leading-5 text-muted-foreground md:block">
                Inspect the latest snapshots for the selected model with key-part, display-name, and state columns.
              </p>
            </div>
          </TabsTrigger>
          <TabsTrigger value="insights" variant="rail" className="min-h-[84px] px-1 py-0 transition-colors duration-200">
            <div className="flex w-full flex-col gap-1 px-3 pb-4 pt-3 text-left">
              <span
                className={cn(
                  "text-[11px] font-semibold uppercase tracking-[0.18em]",
                  activeTab === "insights" ? "text-primary" : "text-muted-foreground"
                )}
              >
                <LineChart className="mr-2 inline h-3.5 w-3.5" />
                Insights
              </span>
              <p className={cn("text-sm font-semibold leading-tight", activeTab === "insights" ? "text-foreground" : "text-foreground/80")}>
                Scoped Investigation
              </p>
              <p className="hidden text-xs leading-5 text-muted-foreground md:block">
                Run RCA and OC-DFG without leaving Object Store. The selected object model stays locked.
              </p>
            </div>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="objects" className="space-y-4">
          <HistoryLiveObjectsPanel key={selectedObjectType} objectType={selectedObjectType} />
        </TabsContent>
        <TabsContent value="insights" className="space-y-4">
          <InsightsPanel
            key={`history-insights-${selectedObjectType}`}
            defaultTab="process-insights"
            queryKey="insights_tab"
            lockedAnchorModelUri={selectedObjectType}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
