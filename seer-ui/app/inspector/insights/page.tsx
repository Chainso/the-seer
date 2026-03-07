import { Suspense } from 'react';
import { connection } from 'next/server';
import { InsightsPanel } from '@/app/components/inspector/insights-panel';

function InsightsPageFallback() {
  return <div className="h-11 w-full max-w-[480px] animate-pulse rounded-lg bg-muted" />;
}

export default async function InspectorInsightsPage() {
  await connection();

  return (
    <Suspense fallback={<InsightsPageFallback />}>
      <InsightsPanel defaultTab="process-insights" />
    </Suspense>
  );
}
