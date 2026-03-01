import { Suspense } from 'react';
import { ObjectHistoryDetailsPanel } from '@/app/components/inspector/object-history-details-panel';

export default function InspectorObjectHistoryPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Loading object history...</div>}>
      <ObjectHistoryDetailsPanel />
    </Suspense>
  );
}
