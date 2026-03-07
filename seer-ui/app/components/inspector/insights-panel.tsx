"use client";

import { startTransition, useCallback, useMemo, useSyncExternalStore } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Activity, Radar } from "lucide-react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { Card } from "../ui/card";

import { ProcessMiningPanel } from "./process-mining-panel";
import { ProcessInsightsPanel } from "./process-insights-panel";
import { mergeSearchParams } from "@/app/lib/url-state";

export type InsightsViewTab = "process-insights" | "process-mining";

interface InsightsPanelProps {
  defaultTab?: InsightsViewTab;
}

const INSIGHTS_MODES: Record<
  InsightsViewTab,
  {
    label: string;
    shortLabel: string;
    summary: string;
    Icon: typeof Activity;
  }
> = {
  "process-insights": {
    label: "Process Insights",
    shortLabel: "RCA",
    summary: "Rank outcome drivers and inspect supporting evidence traces.",
    Icon: Radar,
  },
  "process-mining": {
    label: "Process Mining",
    shortLabel: "OC-DFG",
    summary: "Explore object-centric process flow and drill into graph structure.",
    Icon: Activity,
  },
};

export function InsightsPanel({ defaultTab = "process-insights" }: InsightsPanelProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const mounted = useSyncExternalStore(
    () => () => undefined,
    () => true,
    () => false,
  );
  const activeTab = useMemo<InsightsViewTab>(() => {
    const raw = searchParams.get("tab");
    return raw === "process-mining" ? "process-mining" : defaultTab;
  }, [defaultTab, searchParams]);

  const handleTabChange = useCallback((nextTab: string) => {
    if (nextTab !== "process-insights" && nextTab !== "process-mining") {
      return;
    }
    const nextQuery = mergeSearchParams(searchParams, {
      tab: nextTab === defaultTab ? null : nextTab,
    });
    startTransition(() => {
      router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, { scroll: false });
    });
  }, [defaultTab, pathname, router, searchParams]);

  if (!mounted) {
    return <div className="h-11 w-full max-w-[480px] animate-pulse rounded-lg bg-muted" />;
  }

  return (
    <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-4">
      <Card className="rounded-3xl border border-border bg-card p-6 shadow-sm sm:p-8">
        <div className="space-y-6">
          <div className="space-y-3">
            <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">Insights</p>
            <div className="space-y-2">
              <h1 className="font-display text-3xl sm:text-4xl">Investigate Process Behavior</h1>
              <p className="max-w-3xl text-sm text-muted-foreground sm:text-base">
                Switch between root-cause analysis and process mining without leaving the same investigation surface.
              </p>
            </div>
          </div>

          <TabsList className="grid h-auto w-full grid-cols-1 gap-2 rounded-2xl bg-muted/40 p-2 sm:grid-cols-2">
            {Object.entries(INSIGHTS_MODES).map(([value, mode]) => {
              const Icon = mode.Icon;
              return (
                <TabsTrigger
                  key={value}
                  value={value}
                  className="h-auto items-start justify-start rounded-xl border border-transparent px-4 py-3 text-left data-[state=active]:border-border data-[state=active]:bg-background data-[state=active]:shadow-sm"
                >
                  <span className="flex flex-col items-start gap-2">
                    <span className="flex items-center gap-2">
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-background/80 text-foreground ring-1 ring-border/70 data-[state=active]:bg-primary/10">
                        <Icon className="h-4 w-4" />
                      </span>
                      <span className="flex flex-col items-start leading-tight">
                        <span className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
                          {mode.shortLabel}
                        </span>
                        <span className="text-sm font-semibold text-foreground">{mode.label}</span>
                      </span>
                    </span>
                    <span className="text-xs leading-5 text-muted-foreground">{mode.summary}</span>
                  </span>
                </TabsTrigger>
              );
            })}
          </TabsList>
        </div>
      </Card>
      <TabsContent value="process-insights" className="space-y-4">
        <ProcessInsightsPanel isActive={activeTab === "process-insights"} showIntro={false} />
      </TabsContent>
      <TabsContent value="process-mining" className="space-y-4">
        <ProcessMiningPanel isActive={activeTab === "process-mining"} showIntro={false} />
      </TabsContent>
    </Tabs>
  );
}
