"use client";

import { useMemo } from "react";

import { ObjectStoreInsightsWorkspace } from "@/app/components/inspector/object-store-insights-workspace";
import { Card } from "@/app/components/ui/card";
import { useOntologyDisplay } from "@/app/lib/ontology-display";

function toSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

interface ObjectLifecycleWorkspaceProps {
  objectName: string;
  catalogKey: string;
  isActive: boolean;
}

export function ObjectLifecycleWorkspace({
  objectName,
  catalogKey,
  isActive,
}: ObjectLifecycleWorkspaceProps) {
  const ontologyDisplay = useOntologyDisplay();

  const objectType = useMemo(() => {
    const normalizedName = objectName.trim().toLowerCase();
    const byName = ontologyDisplay.catalog.objectModels.find(
      (model) => model.name.trim().toLowerCase() === normalizedName
    );
    if (byName) {
      return byName.uri;
    }

    const bySlug = ontologyDisplay.catalog.objectModels.find(
      (model) => toSlug(model.name) === catalogKey
    );
    return bySlug?.uri ?? null;
  }, [catalogKey, objectName, ontologyDisplay.catalog.objectModels]);

  if (!objectType) {
    return (
      <Card className="rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground shadow-sm">
        {objectName} lifecycle details are unavailable right now. Summary and runtime data are still available.
      </Card>
    );
  }

  return (
    <div className="space-y-4" data-object-lifecycle-workspace>
      <Card className="rounded-2xl border border-border bg-card p-6 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Lifecycle</p>
        <h2 className="mt-2 font-display text-2xl">{objectName} Lifecycle</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Explore lifecycle flow, inspect patterns, and compare findings for this object.
        </p>
      </Card>
      <ObjectStoreInsightsWorkspace objectType={objectType} isActive={isActive} mode="lifecycle" />
    </div>
  );
}
