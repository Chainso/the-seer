'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { getOntologyGraph } from '@/app/lib/api/ontology';
import type { OntologyGraph } from '@/app/types/ontology';

interface OntologyGraphContextValue {
  graph: OntologyGraph | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

const OntologyGraphContext = createContext<OntologyGraphContextValue | null>(null);

export function OntologyGraphProvider({ children }: { children: React.ReactNode }) {
  const [graph, setGraph] = useState<OntologyGraph | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const nextGraph = await getOntologyGraph();
      setGraph(nextGraph);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to load ontology graph');
      setGraph(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const value = useMemo<OntologyGraphContextValue>(
    () => ({
      graph,
      loading,
      error,
      refresh: load,
    }),
    [error, graph, loading, load]
  );

  return <OntologyGraphContext.Provider value={value}>{children}</OntologyGraphContext.Provider>;
}

export function useOntologyGraphContext(): OntologyGraphContextValue {
  const context = useContext(OntologyGraphContext);
  if (!context) {
    throw new Error('useOntologyGraphContext must be used within OntologyGraphProvider');
  }
  return context;
}
