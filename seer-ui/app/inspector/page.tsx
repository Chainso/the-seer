'use client';

import { useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/app/components/ui/tabs';
import { HistoryPanel } from '@/app/components/inspector/history-panel';
import { ObjectActivityPanel } from '@/app/components/inspector/object-activity-panel';
import { InsightsPanel } from '@/app/components/inspector/insights-panel';

const VALID_TABS = new Set(['activity', 'history', 'insights']);
const DEFAULT_TAB = 'activity';

export default function InspectorPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeTab = useMemo(() => {
    const tab = searchParams.get('tab');
    if (tab && VALID_TABS.has(tab)) {
      return tab;
    }
    return DEFAULT_TAB;
  }, [searchParams]);

  const onTabChange = (nextTab: string) => {
    if (nextTab === DEFAULT_TAB) {
      router.replace('/inspector');
      return;
    }
    router.replace(`/inspector?tab=${nextTab}`);
  };

  return (
    <Tabs value={activeTab} onValueChange={onTabChange} className="space-y-4">
      <TabsList className="grid w-full max-w-2xl grid-cols-3">
        <TabsTrigger value="activity">Object Activity</TabsTrigger>
        <TabsTrigger value="history">Object Store</TabsTrigger>
        <TabsTrigger value="insights">Insights</TabsTrigger>
      </TabsList>
      <TabsContent value="activity" className="space-y-4">
        <ObjectActivityPanel />
      </TabsContent>
      <TabsContent value="history" className="space-y-4">
        <HistoryPanel />
      </TabsContent>
      <TabsContent value="insights" className="space-y-4">
        <InsightsPanel />
      </TabsContent>
    </Tabs>
  );
}
