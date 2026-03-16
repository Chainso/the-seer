"use client";

import Link from "next/link";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { ArrowRight, Plus, Search, Waypoints } from "lucide-react";

import { listManagedAgents } from "@/app/lib/api/agentic-workflows";
import {
  buildManagedAgentHref,
  buildManagedAgentNewHref,
} from "@/app/lib/managed-agent-routes";
import type { ManagedAgentSummary } from "@/app/types/agentic-workflows";

import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Input } from "../ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import {
  TableBody,
  TableCell,
  TableColumnHeaderCell,
  TableHeader,
  TableRoot,
  TableRow,
} from "../ui/table";

type EnabledFilter = "all" | "enabled" | "disabled";

function formatDateTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) {
    return "-";
  }
  return parsed.toLocaleString();
}

function matchesSearch(agent: ManagedAgentSummary, query: string): boolean {
  if (!query) {
    return true;
  }
  const haystack = [
    agent.name,
    agent.managed_agent_key,
    agent.description || "",
    agent.instruction,
    agent.action_uri,
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(query);
}

export function ManagedAgentListPanel() {
  const [managedAgents, setManagedAgents] = useState<ManagedAgentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [enabledFilter, setEnabledFilter] = useState<EnabledFilter>("all");

  const deferredSearch = useDeferredValue(search.trim().toLowerCase());

  useEffect(() => {
    let active = true;

    listManagedAgents()
      .then((response) => {
        if (!active) {
          return;
        }
        setManagedAgents(response.managed_agents);
        setError(null);
      })
      .catch((cause) => {
        if (!active) {
          return;
        }
        setManagedAgents([]);
        setError(cause instanceof Error ? cause.message : "Failed to load managed agents");
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  const visibleAgents = useMemo(() => {
    return [...managedAgents]
      .filter((agent) => {
        if (enabledFilter === "enabled") {
          return agent.enabled;
        }
        if (enabledFilter === "disabled") {
          return !agent.enabled;
        }
        return true;
      })
      .filter((agent) => matchesSearch(agent, deferredSearch))
      .sort((left, right) => right.updated_at.localeCompare(left.updated_at));
  }, [deferredSearch, enabledFilter, managedAgents]);

  return (
    <div className="space-y-6" data-managed-agent-list-panel>
      <Card className="rounded-2xl border border-border bg-card p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              <Waypoints className="h-4 w-4" />
              Managed Agents
            </div>
            <div>
              <h1 className="font-display text-3xl">Author and operate managed agents</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Browse every Seer-authored managed agent, open its definition first, and drill into
                run history from the agent page rather than starting from raw executions.
              </p>
            </div>
          </div>
          <Button asChild size="lg">
            <Link href={buildManagedAgentNewHref()}>
              <Plus className="h-4 w-4" />
              New Managed Agent
            </Link>
          </Button>
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-[1.5fr_0.45fr_0.55fr]">
          <div className="space-y-2 rounded-2xl border border-border/70 bg-muted/15 p-4">
            <label
              htmlFor="managed-agent-search"
              className="text-sm font-medium text-foreground"
            >
              Search
            </label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="managed-agent-search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search by name, key, description, or action URI..."
                className="pl-9"
              />
            </div>
          </div>

          <div className="space-y-2 rounded-2xl border border-border/70 bg-muted/15 p-4">
            <label
              htmlFor="managed-agent-enabled-filter"
              className="text-sm font-medium text-foreground"
            >
              Status
            </label>
            <Select
              value={enabledFilter}
              onValueChange={(value) => setEnabledFilter(value as EnabledFilter)}
            >
              <SelectTrigger id="managed-agent-enabled-filter" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All agents</SelectItem>
                <SelectItem value="enabled">Enabled only</SelectItem>
                <SelectItem value="disabled">Disabled only</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-3 rounded-2xl border border-border/70 bg-muted/15 p-4 sm:grid-cols-2 lg:grid-cols-1">
            <div>
              <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                Total agents
              </div>
              <div className="mt-1 text-2xl font-semibold">{managedAgents.length}</div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                Matching view
              </div>
              <div className="mt-1 text-2xl font-semibold">
                {loading ? "..." : visibleAgents.length}
              </div>
            </div>
          </div>
        </div>
      </Card>

      {error ? (
        <Card className="rounded-2xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </Card>
      ) : null}

      <Card className="rounded-2xl border border-border bg-card p-6 shadow-sm">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              Agent Catalog
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Select a managed agent to review its definition first, then inspect its runs.
            </p>
          </div>
          <Badge variant="outline" className="rounded-full">
            {loading ? "Loading..." : `${visibleAgents.length} shown`}
          </Badge>
        </div>

        {loading ? (
          <div className="rounded-2xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
            Loading managed agents...
          </div>
        ) : visibleAgents.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border p-10 text-center">
            <p className="text-sm text-muted-foreground">
              {managedAgents.length === 0
                ? "No managed agents have been authored in Seer yet."
                : "No managed agents match the active filters."}
            </p>
            <Button asChild className="mt-4">
              <Link href={buildManagedAgentNewHref()}>
                <Plus className="h-4 w-4" />
                New Managed Agent
              </Link>
            </Button>
          </div>
        ) : (
          <TableRoot variant="surface" layout="fixed" striped>
            <TableHeader>
              <TableRow>
                <TableColumnHeaderCell className="w-[32%]">Managed Agent</TableColumnHeaderCell>
                <TableColumnHeaderCell className="w-[12%]">Status</TableColumnHeaderCell>
                <TableColumnHeaderCell className="w-[10%]">Input</TableColumnHeaderCell>
                <TableColumnHeaderCell className="w-[10%]">Output</TableColumnHeaderCell>
                <TableColumnHeaderCell className="w-[16%]">Updated</TableColumnHeaderCell>
                <TableColumnHeaderCell className="w-[20%]">Open</TableColumnHeaderCell>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleAgents.map((agent) => {
                const href = buildManagedAgentHref(agent.managed_agent_key);

                return (
                  <TableRow key={agent.action_uri}>
                    <TableCell>
                      <div className="space-y-1">
                        <Link href={href} className="font-medium hover:underline">
                          {agent.name}
                        </Link>
                        <div className="text-xs text-muted-foreground">
                          Key: {agent.managed_agent_key}
                        </div>
                        {agent.description ? (
                          <div className="line-clamp-2 text-sm text-muted-foreground">
                            {agent.description}
                          </div>
                        ) : (
                          <div className="text-sm text-muted-foreground">
                            No description provided.
                          </div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={agent.enabled ? "rounded-full" : "rounded-full bg-muted/30"}
                      >
                        {agent.enabled ? "Enabled" : "Disabled"}
                      </Badge>
                    </TableCell>
                    <TableCell>{agent.input_field_count} fields</TableCell>
                    <TableCell>{agent.output_field_count} fields</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDateTime(agent.updated_at)}
                    </TableCell>
                    <TableCell>
                      <Button asChild variant="outline" className="w-full justify-between">
                        <Link href={href}>
                          View details
                          <ArrowRight className="h-4 w-4" />
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </TableRoot>
        )}
      </Card>
    </div>
  );
}
