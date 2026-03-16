import { Suspense } from 'react';
import { ManagedAgentEditor } from '@/app/components/inspector/managed-agent-editor';

export default function NewManagedAgentPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Loading managed-agent editor...</div>}>
      <ManagedAgentEditor mode="create" />
    </Suspense>
  );
}
