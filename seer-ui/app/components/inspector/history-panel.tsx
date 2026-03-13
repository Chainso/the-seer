"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Filter, Search } from "lucide-react";
import { useRouter } from "next/navigation";

import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Table } from "../ui/table";

import { listLatestObjects } from "@/app/lib/api/history";
import { queryOntologySelect } from "@/app/lib/api/ontology";
import {
  type OntologyDisplayFieldKind,
  type OntologyDisplayOperator,
  useOntologyDisplay,
} from "@/app/lib/ontology-display";
import type {
  LatestObjectItem,
  LatestObjectsResponse,
  ObjectPropertyFilter,
  PropertyFilterOperator,
} from "@/app/types/history";

type PropertyFilterDraft = ObjectPropertyFilter & { id: string };
type PropertyFilterOperatorOption = { value: PropertyFilterOperator; label: string };
type PropertyKeyOption = { value: string; label: string; kind: OntologyDisplayFieldKind };

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

function formatDateTime(value: string | null): string {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) return "-";
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

export function HistoryPanel() {
  const router = useRouter();
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

  const summarizeObjectRef = useCallback(
    (ref: Record<string, unknown>, objectType: string) =>
      ontologyDisplay.summarizeObjectRef(ref, { objectType }),
    [ontologyDisplay]
  );

  const objectTypeOptions = useMemo(
    () =>
      knownObjectTypes.map((type) => ({
        value: type,
        label: objectTypeDisplayLabel(type),
      })),
    [knownObjectTypes, objectTypeDisplayLabel]
  );

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

  const stateValueOptions = useMemo(
    () => selectedDraftModel?.stateFilterOptions || [],
    [selectedDraftModel]
  );

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
        .map((option) => ({
          value: option.value as PropertyFilterOperator,
          label: option.label,
        }));

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
        const normalizedOperator = normalizeOperatorForPropertyKey(filter.key, filter.op);
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
      })
      .catch((cause) => {
        if (!active) return;
        setLatestData(null);
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
            op: normalizeOperatorForPropertyKey(filter.key.trim(), filter.op),
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
  };

  const clearFilters = () => {
    setObjectTypeDraft("");
    setPropertyFilterDrafts([{ id: "filter-0", key: "", op: "eq", value: "" }]);
    setAppliedObjectType(undefined);
    setAppliedPropertyFilters([]);
    setLatestPage(0);
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
      previous.map((filter) => {
        if (filter.id !== id) {
          return filter;
        }
        const merged = { ...filter, ...patch };
        if (Object.prototype.hasOwnProperty.call(patch, "op")) {
          return merged;
        }
        const normalizedOperator = normalizeOperatorForPropertyKey(merged.key, merged.op);
        return { ...merged, op: normalizedOperator as OntologyDisplayOperator as PropertyFilterOperator };
      })
    );
  };

  return (
    <div className="space-y-6">
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

      <div>
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
              striped
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
                  latestData.items.map((item) => (
                    <Table.Row
                      key={objectIdentityKey(item)}
                      className="cursor-pointer"
                      onClick={() => {
                        const params = new URLSearchParams({
                          object_type: item.object_type,
                          object_ref_canonical: item.object_ref_canonical,
                        });
                        if (typeof item.object_ref_hash === "number") {
                          params.set("object_ref_hash", String(item.object_ref_hash));
                        }
                        router.push(`/inspector/history/object?${params.toString()}`);
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
                  ))
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
      </div>
    </div>
  );
}
