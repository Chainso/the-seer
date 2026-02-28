"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Activity, Database, Filter, Link2, Search } from "lucide-react";

import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Table } from "../ui/table";

import type { ActivityStreamEntry, ObjectGraphResponse } from "@/app/types/activity";
import type { ObjectInstance, ObjectSummaryResponse } from "@/app/types/object";
import type { OntologyGraph, OntologyNode } from "@/app/types/ontology";
import { getObjectGraph, getObjectTimeline } from "@/app/lib/api/object-activity";
import { getObjectSummary, listObjectsByModel } from "@/app/lib/api/objects";
import { getOntologyGraph } from "@/app/lib/api/ontology";
import { mapKeyDefinition, mapPropertyDefinitions } from "@/app/lib/ontology-helpers";
import { ObjectActivityGraph } from "../inspector/object-activity-graph";

type DisplayColumn = {
  label: string;
  fieldKey: string;
  propertyUri: string;
};

const formatValue = (value: unknown) => {
  if (value === null || value === undefined) return "-";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(formatValue).join(", ");
  return JSON.stringify(value);
};

const resolveActivityName = (typeUri: string, lookup: Record<string, string>) => {
  if (lookup[typeUri]) return lookup[typeUri];
  const normalized = typeUri.split("#").pop() ?? typeUri;
  return normalized.split("/").pop() ?? typeUri;
};

export function ObjectStorePanel() {
  const [graph, setGraph] = useState<OntologyGraph | null>(null);
  const [models, setModels] = useState<OntologyNode[]>([]);
  const [model, setModel] = useState("");
  const [objects, setObjects] = useState<ObjectInstance[]>([]);
  const [objectsLoading, setObjectsLoading] = useState(false);
  const [objectsError, setObjectsError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState<string[]>([]);
  const [summary, setSummary] = useState<ObjectSummaryResponse | null>(null);
  const [page, setPage] = useState(0);
  const [pageSize] = useState(25);
  const [totalPages, setTotalPages] = useState(0);
  const [totalObjects, setTotalObjects] = useState(0);
  const [selectedObject, setSelectedObject] = useState<ObjectInstance | null>(null);
  const [timeline, setTimeline] = useState<ActivityStreamEntry[]>([]);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [timelineError, setTimelineError] = useState<string | null>(null);
  const [showGraph, setShowGraph] = useState(false);
  const [objectGraph, setObjectGraph] = useState<ObjectGraphResponse | null>(null);
  const [graphLoading, setGraphLoading] = useState(false);

  useEffect(() => {
    let active = true;
    getOntologyGraph()
      .then((data) => {
        if (!active) return;
        setGraph(data);
        const modelNodes = data.nodes.filter((node) => node.label === "ObjectModel");
        setModels(modelNodes);
        if (!model && modelNodes.length > 0) {
          setModel(modelNodes[0].uri);
        }
      })
      .catch(() => {
        if (!active) return;
        setGraph(null);
        setModels([]);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!model) return;
    let active = true;
    setObjectsLoading(true);
    setObjectsError(null);
    setSelectedObject(null);
    setTimeline([]);
    setObjectGraph(null);
    listObjectsByModel(model, {
      page,
      size: pageSize,
      states: stateFilter.length > 0 ? stateFilter : undefined,
      search: search || undefined,
    })
      .then((data) => {
        if (!active) return;
        setObjects(data.items);
        setTotalPages(data.totalPages);
        setTotalObjects(data.total);
        setSelectedObject((prev) => {
          if (prev && data.items.some((item) => item.id === prev.id)) {
            return prev;
          }
          return data.items[0] ?? null;
        });
      })
      .catch((err) => {
        if (!active) return;
        setObjects([]);
        setSelectedObject(null);
        setObjectsError(err instanceof Error ? err.message : "Failed to load objects");
      })
      .finally(() => {
        if (!active) return;
        setObjectsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [model, page, pageSize, search, stateFilter]);

  useEffect(() => {
    if (!model) return;
    let active = true;
    getObjectSummary(model)
      .then((data) => {
        if (!active) return;
        setSummary(data);
        setTotalObjects(data.total);
      })
      .catch(() => {
        if (!active) return;
        setSummary(null);
      });
    return () => {
      active = false;
    };
  }, [model]);

  useEffect(() => {
    if (!model) return;
    setSearch("");
    setStateFilter([]);
    setPage(0);
  }, [model]);

  useEffect(() => {
    if (!model || !selectedObject) return;
    let active = true;
    setTimelineLoading(true);
    setTimelineError(null);
    getObjectTimeline(model, selectedObject.id, {})
      .then((data) => {
        if (!active) return;
        setTimeline(data);
      })
      .catch((err) => {
        if (!active) return;
        setTimeline([]);
        setTimelineError(err instanceof Error ? err.message : "Failed to load timeline");
      })
      .finally(() => {
        if (!active) return;
        setTimelineLoading(false);
      });
    return () => {
      active = false;
    };
  }, [model, selectedObject]);

  useEffect(() => {
    if (!showGraph || !model || !selectedObject) return;
    let active = true;
    setGraphLoading(true);
    getObjectGraph(model, selectedObject.id, { depth: "1" })
      .then((data) => {
        if (!active) return;
        setObjectGraph(data);
      })
      .catch(() => {
        if (!active) return;
        setObjectGraph(null);
      })
      .finally(() => {
        if (!active) return;
        setGraphLoading(false);
      });
    return () => {
      active = false;
    };
  }, [showGraph, model, selectedObject]);

  const modelOptions = useMemo(() => {
    return models.map((node) => ({
      uri: node.uri,
      name: (node.properties?.name as string) || node.uri,
    }));
  }, [models]);

  const displayColumns: DisplayColumn[] = useMemo(() => {
    if (!graph || !model) return [];
    const properties = mapPropertyDefinitions(model, graph.nodes, graph.edges);
    const propertyMap = new Map(properties.map((prop) => [prop.uri ?? "", prop]));
    const displayKey = mapKeyDefinition(model, "hasDisplayKey", graph.nodes, graph.edges);
    return displayKey.keyParts.map((part) => {
      const prop = propertyMap.get(part.partPropertyUri);
      return {
        label: prop?.name || part.name || "Display key",
        fieldKey: prop?.fieldKey || "",
        propertyUri: part.partPropertyUri,
      };
    });
  }, [graph, model]);

  const stateOptions = useMemo(() => {
    if (!graph || !model) return [];
    const stateUris = graph.edges
      .filter((edge) => edge.fromUri === model && edge.type === "hasPossibleState")
      .map((edge) => edge.toUri);
    const stateMap = new Map(
      graph.nodes
        .filter((node) => node.label === "State")
        .map((node) => [node.uri, (node.properties?.name as string) || node.uri])
    );
    return stateUris.map((uri) => ({ uri, name: stateMap.get(uri) || uri }));
  }, [graph, model]);

  const stateNameLookup = useMemo(() => {
    const map = new Map<string, string>();
    stateOptions.forEach((state) => map.set(state.uri, state.name));
    return map;
  }, [stateOptions]);

  const stateCounts = useMemo(() => {
    if (summary) {
      return summary.states.reduce<Record<string, number>>((acc, state) => {
        acc[state.stateUri] = state.count;
        return acc;
      }, {});
    }
    const counts: Record<string, number> = {};
    objects.forEach((obj) => {
      counts[obj.stateUri] = (counts[obj.stateUri] || 0) + 1;
    });
    return counts;
  }, [objects, summary]);

  const filteredObjects = useMemo(() => {
    return objects;
  }, [objects]);

  const selectedDisplayValues = useMemo(() => {
    if (!selectedObject) return [];
    return displayColumns.map((column) => ({
      label: column.label,
      value: formatValue(selectedObject.data?.[column.fieldKey]),
    }));
  }, [selectedObject, displayColumns]);

  const activityLookup = useMemo(() => {
    if (!graph) return {};
    const activityLabels = new Set(["Action", "Process", "Workflow", "Signal", "Transition"]);
    return graph.nodes.reduce<Record<string, string>>((acc, node) => {
      if (activityLabels.has(node.label)) {
        acc[node.uri] = (node.properties?.name as string) || node.uri;
      }
      return acc;
    }, {});
  }, [graph]);

  const modelLookup = useMemo(() => {
    if (!graph) return {};
    return graph.nodes.reduce<Record<string, string>>((acc, node) => {
      if (node.label === "ObjectModel") {
        acc[node.uri] = (node.properties?.name as string) || node.uri;
      }
      return acc;
    }, {});
  }, [graph]);

  const timelineEntries = useMemo(() => {
    return [...timeline]
      .sort((a, b) => new Date(b.activityTime).getTime() - new Date(a.activityTime).getTime())
      .map((entry) => ({
      ...entry,
      activityName: resolveActivityName(entry.typeUri, activityLookup),
      modelName: modelLookup[entry.modelUri] || entry.modelUri,
      time: new Date(entry.activityTime).toLocaleString(),
      shortId: entry.activityId.slice(0, 8),
    }));
  }, [timeline, activityLookup, modelLookup]);

  return (
    <div className="space-y-6">
      <Card className="rounded-3xl border border-border bg-card p-8 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">Object Store</p>
            <h1 className="mt-3 font-display text-3xl">Live Object Inventory</h1>
            <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
              Scan every object instance, anchor on its display keys, and drill into the full activity trail.
            </p>
          </div>
          <Badge className="gap-2 rounded-full border border-border bg-secondary px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-secondary-foreground">
            <Database className="h-3 w-3" />
            Read-only
          </Badge>
        </div>
      </Card>

      <Card className="rounded-2xl border border-border bg-card p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            <Filter className="h-4 w-4" />
            Inventory Filters
          </div>
          <div className="text-xs text-muted-foreground">
            <div>{totalObjects} objects total</div>
            <div>
              Last updated {summary?.lastUpdatedAt ? new Date(summary.lastUpdatedAt).toLocaleString() : "—"}
            </div>
          </div>
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-[1.2fr_1fr_1fr]">
          <div className="space-y-2">
            <Label htmlFor="model">Object model</Label>
            <Select value={model} onValueChange={(value) => setModel(value)}>
              <SelectTrigger id="model">
                <SelectValue placeholder="Select model" />
              </SelectTrigger>
              <SelectContent>
                {modelOptions.map((option) => (
                  <SelectItem key={option.uri} value={option.uri}>
                    {option.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="search">Search objects</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                id="search"
                placeholder="Search ID or display keys"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(0);
                }}
                className="pl-9"
              />
            </div>
          </div>
          <div />
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              setStateFilter([]);
              setPage(0);
            }}
            className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] ${
              stateFilter.length === 0
                ? "border-foreground bg-foreground text-background"
                : "border-border text-muted-foreground"
            }`}
          >
            All ({totalObjects})
          </button>
          {stateOptions.map((state) => (
            <button
              key={state.uri}
              type="button"
              onClick={() => {
                setStateFilter((prev) => {
                  if (prev.includes(state.uri)) {
                    return prev.filter((item) => item !== state.uri);
                  }
                  return [...prev, state.uri];
                });
                setPage(0);
              }}
              className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] ${
                stateFilter.includes(state.uri)
                  ? "border-foreground bg-foreground text-background"
                  : "border-border text-muted-foreground"
              }`}
            >
              {state.name} ({stateCounts[state.uri] || 0})
            </button>
          ))}
        </div>

        {objectsError && (
          <div className="mt-4 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {objectsError}
          </div>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              Inventory
            </div>
            <Badge variant="outline" className="rounded-full text-xs">
              {filteredObjects.length} visible
            </Badge>
          </div>

          <div className="mt-5">
            {objectsLoading ? (
              <div className="rounded-2xl border border-dashed border-border p-6 text-sm text-muted-foreground">
                Loading objects...
              </div>
            ) : filteredObjects.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border p-6 text-sm text-muted-foreground">
                No objects match the current filters.
              </div>
            ) : (
              <Table.Root>
                <Table.Header>
                  <Table.Row>
                    <Table.ColumnHeaderCell>ID</Table.ColumnHeaderCell>
                    {displayColumns.map((column) => (
                      <Table.ColumnHeaderCell key={column.propertyUri}>{column.label}</Table.ColumnHeaderCell>
                    ))}
                    <Table.ColumnHeaderCell>State</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>Updated</Table.ColumnHeaderCell>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {filteredObjects.map((obj) => {
                    const isSelected = selectedObject?.id === obj.id;
                    return (
                      <Table.Row
                        key={obj.id}
                        onClick={() => {
                          setSelectedObject(obj);
                          setShowGraph(false);
                          setObjectGraph(null);
                        }}
                        data-state={isSelected ? "selected" : undefined}
                        className="cursor-pointer"
                      >
                        <Table.RowHeaderCell className="font-semibold">{obj.id.slice(0, 10)}</Table.RowHeaderCell>
                        {displayColumns.map((column) => (
                          <Table.Cell key={`${obj.id}-${column.propertyUri}`}>
                            {formatValue(obj.data?.[column.fieldKey])}
                          </Table.Cell>
                        ))}
                        <Table.Cell>{stateNameLookup.get(obj.stateUri) || obj.stateUri}</Table.Cell>
                        <Table.Cell>{new Date(obj.updatedAt).toLocaleString()}</Table.Cell>
                      </Table.Row>
                    );
                  })}
                </Table.Body>
              </Table.Root>
            )}
          </div>

          <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
            <span>
              Page {totalPages === 0 ? 0 : page + 1} of {totalPages || 1}
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((prev) => Math.max(prev - 1, 0))}
                disabled={page === 0}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((prev) => Math.min(prev + 1, Math.max(totalPages - 1, 0)))}
                disabled={page >= totalPages - 1}
              >
                Next
              </Button>
            </div>
          </div>
        </Card>

        <Card className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          {selectedObject ? (
            <div className="space-y-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Selected object</div>
                  <h2 className="mt-2 font-display text-xl">
                    {selectedDisplayValues.map((item) => item.value).join(" • ") || selectedObject.id.slice(0, 8)}
                  </h2>
                  <div className="mt-2 text-xs text-muted-foreground">
                    ID {selectedObject.id}
                  </div>
                </div>
                <Badge className="rounded-full bg-muted px-3 py-1 text-[0.65rem] font-semibold uppercase tracking-[0.2em]">
                  {stateNameLookup.get(selectedObject.stateUri) || selectedObject.stateUri}
                </Badge>
              </div>

              <div className="rounded-2xl border border-border bg-muted/40 p-4">
                <div className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  Display keys
                </div>
                <div className="mt-3 space-y-2 text-sm">
                  {selectedDisplayValues.length === 0 ? (
                    <div className="text-muted-foreground">No display key parts configured.</div>
                  ) : (
                    selectedDisplayValues.map((item) => (
                      <div key={item.label} className="flex items-center justify-between gap-3">
                        <span className="text-muted-foreground">{item.label}</span>
                        <span className="font-semibold">{item.value}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="rounded-2xl border border-border p-4">
                <div className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  Properties
                </div>
                <pre className="mt-3 max-h-56 overflow-auto rounded-xl bg-muted/50 p-3 text-xs text-muted-foreground">
{JSON.stringify(selectedObject.data ?? {}, null, 2)}
                </pre>
              </div>

              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  Timeline
                </div>
                <Link
                  href="/inspector"
                  className="text-xs font-semibold uppercase tracking-[0.2em] text-primary"
                >
                  Open inspector
                </Link>
              </div>

              {timelineError && (
                <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                  {timelineError}
                </div>
              )}

              <div className="space-y-3">
                {timelineLoading ? (
                  <div className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
                    Loading timeline...
                  </div>
                ) : timelineEntries.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
                    No activity yet for this object.
                  </div>
                ) : (
                  timelineEntries.slice(0, 6).map((entry) => (
                    <div key={`${entry.activityType}-${entry.activityId}`} className="rounded-xl border border-border p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-[0.6rem] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                            {entry.activityType}
                          </div>
                          <div className="font-display text-sm">{entry.activityName}</div>
                          <div className="text-xs text-muted-foreground">{entry.time}</div>
                        </div>
                        <Badge className="rounded-full border border-foreground/15 bg-background px-3 py-1 text-[0.6rem] font-semibold uppercase tracking-[0.2em] text-foreground">
                          {entry.role}
                        </Badge>
                      </div>
                      <div className="mt-2 text-xs text-muted-foreground">
                        {entry.modelName} • {entry.shortId}
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  <Link2 className="h-4 w-4" />
                  Relationships
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowGraph((prev) => !prev)}
                >
                  {showGraph ? "Hide graph" : "Show graph"}
                </Button>
              </div>

              {showGraph && (
                <div className="mt-2">
                  {graphLoading ? (
                    <div className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
                      Loading graph...
                    </div>
                  ) : objectGraph ? (
                    <ObjectActivityGraph
                      objects={objectGraph.objects}
                      activities={objectGraph.activities}
                      edges={objectGraph.edges}
                      modelLookup={modelLookup}
                      activityLookup={activityLookup}
                    />
                  ) : (
                    <div className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
                      No related activity graph found.
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              <Activity className="h-5 w-5" />
              <p className="mt-3">Select an object to inspect details and timeline.</p>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
