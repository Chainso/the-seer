import { Suspense } from 'react';
import { AgenticWorkflowExecutionDetailsPanel } from '@/app/components/inspector/agentic-workflow-execution-details-panel';
import {
  buildManagedAgentRunHref,
  buildManagedAgentRunsHref,
  managedAgentKeyFromActionUri,
} from '@/app/lib/managed-agent-routes';
import type { AgenticWorkflowActionSummary } from '@/app/types/agentic-workflows';

interface ManagedAgentRunPageProps {
  params: Promise<{ managedAgentKey: string; executionId: string }>;
}

function buildRunHref(action: AgenticWorkflowActionSummary): string | undefined {
  if (action.action_kind !== 'agentic_workflow') {
    return undefined;
  }

  const relatedManagedAgentKey = managedAgentKeyFromActionUri(action.action_uri);
  if (!relatedManagedAgentKey) {
    return undefined;
  }

  return buildManagedAgentRunHref(relatedManagedAgentKey, action.action_id);
}

export default async function ManagedAgentRunPage({ params }: ManagedAgentRunPageProps) {
  const { managedAgentKey, executionId } = await params;

  return (
    <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Loading managed-agent run...</div>}>
      <AgenticWorkflowExecutionDetailsPanel
        executionId={executionId}
        backHref={buildManagedAgentRunsHref(managedAgentKey)}
        backLabel="Back to Agent Runs"
        buildExecutionHref={buildRunHref}
      />
    </Suspense>
  );
}
