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
          className="fixed bottom-[calc(env(safe-area-inset-bottom)+1rem)] right-[calc(env(safe-area-inset-right)+1rem)] z-[60] rounded-full border border-primary/35 bg-primary text-primary-foreground shadow-[0_18px_50px_-18px_var(--primary)] sm:bottom-6 sm:right-6"
          aria-label="Open assistant"
        >
          <Bot className="h-5 w-5" />
        </Button>
      )}

      {isOpen && (
        <div className="fixed inset-0 z-[65]">
          <button
            type="button"
            className="absolute inset-0 bg-background/72 backdrop-blur-sm"
            aria-label="Close assistant"
            onClick={() => setIsOpen(false)}
          />
          <section
            className="absolute right-0 top-0 h-full w-full sm:w-[min(56rem,100vw)]"
            aria-label="Global assistant"
            aria-modal="true"
            role="dialog"
          >
            <div className="relative h-full">
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
