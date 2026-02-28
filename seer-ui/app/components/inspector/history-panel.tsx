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
import { mapPropertyDefinitions } from "@/app/lib/ontology-helpers";
import { useOntologyGraphContext } from "@/app/components/providers/ontology-graph-provider";
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

type FilterFieldKind = "string" | "number" | "boolean" | "temporal";
type PropertyFilterOperatorOption = { value: PropertyFilterOperator; label: string };
type PropertyKeyOption = { value: string; label: string; kind: FilterFieldKind };

type ObjectModelDescriptor = {
  uri: string;
  name: string;
  localName: string;
  fieldLabelByKey: Map<string, string>;
  stateLabelByToken: Map<string, string>;
  stateFilterFieldKey: string | null;
  stateFilterOptions: Array<{ value: string; label: string }>;
  filterFieldOptions: PropertyKeyOption[];
};

const PROPERTY_OPERATORS: Array<PropertyFilterOperatorOption> = [
  { value: "eq", label: "Equals" },
  { value: "contains", label: "Contains" },
  { value: "gt", label: "Greater Than" },
  { value: "gte", label: "Greater or Equal" },
  { value: "lt", label: "Less Than" },
  { value: "lte", label: "Less or Equal" },
];
const NUMERIC_TYPE_TOKENS = new Set([
  "int",
  "integer",
  "long",
  "short",
  "byte",
  "double",
  "float",
  "decimal",
  "nonnegativeinteger",
  "positiveinteger",
  "negativeinteger",
  "nonpositiveinteger",
  "unsignedint",
  "unsignedlong",
  "unsignedshort",
  "unsignedbyte",
]);
const BOOLEAN_TYPE_TOKENS = new Set(["boolean", "bool"]);
const TEMPORAL_TYPE_TOKENS = new Set(["datetime", "date", "duration", "time", "timestamp"]);
const FILTER_OPERATORS_BY_KIND: Record<FilterFieldKind, PropertyFilterOperator[]> = {
  string: ["eq", "contains"],
  number: ["eq", "contains", "gt", "gte", "lt", "lte"],
  boolean: ["eq"],
  temporal: ["eq", "gt", "gte", "lt", "lte"],
};

function formatDateTime(value: string | null): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) return "—";
  return parsed.toLocaleString();
}

function iriLocalName(iri: string): string {
  const hashIndex = iri.lastIndexOf("#");
  if (hashIndex >= 0 && hashIndex < iri.length - 1) {
    return iri.slice(hashIndex + 1);
  }
  const slashIndex = iri.lastIndexOf("/");
  if (slashIndex >= 0 && slashIndex < iri.length - 1) {
    return iri.slice(slashIndex + 1);
  }
  return iri;
}

function normalizeToken(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeComparableToken(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function formatStateLabel(value: string): string {
  const cleaned = value.trim();
  if (!cleaned) {
    return value;
  }
  return cleaned
    .replace(/[_-]+/g, " ")
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function kindFromTypeToken(token: string): FilterFieldKind {
  const normalized = normalizeComparableToken(token);
  if (!normalized) {
    return "string";
  }
  if (TEMPORAL_TYPE_TOKENS.has(normalized)) {
    return "temporal";
  }
  if (BOOLEAN_TYPE_TOKENS.has(normalized)) {
    return "boolean";
  }
  if (NUMERIC_TYPE_TOKENS.has(normalized)) {
    return "number";
  }
  return "string";
}

function fieldKindFromTypeHints(hints: Array<string | undefined>): FilterFieldKind {
  for (const hint of hints) {
    if (!hint || !hint.trim()) {
      continue;
    }
    const inferred = kindFromTypeToken(iriLocalName(hint));
    if (inferred !== "string") {
      return inferred;
    }
    const fallback = kindFromTypeToken(hint);
    if (fallback !== "string") {
      return fallback;
    }
  }
  return "string";
}

function inferPropertyFieldKind(valueTypeUri: string | undefined): FilterFieldKind {
  if (!valueTypeUri) {
    return "string";
  }
  return fieldKindFromTypeHints([valueTypeUri]);
}

function preferredOntologyName(properties: Record<string, unknown> | undefined): string | null {
  const prophetName = properties?.["prophet:name"];
  if (typeof prophetName === "string" && prophetName.trim()) {
    return prophetName.trim();
  }
  const name = properties?.name;
  if (typeof name === "string" && name.trim()) {
    return name.trim();
  }
  return null;
}

async function fetchObjectModelPropertyKinds(
  objectModelUri: string
): Promise<Record<string, FilterFieldKind>> {
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
  const output: Record<string, FilterFieldKind> = {};
  rows.forEach((row) => {
    const key = row.fieldKey?.trim();
    if (!key) {
      return;
    }
    output[key] = fieldKindFromTypeHints([row.baseName, row.baseType, row.mapsToXsd]);
  });
  return output;
}

function operatorOptionsForPropertyKey(
  key: string,
  propertyKeyOptionLookup: Map<string, PropertyKeyOption>
): Array<PropertyFilterOperatorOption> {
  if (key === STATE_FILTER_KEY) {
    return PROPERTY_OPERATORS.filter((operator) => operator.value === "eq");
  }
  const kind = propertyKeyOptionLookup.get(key)?.kind || "string";
  const allowed = new Set(FILTER_OPERATORS_BY_KIND[kind]);
  return PROPERTY_OPERATORS.filter((operator) => allowed.has(operator.value));
}

function normalizeOperatorForPropertyKey(
  key: string,
  operator: PropertyFilterOperator,
  propertyKeyOptionLookup: Map<string, PropertyKeyOption>
): PropertyFilterOperator {
  const options = operatorOptionsForPropertyKey(key, propertyKeyOptionLookup);
  if (options.some((option) => option.value === operator)) {
    return operator;
  }
  return options[0]?.value || "eq";
}

const MODEL_ALIAS_REWRITES: Array<[RegExp, string]> = [
  [/^shipment$/i, "delivery"],
  [/^delivery$/i, "shipment"],
  [/^order$/i, "sales order"],
  [/^sales order$/i, "order"],
];

const FIELD_ALIAS_REWRITES: Array<[RegExp, string]> = [
  [/^sales_order_(.+)$/i, "order_$1"],
  [/^order_(.+)$/i, "sales_order_$1"],
  [/^delivery_(.+)$/i, "shipment_$1"],
  [/^shipment_(.+)$/i, "delivery_$1"],
];

function applyAliasRewrites(value: string, rules: Array<[RegExp, string]>): string[] {
  const variants = new Set<string>([value]);
  for (const [pattern, replacement] of rules) {
    if (pattern.test(value)) {
      variants.add(value.replace(pattern, replacement));
    }
  }
  return Array.from(variants);
}

function tokenVariants(value: string): string[] {
  const local = iriLocalName(value);
  const candidates = new Set<string>([value, local]);
  for (const candidate of [value, local]) {
    applyAliasRewrites(candidate, MODEL_ALIAS_REWRITES).forEach((alias) => candidates.add(alias));
  }

  const variants = new Set<string>();
  for (const candidate of candidates) {
    const strict = normalizeToken(candidate);
    const comparable = normalizeComparableToken(candidate);
    if (strict) {
      variants.add(strict);
    }
    if (comparable) {
      variants.add(comparable);
    }
  }
  return Array.from(variants);
}

function resolveFieldLabel(
  fieldLabelByKey: Map<string, string> | undefined,
  key: string
): string | undefined {
  if (!fieldLabelByKey) {
    return undefined;
  }
  const lookupComparable = (lookupKey: string): string | undefined => {
    const direct = fieldLabelByKey.get(lookupKey);
    if (direct) {
      return direct;
    }
    const comparable = normalizeComparableToken(lookupKey);
    if (!comparable) {
      return undefined;
    }
    for (const [candidateKey, label] of fieldLabelByKey.entries()) {
      if (normalizeComparableToken(candidateKey) === comparable) {
        return label;
      }
    }
    return undefined;
  };

  const exact = lookupComparable(key);
  if (exact) {
    return exact;
  }

  const suffixRules: Array<{ suffix: string; decorate: (label: string) => string; extras?: string[] }> =
    [
      { suffix: "_id", decorate: (label) => `${label} ID` },
      {
        suffix: "_count",
        decorate: (label) => `${label} Count`,
        extras: ["s"],
      },
    ];

  for (const rule of suffixRules) {
    if (!key.endsWith(rule.suffix) || key.length <= rule.suffix.length) {
      continue;
    }
    const base = key.slice(0, -rule.suffix.length);
    const candidates = new Set<string>([base]);
    for (const extra of rule.extras || []) {
      candidates.add(`${base}${extra}`);
    }
    for (const candidate of candidates) {
      const baseLabel = lookupComparable(candidate);
      if (baseLabel) {
        return rule.decorate(baseLabel);
      }
    }
  }

  return undefined;
}

function resolveStateDisplayValue(
  key: string,
  value: unknown,
  stateLabelByToken?: Map<string, string>
): unknown {
  if (!stateLabelByToken || typeof value !== "string" || !value.trim()) {
    return value;
  }
  if (!isStateLikeFieldKey(key)) {
    return value;
  }
  return (
    stateLabelByToken.get(normalizeToken(value)) ||
    stateLabelByToken.get(normalizeComparableToken(value)) ||
    formatStateLabel(value)
  );
}

function fallbackFieldLabel(key: string): string {
  const normalized = normalizeComparableToken(key);
  if (normalized === "fromstate") {
    return "From";
  }
  if (normalized === "tostate") {
    return "To";
  }
  if (normalized === "state") {
    return "State";
  }
  return iriLocalName(key);
}

function isStateLikeFieldKey(key: string): boolean {
  return normalizeComparableToken(key) === "state";
}

function displayFieldLabel(
  fieldLabelByKey: Map<string, string> | undefined,
  key: string
): string {
  if (isStateLikeFieldKey(key)) {
    return fallbackFieldLabel(key);
  }
  return resolveFieldLabel(fieldLabelByKey, key) || fallbackFieldLabel(key);
}

function registerPropertyAliases(
  labelMap: Map<string, string>,
  aliases: Array<string | undefined>,
  label: string
): void {
  for (const alias of aliases) {
    if (!alias || !alias.trim()) {
      continue;
    }
    const base = alias.trim();
    const candidates = new Set<string>([base]);
    applyAliasRewrites(base, FIELD_ALIAS_REWRITES).forEach((nextAlias) => candidates.add(nextAlias));
    for (const candidate of candidates) {
      if (!labelMap.has(candidate)) {
        labelMap.set(candidate, label);
      }
    }
  }
}

function summarizeObjectRef(
  ref: Record<string, unknown>,
  fieldLabelByKey?: Map<string, string>
): string {
  const entries = Object.entries(ref);
  if (entries.length === 0) return "—";
  return entries
    .slice(0, 2)
    .map(
      ([key, value]) =>
        `${displayFieldLabel(fieldLabelByKey, key)} · ${String(value)}`
    )
    .join(" | ");
}

function summarizePayload(
  payload: Record<string, unknown> | null,
  fieldLabelByKey?: Map<string, string>,
  stateLabelByToken?: Map<string, string>
): string {
  if (!payload) return "—";
  const entries = Object.entries(payload).filter(([, value]) =>
    ["string", "number", "boolean"].includes(typeof value)
  );
  if (entries.length === 0) return "—";
  return entries
    .slice(0, 3)
    .map(([key, value]) => {
      const displayValue = resolveStateDisplayValue(key, value, stateLabelByToken);
      return `${displayFieldLabel(fieldLabelByKey, key)} · ${String(displayValue)}`;
    })
    .join(" | ");
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
  fieldLabelByKey: Map<string, string> | undefined,
  stateLabelByToken: Map<string, string> | undefined,
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
              {renderObjectDetailsNode(item, fieldLabelByKey, stateLabelByToken, depth + 1)}
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
          const nestedLabel = displayFieldLabel(fieldLabelByKey, key);
          const resolvedNestedValue = resolveStateDisplayValue(key, nestedValue, stateLabelByToken);
          return (
            <div key={key} className="grid grid-cols-[minmax(80px,auto)_1fr] items-start gap-2">
              <span className="text-xs font-medium text-muted-foreground">{nestedLabel}:</span>
              <div className="min-w-0">
                {renderObjectDetailsNode(
                  resolvedNestedValue,
                  fieldLabelByKey,
                  stateLabelByToken,
                  depth + 1
                )}
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
  fieldLabelByKey?: Map<string, string>,
  stateLabelByToken?: Map<string, string>
): React.ReactNode {
  return renderObjectDetailsNode(value, fieldLabelByKey, stateLabelByToken, 0);
}

export function HistoryPanel() {
  const { graph } = useOntologyGraphContext();
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
    Record<string, Record<string, FilterFieldKind>>
  >({});

  const objectModels = useMemo<ObjectModelDescriptor[]>(() => {
    if (!graph) {
      return [];
    }
    const nodesByUri = new Map(graph.nodes.map((node) => [node.uri, node]));
    return graph.nodes
      .filter((node) => node.label === "ObjectModel")
      .map((node) => {
        const fieldLabelByKey = new Map<string, string>();
        const stateLabelByToken = new Map<string, string>();
        const stateFilterOptionsByValue = new Map<string, string>();
        const filterFieldOptions: PropertyKeyOption[] = [];
        const canonicalFieldKeys: string[] = [];
        const objectLocalName = iriLocalName(node.uri);
        const objectSlug = objectLocalName.startsWith("obj_")
          ? objectLocalName.slice(4)
          : objectLocalName;

        for (const prop of mapPropertyDefinitions(node.uri, graph.nodes, graph.edges)) {
          const propertyNode = prop.uri ? nodesByUri.get(prop.uri) : undefined;
          const label =
            preferredOntologyName(propertyNode?.properties) ||
            (prop.name && prop.name.trim()) ||
            (prop.fieldKey && prop.fieldKey.trim()) ||
            (prop.uri ? iriLocalName(prop.uri) : "");
          const canonicalKey =
            (prop.fieldKey && prop.fieldKey.trim()) || (prop.uri ? iriLocalName(prop.uri) : "");
          if (!label) {
            continue;
          }
          if (canonicalKey) {
            canonicalFieldKeys.push(canonicalKey);
            filterFieldOptions.push({
              value: canonicalKey,
              label,
              kind: inferPropertyFieldKind(prop.valueTypeUri),
            });
          }
          registerPropertyAliases(
            fieldLabelByKey,
            [prop.fieldKey, prop.name, prop.uri ? iriLocalName(prop.uri) : undefined],
            label
          );
        }

        const stateUris = graph.edges
          .filter((edge) => edge.fromUri === node.uri && edge.type === "hasPossibleState")
          .map((edge) => edge.toUri);
        for (const stateUri of stateUris) {
          const stateNode = nodesByUri.get(stateUri);
          const stateLocalName = iriLocalName(stateUri);
          const stateName = preferredOntologyName(stateNode?.properties) || stateLocalName;
          const aliases = new Set<string>([stateName, stateLocalName]);
          const scopedPrefix = `state_${objectSlug}_`;
          const stateValue =
            objectSlug && stateLocalName.startsWith(scopedPrefix)
              ? stateLocalName.slice(scopedPrefix.length)
              : stateLocalName.startsWith("state_")
                ? stateLocalName.slice(6)
                : stateLocalName;
          if (stateValue) {
            stateFilterOptionsByValue.set(stateValue, stateName);
            aliases.add(stateValue);
          }
          if (stateLocalName.startsWith("state_")) {
            aliases.add(stateLocalName.slice(6));
          }
          if (objectSlug && stateLocalName.startsWith(scopedPrefix)) {
            aliases.add(stateLocalName.slice(scopedPrefix.length));
          }
          for (const alias of aliases) {
            for (const token of tokenVariants(alias)) {
              if (token && !stateLabelByToken.has(token)) {
                stateLabelByToken.set(token, stateName);
              }
            }
          }
        }

        const name = preferredOntologyName(node.properties) || iriLocalName(node.uri);
        const scoreStateFieldKey = (key: string): number => {
          const comparable = normalizeComparableToken(key);
          if (comparable === "state") return 0;
          return 99;
        };
        const stateFieldKeyCandidate = canonicalFieldKeys
          .slice()
          .sort((a, b) => scoreStateFieldKey(a) - scoreStateFieldKey(b))[0];
        const stateFieldKey =
          stateFieldKeyCandidate && scoreStateFieldKey(stateFieldKeyCandidate) < 99
            ? stateFieldKeyCandidate
            : null;
        return {
          uri: node.uri,
          localName: iriLocalName(node.uri),
          name,
          fieldLabelByKey,
          stateLabelByToken,
          stateFilterFieldKey: stateFieldKey,
          stateFilterOptions: Array.from(stateFilterOptionsByValue.entries())
            .map(([value, label]) => ({ value, label }))
            .sort((a, b) => a.label.localeCompare(b.label)),
          filterFieldOptions,
        };
      });
  }, [graph]);

  const objectModelLookup = useMemo(() => {
    const byToken = new Map<string, ObjectModelDescriptor>();
    for (const model of objectModels) {
      const keys = [model.uri, model.name, model.localName];
      for (const key of keys) {
        for (const normalized of tokenVariants(key)) {
          if (!normalized || byToken.has(normalized)) {
            continue;
          }
          byToken.set(normalized, model);
        }
      }
    }
    return byToken;
  }, [objectModels]);

  const conceptLabelLookup = useMemo(() => {
    const byToken = new Map<string, string>();
    if (!graph) {
      return byToken;
    }
    for (const node of graph.nodes) {
      const displayName = preferredOntologyName(node.properties) || iriLocalName(node.uri);
      const keys = [node.uri, displayName, iriLocalName(node.uri)];
      for (const value of Object.values(node.properties || {})) {
        if (typeof value === "string") {
          keys.push(value);
        } else if (Array.isArray(value)) {
          value.forEach((item) => {
            if (typeof item === "string") {
              keys.push(item);
            }
          });
        }
      }
      for (const key of keys) {
        for (const normalized of tokenVariants(key)) {
          if (!normalized || byToken.has(normalized)) {
            continue;
          }
          byToken.set(normalized, displayName);
        }
      }
    }
    return byToken;
  }, [graph]);

  const conceptFieldLabelLookup = useMemo(() => {
    const byToken = new Map<string, Map<string, string>>();
    if (!graph) {
      return byToken;
    }
    const nodesByUri = new Map(graph.nodes.map((node) => [node.uri, node]));
    for (const node of graph.nodes) {
      const fieldLabelByKey = new Map<string, string>();
      for (const prop of mapPropertyDefinitions(node.uri, graph.nodes, graph.edges)) {
        const propertyNode = prop.uri ? nodesByUri.get(prop.uri) : undefined;
        const label =
          preferredOntologyName(propertyNode?.properties) ||
          (prop.name && prop.name.trim()) ||
          (prop.fieldKey && prop.fieldKey.trim()) ||
          (prop.uri ? iriLocalName(prop.uri) : "");
        if (!label) {
          continue;
        }
        registerPropertyAliases(
          fieldLabelByKey,
          [prop.fieldKey, prop.name, prop.uri ? iriLocalName(prop.uri) : undefined],
          label
        );
      }
      if (fieldLabelByKey.size === 0) {
        continue;
      }
      const keys = [node.uri, iriLocalName(node.uri)];
      const preferredName = preferredOntologyName(node.properties);
      if (preferredName) {
        keys.push(preferredName);
      }
      for (const key of keys) {
        for (const normalized of tokenVariants(key)) {
          if (!normalized || byToken.has(normalized)) {
            continue;
          }
          byToken.set(normalized, fieldLabelByKey);
        }
      }
    }
    return byToken;
  }, [graph]);

  const globalFieldLabelLookup = useMemo(() => {
    const labels = new Map<string, string>();
    if (!graph) {
      return labels;
    }
    const nodesByUri = new Map(graph.nodes.map((node) => [node.uri, node]));
    for (const node of graph.nodes) {
      for (const prop of mapPropertyDefinitions(node.uri, graph.nodes, graph.edges)) {
        const propertyNode = prop.uri ? nodesByUri.get(prop.uri) : undefined;
        const label =
          preferredOntologyName(propertyNode?.properties) ||
          (prop.name && prop.name.trim()) ||
          (prop.fieldKey && prop.fieldKey.trim()) ||
          (prop.uri ? iriLocalName(prop.uri) : "");
        if (!label) {
          continue;
        }
        registerPropertyAliases(
          labels,
          [prop.fieldKey, prop.name, prop.uri ? iriLocalName(prop.uri) : undefined],
          label
        );
      }
    }
    return labels;
  }, [graph]);

  const resolveObjectModel = useCallback(
    (objectType: string): ObjectModelDescriptor | null =>
      objectModelLookup.get(normalizeToken(objectType)) ||
      objectModelLookup.get(normalizeComparableToken(objectType)) ||
      null,
    [objectModelLookup]
  );

  const objectTypeDisplayLabel = useCallback(
    (objectType: string): string => {
      const model = resolveObjectModel(objectType);
      if (!model) {
        return iriLocalName(objectType);
      }
      return model.name;
    },
    [resolveObjectModel]
  );

  const fieldLabelsForObjectType = useCallback(
    (objectType: string): Map<string, string> | undefined =>
      resolveObjectModel(objectType)?.fieldLabelByKey,
    [resolveObjectModel]
  );

  const ontologyConceptDisplayLabel = useCallback(
    (conceptType: string | null | undefined, fallbackObjectType?: string): string => {
      if (!conceptType || !conceptType.trim()) {
        return "Unknown event";
      }
      const ontologyLabel =
        conceptLabelLookup.get(normalizeToken(conceptType)) ||
        conceptLabelLookup.get(normalizeComparableToken(conceptType)) ||
        null;
      if (ontologyLabel) {
        return ontologyLabel;
      }

      const [entityToken, actionToken] = conceptType.split(".", 2);
      if (entityToken && actionToken) {
        const objectLabel = objectTypeDisplayLabel(fallbackObjectType || entityToken);
        return `${objectLabel} ${actionToken}`;
      }
      return iriLocalName(conceptType);
    },
    [conceptLabelLookup, objectTypeDisplayLabel]
  );

  const fieldLabelsForEventType = useCallback(
    (eventType: string | null | undefined): Map<string, string> | undefined => {
      if (!eventType || !eventType.trim()) {
        return undefined;
      }
      return (
        conceptFieldLabelLookup.get(normalizeToken(eventType)) ||
        conceptFieldLabelLookup.get(normalizeComparableToken(eventType))
      );
    },
    [conceptFieldLabelLookup]
  );

  const mergedFieldLabelsForTimeline = useCallback(
    (eventType: string | null | undefined, objectType: string | undefined): Map<string, string> => {
      const merged = new Map<string, string>(globalFieldLabelLookup);
      const objectLabels = objectType ? fieldLabelsForObjectType(objectType) : undefined;
      const eventLabels = fieldLabelsForEventType(eventType);
      for (const [key, label] of objectLabels?.entries() || []) {
        merged.set(key, label);
      }
      for (const [key, label] of eventLabels?.entries() || []) {
        merged.set(key, label);
      }
      return merged;
    },
    [fieldLabelsForEventType, fieldLabelsForObjectType, globalFieldLabelLookup]
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

  const propertyKeyOptions = useMemo(() => {
    if (!selectedDraftModel) {
      return [];
    }
    const resolvedKinds = propertyKindsByModelUri[selectedDraftModel.uri] || {};
    const options = selectedDraftModel.filterFieldOptions.map((option) => ({
      ...option,
      kind: resolvedKinds[option.value] || option.kind,
    }));
    if (selectedDraftModel.stateFilterOptions.length > 0 && selectedDraftModel.stateFilterFieldKey) {
      options.push({ value: STATE_FILTER_KEY, label: "State", kind: "string" });
    }
    return options.sort((a, b) => a.label.localeCompare(b.label));
  }, [selectedDraftModel, propertyKindsByModelUri]);

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
  const selectedObjectFieldLabels = useMemo(
    () => (selectedObject ? fieldLabelsForObjectType(selectedObject.object_type) : undefined),
    [selectedObject, fieldLabelsForObjectType]
  );
  const selectedObjectStateLabels = useMemo(
    () => (selectedObject ? resolveObjectModel(selectedObject.object_type)?.stateLabelByToken : undefined),
    [selectedObject, resolveObjectModel]
  );
  const selectedEventFieldLabels = useMemo(
    () => fieldLabelsForEventType(selectedEvent?.event_type),
    [selectedEvent, fieldLabelsForEventType]
  );
  const selectedDetailsFieldLabels = useMemo(() => {
    const merged = new Map<string, string>(globalFieldLabelLookup);
    for (const [key, label] of selectedObjectFieldLabels?.entries() || []) {
      merged.set(key, label);
    }
    for (const [key, label] of selectedEventFieldLabels?.entries() || []) {
      merged.set(key, label);
    }
    return merged;
  }, [globalFieldLabelLookup, selectedObjectFieldLabels, selectedEventFieldLabels]);
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
        const label = displayFieldLabel(selectedDetailsFieldLabels, key);
        const displayValue = resolveStateDisplayValue(key, value, selectedObjectStateLabels);
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
  }, [selectedDetailsFieldLabels, selectedEvent, selectedObject, selectedObjectStateLabels]);

  useEffect(() => {
    let active = true;
    const modelUri = selectedDraftModel?.uri;
    if (!modelUri || propertyKindsByModelUri[modelUri]) {
      return () => {
        active = false;
      };
    }
    fetchObjectModelPropertyKinds(modelUri)
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
  }, [selectedDraftModel, propertyKindsByModelUri]);

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
          return { ...filter, key: "", op: "eq", value: "" };
        }
        const normalizedOperator = normalizeOperatorForPropertyKey(
          filter.key,
          filter.op,
          propertyKeyOptionLookup
        );
        if (normalizedOperator !== filter.op) {
          changed = true;
          return { ...filter, op: normalizedOperator };
        }
        return filter;
      });
      return changed ? next : previous;
    });
  }, [allowedPropertyKeySet, propertyKeyOptionLookup]);

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
              filter.op,
              propertyKeyOptionLookup
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
              const operatorOptions = operatorOptionsForPropertyKey(
                filter.key,
                propertyKeyOptionLookup
              );
              const fieldKind = propertyKeyOptionLookup.get(filter.key)?.kind || "string";
              const isBooleanField = filter.key !== STATE_FILTER_KEY && fieldKind === "boolean";
              const valuePlaceholder =
                fieldKind === "number"
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
                      op: normalizeOperatorForPropertyKey(
                        nextKey,
                        filter.op,
                        propertyKeyOptionLookup
                      ),
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
                          {summarizeObjectRef(
                            item.object_ref,
                            fieldLabelsForObjectType(item.object_type)
                          )}
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
                              selectedDetailsFieldLabels,
                              selectedObjectStateLabels
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
                          mergedFieldLabelsForTimeline(item.event_type, selectedObject?.object_type),
                          selectedObjectStateLabels
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
