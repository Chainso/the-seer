"use client";

import Link from "next/link";
import { startTransition, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Pencil, Plus, Waypoints } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";

import { getManagedAgent } from "@/app/lib/api/agentic-workflows";
import {
  buildManagedAgentEditHref,
  buildManagedAgentNewHref,
  buildManagedAgentRunHref,
  buildManagedAgentsIndexHref,
  normalizeManagedAgentTab,
} from "@/app/lib/managed-agent-routes";
import { useOntologyDisplay } from "@/app/lib/ontology-display";
import type { ManagedAgentDetail, ManagedAgentFieldDefinition } from "@/app/types/agentic-workflows";

import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import {
  TableBody,
  TableCell,
  TableColumnHeaderCell,
  TableHeader,
  TableRoot,
  TableRow,
} from "../ui/table";
import { ManagedAgentRunsTable } from "./managed-agent-runs-table";

function formatDateTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) {
    return "-";
  }
  return parsed.toLocaleString();
}

function FieldSchemaTable({
  title,
  description,
  fields,
}: {
  title: string;
  description: string;
  fields: ManagedAgentFieldDefinition[];
}) {
  const ontologyDisplay = useOntologyDisplay();

  return (
    <Card className="rounded-2xl border border-border bg-card p-6 shadow-sm">
      <div className="mb-4">
        <div className="text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          {title}
        </div>
        <p className="mt-2 text-sm text-muted-foreground">{description}</p>
      </div>

      {fields.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          No fields defined.
        </div>
      ) : (
        <TableRoot variant="surface" striped>
          <TableHeader>
            <TableRow>
              <TableColumnHeaderCell>Field</TableColumnHeaderCell>
              <TableColumnHeaderCell>Type</TableColumnHeaderCell>
              <TableColumnHeaderCell>Cardinality</TableColumnHeaderCell>
              <TableColumnHeaderCell>Description</TableColumnHeaderCell>
            </TableRow>
          </TableHeader>
          <TableBody>
            {fields.map((field) => {
              const targetLabel = field.value_type_iri
                ? ontologyDisplay.displayConcept(field.value_type_iri)
                : field.object_model_iri
                  ? ontologyDisplay.displayConcept(field.object_model_iri)
                  : field.field_type;

              return (
                <TableRow key={field.field_key}>
                  <TableCell>
                    <div className="space-y-1">
                      <div className="font-medium">{field.label}</div>
                      <div className="text-xs text-muted-foreground">
                        Key: {field.field_key}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="space-y-1">
                      <Badge variant="outline" className="rounded-full">
                        {field.field_type === "object_reference"
                          ? "Object reference"
                          : "Value type"}
                      </Badge>
                      <div className="text-sm text-muted-foreground">{targetLabel}</div>
                    </div>
                  </TableCell>
                  <TableCell>
                    {field.required ? "Required" : "Optional"}
                    {field.multi_value ? " • Multi-value" : " • Single value"}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {field.description || "No description provided."}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </TableRoot>
      )}
    </Card>
  );
}

export function ManagedAgentDetailPanel({
  managedAgentKey,
}: {
  managedAgentKey: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [managedAgent, setManagedAgent] = useState<ManagedAgentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    getManagedAgent(managedAgentKey)
      .then((response) => {
        if (!active) {
          return;
        }
        setManagedAgent(response);
        setError(null);
      })
      .catch((cause) => {
        if (!active) {
          return;
        }
        setManagedAgent(null);
        setError(cause instanceof Error ? cause.message : "Failed to load managed agent");
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [managedAgentKey]);

  const activeTab = useMemo(
    () => normalizeManagedAgentTab(searchParams.get("tab")),
    [searchParams]
  );

  const handleTabChange = (nextTab: string) => {
    const normalized = normalizeManagedAgentTab(nextTab);
    const nextParams = new URLSearchParams(searchParams.toString());
    if (normalized === "details") {
      nextParams.delete("tab");
    } else {
      nextParams.set("tab", normalized);
    }
    const query = nextParams.toString();
    startTransition(() => {
      router.push(
        query
          ? `/inspector/managed-agents/${managedAgentKey}?${query}`
          : `/inspector/managed-agents/${managedAgentKey}`
      );
    });
  };

  if (loading) {
    return (
      <Card className="rounded-2xl border border-border bg-card p-8 text-sm text-muted-foreground">
        Loading managed agent...
      </Card>
    );
  }

  if (!managedAgent || error) {
    return (
      <Card className="rounded-2xl border border-destructive/40 bg-destructive/10 p-8 text-sm text-destructive">
        {error || "Managed agent not found."}
      </Card>
    );
  }

  return (
    <div className="space-y-6" data-managed-agent-detail-panel={managedAgentKey}>
      <Card className="rounded-2xl border border-border bg-card p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              <Waypoints className="h-4 w-4" />
              Managed Agent
            </div>
            <div>
              <h1 className="font-display text-3xl">{managedAgent.name}</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                {managedAgent.description || "No description provided."}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline" className="rounded-full">
                {managedAgent.enabled ? "Enabled" : "Disabled"}
              </Badge>
              <Badge variant="outline" className="rounded-full">
                Key {managedAgent.managed_agent_key}
              </Badge>
              <Badge variant="outline" className="rounded-full">
                {managedAgent.input_fields.length} input fields
              </Badge>
              <Badge variant="outline" className="rounded-full">
                {managedAgent.output_fields.length} output fields
              </Badge>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link href={buildManagedAgentsIndexHref()}>
                <ArrowLeft className="h-4 w-4" />
                All Managed Agents
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href={buildManagedAgentNewHref()}>
                <Plus className="h-4 w-4" />
                New
              </Link>
            </Button>
            <Button asChild>
              <Link href={buildManagedAgentEditHref(managedAgent.managed_agent_key)}>
                <Pencil className="h-4 w-4" />
                Edit
              </Link>
            </Button>
          </div>
        </div>

        <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-2xl border border-border/70 bg-background/80 p-4">
            <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              Canonical action
            </div>
            <div className="mt-2 break-all text-sm">{managedAgent.action_uri}</div>
          </div>
          <div className="rounded-2xl border border-border/70 bg-background/80 p-4">
            <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              Input definition
            </div>
            <div className="mt-2 text-sm font-medium">{managedAgent.input_name}</div>
            <div className="mt-1 text-xs text-muted-foreground">
              {managedAgent.input_description || "No input description provided."}
            </div>
          </div>
          <div className="rounded-2xl border border-border/70 bg-background/80 p-4">
            <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              Output event
            </div>
            <div className="mt-2 text-sm font-medium">{managedAgent.output_name}</div>
            <div className="mt-1 text-xs text-muted-foreground">
              {managedAgent.output_description || "No output description provided."}
            </div>
          </div>
          <div className="rounded-2xl border border-border/70 bg-background/80 p-4">
            <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              Last updated
            </div>
            <div className="mt-2 text-sm font-medium">{formatDateTime(managedAgent.updated_at)}</div>
          </div>
        </div>
      </Card>

      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList variant="rail">
          <TabsTrigger value="details" variant="rail">
            Details
          </TabsTrigger>
          <TabsTrigger value="runs" variant="rail">
            Runs
          </TabsTrigger>
        </TabsList>

        <TabsContent value="details" className="space-y-6">
          <Card className="rounded-2xl border border-border bg-card p-6 shadow-sm">
            <div className="mb-3 text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              Instruction
            </div>
            <div className="whitespace-pre-wrap text-sm leading-6 text-foreground">
              {managedAgent.instruction}
            </div>
          </Card>

          <div className="grid gap-6 xl:grid-cols-2">
            <FieldSchemaTable
              title="Input Schema"
              description="These are the fields the managed agent accepts when a run is submitted."
              fields={managedAgent.input_fields}
            />
            <FieldSchemaTable
              title="Output Event Schema"
              description="These are the fields the managed agent promises to emit in its output event."
              fields={managedAgent.output_fields}
            />
          </div>
        </TabsContent>

        <TabsContent value="runs">
          <ManagedAgentRunsTable
            managedAgentKey={managedAgent.managed_agent_key}
            actionUri={managedAgent.action_uri}
            buildRunHref={(executionId) =>
              buildManagedAgentRunHref(managedAgent.managed_agent_key, executionId)
            }
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
