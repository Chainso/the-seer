import { NavSidebar } from './nav-sidebar';
import { GlobalAssistantLayer } from '@/app/components/assistant/global-assistant-layer';
import { SharedAssistantStateProvider } from '@/app/components/assistant/shared-assistant-state';
import { OntologyGraphProvider } from '@/app/components/providers/ontology-graph-provider';

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <SharedAssistantStateProvider>
      <OntologyGraphProvider>
        <div className="flex h-screen">
          <NavSidebar />
          <main className="flex-1 overflow-auto">
            <div className="min-h-full px-8 py-6">{children}</div>
          </main>
          <GlobalAssistantLayer />
        </div>
      </OntologyGraphProvider>
    </SharedAssistantStateProvider>
  );
}
