"use client";

import { useEffect, useState } from "react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";

import { ProcessMiningPanel } from "./process-mining-panel";
import { ProcessInsightsPanel } from "./process-insights-panel";

export type InsightsViewTab = "process-insights" | "process-mining";

interface InsightsPanelProps {
  defaultTab?: InsightsViewTab;
}

export function InsightsPanel({ defaultTab = "process-insights" }: InsightsPanelProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return <div className="h-11 w-full max-w-[480px] animate-pulse rounded-lg bg-muted" />;
  }

  return (
    <Tabs defaultValue={defaultTab} className="space-y-4">
      <TabsList className="grid h-11 w-full max-w-[480px] grid-cols-2">
        <TabsTrigger value="process-insights">Process Insights</TabsTrigger>
        <TabsTrigger value="process-mining">Process Mining</TabsTrigger>
      </TabsList>
      <TabsContent value="process-insights" className="space-y-4">
        <ProcessInsightsPanel />
      </TabsContent>
      <TabsContent value="process-mining" className="space-y-4">
        <ProcessMiningPanel />
      </TabsContent>
    </Tabs>
  );
}
