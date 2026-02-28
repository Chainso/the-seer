'use client';

import { useEffect, useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Bot } from 'lucide-react';

import { AssistantWorkspace } from '@/app/components/assistant/assistant-workspace';
import { inferModuleFromPath } from '@/app/components/assistant/shared-assistant-state';
import { Button } from '@/app/components/ui/button';

export function GlobalAssistantLayer() {
  const pathname = usePathname() || '/';
  const moduleName = useMemo(() => inferModuleFromPath(pathname), [pathname]);
  const isAssistantRoute = pathname.startsWith('/assistant');

  return (
    <GlobalAssistantLayerSurface
      key={isAssistantRoute ? 'assistant-route' : 'global-route'}
      pathname={pathname}
      moduleName={moduleName}
      isAssistantRoute={isAssistantRoute}
    />
  );
}

function GlobalAssistantLayerSurface({
  pathname,
  moduleName,
  isAssistantRoute,
}: {
  pathname: string;
  moduleName: string;
  isAssistantRoute: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen]);

  if (isAssistantRoute) {
    return null;
  }

  return (
    <>
      {!isOpen && (
        <Button
          type="button"
          size="icon-lg"
          onClick={() => setIsOpen(true)}
          className="fixed bottom-6 right-6 z-[60] rounded-full border border-primary/35 bg-primary text-primary-foreground shadow-[0_18px_50px_-18px_var(--primary)]"
          aria-label="Open assistant"
        >
          <Bot className="h-5 w-5" />
        </Button>
      )}

      {isOpen && (
        <div className="pointer-events-none fixed inset-0 z-50">
          <section className="absolute right-0 top-0 h-full w-full sm:w-[min(56rem,100vw)]">
            <div className="pointer-events-auto h-full">
              <AssistantWorkspace
                variant="panel"
                route={pathname}
                moduleName={moduleName}
                onRequestClose={() => setIsOpen(false)}
              />
            </div>
          </section>
        </div>
      )}
    </>
  );
}
