"use client";

import { useMemo } from "react";

import { useOntologyGraphContext } from "@/app/components/providers/ontology-graph-provider";

import { buildOntologyDisplayCatalog } from "./catalog";
import { createOntologyDisplayResolver, type OntologyDisplayResolver } from "./resolver";

export type UseOntologyDisplayResult = OntologyDisplayResolver & {
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
};

export function useOntologyDisplay(): UseOntologyDisplayResult {
  const { graph, loading, error, refresh } = useOntologyGraphContext();

  const catalog = useMemo(() => buildOntologyDisplayCatalog(graph), [graph]);
  const resolver = useMemo(() => createOntologyDisplayResolver(catalog), [catalog]);

  return useMemo(
    () => ({
      ...resolver,
      loading,
      error,
      refresh,
    }),
    [error, loading, refresh, resolver]
  );
}
