import { Suspense } from 'react';
import { ManagedAgentListPanel } from '@/app/components/inspector/managed-agent-list-panel';

export default function ManagedAgentsPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Loading managed agents...</div>}>
      <ManagedAgentListPanel />
    </Suspense>
  );
}
