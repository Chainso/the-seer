import { Suspense } from 'react';
import { AgenticWorkflowExecutionDetailsPanel } from '@/app/components/inspector/agentic-workflow-execution-details-panel';
import { buildManagedAgentRunsHref } from '@/app/lib/managed-agent-routes';

interface ManagedAgentRunPageProps {
  params: Promise<{ managedAgentKey: string; executionId: string }>;
}

export default async function ManagedAgentRunPage({ params }: ManagedAgentRunPageProps) {
  const { managedAgentKey, executionId } = await params;

  return (
    <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Loading managed-agent run...</div>}>
      <AgenticWorkflowExecutionDetailsPanel
        executionId={executionId}
        backHref={buildManagedAgentRunsHref(managedAgentKey)}
        backLabel="Back to Agent Runs"
        useNestedManagedAgentRunRoutes
      />
    </Suspense>
  );
}
