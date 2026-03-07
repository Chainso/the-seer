import { Suspense } from 'react';
import { AssistantPageWorkspace } from '@/app/components/assistant/assistant-page-workspace';

export default function AssistantPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Loading workbench...</div>}>
      <AssistantPageWorkspace />
    </Suspense>
  );
}
