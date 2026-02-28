import { NavSidebar } from './nav-sidebar';
import { GlobalAssistantCommandBar } from './global-assistant-command-bar';
import { OntologyGraphProvider } from '@/app/components/providers/ontology-graph-provider';

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <OntologyGraphProvider>
      <div className="flex h-screen">
        <NavSidebar />
        <main className="flex-1 overflow-auto">
          <div className="min-h-full px-8 py-6">
            <GlobalAssistantCommandBar />
            {children}
          </div>
        </main>
      </div>
    </OntologyGraphProvider>
  );
}
