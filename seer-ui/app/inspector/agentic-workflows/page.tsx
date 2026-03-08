import { Suspense } from 'react';
import { AgenticWorkflowExecutionPanel } from '@/app/components/inspector/agentic-workflow-execution-panel';

export default function AgenticWorkflowExecutionsPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Loading workflow executions...</div>}>
      <AgenticWorkflowExecutionPanel />
    </Suspense>
  );
}
