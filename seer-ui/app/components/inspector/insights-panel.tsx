"use client";

import { startTransition, useCallback, useMemo, useSyncExternalStore } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";

import { ProcessMiningPanel } from "./process-mining-panel";
import { ProcessInsightsPanel } from "./process-insights-panel";
import { mergeSearchParams } from "@/app/lib/url-state";
import { cn } from "@/app/lib/utils";

export type InsightsViewTab = "process-insights" | "process-mining";

interface InsightsPanelProps {
  defaultTab?: InsightsViewTab;
}

const INSIGHTS_MODES: Record<
  InsightsViewTab,
  {
    label: string;
    title: string;
    description: string;
  }
> = {
  "process-insights": {
    label: "RCA",
    title: "Root Cause Analysis",
    description: "Trace the drivers behind outcomes, compare filters, and rank the most likely explanations.",
  },
  "process-mining": {
    label: "OC-DFG",
    title: "Object-Centric Flow Graph",
    description: "Inspect object interactions, mined process structure, and handoffs across the execution graph.",
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
    return <div className="h-24 w-full animate-pulse border-b border-border bg-muted/20" />;
  }

  return (
    <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-5">
      <TabsList variant="rail" className="grid grid-cols-2 gap-0">
        {Object.entries(INSIGHTS_MODES).map(([value, mode]) => {
          const isActive = activeTab === value;

          return (
            <TabsTrigger
              key={value}
              value={value}
              variant="rail"
              className="min-h-[84px] px-1 py-0 transition-colors duration-200"
            >
              <div className="flex w-full flex-col gap-1 px-3 pb-4 pt-3">
                <span
                  className={cn(
                    "text-[11px] font-semibold uppercase tracking-[0.18em]",
                    isActive ? "text-primary" : "text-muted-foreground"
                  )}
                >
                  {mode.label}
                </span>
                <div className="space-y-1">
                  <p className={cn("text-sm font-semibold leading-tight", isActive ? "text-foreground" : "text-foreground/80")}>
                    {mode.title}
                  </p>
                  <p className="hidden text-xs leading-5 text-muted-foreground md:block">{mode.description}</p>
                </div>
              </div>
            </TabsTrigger>
          );
        })}
      </TabsList>
      <TabsContent value="process-insights" className="space-y-4">
        <ProcessInsightsPanel isActive={activeTab === "process-insights"} />
      </TabsContent>
      <TabsContent value="process-mining" className="space-y-4">
        <ProcessMiningPanel isActive={activeTab === "process-mining"} />
      </TabsContent>
    </Tabs>
  );
}
