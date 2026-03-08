import { Suspense } from 'react';
import { AgenticWorkflowExecutionDetailsPanel } from '@/app/components/inspector/agentic-workflow-execution-details-panel';

interface AgenticWorkflowExecutionDetailsPageProps {
  params: Promise<{ executionId: string }>;
}

export default async function AgenticWorkflowExecutionDetailsPage({
  params,
}: AgenticWorkflowExecutionDetailsPageProps) {
  const { executionId } = await params;
  return (
    <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Loading workflow execution...</div>}>
      <AgenticWorkflowExecutionDetailsPanel executionId={executionId} />
    </Suspense>
  );
}
