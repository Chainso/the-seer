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
    <div data-object-lifecycle-workspace>
      <ObjectStoreInsightsWorkspace objectType={objectType} isActive={isActive} mode="lifecycle" />
    </div>
  );
}
