'use client';

import { useEffect, useState } from 'react';
import { Menu, Sparkles } from 'lucide-react';
import { NavSidebar } from './nav-sidebar';
import { GlobalAssistantLayer } from '@/app/components/assistant/global-assistant-layer';
import { SharedAssistantStateProvider } from '@/app/components/assistant/shared-assistant-state';
import { OntologyGraphProvider } from '@/app/components/providers/ontology-graph-provider';
import { Button } from '@/app/components/ui/button';

export function AppShell({ children }: { children: React.ReactNode }) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    if (!mobileNavOpen) {
      document.body.style.removeProperty('overflow');
      return;
    }
    document.body.style.setProperty('overflow', 'hidden');
    return () => {
      document.body.style.removeProperty('overflow');
    };
  }, [mobileNavOpen]);

  useEffect(() => {
    if (!mobileNavOpen) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMobileNavOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [mobileNavOpen]);

  useEffect(() => {
    const desktopMedia = window.matchMedia('(min-width: 1024px)');
    const handleDesktopMatch = (event: MediaQueryListEvent | MediaQueryList) => {
      if (event.matches) {
        setMobileNavOpen(false);
      }
    };

    handleDesktopMatch(desktopMedia);

    const listener = (event: MediaQueryListEvent) => handleDesktopMatch(event);
    desktopMedia.addEventListener('change', listener);
    return () => {
      desktopMedia.removeEventListener('change', listener);
    };
  }, []);

  return (
    <SharedAssistantStateProvider>
      <OntologyGraphProvider>
        <div className="flex min-h-screen overflow-x-clip bg-background">
          <div className="hidden lg:flex lg:shrink-0">
            <NavSidebar />
          </div>

          {mobileNavOpen && (
            <div className="fixed inset-0 z-[70] lg:hidden" aria-modal="true" role="dialog">
              <button
                type="button"
                className="absolute inset-0 bg-background/75 backdrop-blur-sm"
                aria-label="Close navigation"
                onClick={() => setMobileNavOpen(false)}
              />
              <div className="relative h-full pt-[calc(env(safe-area-inset-top)+0.75rem)]">
                <NavSidebar variant="drawer" onNavigate={() => setMobileNavOpen(false)} />
              </div>
            </div>
          )}

          <div className="flex min-h-screen min-w-0 flex-1 flex-col">
            <header className="sticky top-0 z-40 flex h-16 items-center justify-between border-b border-border/70 bg-background/95 pl-[calc(env(safe-area-inset-left)+1rem)] pr-[calc(env(safe-area-inset-right)+1rem)] backdrop-blur lg:hidden">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Open navigation"
                onClick={() => setMobileNavOpen(true)}
                className="touch-manipulation"
              >
                <Menu className="h-5 w-5" />
              </Button>
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/12 text-primary">
                  <Sparkles className="h-4 w-4" />
                </div>
                <div className="text-right">
                  <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Seer</p>
                  <p className="font-display text-base">Atlas Explorer</p>
                </div>
              </div>
            </header>

            <main className="min-w-0 flex-1 overflow-auto overflow-x-hidden">
              <div className="min-h-full px-4 py-4 sm:px-6 sm:py-6 lg:px-8 lg:py-6">{children}</div>
            </main>
          </div>

          <GlobalAssistantLayer />
        </div>
      </OntologyGraphProvider>
    </SharedAssistantStateProvider>
  );
}
