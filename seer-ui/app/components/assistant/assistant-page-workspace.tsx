'use client';

import { usePathname, useSearchParams } from 'next/navigation';

import { AssistantWorkspace } from '@/app/components/assistant/assistant-workspace';

export function AssistantPageWorkspace() {
  const pathname = usePathname() || '/assistant';
  const searchParams = useSearchParams();
  const seedPrompt = searchParams.get('q');

  return (
    <AssistantWorkspace
      experience="assistant"
      variant="page"
      route={pathname}
      moduleName="assistant"
      seedPrompt={seedPrompt}
    />
  );
}
