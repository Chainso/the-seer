import { Suspense } from 'react';
import { ManagedAgentEditor } from '@/app/components/inspector/managed-agent-editor';

interface EditManagedAgentPageProps {
  params: Promise<{ managedAgentKey: string }>;
}

export default async function EditManagedAgentPage({
  params,
}: EditManagedAgentPageProps) {
  const { managedAgentKey } = await params;

  return (
    <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Loading managed-agent editor...</div>}>
      <ManagedAgentEditor mode="edit" managedAgentKey={managedAgentKey} />
    </Suspense>
  );
}
