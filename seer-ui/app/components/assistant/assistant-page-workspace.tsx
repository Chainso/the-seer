'use client';

import { useMemo } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';

import { AssistantWorkspace } from '@/app/components/assistant/assistant-workspace';
import { inferModuleFromPath } from '@/app/components/assistant/shared-assistant-state';

export function AssistantPageWorkspace() {
  const pathname = usePathname() || '/assistant';
  const searchParams = useSearchParams();
  const moduleName = useMemo(
    () => (pathname === '/assistant' ? 'workbench' : inferModuleFromPath(pathname)),
    [pathname]
  );
  const seedPrompt = searchParams.get('q');

  return (
    <AssistantWorkspace
      experience="workbench"
      variant="page"
      route={pathname}
      moduleName={moduleName}
      seedPrompt={seedPrompt}
    />
  );
}
