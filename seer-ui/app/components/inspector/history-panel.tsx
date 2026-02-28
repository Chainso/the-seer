"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Clock3, Filter, Search } from "lucide-react";
import { DataList } from "@radix-ui/themes";

import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Table } from "../ui/table";

import { listLatestObjects, listObjectEvents } from "@/app/lib/api/history";
import { queryOntologySelect } from "@/app/lib/api/ontology";
import {
  normalizeComparableToken,
  type OntologyDisplayFieldKind,
  type OntologyDisplayResolveContext,
  type OntologyDisplayValueContext,
  useOntologyDisplay,
} from "@/app/lib/ontology-display";
import type {
  LatestObjectItem,
  LatestObjectsResponse,
  ObjectEventItem,
  ObjectEventsResponse,
  ObjectPropertyFilter,
  PropertyFilterOperator,
} from "@/app/types/history";

type PropertyFilterDraft = ObjectPropertyFilter & { id: string };
const STATE_FILTER_KEY = "__state__";
const TYPE_RESOLUTION_QUERY_PREFIX = `
PREFIX prophet: <http://prophet.platform/ontology#>
`.trim();
const ALLOWED_HISTORY_OPERATORS = new Set<PropertyFilterOperator>([
  "eq",
  "contains",
  "gt",
  "gte",
  "lt",
  "lte",
]);

type PropertyFilterOperatorOption = { value: PropertyFilterOperator; label: string };
type PropertyKeyOption = { value: string; label: string; kind: OntologyDisplayFieldKind };

function formatDateTime(value: string | null): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) return "—";
  return parsed.toLocaleString();
}

async function fetchObjectModelPropertyKinds(
  objectModelUri: string,
  inferFieldKind: (fieldKey: string, hints: Array<string | undefined>) => OntologyDisplayFieldKind
): Promise<Record<string, OntologyDisplayFieldKind>> {
  if (!objectModelUri || /[<>\s]/.test(objectModelUri)) {
    return {};
  }
  const query = `
${TYPE_RESOLUTION_QUERY_PREFIX}
SELECT DISTINCT ?fieldKey ?baseType ?baseName ?mapsToXsd
WHERE {
  <${objectModelUri}> prophet:hasProperty ?property .
  ?property prophet:fieldKey ?fieldKey .
  ?property prophet:valueType ?valueType .
  OPTIONAL {
    ?valueType (prophet:derivedFrom|prophet:itemType)* ?baseType .
    ?baseType a prophet:BaseType .
    OPTIONAL { ?baseType prophet:name ?baseName . }
    OPTIONAL { ?baseType prophet:mapsToXSD ?mapsToXsd . }
  }
}
`.trim();
  const rows = await queryOntologySelect(query);
  const output: Record<string, OntologyDisplayFieldKind> = {};
  rows.forEach((row) => {
    const key = row.fieldKey?.trim();
    if (!key) {
      return;
    }
    output[key] = inferFieldKind(key, [row.baseName, row.baseType, row.mapsToXsd]);
  });
  return output;
}

function objectIdentityKey(item: LatestObjectItem): string {
  return `${item.object_type}:${item.object_ref_canonical}`;
}

function objectEventIdentityKey(item: ObjectEventItem): string {
  return `${item.event_id}:${item.object_history_id}`;
}

type ObjectDetailsEntry = {
  key: string;
  label: string;
  value: unknown;
};

function renderObjectDetailsNode(
  value: unknown,
  resolveFieldLabel: (key: string) => string,
  resolveFieldValue: (key: string, nestedValue: unknown) => unknown,
  depth: number
): React.ReactNode {
  if (depth > 6) {
    return (
      <code className="rounded bg-muted/40 px-1.5 py-0.5 font-mono text-[11px] break-all">
        {JSON.stringify(value)}
      </code>
    );
  }
  if (value === null || value === undefined) {
    return <span className="text-muted-foreground">—</span>;
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return <span className="break-all">{String(value)}</span>;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <span className="text-muted-foreground">[]</span>;
    }
    return (
      <div className="space-y-2">
        {value.map((item, index) => (
          <div key={`item-${index}`} className="rounded-md border border-border/60 bg-muted/20 p-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              Item {index + 1}
            </p>
            <div className="mt-1 border-l border-border/60 pl-3">
              {renderObjectDetailsNode(item, resolveFieldLabel, resolveFieldValue, depth + 1)}
            </div>
          </div>
        ))}
      </div>
    );
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (!entries.length) {
      return <span className="text-muted-foreground">{"{}"}</span>;
    }
    return (
      <div className="space-y-1.5">
        {entries.map(([key, nestedValue]) => {
          const nestedLabel = resolveFieldLabel(key);
          const resolvedNestedValue = resolveFieldValue(key, nestedValue);
          return (
            <div key={key} className="grid grid-cols-[minmax(80px,auto)_1fr] items-start gap-2">
              <span className="text-xs font-medium text-muted-foreground">{nestedLabel}:</span>
              <div className="min-w-0">
                {renderObjectDetailsNode(resolvedNestedValue, resolveFieldLabel, resolveFieldValue, depth + 1)}
              </div>
            </div>
          );
        })}
      </div>
    );
  }
  return <span className="break-all">{String(value)}</span>;
}

function renderObjectDetailsValue(
  value: unknown,
  resolveFieldLabel: (key: string) => string,
  resolveFieldValue: (key: string, nestedValue: unknown) => unknown
): React.ReactNode {
  return renderObjectDetailsNode(value, resolveFieldLabel, resolveFieldValue, 0);
}

export function HistoryPanel() {
  const ontologyDisplay = useOntologyDisplay();
  const [latestPage, setLatestPage] = useState(0);
  const latestPageSize = 25;
  const [latestData, setLatestData] = useState<LatestObjectsResponse | null>(null);
  const [latestLoading, setLatestLoading] = useState(false);
  const [latestError, setLatestError] = useState<string | null>(null);

  const [objectTypeDraft, setObjectTypeDraft] = useState("");
  const [propertyFilterDrafts, setPropertyFilterDrafts] = useState<PropertyFilterDraft[]>([
    { id: "filter-0", key: "", op: "eq", value: "" },
  ]);
  const [appliedObjectType, setAppliedObjectType] = useState<string | undefined>(undefined);
  const [appliedPropertyFilters, setAppliedPropertyFilters] = useState<ObjectPropertyFilter[]>([]);
  const [knownObjectTypes, setKnownObjectTypes] = useState<string[]>([]);
  const [propertyKindsByModelUri, setPropertyKindsByModelUri] = useState<
    Record<string, Record<string, OntologyDisplayFieldKind>>
  >({});

  const resolveObjectModel = useCallback(
    (objectType: string) => ontologyDisplay.resolveObjectModel(objectType),
    [ontologyDisplay]
  );

  const objectTypeDisplayLabel = useCallback(
    (objectType: string) => ontologyDisplay.displayObjectType(objectType),
    [ontologyDisplay]
  );

  const ontologyConceptDisplayLabel = useCallback(
    (conceptType: string | null | undefined, fallbackObjectType?: string) =>
      ontologyDisplay.displayEventType(conceptType, { fallbackObjectType }),
    [ontologyDisplay]
  );

  const summarizeObjectRef = useCallback(
    (ref: Record<string, unknown>, objectType: string) =>
      ontologyDisplay.summarizeObjectRef(ref, { objectType }),
    [ontologyDisplay]
  );

  const summarizePayload = useCallback(
    (payload: Record<string, unknown> | null | undefined, context?: OntologyDisplayValueContext) =>
      ontologyDisplay.summarizePayload(payload, context),
    [ontologyDisplay]
  );

  const objectTypeOptions = useMemo(() => {
    return knownObjectTypes.map((type) => ({
      value: type,
      label: objectTypeDisplayLabel(type),
    }));
  }, [knownObjectTypes, objectTypeDisplayLabel]);

  const selectedDraftModel = useMemo(
    () => (objectTypeDraft ? resolveObjectModel(objectTypeDraft) : null),
    [objectTypeDraft, resolveObjectModel]
  );

  const propertyFilteringEnabled = useMemo(
    () => Boolean(objectTypeDraft && selectedDraftModel),
    [objectTypeDraft, selectedDraftModel]
  );

  const propertyKeyOptions = useMemo<PropertyKeyOption[]>(() => {
    if (!selectedDraftModel) {
      return [];
    }
    const resolvedKinds = propertyKindsByModelUri[selectedDraftModel.uri] || {};
    const options = selectedDraftModel.canonicalFieldKeys.map((fieldKey) => ({
      value: fieldKey,
      label: ontologyDisplay.displayFieldLabel(fieldKey, { objectType: selectedDraftModel.uri }),
      kind:
        resolvedKinds[fieldKey] ||
        ontologyDisplay.fieldKindForKey(fieldKey, {
          objectType: selectedDraftModel.uri,
        }),
    }));
    if (selectedDraftModel.stateFilterOptions.length > 0 && selectedDraftModel.stateFilterFieldKey) {
      options.push({ value: STATE_FILTER_KEY, label: "State", kind: "string" });
    }
    return options.sort((a, b) => a.label.localeCompare(b.label));
  }, [ontologyDisplay, propertyKindsByModelUri, selectedDraftModel]);

  const stateValueOptions = useMemo(() => {
    if (!selectedDraftModel) {
      return [];
    }
    return selectedDraftModel.stateFilterOptions;
  }, [selectedDraftModel]);

  const propertyKeyOptionLookup = useMemo(
    () => new Map(propertyKeyOptions.map((option) => [option.value, option])),
    [propertyKeyOptions]
  );

  const allowedPropertyKeySet = useMemo(
    () => new Set(propertyKeyOptions.map((option) => option.value)),
    [propertyKeyOptions]
  );

  const knownFieldKinds = useMemo(() => {
    const lookup = new Map<string, OntologyDisplayFieldKind>();
    propertyKeyOptions.forEach((option) => {
      if (option.value !== STATE_FILTER_KEY) {
        lookup.set(option.value, option.kind);
      }
    });
    return lookup;
  }, [propertyKeyOptions]);

  const normalizedFilterFieldKey = useCallback(
    (key: string, objectTypeHint?: string) => {
      if (key !== STATE_FILTER_KEY) {
        return key;
      }
      const model = objectTypeHint ? resolveObjectModel(objectTypeHint) : selectedDraftModel;
      return model?.stateFilterFieldKey || "state";
    },
    [resolveObjectModel, selectedDraftModel]
  );

  const operatorOptionsForPropertyKey = useCallback(
    (key: string): Array<PropertyFilterOperatorOption> => {
      const lookupKey = normalizedFilterFieldKey(key, objectTypeDraft);
      let options = ontologyDisplay
        .operatorOptionsForField(lookupKey, {
          objectType: selectedDraftModel?.uri || objectTypeDraft || undefined,
          knownFieldKinds,
          profile: "history",
        })
        .filter((option) => ALLOWED_HISTORY_OPERATORS.has(option.value as PropertyFilterOperator))
        .map((option) => ({ value: option.value as PropertyFilterOperator, label: option.label }));
      if (key === STATE_FILTER_KEY) {
        options = options.filter((option) => option.value === "eq");
      }
      return options.length ? options : [{ value: "eq", label: "Equals" }];
    },
    [knownFieldKinds, normalizedFilterFieldKey, objectTypeDraft, ontologyDisplay, selectedDraftModel]
  );

  const normalizeOperatorForPropertyKey = useCallback(
    (key: string, operator: PropertyFilterOperator): PropertyFilterOperator => {
      const options = operatorOptionsForPropertyKey(key);
      if (options.some((option) => option.value === operator)) {
        return operator;
      }
      return options[0]?.value || "eq";
    },
    [operatorOptionsForPropertyKey]
  );

  const [selectedObjectKey, setSelectedObjectKey] = useState<string | null>(null);
  const selectedObject = useMemo(() => {
    if (!latestData || !selectedObjectKey) return null;
    return latestData.items.find((item) => objectIdentityKey(item) === selectedObjectKey) || null;
  }, [latestData, selectedObjectKey]);

  const [eventsPage, setEventsPage] = useState(0);
  const eventsPageSize = 20;
  const [eventsData, setEventsData] = useState<ObjectEventsResponse | null>(null);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [selectedEventKey, setSelectedEventKey] = useState<string | null>(null);
  const selectedEvent = useMemo<ObjectEventItem | null>(() => {
    const items = eventsData?.items || [];
    if (!items.length) {
      return null;
    }
    if (selectedEventKey) {
      const matched = items.find((item) => objectEventIdentityKey(item) === selectedEventKey);
      if (matched) {
        return matched;
      }
    }
    return items[0];
  }, [eventsData, selectedEventKey]);
  const selectedObjectStateLabels = useMemo(
    () => (selectedObject ? resolveObjectModel(selectedObject.object_type)?.stateLabelByToken : undefined),
    [selectedObject, resolveObjectModel]
  );
  const selectedDetailsLabelContext = useMemo<OntologyDisplayResolveContext | undefined>(() => {
    if (!selectedObject) {
      return undefined;
    }
    return {
      objectType: selectedObject.object_type,
      eventType: selectedEvent?.event_type,
    };
  }, [selectedEvent, selectedObject]);
  const selectedDetailsValueContext = useMemo<OntologyDisplayValueContext | undefined>(() => {
    if (!selectedObject) {
      return undefined;
    }
    return {
      objectType: selectedObject.object_type,
      eventType: selectedEvent?.event_type,
      stateLabelByToken: selectedObjectStateLabels,
    };
  }, [selectedEvent, selectedObject, selectedObjectStateLabels]);
  const displaySelectedDetailsFieldLabel = useCallback(
    (key: string) => ontologyDisplay.displayFieldLabel(key, selectedDetailsLabelContext),
    [ontologyDisplay, selectedDetailsLabelContext]
  );
  const displaySelectedDetailsFieldValue = useCallback(
    (key: string, value: unknown) =>
      ontologyDisplay.displayFieldValue(key, value, selectedDetailsValueContext),
    [ontologyDisplay, selectedDetailsValueContext]
  );
  const selectedObjectDetails = useMemo<ObjectDetailsEntry[]>(() => {
    if (!selectedObject) {
      return [];
    }

    const entryByComparableKey = new Map<string, ObjectDetailsEntry>();
    const appendEntries = (payload: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(payload || {})) {
        if (normalizeComparableToken(key) === "objecttype") {
          continue;
        }
        const label = displaySelectedDetailsFieldLabel(key);
        const displayValue = displaySelectedDetailsFieldValue(key, value);
        entryByComparableKey.set(normalizeComparableToken(key), {
          key: `field:${key}`,
          label,
          value: displayValue,
        });
      }
    };

    const snapshotPayload = selectedEvent?.object_payload || selectedObject.object_payload || {};
    appendEntries(selectedObject.object_ref || {});
    appendEntries(snapshotPayload);
    return Array.from(entryByComparableKey.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [displaySelectedDetailsFieldLabel, displaySelectedDetailsFieldValue, selectedEvent, selectedObject]);

  useEffect(() => {
    let active = true;
    const modelUri = selectedDraftModel?.uri;
    if (!modelUri || propertyKindsByModelUri[modelUri]) {
      return () => {
        active = false;
      };
    }
    fetchObjectModelPropertyKinds(modelUri, (fieldKey, hints) =>
      ontologyDisplay.fieldKindForKey(fieldKey, {
        objectType: modelUri,
        valueTypeHints: hints,
      })
    )
      .then((kinds) => {
        if (!active) {
          return;
        }
        setPropertyKindsByModelUri((previous) => {
          if (previous[modelUri]) {
            return previous;
          }
          return { ...previous, [modelUri]: kinds };
        });
      })
      .catch(() => {
        if (!active) {
          return;
        }
        setPropertyKindsByModelUri((previous) => {
          if (previous[modelUri]) {
            return previous;
          }
          return { ...previous, [modelUri]: {} };
        });
      });
    return () => {
      active = false;
    };
  }, [ontologyDisplay, propertyKindsByModelUri, selectedDraftModel]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPropertyFilterDrafts((previous) => {
      let changed = false;
      const next = previous.map((filter) => {
        if (!filter.key) {
          return filter;
        }
        if (!allowedPropertyKeySet.has(filter.key)) {
          changed = true;
          return { ...filter, key: "", op: "eq" as PropertyFilterOperator, value: "" };
        }
        const normalizedOperator = normalizeOperatorForPropertyKey(
          filter.key,
          filter.op
        );
        if (normalizedOperator !== filter.op) {
          changed = true;
          return { ...filter, op: normalizedOperator };
        }
        return filter;
      });
      return changed ? next : previous;
    });
  }, [allowedPropertyKeySet, normalizeOperatorForPropertyKey]);

  useEffect(() => {
    let active = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLatestLoading(true);
    setLatestError(null);
    listLatestObjects({
      objectType: appliedObjectType,
      propertyFilters: appliedPropertyFilters,
      page: latestPage,
      size: latestPageSize,
    })
      .then((response) => {
        if (!active) return;
        setLatestData(response);
        setKnownObjectTypes((previous) => {
          const next = new Set(previous);
          response.items.forEach((item) => next.add(item.object_type));
          return Array.from(next).sort();
        });
        setSelectedObjectKey((previous) => {
          if (!response.items.length) return null;
          if (previous && response.items.some((item) => objectIdentityKey(item) === previous)) {
            return previous;
          }
          return objectIdentityKey(response.items[0]);
        });
      })
      .catch((cause) => {
        if (!active) return;
        setLatestData(null);
        setSelectedObjectKey(null);
        setLatestError(cause instanceof Error ? cause.message : "Failed to load latest objects");
      })
      .finally(() => {
        if (!active) return;
        setLatestLoading(false);
      });
    return () => {
      active = false;
    };
  }, [appliedObjectType, appliedPropertyFilters, latestPage]);

  useEffect(() => {
    if (!selectedObject) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setEventsData(null);
      setEventsError(null);
      return;
    }
    let active = true;
    setEventsLoading(true);
    setEventsError(null);
    listObjectEvents({
      objectType: selectedObject.object_type,
      objectRefCanonical: selectedObject.object_ref_canonical,
      objectRefHash: selectedObject.object_ref_hash,
      page: eventsPage,
      size: eventsPageSize,
    })
      .then((response) => {
        if (!active) return;
        setEventsData(response);
      })
      .catch((cause) => {
        if (!active) return;
        setEventsData(null);
        setEventsError(cause instanceof Error ? cause.message : "Failed to load object events");
      })
      .finally(() => {
        if (!active) return;
        setEventsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [eventsPage, selectedObject]);

  const applyFilters = () => {
    const nextType = objectTypeDraft.trim();
    const currentModel = nextType ? resolveObjectModel(nextType) : null;
    const nextFilters = propertyFilteringEnabled
      ? propertyFilterDrafts
          .filter(
            (filter) =>
              filter.key.trim() &&
              filter.value.trim() &&
              allowedPropertyKeySet.has(filter.key.trim())
          )
          .map((filter) => ({
            op: normalizeOperatorForPropertyKey(
              filter.key.trim(),
              filter.op
            ),
            key:
              filter.key.trim() === STATE_FILTER_KEY
                ? currentModel?.stateFilterFieldKey || "state"
                : filter.key.trim(),
            value: filter.value.trim(),
          }))
      : [];
    setAppliedObjectType(nextType || undefined);
    setAppliedPropertyFilters(nextFilters);
    setLatestPage(0);
    setEventsPage(0);
    setSelectedEventKey(null);
  };

  const clearFilters = () => {
    setObjectTypeDraft("");
    setPropertyFilterDrafts([{ id: "filter-0", key: "", op: "eq", value: "" }]);
    setAppliedObjectType(undefined);
    setAppliedPropertyFilters([]);
    setLatestPage(0);
    setEventsPage(0);
    setSelectedEventKey(null);
  };

  const addFilter = () => {
    setPropertyFilterDrafts((previous) => [
      ...previous,
      { id: `filter-${Date.now()}-${previous.length}`, key: "", op: "eq", value: "" },
    ]);
  };

  const removeFilter = (id: string) => {
    setPropertyFilterDrafts((previous) => {
      if (previous.length <= 1) {
        return [{ id: "filter-0", key: "", op: "eq", value: "" }];
      }
      return previous.filter((filter) => filter.id !== id);
    });
  };

  const updateFilter = (id: string, patch: Partial<PropertyFilterDraft>) => {
    setPropertyFilterDrafts((previous) =>
      previous.map((filter) => (filter.id === id ? { ...filter, ...patch } : filter))
    );
  };

  return (
    <div className="space-y-6">
      <Card className="rounded-3xl border border-border bg-card p-8 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">Object Store</p>
            <h1 className="mt-3 font-display text-3xl">Object Store</h1>
            <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
              Browse the latest snapshot of every object and inspect full event history for the selected identity.
            </p>
          </div>
        </div>
      </Card>

      <Card className="rounded-2xl border border-border bg-card p-6 shadow-sm">
        <div className="flex items-center gap-3 text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          <Filter className="h-4 w-4" />
          History Filters
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-[1.2fr_2fr_auto]">
          <div className="space-y-2">
            <Label htmlFor="history-object-type">Object type</Label>
            <Select
              value={objectTypeDraft || "__all"}
              onValueChange={(value) => setObjectTypeDraft(value === "__all" ? "" : value)}
            >
              <SelectTrigger id="history-object-type">
                <SelectValue placeholder="All object types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">All object types</SelectItem>
                {objectTypeOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-3">
            <Label>Property filters</Label>
            {!propertyFilteringEnabled && (
              <p className="text-xs text-muted-foreground">
                Select an object type first to enable property filters.
              </p>
            )}
            {propertyFilterDrafts.map((filter) => {
              const operatorOptions = operatorOptionsForPropertyKey(filter.key);
              const fieldKind = propertyKeyOptionLookup.get(filter.key)?.kind || "string";
              const isBooleanField = filter.key !== STATE_FILTER_KEY && fieldKind === "boolean";
              const valuePlaceholder =
                fieldKind === "number" || fieldKind === "count"
                  ? "80"
                  : fieldKind === "temporal"
                    ? "2026-03-01T08:00:00Z or P2D"
                    : "approved";
              return (
              <div key={filter.id} className="grid gap-2 md:grid-cols-[1.2fr_1fr_1.2fr_auto]">
                <Select
                  value={propertyFilteringEnabled ? filter.key || "__unset" : "__unset"}
                  onValueChange={(value) => {
                    const nextKey = value === "__unset" ? "" : value;
                    updateFilter(filter.id, {
                      key: nextKey,
                      op: normalizeOperatorForPropertyKey(nextKey, filter.op),
                      value: "",
                    });
                  }}
                  disabled={!propertyFilteringEnabled}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select field" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__unset">Select field</SelectItem>
                    {propertyKeyOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={filter.op}
                  onValueChange={(value) =>
                    updateFilter(filter.id, { op: value as PropertyFilterOperator })
                  }
                  disabled={
                    !propertyFilteringEnabled ||
                    !filter.key ||
                    filter.key === STATE_FILTER_KEY ||
                    operatorOptions.length <= 1
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {operatorOptions.map((operator) => (
                      <SelectItem key={operator.value} value={operator.value}>
                        {operator.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {filter.key === STATE_FILTER_KEY ? (
                  <Select
                    value={propertyFilteringEnabled ? filter.value || "__unset" : "__unset"}
                    onValueChange={(value) =>
                      updateFilter(filter.id, { value: value === "__unset" ? "" : value })
                    }
                    disabled={!propertyFilteringEnabled || stateValueOptions.length === 0}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select state" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__unset">Select state</SelectItem>
                      {stateValueOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : isBooleanField ? (
                  <Select
                    value={propertyFilteringEnabled ? filter.value || "__unset" : "__unset"}
                    onValueChange={(value) =>
                      updateFilter(filter.id, { value: value === "__unset" ? "" : value })
                    }
                    disabled={!propertyFilteringEnabled}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select value" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__unset">Select value</SelectItem>
                      <SelectItem value="true">True</SelectItem>
                      <SelectItem value="false">False</SelectItem>
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    placeholder={valuePlaceholder}
                    value={filter.value}
                    onChange={(event) => updateFilter(filter.id, { value: event.target.value })}
                    disabled={!propertyFilteringEnabled}
                  />
                )}
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => removeFilter(filter.id)}
                  disabled={!propertyFilteringEnabled || propertyFilterDrafts.length <= 1}
                >
                  Remove
                </Button>
              </div>
              );
            })}
            <Button
              type="button"
              variant="outline"
              onClick={addFilter}
              disabled={!propertyFilteringEnabled}
            >
              Add filter
            </Button>
          </div>

          <div className="flex items-end gap-2">
            <Button type="button" onClick={applyFilters}>
              <Search className="mr-2 h-4 w-4" />
              Apply
            </Button>
            <Button type="button" variant="outline" onClick={clearFilters}>
              Reset
            </Button>
          </div>
        </div>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[1.3fr_1fr]">
        <Card className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Latest Objects</p>
              <h2 className="mt-1 font-display text-xl">Live Objects</h2>
            </div>
            <Badge variant="outline" className="rounded-full">
              {latestData?.total ?? 0} objects
            </Badge>
          </div>

          {latestError ? (
            <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
              {latestError}
            </div>
          ) : (
            <Table.Root
              layout="fixed"
              style={{ width: "100%", minWidth: "100%" }}
              className="[&_th:nth-child(1)]:w-[22%] [&_th:nth-child(2)]:w-[53%] [&_th:nth-child(3)]:w-[25%] [&_td:nth-child(1)]:w-[22%] [&_td:nth-child(2)]:w-[53%] [&_td:nth-child(3)]:w-[25%]"
            >
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeaderCell>Type</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell>Reference</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell>Latest Update</Table.ColumnHeaderCell>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {latestLoading ? (
                  <Table.Row>
                    <Table.Cell colSpan={3} className="h-16 text-center text-sm text-muted-foreground">
                      Loading latest objects...
                    </Table.Cell>
                  </Table.Row>
                ) : latestData && latestData.items.length > 0 ? (
                  latestData.items.map((item) => {
                    const key = objectIdentityKey(item);
                    const selected = selectedObjectKey === key;
                    return (
                      <Table.Row
                        key={key}
                        className={selected ? "bg-muted/50" : ""}
                        onClick={() => {
                          setSelectedObjectKey(key);
                          setEventsPage(0);
                          setSelectedEventKey(null);
                        }}
                      >
                        <Table.RowHeaderCell className="font-medium whitespace-normal">
                          {objectTypeDisplayLabel(item.object_type)}
                        </Table.RowHeaderCell>
                        <Table.Cell className="whitespace-normal break-words">
                          {summarizeObjectRef(item.object_ref, item.object_type)}
                        </Table.Cell>
                        <Table.Cell className="whitespace-normal">{formatDateTime(item.recorded_at)}</Table.Cell>
                      </Table.Row>
                    );
                  })
                ) : (
                  <Table.Row>
                    <Table.Cell colSpan={3} className="h-16 text-center text-sm text-muted-foreground">
                      No objects match the active filters.
                    </Table.Cell>
                  </Table.Row>
                )}
              </Table.Body>
            </Table.Root>
          )}

          <div className="mt-4 flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              Page {(latestData?.page ?? latestPage) + 1} of {latestData?.total_pages ?? 0}
            </p>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setLatestPage((previous) => Math.max(0, previous - 1))}
                disabled={latestPage <= 0 || latestLoading}
              >
                Previous
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setLatestPage((previous) => previous + 1)}
                disabled={latestLoading || (latestData ? latestPage + 1 >= latestData.total_pages : true)}
              >
                Next
              </Button>
            </div>
          </div>
        </Card>

        <Card className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Timeline</p>
              <h2 className="mt-1 font-display text-xl">Object Event History</h2>
            </div>
            <Badge variant="outline" className="rounded-full">
              {eventsData?.total ?? 0} events
            </Badge>
          </div>

          {selectedObject ? (
            <div className="mb-4 rounded-xl border border-border bg-muted/20 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                    {selectedEvent ? "Selected Event Object Snapshot" : "Selected Object"}
                  </p>
                  <p className="mt-1 text-sm font-semibold">
                    {objectTypeDisplayLabel(selectedObject.object_type)}
                  </p>
                  {selectedEvent && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {ontologyConceptDisplayLabel(
                        selectedEvent.event_type,
                        selectedObject.object_type
                      )}{" "}
                      · {formatDateTime(selectedEvent.occurred_at || selectedEvent.linked_at)}
                    </p>
                  )}
                </div>
                <Badge variant="outline" className="rounded-full text-[10px] uppercase">
                  {selectedObjectDetails.length} fields
                </Badge>
              </div>
              <div className="max-h-56 overflow-y-auto pr-1">
                <DataList.Root size="1">
                  {selectedObjectDetails.map((entry) => (
                    <DataList.Item key={entry.key} align="start">
                      <DataList.Value>
                        <div className="space-y-1">
                          <span className="font-medium">{entry.label}:</span>
                          <div className="rounded-md border border-border/60 bg-muted/20 p-2">
                            {renderObjectDetailsValue(
                              entry.value,
                              displaySelectedDetailsFieldLabel,
                              displaySelectedDetailsFieldValue
                            )}
                          </div>
                        </div>
                      </DataList.Value>
                    </DataList.Item>
                  ))}
                </DataList.Root>
              </div>
            </div>
          ) : (
            <div className="mb-4 rounded-xl border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
              Select an object from the table to load its event history.
            </div>
          )}

          {eventsError ? (
            <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
              {eventsError}
            </div>
          ) : (
            <div className="space-y-3">
              {eventsLoading ? (
                <div className="rounded-xl border border-border p-4 text-sm text-muted-foreground">
                  Loading event history...
                </div>
              ) : eventsData && eventsData.items.length > 0 ? (
                eventsData.items.map((item) => {
                  const eventKey = objectEventIdentityKey(item);
                  const isSelected = selectedEvent
                    ? objectEventIdentityKey(selectedEvent) === eventKey
                    : false;
                  return (
                    <button
                      key={eventKey}
                      type="button"
                      className={`w-full rounded-xl border p-3 text-left transition-colors ${
                        isSelected
                          ? "border-primary/40 bg-primary/5"
                          : "border-border hover:bg-muted/30"
                      }`}
                      onClick={() => setSelectedEventKey(eventKey)}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-medium">
                          {ontologyConceptDisplayLabel(item.event_type, selectedObject?.object_type)}
                        </p>
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Clock3 className="h-3 w-3" />
                          {formatDateTime(item.occurred_at || item.linked_at)}
                        </div>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Source · {item.source || "—"} | Role · {item.relation_role || "—"}
                      </p>
                      <p className="mt-2 text-xs text-muted-foreground">
                        {summarizePayload(
                          item.payload,
                          {
                            objectType: selectedObject?.object_type,
                            eventType: item.event_type,
                            stateLabelByToken: selectedObjectStateLabels,
                          }
                        )}
                      </p>
                    </button>
                  );
                })
              ) : (
                <div className="rounded-xl border border-border p-4 text-sm text-muted-foreground">
                  No events for this object in the selected page.
                </div>
              )}
            </div>
          )}

          <div className="mt-4 flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              Page {(eventsData?.page ?? eventsPage) + 1} of {eventsData?.total_pages ?? 0}
            </p>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setEventsPage((previous) => Math.max(0, previous - 1))}
                disabled={eventsPage <= 0 || eventsLoading || !selectedObject}
              >
                Previous
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setEventsPage((previous) => previous + 1)}
                disabled={eventsLoading || !selectedObject || (eventsData ? eventsPage + 1 >= eventsData.total_pages : true)}
              >
                Next
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
