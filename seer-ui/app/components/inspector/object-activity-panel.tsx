"use client";

import { useEffect, useMemo, useState } from "react";
import { Activity, Filter, Link2, Search } from "lucide-react";

import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";

import type { ActivityStreamEntry, ObjectGraphResponse } from "@/app/types/activity";
import type { ObjectInstance } from "@/app/types/object";
import { getObjectGraph, getObjectTimeline } from "@/app/lib/api/object-activity";
import { listObjectsByModel } from "@/app/lib/api/objects";
import { useOntologyDisplay } from "@/app/lib/ontology-display";
import { ObjectActivityGraph } from "./object-activity-graph";

const ACTIVITY_TYPES = ["event", "action"];

export function ObjectActivityPanel() {
  const ontologyDisplay = useOntologyDisplay();
  const [model, setModel] = useState("");
  const [objectId, setObjectId] = useState("");
  const [objectSearch, setObjectSearch] = useState("");
  const [objects, setObjects] = useState<ObjectInstance[]>([]);
  const [objectsLoading, setObjectsLoading] = useState(false);
  const [objectsError, setObjectsError] = useState<string | null>(null);
  const [depth, setDepth] = useState("1");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [traceId, setTraceId] = useState("");
  const [workflowId, setWorkflowId] = useState("");
  const [activityTypes, setActivityTypes] = useState<string[]>(["event", "action"]);

  const [timeline, setTimeline] = useState<ActivityStreamEntry[]>([]);
  const [graph, setGraph] = useState<ObjectGraphResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedModelFilters, setSelectedModelFilters] = useState<string[]>([]);
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);

  const resolvedFrom = from ? new Date(from).toISOString() : undefined;
  const resolvedTo = to ? new Date(to).toISOString() : undefined;

  const canLoad = model.trim() !== "" && objectId.trim() !== "";

  const modelOptions = useMemo(() => {
    return [...ontologyDisplay.catalog.objectModels]
      .map((node) => ({
        uri: node.uri,
        name: ontologyDisplay.displayObjectType(node.uri),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [ontologyDisplay]);

  useEffect(() => {
    if (!model && modelOptions.length > 0) {
      setModel(modelOptions[0].uri);
    }
  }, [model, modelOptions]);

  useEffect(() => {
    if (!model) return;
    let active = true;
    setObjectsLoading(true);
    setObjectsError(null);
    setObjectId("");
    setGraph(null);
    setTimeline([]);
    setSelectedRoles([]);
    setSelectedModelFilters([model]);
    listObjectsByModel(model, { page: 0, size: 200 })
      .then(list => {
        if (!active) return;
        setObjects(list.items);
      })
      .catch(err => {
        if (!active) return;
        setObjects([]);
        setObjectsError(err instanceof Error ? err.message : "Failed to load objects");
      })
      .finally(() => {
        if (!active) return;
        setObjectsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [model]);

  const loadData = async () => {
    if (!canLoad) return;
    setLoading(true);
    setError(null);
    try {
      const [timelineData, graphData] = await Promise.all([
        getObjectTimeline(model, objectId, {
          from: resolvedFrom,
          to: resolvedTo,
          activityTypes,
          traceId: traceId || undefined,
          workflowId: workflowId || undefined,
        }),
        getObjectGraph(model, objectId, {
          depth,
          modelUris: selectedModelFilters.length > 0 ? selectedModelFilters : undefined,
          from: resolvedFrom,
          to: resolvedTo,
          activityTypes,
        }),
      ]);
      setTimeline(timelineData);
      setGraph(graphData);
      setSelectedRoles([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load activity data");
    } finally {
      setLoading(false);
    }
  };

  const modelLookup = useMemo(() => {
    return modelOptions.reduce<Record<string, string>>((acc, item) => {
      acc[item.uri] = item.name;
      return acc;
    }, {});
  }, [modelOptions]);

  const activityLookup = useMemo(() => {
    const typeUris = new Set<string>();
    timeline.forEach((entry) => {
      if (entry.typeUri) {
        typeUris.add(entry.typeUri);
      }
    });
    graph?.activities.forEach((activity) => {
      if (activity.typeUri) {
        typeUris.add(activity.typeUri);
      }
    });
    return Array.from(typeUris).reduce<Record<string, string>>((acc, typeUri) => {
      acc[typeUri] = ontologyDisplay.displayEventType(typeUri);
      return acc;
    }, {});
  }, [graph, ontologyDisplay, timeline]);

  const timelineBuckets = useMemo(() => {
    return [...timeline]
      .sort((a, b) => new Date(b.activityTime).getTime() - new Date(a.activityTime).getTime())
      .map(entry => ({
        ...entry,
        time: new Date(entry.activityTime).toLocaleString(),
        shortId: entry.activityId.slice(0, 8),
        modelName: entry.modelUri ? ontologyDisplay.displayObjectType(entry.modelUri) : "Unknown model",
        activityName: ontologyDisplay.displayEventType(entry.typeUri),
      }));
  }, [ontologyDisplay, timeline]);

  const filteredObjects = useMemo(() => {
    if (!objectSearch) return objects;
    const needle = objectSearch.toLowerCase();
    return objects.filter(item => {
      const haystack = JSON.stringify(item.data ?? {}).toLowerCase();
      return item.id.toLowerCase().includes(needle) || haystack.includes(needle);
    });
  }, [objectSearch, objects]);

  const roleOptions = useMemo(() => {
    if (!graph) return [];
    const roles = Array.from(new Set(graph.edges.map(edge => edge.role))).sort();
    return roles;
  }, [graph]);

  const filteredGraph = useMemo(() => {
    if (!graph) return null;
    if (selectedRoles.length === 0) return graph;
    const edges = graph.edges.filter(edge => selectedRoles.includes(edge.role));
    const activityKeys = new Set(edges.map(edge => `${edge.activityType}:${edge.activityId}`));
    const objectIds = new Set(edges.map(edge => edge.objectId));
    return {
      objects: graph.objects.filter(obj => objectIds.has(obj.id)),
      activities: graph.activities.filter(act => activityKeys.has(`${act.activityType}:${act.id}`)),
      edges,
    } satisfies ObjectGraphResponse;
  }, [graph, selectedRoles]);

  return (
    <div className="space-y-6">
      <Card className="rounded-3xl border border-border bg-card p-8 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">Process Inspector</p>
            <h1 className="mt-3 font-display text-3xl">Object Activity Trace</h1>
            <p className="mt-3 text-sm text-muted-foreground max-w-2xl">
              Pull the full action/event storyline for one object and reveal related objects that share those activities.
            </p>
          </div>
          <Badge className="gap-2 rounded-full bg-muted px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em]">
            <Activity className="h-3 w-3" />
            Timeline + Graph
          </Badge>
        </div>
      </Card>

      <Card className="rounded-2xl border border-border bg-card p-6 shadow-sm">
        <div className="flex items-center gap-3 text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          <Filter className="h-4 w-4" />
          Trace Controls
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-[1.1fr_1.3fr_0.7fr_0.7fr]">
          <div className="space-y-2">
            <Label htmlFor="model">Object model</Label>
            <Select value={model} onValueChange={value => setModel(value)}>
              <SelectTrigger id="model">
                <SelectValue placeholder="Select model" />
              </SelectTrigger>
              <SelectContent>
                {modelOptions.map(option => (
                  <SelectItem key={option.uri} value={option.uri}>
                    {option.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="objectSearch">Object search</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                id="objectSearch"
                placeholder="Search by ID or properties"
                value={objectSearch}
                onChange={e => setObjectSearch(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="depth">Graph depth</Label>
            <Input id="depth" type="number" min="0" max="4" value={depth} onChange={e => setDepth(e.target.value)} />
          </div>
          <div className="flex items-end">
            <Button className="w-full" onClick={loadData} disabled={!canLoad || loading}>
              {loading ? "Loading..." : "Load trace"}
            </Button>
          </div>
        </div>

        <div className="mt-4 rounded-2xl border border-border bg-muted/40 p-4">
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              Objects in model
            </div>
            <Badge variant="outline" className="rounded-full text-xs">
              {objects.length} total
            </Badge>
          </div>
          <div className="mt-3 space-y-2">
            <Label htmlFor="selectedObject">Selected object</Label>
            <Input
              id="selectedObject"
              placeholder="UUID"
              value={objectId}
              onChange={e => setObjectId(e.target.value)}
            />
          </div>
          {objectsError ? (
            <div className="mt-3 text-sm text-destructive">{objectsError}</div>
          ) : (
            <div className="mt-3 max-h-40 space-y-2 overflow-y-auto pr-2">
              {objectsLoading ? (
                <div className="text-sm text-muted-foreground">Loading objects…</div>
              ) : filteredObjects.length === 0 ? (
                <div className="text-sm text-muted-foreground">No objects match the search.</div>
              ) : (
                filteredObjects.map(item => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setObjectId(item.id)}
                    className={`flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left text-sm transition ${
                      objectId === item.id
                        ? "border-foreground bg-foreground text-background"
                        : "border-border bg-background hover:border-muted-foreground"
                    }`}
                  >
                    <span className="font-semibold">{item.id.slice(0, 10)}</span>
                    <span className="text-xs opacity-80">{item.stateUri.split("_").slice(-1)}</span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="from">From</Label>
            <Input id="from" type="datetime-local" value={from} onChange={e => setFrom(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="to">To</Label>
            <Input id="to" type="datetime-local" value={to} onChange={e => setTo(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Activity types</Label>
            <div className="flex flex-wrap gap-2">
              {ACTIVITY_TYPES.map(type => (
                <button
                  key={type}
                  type="button"
                  onClick={() =>
                    setActivityTypes(prev =>
                      prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]
                    )
                  }
                  className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] ${
                    activityTypes.includes(type)
                      ? "border-foreground bg-foreground text-background"
                      : "border-border text-muted-foreground"
                  }`}
                >
                  {type}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="trace">Trace ID (optional)</Label>
            <Input id="trace" placeholder="UUID" value={traceId} onChange={e => setTraceId(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="workflow">Workflow ID (optional)</Label>
            <Input id="workflow" placeholder="UUID" value={workflowId} onChange={e => setWorkflowId(e.target.value)} />
          </div>
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <div className="space-y-2">
            <Label>Related object models (graph)</Label>
            <div className="flex flex-wrap gap-2">
              {modelOptions.map(option => {
                const active = selectedModelFilters.includes(option.uri);
                return (
                  <button
                    key={option.uri}
                    type="button"
                    onClick={() =>
                      setSelectedModelFilters(prev =>
                        prev.includes(option.uri)
                          ? prev.filter(item => item !== option.uri)
                          : [...prev, option.uri]
                      )
                    }
                    className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] ${
                      active
                        ? "border-foreground bg-foreground text-background"
                        : "border-border text-muted-foreground"
                    }`}
                  >
                    {option.name}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="space-y-2">
            <Label>Roles (graph)</Label>
            <div className="flex flex-wrap gap-2">
              {roleOptions.length === 0 ? (
                <div className="text-xs text-muted-foreground">Load a trace to see roles.</div>
              ) : (
                roleOptions.map(role => {
                  const active = selectedRoles.includes(role);
                  return (
                    <button
                      key={role}
                      type="button"
                      onClick={() =>
                        setSelectedRoles(prev =>
                          prev.includes(role) ? prev.filter(item => item !== role) : [...prev, role]
                        )
                      }
                      className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] ${
                        active
                          ? "border-foreground bg-foreground text-background"
                          : "border-border text-muted-foreground"
                      }`}
                    >
                      {role}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {error && (
          <div className="mt-4 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            <Link2 className="h-4 w-4" />
            Graph view
          </div>
          <div className="mt-5">
            {filteredGraph ? (
              <ObjectActivityGraph
                objects={filteredGraph.objects}
                activities={filteredGraph.activities}
                edges={filteredGraph.edges}
                modelLookup={modelLookup}
                activityLookup={activityLookup}
              />
            ) : (
              <div className="flex h-[540px] items-center justify-center rounded-2xl border border-dashed border-border text-sm text-muted-foreground">
                Load an object to render the activity graph.
              </div>
            )}
          </div>
        </Card>

        <Card className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              Timeline
            </div>
            <Badge variant="outline" className="rounded-full text-xs">
              {timeline.length} activities
            </Badge>
          </div>
          <div className="mt-5 space-y-4">
            {timelineBuckets.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                No activity yet. Load an object timeline to get started.
              </div>
            ) : (
              timelineBuckets.map(entry => (
                <div key={`${entry.activityType}-${entry.activityId}`} className="rounded-2xl border border-border p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-[0.65rem] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                        {entry.activityType}
                      </div>
                      <div className="font-display text-sm">{entry.activityName}</div>
                      <div className="text-xs text-muted-foreground">{entry.time}</div>
                    </div>
                    <Badge className="rounded-full border border-foreground/15 bg-background px-3 py-1 text-[0.6rem] font-semibold uppercase tracking-[0.2em] text-foreground">
                      {entry.role}
                    </Badge>
                  </div>
                  <div className="mt-3 text-xs text-muted-foreground">
                    Object {entry.objectId.slice(0, 8)} • {entry.modelName} • {entry.shortId}
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
