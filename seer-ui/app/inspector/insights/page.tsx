import { Suspense } from 'react';
import { connection } from 'next/server';
import { InsightsPanel } from '@/app/components/inspector/insights-panel';

function InsightsPageFallback() {
  return <div className="h-24 w-full animate-pulse border-b border-border bg-muted/20" />;
}

export default async function InspectorInsightsPage() {
  await connection();

  return (
    <Suspense fallback={<InsightsPageFallback />}>
      <InsightsPanel defaultTab="process-insights" />
    </Suspense>
  );
}
