import { Suspense } from 'react';
import { ManagedAgentDetailPanel } from '@/app/components/inspector/managed-agent-detail-panel';

interface ManagedAgentPageProps {
  params: Promise<{ managedAgentKey: string }>;
}

export default async function ManagedAgentPage({ params }: ManagedAgentPageProps) {
  const { managedAgentKey } = await params;

  return (
    <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Loading managed agent...</div>}>
      <ManagedAgentDetailPanel managedAgentKey={managedAgentKey} />
    </Suspense>
  );
}
