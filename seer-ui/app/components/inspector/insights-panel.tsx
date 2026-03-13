"use client";

import { startTransition, useCallback, useMemo, useSyncExternalStore } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";

import { ProcessMiningPanel } from "./process-mining-panel";
import { ProcessInsightsPanel } from "./process-insights-panel";
import { mergeSearchParams } from "@/app/lib/url-state";

export type InsightsViewTab = "process-insights" | "process-mining";

interface InsightsPanelProps {
  defaultTab?: InsightsViewTab;
}

const INSIGHTS_MODES: Record<InsightsViewTab, { label: string }> = {
  "process-insights": {
    label: "RCA",
  },
  "process-mining": {
    label: "OC-DFG",
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
      <TabsList className="grid h-11 w-full max-w-[220px] grid-cols-2 rounded-full bg-muted/50 p-1">
        {Object.entries(INSIGHTS_MODES).map(([value, mode]) => (
          <TabsTrigger key={value} value={value} className="rounded-full text-sm font-medium">
            {mode.label}
          </TabsTrigger>
        ))}
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
