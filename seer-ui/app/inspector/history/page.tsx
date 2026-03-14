import { Suspense } from 'react';
import { connection } from 'next/server';
import { HistoryPanel } from '@/app/components/inspector/history-panel';

function HistoryPageFallback() {
  return <div className="h-24 w-full animate-pulse border-b border-border bg-muted/20" />;
}

export default async function InspectorHistoryPage() {
  await connection();

  return (
    <Suspense fallback={<HistoryPageFallback />}>
      <HistoryPanel />
    </Suspense>
  );
}
