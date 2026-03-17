"use client";

import { ObjectStoreInsightsWorkspace } from "@/app/components/inspector/object-store-insights-workspace";
import { Card } from "@/app/components/ui/card";

interface ObjectLifecycleWorkspaceProps {
  objectName: string;
  objectType: string | null | undefined;
  isActive: boolean;
}

export function ObjectLifecycleWorkspace({
  objectName,
  objectType,
  isActive,
}: ObjectLifecycleWorkspaceProps) {
  if (!objectType) {
    return (
      <Card className="rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground shadow-sm">
        {objectName} lifecycle details are unavailable right now because the object schema could not be resolved. Summary and runtime data are still available.
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
