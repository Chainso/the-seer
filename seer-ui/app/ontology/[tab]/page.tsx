'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { OntologyExplorerTabs } from '@/app/components/ontology/ontology-explorer-tabs';
import { recordPerformanceMetric } from '@/app/lib/performance-budget';
import { Card } from '@/app/components/ui/card';
import { Loader2, AlertCircle } from 'lucide-react';
import { Button } from '@/app/components/ui/button';
import { useOntologyGraphContext } from '@/app/components/providers/ontology-graph-provider';

const VALID_TABS = new Set(['overview', 'objects', 'actions', 'events', 'triggers']);
const DEFAULT_TAB = 'overview';

export default function OntologyTabPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { graph, loading, error, refresh } = useOntologyGraphContext();
  const perfStartRef = useRef<number | null>(null);

  const tabParam = useMemo(() => {
    const raw = params?.tab;
    if (Array.isArray(raw)) {
      return raw[0];
    }
    return raw;
  }, [params]);
  const activeTab = VALID_TABS.has(tabParam || '') ? (tabParam as string) : DEFAULT_TAB;
  const conceptUri = searchParams.get('conceptUri');

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.performance === 'undefined') {
      return;
    }
    if (loading) {
      if (perfStartRef.current === null) {
        perfStartRef.current = window.performance.now();
      }
      return;
    }
    if (perfStartRef.current !== null) {
      recordPerformanceMetric('ontology_graph_load_ms', window.performance.now() - perfStartRef.current);
      perfStartRef.current = null;
    }
  }, [loading]);

  useEffect(() => {
    if (!VALID_TABS.has(tabParam || '')) {
      router.replace(`/ontology/${DEFAULT_TAB}`);
    }
  }, [router, tabParam]);

  const handleTabChange = (nextTab: string) => {
    const query = searchParams.toString();
    router.push(`/ontology/${nextTab}${query ? `?${query}` : ''}`);
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-2">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Loading ontology graph...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <Card className="p-6 max-w-md">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-destructive mt-0.5" />
            <div>
              <h3 className="font-semibold mb-1">Failed to load ontology</h3>
              <p className="text-sm text-muted-foreground">{error}</p>
              <p className="text-xs text-muted-foreground mt-2">
                Make sure the backend is running on port 8080.
              </p>
              <Button className="mt-4" size="sm" onClick={() => void refresh()}>
                Retry
              </Button>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-3xl border border-border bg-card p-6 shadow-sm">
        <div className="flex flex-col gap-2">
          <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">Ontology Explorer</p>
          <h1 className="font-display text-3xl">Understand your ontology as an industry-scale system</h1>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Explore local ontologies, object lifecycles, action contracts, event semantics, and trigger networks
            through a graph-first, read-optimized interface built for repository-driven ontology evolution.
          </p>
        </div>
      </div>
      {graph && (
        <OntologyExplorerTabs
          graphData={graph}
          activeTab={activeTab}
          onTabChange={handleTabChange}
          initialConceptUri={conceptUri}
        />
      )}
    </div>
  );
}
