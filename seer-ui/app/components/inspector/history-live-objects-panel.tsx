"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Filter, Search } from "lucide-react";
import { useRouter } from "next/navigation";

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

import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { SearchableSelect } from "../ui/searchable-select";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Table } from "../ui/table";

type PropertyFilterDraft = ObjectPropertyFilter & { id: string };
type PropertyFilterOperatorOption = { value: PropertyFilterOperator; label: string };
type PropertyKeyOption = { value: string; label: string; kind: OntologyDisplayFieldKind };
type LatestObjectsRequestState = {
  requestKey: string;
  data: LatestObjectsResponse | null;
  error: string | null;
};

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
  if (!value) {
    return "—";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) {
    return "—";
  }
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

function normalizeFieldRank(fieldKey: string, orderedFieldKeys: string[]): number {
  const index = orderedFieldKeys.indexOf(fieldKey);
  return index >= 0 ? index : Number.MAX_SAFE_INTEGER;
}

function isScalarValue(value: unknown): value is string | number | boolean {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function stringifyCellValue(value: unknown): string {
  if (value === null || value === undefined || value === "") {
    return "—";
  }
  if (isScalarValue(value)) {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function snakeCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

function isStateLikeFieldKey(fieldKey: string): boolean {
  const normalized = fieldKey.trim().toLowerCase();
  return (
    normalized === "state" ||
    normalized === "status" ||
    normalized.endsWith("_state") ||
    normalized.endsWith("_status")
  );
}

function readFieldValue(item: LatestObjectItem, fieldKey: string): unknown {
  if (item.object_payload && Object.prototype.hasOwnProperty.call(item.object_payload, fieldKey)) {
    return item.object_payload[fieldKey];
  }
  if (Object.prototype.hasOwnProperty.call(item.object_ref, fieldKey)) {
    return item.object_ref[fieldKey];
  }
  return null;
}

export function HistoryLiveObjectsPanel({ objectType }: { objectType: string }) {
  const router = useRouter();
  const ontologyDisplay = useOntologyDisplay();
  const selectedModel = useMemo(
    () => ontologyDisplay.resolveObjectModel(objectType),
    [objectType, ontologyDisplay]
  );

  const [latestPage, setLatestPage] = useState(0);
  const latestPageSize = 25;
  const [latestRequestState, setLatestRequestState] = useState<LatestObjectsRequestState>({
    requestKey: "",
    data: null,
    error: null,
  });

  const [propertyFilterDrafts, setPropertyFilterDrafts] = useState<PropertyFilterDraft[]>([
    { id: "filter-0", key: "", op: "eq", value: "" },
  ]);
  const [appliedPropertyFilters, setAppliedPropertyFilters] = useState<ObjectPropertyFilter[]>([]);
  const [propertyKindsByModelUri, setPropertyKindsByModelUri] = useState<
    Record<string, Record<string, OntologyDisplayFieldKind>>
  >({});

  const inferFieldKind = useCallback(
    (fieldKey: string, hints: Array<string | undefined>) =>
      ontologyDisplay.fieldKindForKey(fieldKey, {
        objectType,
        valueTypeHints: hints,
      }),
    [objectType, ontologyDisplay]
  );

  const propertyKeyOptions = useMemo<PropertyKeyOption[]>(() => {
    if (!selectedModel) {
      return [];
    }
    const resolvedKinds = propertyKindsByModelUri[selectedModel.uri] || {};
    const options = selectedModel.canonicalFieldKeys.map((fieldKey) => ({
      value: fieldKey,
      label: ontologyDisplay.displayFieldLabel(fieldKey, { objectType: selectedModel.uri }),
      kind:
        resolvedKinds[fieldKey] ||
        ontologyDisplay.fieldKindForKey(fieldKey, {
          objectType: selectedModel.uri,
        }),
    }));
    if (selectedModel.stateFilterOptions.length > 0 && selectedModel.stateFilterFieldKey) {
      options.push({ value: STATE_FILTER_KEY, label: "State", kind: "string" });
    }
    return options.sort((a, b) => a.label.localeCompare(b.label));
  }, [ontologyDisplay, propertyKindsByModelUri, selectedModel]);

  const stateValueOptions = useMemo(
    () => selectedModel?.stateFilterOptions || [],
    [selectedModel]
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
    (key: string) => {
      if (key !== STATE_FILTER_KEY) {
        return key;
      }
      return selectedModel?.stateFilterFieldKey || "state";
    },
    [selectedModel]
  );

  const operatorOptionsForPropertyKey = useCallback(
    (key: string): Array<PropertyFilterOperatorOption> => {
      const lookupKey = normalizedFilterFieldKey(key);
      let options = ontologyDisplay
        .operatorOptionsForField(lookupKey, {
          objectType: selectedModel?.uri || objectType,
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
    [knownFieldKinds, normalizedFilterFieldKey, objectType, ontologyDisplay, selectedModel]
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
    const modelUri = selectedModel?.uri;
    if (!modelUri || propertyKindsByModelUri[modelUri]) {
      return () => {
        active = false;
      };
    }

    fetchObjectModelPropertyKinds(modelUri, inferFieldKind)
      .then((kinds) => {
        if (!active) {
          return;
        }
        setPropertyKindsByModelUri((previous) => ({ ...previous, [modelUri]: kinds }));
      })
      .catch(() => {
        if (!active) {
          return;
        }
        setPropertyKindsByModelUri((previous) => ({ ...previous, [modelUri]: {} }));
      });

    return () => {
      active = false;
    };
  }, [inferFieldKind, propertyKindsByModelUri, selectedModel]);

  const normalizedPropertyFilterDrafts = useMemo(
    () =>
      propertyFilterDrafts.map((filter) => {
        if (!filter.key) {
          return filter;
        }
        if (!allowedPropertyKeySet.has(filter.key)) {
          return { ...filter, key: "", op: "eq" as PropertyFilterOperator, value: "" };
        }
        const normalizedOperator = normalizeOperatorForPropertyKey(filter.key, filter.op);
        if (normalizedOperator !== filter.op) {
          return { ...filter, op: normalizedOperator };
        }
        return filter;
      }),
    [allowedPropertyKeySet, normalizeOperatorForPropertyKey, propertyFilterDrafts]
  );

  useEffect(() => {
    let active = true;
    const requestKey = JSON.stringify({
      objectType,
      propertyFilters: appliedPropertyFilters,
      page: latestPage,
      size: latestPageSize,
    });

    listLatestObjects({
      objectType,
      propertyFilters: appliedPropertyFilters,
      page: latestPage,
      size: latestPageSize,
    })
      .then((response) => {
        if (!active) {
          return;
        }
        setLatestRequestState({
          requestKey,
          data: response,
          error: null,
        });
      })
      .catch((cause) => {
        if (!active) {
          return;
        }
        setLatestRequestState({
          requestKey,
          data: null,
          error: cause instanceof Error ? cause.message : "Failed to load latest objects",
        });
      });

    return () => {
      active = false;
    };
  }, [appliedPropertyFilters, latestPage, objectType]);

  const latestRequestKey = useMemo(
    () =>
      JSON.stringify({
        objectType,
        propertyFilters: appliedPropertyFilters,
        page: latestPage,
        size: latestPageSize,
      }),
    [appliedPropertyFilters, latestPage, objectType]
  );
  const latestLoading = latestRequestState.requestKey !== latestRequestKey;
  const latestError = latestLoading ? null : latestRequestState.error;
  const latestData = latestRequestState.data;

  const applyFilters = () => {
    const nextFilters = normalizedPropertyFilterDrafts
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
            ? selectedModel?.stateFilterFieldKey || "state"
            : filter.key.trim(),
        value: filter.value.trim(),
      }));

    setAppliedPropertyFilters(nextFilters);
    setLatestPage(0);
  };

  const clearFilters = () => {
    setPropertyFilterDrafts([{ id: "filter-0", key: "", op: "eq", value: "" }]);
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

  const liveObjects = useMemo(() => latestData?.items ?? [], [latestData]);
  const keyPartFieldKeys = useMemo(() => {
    const discoveredKeys = new Set<string>();
    liveObjects.forEach((item) => {
      Object.keys(item.object_ref).forEach((key) => discoveredKeys.add(key));
    });
    return Array.from(discoveredKeys).sort((left, right) => {
      const leftRank = normalizeFieldRank(left, selectedModel?.canonicalFieldKeys || []);
      const rightRank = normalizeFieldRank(right, selectedModel?.canonicalFieldKeys || []);
      if (leftRank !== rightRank) {
        return leftRank - rightRank;
      }
      return ontologyDisplay
        .displayFieldLabel(left, { objectType })
        .localeCompare(ontologyDisplay.displayFieldLabel(right, { objectType }));
    });
  }, [liveObjects, objectType, ontologyDisplay, selectedModel]);

  const displayNameFieldCandidates = useMemo(() => {
    const candidates = ["display_name", "name"];
    const localFieldCandidate = selectedModel?.localName
      ? `${snakeCase(selectedModel.localName)}_name`
      : null;
    if (localFieldCandidate) {
      candidates.push(localFieldCandidate);
    }
    return Array.from(new Set(candidates));
  }, [selectedModel]);
  const displayNameFieldKey = useMemo(
    () =>
      displayNameFieldCandidates.find((fieldKey) => selectedModel?.canonicalFieldKeys.includes(fieldKey)) ||
      null,
    [displayNameFieldCandidates, selectedModel]
  );

  const stateFieldKeys = useMemo(() => {
    const excludedFields = new Set([
      ...keyPartFieldKeys,
      ...(displayNameFieldKey ? [displayNameFieldKey] : []),
    ]);
    const orderedStateKeys: string[] = [];
    const seen = new Set<string>();
    const pushKey = (fieldKey: string | null | undefined) => {
      if (!fieldKey || excludedFields.has(fieldKey) || seen.has(fieldKey)) {
        return;
      }
      seen.add(fieldKey);
      orderedStateKeys.push(fieldKey);
    };

    pushKey(selectedModel?.stateFilterFieldKey);
    (selectedModel?.canonicalFieldKeys || []).forEach((fieldKey) => {
      if (isStateLikeFieldKey(fieldKey)) {
        pushKey(fieldKey);
      }
    });
    return orderedStateKeys;
  }, [displayNameFieldKey, keyPartFieldKeys, selectedModel]);

  const displayFieldValue = useCallback(
    (fieldKey: string, rawValue: unknown) =>
      ontologyDisplay.displayFieldValue(fieldKey, rawValue, {
        objectType,
        stateLabelByToken: selectedModel?.stateLabelByToken,
      }),
    [objectType, ontologyDisplay, selectedModel]
  );

  const renderFieldValue = useCallback(
    (item: LatestObjectItem, fieldKey: string) =>
      stringifyCellValue(displayFieldValue(fieldKey, readFieldValue(item, fieldKey))),
    [displayFieldValue]
  );

  const renderDisplayName = useCallback(
    (item: LatestObjectItem) => {
      if (!displayNameFieldKey) {
        return "—";
      }
      return stringifyCellValue(displayFieldValue(displayNameFieldKey, readFieldValue(item, displayNameFieldKey)));
    },
    [displayFieldValue, displayNameFieldKey]
  );
  const visibleColumnCount = keyPartFieldKeys.length + stateFieldKeys.length + (displayNameFieldKey ? 2 : 1);

  if (!selectedModel) {
    return (
      <Card className="rounded-2xl border border-destructive/40 bg-destructive/10 p-6 text-sm text-destructive">
        Unable to resolve the selected object model.
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="rounded-2xl border border-border bg-card p-6 shadow-sm">
        <div className="flex items-center gap-3 text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          <Filter className="h-4 w-4" />
          History Filters
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-[2fr_auto]">
          <div className="space-y-3">
            <Label>Property filters</Label>
            {normalizedPropertyFilterDrafts.map((filter) => {
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
                  <SearchableSelect
                    value={filter.key || "__unset"}
                    onValueChange={(value) => {
                      const nextKey = value === "__unset" ? "" : value;
                      updateFilter(filter.id, {
                        key: nextKey,
                        op: normalizeOperatorForPropertyKey(nextKey, filter.op),
                        value: "",
                      });
                    }}
                    groups={[
                      {
                        label: "Properties",
                        options: [
                          { value: "__unset", label: "Select field" },
                          ...propertyKeyOptions.map((option) => ({
                            value: option.value,
                            label: option.label,
                            description: option.kind,
                          })),
                        ],
                      },
                    ]}
                    placeholder="Select field"
                    searchPlaceholder="Search properties..."
                    emptyMessage="No properties found."
                  />

                  <Select
                    value={filter.op}
                    onValueChange={(value) =>
                      updateFilter(filter.id, { op: value as PropertyFilterOperator })
                    }
                    disabled={!filter.key || filter.key === STATE_FILTER_KEY || operatorOptions.length <= 1}
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
                      value={filter.value || "__unset"}
                      onValueChange={(value) =>
                        updateFilter(filter.id, { value: value === "__unset" ? "" : value })
                      }
                      disabled={stateValueOptions.length === 0}
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
                      value={filter.value || "__unset"}
                      onValueChange={(value) =>
                        updateFilter(filter.id, { value: value === "__unset" ? "" : value })
                      }
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
                    />
                  )}

                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => removeFilter(filter.id)}
                    disabled={normalizedPropertyFilterDrafts.length <= 1}
                  >
                    Remove
                  </Button>
                </div>
              );
            })}
            <Button type="button" variant="outline" onClick={addFilter}>
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

      <Card className="rounded-2xl border border-border bg-card p-6 shadow-sm">
        <div className="mb-4 flex items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Latest Objects</p>
            <h2 className="mt-1 font-display text-xl">
              {ontologyDisplay.displayObjectType(objectType)}
            </h2>
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
          <Table.Root striped className="w-full min-w-[980px]">
            <Table.Header>
              <Table.Row>
                {keyPartFieldKeys.map((fieldKey) => (
                  <Table.ColumnHeaderCell key={fieldKey}>
                    {ontologyDisplay.displayFieldLabel(fieldKey, { objectType })}
                  </Table.ColumnHeaderCell>
                ))}
                {displayNameFieldKey ? (
                  <Table.ColumnHeaderCell>
                    {ontologyDisplay.displayFieldLabel(displayNameFieldKey, { objectType })}
                  </Table.ColumnHeaderCell>
                ) : null}
                {stateFieldKeys.map((fieldKey) => (
                  <Table.ColumnHeaderCell key={fieldKey}>
                    {ontologyDisplay.displayFieldLabel(fieldKey, { objectType })}
                  </Table.ColumnHeaderCell>
                ))}
                <Table.ColumnHeaderCell>Latest update</Table.ColumnHeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {latestLoading ? (
                <Table.Row>
                  <Table.Cell
                    colSpan={visibleColumnCount}
                    className="h-16 text-center text-sm text-muted-foreground"
                  >
                    Loading latest objects...
                  </Table.Cell>
                </Table.Row>
              ) : liveObjects.length > 0 ? (
                liveObjects.map((item) => (
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
                    {keyPartFieldKeys.map((fieldKey) => (
                      <Table.RowHeaderCell key={`${objectIdentityKey(item)}-${fieldKey}`} className="whitespace-normal">
                        {renderFieldValue(item, fieldKey)}
                      </Table.RowHeaderCell>
                    ))}
                    {displayNameFieldKey ? (
                      <Table.Cell className="whitespace-normal break-words">
                        {renderDisplayName(item)}
                      </Table.Cell>
                    ) : null}
                    {stateFieldKeys.map((fieldKey) => (
                      <Table.Cell key={`${objectIdentityKey(item)}-${fieldKey}-state`} className="whitespace-normal">
                        {renderFieldValue(item, fieldKey)}
                      </Table.Cell>
                    ))}
                    <Table.Cell className="whitespace-normal">{formatDateTime(item.recorded_at)}</Table.Cell>
                  </Table.Row>
                ))
              ) : (
                <Table.Row>
                  <Table.Cell
                    colSpan={visibleColumnCount}
                    className="h-16 text-center text-sm text-muted-foreground"
                  >
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
  );
}
