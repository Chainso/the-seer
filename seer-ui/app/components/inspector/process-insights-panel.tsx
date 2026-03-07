"use client";

import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { DataList } from "@radix-ui/themes";
import { Bot, FlaskConical, Radar, SearchCheck, Sparkles } from "lucide-react";

import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Table } from "../ui/table";
import { InspectorScopeFilters, type SharedWindowPreset } from "./inspector-scope-filters";

import { cn } from "@/app/lib/utils";
import { getOntologyGraph, queryOntologySelect } from "@/app/lib/api/ontology";
import { buildReferenceEdges } from "@/app/components/ontology/graph-reference-edges";
import {
  iriLocalName,
  type OntologyDisplayFieldKind,
  useOntologyDisplay,
} from "@/app/lib/ontology-display";
import {
  assistRootCauseInterpret,
  assistRootCauseSetup,
  getRootCauseEvidence,
  runRootCause,
} from "@/app/lib/api/root-cause";
import type {
  RootCauseAssistInterpretResponseContract,
  RootCauseEvidenceResponseContract,
  RootCauseFilterOperator,
  RootCauseInsightResultContract,
  RootCauseRunResponseContract,
  RootCauseSetupSuggestionContract,
} from "@/app/types/root-cause";
import type { OntologyGraph, OntologyNode } from "@/app/types/ontology";
import { mergeSearchParams } from "@/app/lib/url-state";

type RunState = "idle" | "running" | "completed" | "error";

interface ModelOption {
  uri: string;
  name: string;
  objectType: string;
}

interface FilterDraft {
  id: string;
  field: string;
  op: RootCauseFilterOperator;
  value: string;
}

interface OutcomeOption {
  value: string;
  label: string;
  source: string;
}

interface FilterFieldOption {
  value: string;
  label: string;
  kind: FilterFieldKind;
}

type FilterFieldKind = OntologyDisplayFieldKind;

interface FilterOperatorOption {
  value: RootCauseFilterOperator;
  label: string;
}

type ReadableSearchParams = Pick<URLSearchParams, "get" | "getAll">;

const EVENT_NODE_LABELS = new Set(["Event", "Signal", "Transition"]);
const OUTCOME_SENTINEL = "__select_outcome__";
const FILTER_FIELD_SENTINEL = "__select_filter_field__";
const RCA_FILTER_PARAM = "rca_filter";

const TYPE_RESOLUTION_QUERY_PREFIX = `
PREFIX prophet: <http://prophet.platform/ontology#>
`.trim();

function toDatetimeLocalValue(date: Date): string {
  const withOffset = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return withOffset.toISOString().slice(0, 16);
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return "—";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) {
    return "—";
  }
  return parsed.toLocaleString();
}

function toPercent(value: number): string {
  return `${(Math.max(0, value) * 100).toFixed(2)}%`;
}

function stringifyRefValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "null";
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function parseTraceAnchor(trace: RootCauseEvidenceResponseContract["traces"][number]): {
  objectType: string;
  keyParts: Record<string, string>;
  fallbackRef: string;
} {
  const anchorKey = trace.anchor_key || "";
  const firstSep = anchorKey.indexOf("|");
  const secondSep = firstSep >= 0 ? anchorKey.indexOf("|", firstSep + 1) : -1;

  const objectTypeFromKey = firstSep > 0 ? anchorKey.slice(0, firstSep) : "";
  const canonicalFromKey = secondSep > firstSep ? anchorKey.slice(secondSep + 1) : "";
  const canonicalRaw = (trace.anchor_object_ref_canonical || canonicalFromKey || "").trim();

  const objectType = objectTypeFromKey || trace.anchor_object_type || "—";
  if (!canonicalRaw) {
    const fallback = trace.anchor_object_ref_hash ? String(trace.anchor_object_ref_hash) : "—";
    return {
      objectType,
      keyParts: {},
      fallbackRef: fallback,
    };
  }

  try {
    const parsed = JSON.parse(canonicalRaw) as unknown;
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
      return {
        objectType,
        keyParts: {},
        fallbackRef: stringifyRefValue(parsed),
      };
    }
    const entries = Object.entries(parsed as Record<string, unknown>);
    if (entries.length === 0) {
      return {
        objectType,
        keyParts: {},
        fallbackRef: "—",
      };
    }
    const keyParts = entries.reduce<Record<string, string>>((acc, [key, value]) => {
      acc[key] = stringifyRefValue(value) || "—";
      return acc;
    }, {});
    return { objectType, keyParts, fallbackRef: canonicalRaw };
  } catch {
    return {
      objectType,
      keyParts: {},
      fallbackRef: canonicalRaw,
    };
  }
}

function summarizeTraceEvents(
  events: RootCauseEvidenceResponseContract["traces"][number]["events"],
  displayEventType: (eventType: string) => string
): string {
  if (events.length === 0) {
    return "—";
  }
  return events
    .slice(0, 5)
    .map((event) => displayEventType(event.event_type))
    .join(" -> ");
}

function ontologyNodeName(node: OntologyNode): string {
  const prophetName = node.properties?.["prophet:name"];
  if (typeof prophetName === "string" && prophetName.trim()) {
    return prophetName.trim();
  }
  const name = node.properties?.name;
  if (typeof name === "string" && name.trim()) {
    return name.trim();
  }
  return iriLocalName(node.uri);
}

function buildOutcomeOptions(
  graph: OntologyGraph | null,
  anchorModelUri: string,
  displayEventType: (eventType: string) => string
): OutcomeOption[] {
  if (!graph || !anchorModelUri) {
    return [];
  }

  const nodeByUri = new Map(graph.nodes.map((node) => [node.uri, node]));
  const allEdges = [...graph.edges, ...buildReferenceEdges(graph.nodes, graph.edges)];
  const candidateUris = new Set<string>();

  const transitionUris = allEdges
    .filter((edge) => edge.type === "transitionOf" && edge.toUri === anchorModelUri)
    .map((edge) => edge.fromUri);

  transitionUris.forEach((uri) => candidateUris.add(uri));

  allEdges.forEach((edge) => {
    if (edge.fromUri === anchorModelUri) {
      const target = nodeByUri.get(edge.toUri);
      if (target && EVENT_NODE_LABELS.has(target.label)) {
        candidateUris.add(target.uri);
      }
    }
    if (edge.toUri === anchorModelUri) {
      const source = nodeByUri.get(edge.fromUri);
      if (source && EVENT_NODE_LABELS.has(source.label)) {
        candidateUris.add(source.uri);
      }
    }
  });

  allEdges.forEach((edge) => {
    if (edge.type !== "referencesObjectModel" || edge.toUri !== anchorModelUri) {
      return;
    }
    const source = nodeByUri.get(edge.fromUri);
    if (source && EVENT_NODE_LABELS.has(source.label)) {
      candidateUris.add(source.uri);
    }
  });

  const transitionSet = new Set(transitionUris);
  allEdges.forEach((edge) => {
    if (transitionSet.has(edge.fromUri)) {
      const target = nodeByUri.get(edge.toUri);
      if (target && EVENT_NODE_LABELS.has(target.label)) {
        candidateUris.add(target.uri);
      }
    }
    if (transitionSet.has(edge.toUri)) {
      const source = nodeByUri.get(edge.fromUri);
      if (source && EVENT_NODE_LABELS.has(source.label)) {
        candidateUris.add(source.uri);
      }
    }
  });

  const byValue = new Map<string, OutcomeOption>();
  candidateUris.forEach((uri) => {
    const node = nodeByUri.get(uri);
    if (!node) {
      return;
    }
    const value = uri;
    if (!value || byValue.has(value)) {
      return;
    }
    const source = node.label === "Transition" ? "Transition" : "Event";
    byValue.set(value, {
      value,
      label: displayEventType(value),
      source,
    });
  });

  return Array.from(byValue.values()).sort((a, b) => a.label.localeCompare(b.label));
}

async function fetchAnchorPropertyKinds(
  anchorModelUri: string,
  inferFieldKind: (fieldKey: string, hints: Array<string | undefined>) => FilterFieldKind
): Promise<Record<string, FilterFieldKind>> {
  if (!anchorModelUri || /[<>\s]/.test(anchorModelUri)) {
    return {};
  }

  const query = `
${TYPE_RESOLUTION_QUERY_PREFIX}
SELECT DISTINCT ?fieldKey ?baseType ?baseName ?mapsToXsd
WHERE {
  <${anchorModelUri}> prophet:hasProperty ?property .
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
  const byFieldKey: Record<string, FilterFieldKind> = {};

  rows.forEach((row) => {
    const fieldKey = row.fieldKey?.trim();
    if (!fieldKey) {
      return;
    }
    byFieldKey[fieldKey] = inferFieldKind(fieldKey, [row.baseName, row.baseType, row.mapsToXsd]);
  });

  return byFieldKey;
}

function buildFilterFieldOptions(
  anchorFieldKeys: string[],
  anchorObjectType: string,
  outcomeOptions: OutcomeOption[],
  anchorFieldKinds: Record<string, FilterFieldKind>,
  displayFilterFieldLabel: (field: string) => string,
  resolveAnchorFieldKind: (fieldKey: string) => FilterFieldKind
): FilterFieldOption[] {
  const options = new Map<string, FilterFieldOption>();
  const add = (value: string, label: string, kind: FilterFieldKind) => {
    if (!value || options.has(value)) {
      return;
    }
    options.set(value, { value, label, kind });
  };

  anchorFieldKeys.forEach((fieldKey) => {
    const anchorField = `anchor.${fieldKey}`;
    add(
      anchorField,
      displayFilterFieldLabel(anchorField),
      anchorFieldKinds[fieldKey] || resolveAnchorFieldKind(fieldKey)
    );
  });

  if (anchorObjectType) {
    const countField = `object_type.count.${anchorObjectType}`;
    add(countField, displayFilterFieldLabel(countField), "count");
  }

  outcomeOptions.forEach((option) => {
    const presentField = `event.present.${option.value}`;
    const countField = `event.count.${option.value}`;
    add(presentField, displayFilterFieldLabel(presentField), "boolean");
    add(countField, displayFilterFieldLabel(countField), "count");
  });

  return Array.from(options.values()).sort((a, b) => a.label.localeCompare(b.label));
}

function suggestedValuesForFilterField(field: string): string[] {
  if (!field) {
    return [];
  }
  if (field.startsWith("event.present.")) {
    return ["true"];
  }
  if (field.startsWith("event.count.") || field.startsWith("object_type.count.")) {
    return ["1", "2", "3", "4+"];
  }
  return [];
}

function serializeRootCauseFilters(filters: FilterDraft[]): string[] {
  return filters
    .filter((filter) => filter.field.trim() || filter.value.trim())
    .map((filter) =>
      [filter.field.trim(), filter.op, filter.value.trim()].map(encodeURIComponent).join("~")
    );
}

function defaultWindowRange(): { from: string; to: string } {
  const now = new Date();
  return {
    from: toDatetimeLocalValue(new Date(now.getTime() - 24 * 60 * 60 * 1000)),
    to: toDatetimeLocalValue(now),
  };
}

function decodeSearchToken(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return "";
  }
}

function normalizeDateTimeLocalValue(value: string | null | undefined, fallback: string): string {
  if (!value) {
    return fallback;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) {
    return fallback;
  }
  return toDatetimeLocalValue(parsed);
}

function toIsoDateTime(value: string): string | null {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) {
    return null;
  }
  return parsed.toISOString();
}

function parseRootCauseFilters(searchParams: ReadableSearchParams): FilterDraft[] {
  const filters = searchParams
    .getAll(RCA_FILTER_PARAM)
    .map((entry, index) => {
      const [rawField = "", rawOp = "contains", rawValue = ""] = entry.split("~", 3);
      return {
        id: `filter-${index}`,
        field: decodeSearchToken(rawField),
        op: decodeSearchToken(rawOp) as RootCauseFilterOperator,
        value: decodeSearchToken(rawValue),
      };
    })
    .filter((filter) => filter.field || filter.value);

  return filters.length > 0
    ? filters
    : [{ id: "filter-0", field: "", op: "contains", value: "" }];
}

function areRootCauseFiltersEqual(left: FilterDraft[], right: FilterDraft[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((filter, index) => {
    const candidate = right[index];
    return (
      Boolean(candidate) &&
      filter.field === candidate.field &&
      filter.op === candidate.op &&
      filter.value === candidate.value
    );
  });
}

function areSerializedFiltersEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((value, index) => value === right[index]);
}

interface ProcessInsightsPanelProps {
  isActive: boolean;
}

export function ProcessInsightsPanel({ isActive }: ProcessInsightsPanelProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const ontologyDisplay = useOntologyDisplay();
  const [ontologyGraph, setOntologyGraph] = useState<OntologyGraph | null>(null);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [anchorModelUri, setAnchorModelUri] = useState(() => searchParams.get("rca_anchor") ?? "");
  const [windowPreset, setWindowPreset] = useState<SharedWindowPreset>(() => {
    const preset = searchParams.get("rca_preset");
    return preset === "7d" || preset === "30d" || preset === "custom" ? preset : "24h";
  });
  const [from, setFrom] = useState(() =>
    normalizeDateTimeLocalValue(searchParams.get("rca_from"), defaultWindowRange().from)
  );
  const [to, setTo] = useState(() =>
    normalizeDateTimeLocalValue(searchParams.get("rca_to"), defaultWindowRange().to)
  );
  const [depth, setDepth] = useState(() => searchParams.get("rca_depth") ?? "1");
  const [outcomeEventType, setOutcomeEventType] = useState(() => searchParams.get("rca_outcome") ?? "");
  const [filters, setFilters] = useState<FilterDraft[]>(() => parseRootCauseFilters(searchParams));
  const [evidenceLimit, setEvidenceLimit] = useState(() => searchParams.get("rca_evidence_limit") ?? "10");

  const [runState, setRunState] = useState<RunState>("idle");
  const [runError, setRunError] = useState<string | null>(null);
  const [run, setRun] = useState<RootCauseRunResponseContract | null>(null);

  const [selectedInsightId, setSelectedInsightId] = useState<string | null>(() => searchParams.get("rca_insight"));
  const [evidence, setEvidence] = useState<RootCauseEvidenceResponseContract | null>(null);
  const [evidenceLoading, setEvidenceLoading] = useState(false);
  const [evidenceError, setEvidenceError] = useState<string | null>(null);

  const [setupLoading, setSetupLoading] = useState(false);
  const [setupSuggestions, setSetupSuggestions] = useState<RootCauseSetupSuggestionContract[]>([]);
  const [setupNotes, setSetupNotes] = useState<string[]>([]);
  const [setupError, setSetupError] = useState<string | null>(null);

  const [interpretation, setInterpretation] =
    useState<RootCauseAssistInterpretResponseContract | null>(null);
  const [interpretLoading, setInterpretLoading] = useState(false);
  const [interpretError, setInterpretError] = useState<string | null>(null);
  const [anchorFieldKinds, setAnchorFieldKinds] = useState<Record<string, FilterFieldKind>>({});
  const resultsSummaryRef = useRef<HTMLDivElement | null>(null);
  const rankedInsightsRef = useRef<HTMLDivElement | null>(null);
  const evidenceSectionRef = useRef<HTMLDivElement | null>(null);
  const autoRunSignatureRef = useRef("");
  const completionSignatureRef = useRef("");
  const evidenceSignatureRef = useRef("");
  const filterSyncSourceRef = useRef<"local" | "url">("local");

  const replaceQuery = useCallback((updates: Record<string, string | string[] | null | undefined>) => {
    const nextQuery = mergeSearchParams(searchParams, updates);
    const nextUrl = nextQuery ? `${pathname}?${nextQuery}` : pathname;
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", nextUrl);
    }
    startTransition(() => {
      router.replace(nextUrl, { scroll: false });
    });
  }, [pathname, router, searchParams]);

  const clearInsightResults = useCallback(() => {
    setRun(null);
    setRunError(null);
    setRunState("idle");
    setSelectedInsightId(null);
    setEvidence(null);
    setEvidenceError(null);
    setInterpretation(null);
    setInterpretError(null);
    completionSignatureRef.current = "";
    evidenceSignatureRef.current = "";
  }, []);

  const inferAnchorFieldKind = useCallback(
    (fieldKey: string, hints: Array<string | undefined> = []): FilterFieldKind =>
      ontologyDisplay.fieldKindForKey(fieldKey, {
        objectType: anchorModelUri || undefined,
        valueTypeHints: hints,
      }),
    [anchorModelUri, ontologyDisplay]
  );

  useEffect(() => {
    let active = true;
    getOntologyGraph()
      .then((graph) => {
        if (!active) {
          return;
        }
        setOntologyGraph(graph);
        const options = graph.nodes
          .filter((node) => node.label === "ObjectModel")
          .map((node) => {
            const name = ontologyNodeName(node);
            return {
              uri: node.uri,
              name,
              objectType: node.uri,
            };
          })
          .sort((a, b) => a.name.localeCompare(b.name));
        setModels(options);
        if (options.length > 0) {
          setAnchorModelUri((current) => current || options[0].uri);
        }
      })
      .catch(() => {
        if (!active) {
          return;
        }
        setOntologyGraph(null);
        setModels([]);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const fallbackWindow = defaultWindowRange();
    const nextAnchorModelUri = searchParams.get("rca_anchor") ?? "";
    const nextPreset = searchParams.get("rca_preset");
    const nextWindowPreset =
      nextPreset === "7d" || nextPreset === "30d" || nextPreset === "custom" ? nextPreset : "24h";
    const nextDepth = searchParams.get("rca_depth") ?? "1";
    const nextOutcomeEventType = searchParams.get("rca_outcome") ?? "";
    const nextEvidenceLimit = searchParams.get("rca_evidence_limit") ?? "10";
    const nextSelectedInsightId = searchParams.get("rca_insight");
    const nextFilters = parseRootCauseFilters(searchParams);
    const nextRunRequested = searchParams.get("rca_run") === "1";

    setAnchorModelUri((current) => (current === nextAnchorModelUri ? current : nextAnchorModelUri));
    setWindowPreset((current) => (current === nextWindowPreset ? current : nextWindowPreset));
    setFrom((current) => {
      const nextFrom = normalizeDateTimeLocalValue(searchParams.get("rca_from"), fallbackWindow.from);
      return current === nextFrom ? current : nextFrom;
    });
    setTo((current) => {
      const nextTo = normalizeDateTimeLocalValue(searchParams.get("rca_to"), fallbackWindow.to);
      return current === nextTo ? current : nextTo;
    });
    setDepth((current) => (current === nextDepth ? current : nextDepth));
    setOutcomeEventType((current) => (current === nextOutcomeEventType ? current : nextOutcomeEventType));
    setEvidenceLimit((current) => (current === nextEvidenceLimit ? current : nextEvidenceLimit));
    setSelectedInsightId((current) => (current === nextSelectedInsightId ? current : nextSelectedInsightId));
    setFilters((current) => {
      if (areRootCauseFiltersEqual(current, nextFilters)) {
        return current;
      }
      filterSyncSourceRef.current = "url";
      return nextFilters;
    });
    if (!nextRunRequested) {
      clearInsightResults();
      autoRunSignatureRef.current = "";
    }
  }, [clearInsightResults, searchParams]);

  useEffect(() => {
    if (filterSyncSourceRef.current === "url") {
      filterSyncSourceRef.current = "local";
      return;
    }
    const serializedFilters = serializeRootCauseFilters(filters);
    const currentFilters = searchParams.getAll(RCA_FILTER_PARAM);
    if (areSerializedFiltersEqual(serializedFilters, currentFilters)) {
      return;
    }
    replaceQuery({
      rca_filter: serializedFilters,
      rca_run: null,
      rca_insight: null,
    });
  }, [filters, replaceQuery, searchParams]);

  useEffect(() => {
    let active = true;
    if (!anchorModelUri) {
      setAnchorFieldKinds({});
      return () => {
        active = false;
      };
    }

    setAnchorFieldKinds({});
    fetchAnchorPropertyKinds(anchorModelUri, inferAnchorFieldKind)
      .then((kinds) => {
        if (!active) {
          return;
        }
        setAnchorFieldKinds(kinds);
      })
      .catch(() => {
        if (!active) {
          return;
        }
        setAnchorFieldKinds({});
      });

    return () => {
      active = false;
    };
  }, [anchorModelUri, inferAnchorFieldKind]);

  const selectedModel = useMemo(
    () => models.find((model) => model.uri === anchorModelUri) || null,
    [models, anchorModelUri]
  );
  const selectedDisplayModel = useMemo(
    () => ontologyDisplay.resolveObjectModel(anchorModelUri),
    [anchorModelUri, ontologyDisplay]
  );
  const anchorObjectType = selectedModel?.objectType || "";
  const displayEventType = useCallback(
    (eventType: string) =>
      ontologyDisplay.displayEventType(eventType, {
        fallbackObjectType: anchorObjectType || anchorModelUri || undefined,
      }),
    [anchorModelUri, anchorObjectType, ontologyDisplay]
  );
  const displayFilterFieldLabel = useCallback(
    (field: string) =>
      ontologyDisplay.displayFieldLabel(field, {
        objectType: anchorModelUri || anchorObjectType || undefined,
      }),
    [anchorModelUri, anchorObjectType, ontologyDisplay]
  );
  const baseOutcomeOptions = useMemo(
    () => buildOutcomeOptions(ontologyGraph, anchorModelUri, displayEventType),
    [displayEventType, ontologyGraph, anchorModelUri]
  );
  const outcomeOptions = useMemo(() => {
    const merged = new Map<string, OutcomeOption>();
    baseOutcomeOptions.forEach((option) => merged.set(option.value, option));
    setupSuggestions.forEach((suggestion) => {
      const value = (suggestion.outcome.event_type || "").trim();
      if (!value || merged.has(value)) {
        return;
      }
      merged.set(value, {
        value,
        label: `${displayEventType(value)} (Suggested)`,
        source: "Suggested",
      });
    });
    return Array.from(merged.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [baseOutcomeOptions, displayEventType, setupSuggestions]);
  const selectedOutcomeEventType = useMemo(() => outcomeEventType, [outcomeEventType]);
  const anchorFieldKeys = useMemo(
    () => selectedDisplayModel?.canonicalFieldKeys || [],
    [selectedDisplayModel]
  );
  const resolveAnchorFieldKind = useCallback(
    (fieldKey: string) =>
      ontologyDisplay.fieldKindForKey(fieldKey, {
        objectType: anchorModelUri || undefined,
      }),
    [anchorModelUri, ontologyDisplay]
  );
  const filterFieldOptions = useMemo(
    () =>
      buildFilterFieldOptions(
        anchorFieldKeys,
        anchorObjectType,
        outcomeOptions,
        anchorFieldKinds,
        displayFilterFieldLabel,
        resolveAnchorFieldKind
      ),
    [
      anchorFieldKeys,
      anchorFieldKinds,
      anchorObjectType,
      displayFilterFieldLabel,
      outcomeOptions,
      resolveAnchorFieldKind,
    ]
  );
  const filterFieldKindsByValue = useMemo(
    () => new Map(filterFieldOptions.map((option) => [option.value, option.kind])),
    [filterFieldOptions]
  );
  const operatorOptionsForFilterField = useCallback(
    (field: string): FilterOperatorOption[] =>
      ontologyDisplay.operatorOptionsForField(field, {
        objectType: anchorModelUri || undefined,
        knownFieldKinds: filterFieldKindsByValue,
        profile: "insights",
      }).map((option) => ({
        value: option.value as RootCauseFilterOperator,
        label: option.label,
      })),
    [anchorModelUri, filterFieldKindsByValue, ontologyDisplay]
  );
  const defaultOperatorForFilterField = useCallback(
    (field: string): RootCauseFilterOperator =>
      ontologyDisplay.defaultOperatorForField(field, {
        objectType: anchorModelUri || undefined,
        knownFieldKinds: filterFieldKindsByValue,
        profile: "insights",
      }) as RootCauseFilterOperator,
    [anchorModelUri, filterFieldKindsByValue, ontologyDisplay]
  );
  const normalizeOperatorForFilterField = useCallback(
    (field: string, operator: RootCauseFilterOperator): RootCauseFilterOperator =>
      ontologyDisplay.normalizeOperatorForField(field, operator, {
        objectType: anchorModelUri || undefined,
        knownFieldKinds: filterFieldKindsByValue,
        profile: "insights",
      }) as RootCauseFilterOperator,
    [anchorModelUri, filterFieldKindsByValue, ontologyDisplay]
  );

  useEffect(() => {
    setSetupSuggestions([]);
    setSetupNotes([]);
    setSetupError(null);
  }, [anchorModelUri]);

  useEffect(() => {
    if (!outcomeEventType || !anchorModelUri || !ontologyGraph) {
      return;
    }
    const stillApplicable = baseOutcomeOptions.some((option) => option.value === outcomeEventType);
    if (!stillApplicable) {
      setOutcomeEventType("");
      replaceQuery({
        rca_outcome: null,
        rca_run: null,
        rca_insight: null,
      });
    }
  }, [anchorModelUri, baseOutcomeOptions, ontologyGraph, outcomeEventType, replaceQuery]);

  useEffect(() => {
    setFilters((current) => {
      let changed = false;
      const next = current.map((filter) => {
        const normalizedOp = normalizeOperatorForFilterField(filter.field, filter.op);
        if (normalizedOp !== filter.op) {
          changed = true;
          return { ...filter, op: normalizedOp };
        }
        return filter;
      });
      return changed ? next : current;
    });
  }, [normalizeOperatorForFilterField]);

  const selectedInsight = useMemo(() => {
    if (!run || !selectedInsightId) {
      return run?.insights[0] || null;
    }
    return run.insights.find((insight) => insight.insight_id === selectedInsightId) || run.insights[0] || null;
  }, [run, selectedInsightId]);

  const activeFilterPayload = useMemo(
    () =>
      filters
        .filter((filter) => filter.field.trim() && filter.value.trim())
        .map((filter) => ({
          field: filter.field.trim(),
          op: normalizeOperatorForFilterField(filter.field.trim(), filter.op),
          value: filter.value.trim(),
        })),
    [filters, normalizeOperatorForFilterField]
  );
  const resolvedFrom = useMemo(() => toIsoDateTime(from), [from]);
  const resolvedTo = useMemo(() => toIsoDateTime(to), [to]);

  const parseEvidenceLimit = (value: string): number => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return 10;
    }
    return Math.floor(parsed);
  };

  const applyWindowPreset = (preset: Exclude<SharedWindowPreset, "custom">) => {
    setWindowPreset(preset);
    const now = new Date();
    const durationMsByPreset: Record<Exclude<SharedWindowPreset, "custom">, number> = {
      "24h": 24 * 60 * 60 * 1000,
      "7d": 7 * 24 * 60 * 60 * 1000,
      "30d": 30 * 24 * 60 * 60 * 1000,
    };
    const start = new Date(now.getTime() - durationMsByPreset[preset]);
    const nextFrom = toDatetimeLocalValue(start);
    const nextTo = toDatetimeLocalValue(now);
    setFrom(nextFrom);
    setTo(nextTo);
    replaceQuery({
      rca_preset: preset,
      rca_from: nextFrom,
      rca_to: nextTo,
      rca_filter: serializeRootCauseFilters(filters),
      rca_run: null,
      rca_insight: null,
    });
  };

  const persistRunQuery = useCallback((insightId?: string | null) => {
    replaceQuery({
      rca_anchor: anchorModelUri,
      rca_preset: windowPreset,
      rca_from: from,
      rca_to: to,
      rca_depth: depth,
      rca_outcome: selectedOutcomeEventType || null,
      rca_evidence_limit: evidenceLimit,
      rca_filter: serializeRootCauseFilters(filters),
      rca_run: "1",
      rca_insight: insightId || null,
    });
  }, [anchorModelUri, depth, evidenceLimit, filters, from, replaceQuery, selectedOutcomeEventType, to, windowPreset]);

  useEffect(() => {
    if (!run || !selectedInsightId) {
      return;
    }
    const isValidSelection = run.insights.some((insight) => insight.insight_id === selectedInsightId);
    if (isValidSelection) {
      return;
    }
    const fallbackInsightId = run.insights[0]?.insight_id ?? null;
    setSelectedInsightId(fallbackInsightId);
    persistRunQuery(fallbackInsightId);
  }, [persistRunQuery, run, selectedInsightId]);

  const loadEvidence = useCallback(async (insight: RootCauseInsightResultContract) => {
    const limit = parseEvidenceLimit(evidenceLimit);
    setEvidenceLoading(true);
    setEvidenceError(null);
    try {
      const response = await getRootCauseEvidence(insight.evidence_handle, limit);
      setEvidence(response);
    } catch (error) {
      setEvidence(null);
      setEvidenceError(error instanceof Error ? error.message : "Failed to load evidence traces.");
    } finally {
      setEvidenceLoading(false);
    }
  }, [evidenceLimit]);

  const runAnalysis = useCallback(async () => {
    if (!anchorObjectType) {
      setRunError("Select an anchor object model before running.");
      setRunState("error");
      return;
    }
    if (!selectedOutcomeEventType.trim()) {
      setRunError("Outcome event type is required.");
      setRunState("error");
      return;
    }
    if (!resolvedFrom || !resolvedTo) {
      setRunError("Select a valid time window before running.");
      setRunState("error");
      return;
    }
    if (resolvedFrom > resolvedTo) {
      setRunError("The start time must be earlier than the end time.");
      setRunState("error");
      return;
    }

    setRunState("running");
    setRunError(null);
    setSetupError(null);
    setEvidence(null);
    setEvidenceError(null);
    setInterpretation(null);
    setInterpretError(null);
    try {
      const outcomeEventTypeUri = selectedOutcomeEventType.trim();
      const response = await runRootCause({
        anchor_object_type: anchorModelUri,
        start_at: resolvedFrom,
        end_at: resolvedTo,
        depth: Number(depth),
        outcome: {
          event_type: outcomeEventTypeUri,
          object_type: anchorModelUri,
        },
        filters: activeFilterPayload,
      });
      setRun(response);
      const requestedInsightId = searchParams.get("rca_insight");
      const preferredInsight =
        response.insights.find((insight) => insight.insight_id === requestedInsightId) ||
        response.insights[0] ||
        null;
      if (preferredInsight) {
        setSelectedInsightId(preferredInsight.insight_id);
        persistRunQuery(preferredInsight.insight_id);
      } else {
        setSelectedInsightId(null);
        persistRunQuery(null);
      }
      setRunState("completed");
    } catch (error) {
      setRun(null);
      setRunState("error");
      setRunError(error instanceof Error ? error.message : "Root-cause analysis failed.");
      replaceQuery({
        rca_run: null,
        rca_insight: null,
      });
    }
  }, [
    activeFilterPayload,
    anchorModelUri,
    anchorObjectType,
    depth,
    persistRunQuery,
    replaceQuery,
    resolvedFrom,
    resolvedTo,
    searchParams,
    selectedOutcomeEventType,
  ]);

  const requestSuggestions = async () => {
    if (!anchorObjectType) {
      setSetupError("Select an anchor model before requesting suggestions.");
      return;
    }
    if (!resolvedFrom || !resolvedTo || resolvedFrom > resolvedTo) {
      setSetupError("Select a valid time window before requesting suggestions.");
      return;
    }
    setSetupLoading(true);
    setSetupError(null);
    try {
      const response = await assistRootCauseSetup({
        anchor_object_type: anchorModelUri,
        start_at: resolvedFrom,
        end_at: resolvedTo,
      });
      setSetupSuggestions(response.suggestions);
      setSetupNotes(response.notes);
      if (response.suggested_depth >= 1 && response.suggested_depth <= 3) {
        const nextDepth = String(response.suggested_depth);
        setDepth(nextDepth);
        replaceQuery({
          rca_depth: nextDepth,
          rca_filter: serializeRootCauseFilters(filters),
          rca_run: null,
          rca_insight: null,
        });
      }
    } catch (error) {
      setSetupSuggestions([]);
      setSetupNotes([]);
      setSetupError(error instanceof Error ? error.message : "Failed to load setup suggestions.");
    } finally {
      setSetupLoading(false);
    }
  };

  const runInterpretation = async () => {
    if (!run || run.insights.length === 0) {
      setInterpretError("Run analysis first to generate insights.");
      return;
    }
    setInterpretLoading(true);
    setInterpretError(null);
    try {
      const response = await assistRootCauseInterpret({
        baseline_rate: run.baseline_rate,
        insights: run.insights,
      });
      setInterpretation(response);
    } catch (error) {
      setInterpretation(null);
      setInterpretError(error instanceof Error ? error.message : "Failed to interpret insights.");
    } finally {
      setInterpretLoading(false);
    }
  };

  const addFilter = () => {
    setFilters((current) => [
      ...current,
      { id: `filter-${current.length}`, field: "", op: "contains" as RootCauseFilterOperator, value: "" },
    ]);
  };

  const updateFilter = (id: string, updates: Partial<FilterDraft>) => {
    setFilters((current) => current.map((filter) => (filter.id === id ? { ...filter, ...updates } : filter)));
  };

  const removeFilter = (id: string) => {
    setFilters((current) => (current.length <= 1 ? current : current.filter((filter) => filter.id !== id)));
  };

  const onSelectInsight = (insight: RootCauseInsightResultContract) => {
    setSelectedInsightId(insight.insight_id);
    persistRunQuery(insight.insight_id);
  };

  const onEvidenceLimitChange = (value: string) => {
    setEvidenceLimit(value);
    replaceQuery({
      rca_evidence_limit: value,
      rca_filter: serializeRootCauseFilters(filters),
      rca_run: run ? "1" : null,
      rca_insight: selectedInsight?.insight_id || null,
    });
  };

  const handleAnchorModelChange = (value: string) => {
    setAnchorModelUri(value);
    replaceQuery({
      rca_anchor: value,
      rca_filter: serializeRootCauseFilters(filters),
      rca_run: null,
      rca_insight: null,
    });
  };

  const handleFromChange = (value: string) => {
    setFrom(value);
    setWindowPreset("custom");
    replaceQuery({
      rca_from: value,
      rca_preset: "custom",
      rca_filter: serializeRootCauseFilters(filters),
      rca_run: null,
      rca_insight: null,
    });
  };

  const handleToChange = (value: string) => {
    setTo(value);
    setWindowPreset("custom");
    replaceQuery({
      rca_to: value,
      rca_preset: "custom",
      rca_filter: serializeRootCauseFilters(filters),
      rca_run: null,
      rca_insight: null,
    });
  };

  const handleDepthChange = (value: string) => {
    setDepth(value);
    replaceQuery({
      rca_depth: value,
      rca_filter: serializeRootCauseFilters(filters),
      rca_run: null,
      rca_insight: null,
    });
  };

  const handleOutcomeEventType = (value: string) => {
    const nextValue = value === OUTCOME_SENTINEL ? "" : value;
    setOutcomeEventType(nextValue);
    replaceQuery({
      rca_outcome: nextValue || null,
      rca_filter: serializeRootCauseFilters(filters),
      rca_run: null,
      rca_insight: null,
    });
  };

  useEffect(() => {
    if (!run || !selectedInsight) {
      evidenceSignatureRef.current = "";
      return;
    }
    const signature = `${selectedInsight.evidence_handle}|${evidenceLimit}`;
    if (evidenceSignatureRef.current === signature) {
      return;
    }
    evidenceSignatureRef.current = signature;
    void loadEvidence(selectedInsight);
  }, [evidenceLimit, loadEvidence, run, selectedInsight]);

  useEffect(() => {
    if (!isActive) {
      return;
    }
    if (searchParams.get("rca_run") !== "1") {
      autoRunSignatureRef.current = "";
      return;
    }
    if (!anchorModelUri || !anchorObjectType || !selectedOutcomeEventType.trim() || runState === "running") {
      return;
    }
    const signature = [
      anchorModelUri,
      depth,
      from,
      to,
      selectedOutcomeEventType,
      serializeRootCauseFilters(filters).join("|"),
    ].join("|");
    if (autoRunSignatureRef.current === signature) {
      return;
    }
    autoRunSignatureRef.current = signature;
    void runAnalysis();
  }, [
    anchorModelUri,
    anchorObjectType,
    depth,
    filters,
    from,
    isActive,
    runAnalysis,
    runState,
    searchParams,
    selectedOutcomeEventType,
    to,
  ]);

  useEffect(() => {
    if (!isActive || runState !== "completed" || !run) {
      return;
    }
    const signature = [
      anchorModelUri,
      from,
      to,
      depth,
      selectedOutcomeEventType,
      serializeRootCauseFilters(filters).join("|"),
      run.insights.length,
      run.cohort_size,
    ].join("|");
    if (completionSignatureRef.current === signature) {
      return;
    }
    completionSignatureRef.current = signature;
    window.requestAnimationFrame(() => {
      resultsSummaryRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, [anchorModelUri, depth, filters, from, isActive, run, runState, selectedOutcomeEventType, to]);

  const evidenceTraceRows = useMemo(
    () => (evidence?.traces || []).map((trace) => ({ trace, anchor: parseTraceAnchor(trace) })),
    [evidence]
  );

  const evidenceAnchorColumns = useMemo(() => {
    const seen = new Set<string>();
    const ordered: string[] = [];
    evidenceTraceRows.forEach(({ anchor }) => {
      Object.keys(anchor.keyParts).forEach((key) => {
        if (!seen.has(key)) {
          seen.add(key);
          ordered.push(key);
        }
      });
    });
    return ordered;
  }, [evidenceTraceRows]);

  return (
    <div className="space-y-6">
      <Card className="rounded-3xl border border-border bg-card p-8 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">Process Insights</p>
            <h1 className="mt-3 font-display text-3xl">Root-Cause Intelligence</h1>
            <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
              Find which attributes are most associated with a target failure outcome, then open trace evidence for
              each hypothesis.
            </p>
          </div>
          <Badge className="gap-2 rounded-full bg-muted px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em]">
            <Radar className="h-3 w-3" />
            WRAcc + Lift Ranking
          </Badge>
        </div>
      </Card>

      <Card className="rounded-2xl border border-border bg-card p-6 shadow-sm">
        <InspectorScopeFilters
          windowPreset={windowPreset}
          onApplyWindowPreset={applyWindowPreset}
          onCustomWindowChange={() => setWindowPreset("custom")}
          modelId="anchor-model"
          modelLabel="Anchor object model"
          modelValue={anchorModelUri}
          modelOptions={models.map((model) => ({ value: model.uri, label: model.name }))}
          onModelChange={handleAnchorModelChange}
          fromId="insights-from"
          fromValue={from}
          onFromChange={handleFromChange}
          toId="insights-to"
          toValue={to}
          onToChange={handleToChange}
          runLabel="Run insights"
          runningLabel="Running…"
          isRunning={runState === "running"}
          runDisabled={runState === "running"}
          onRun={runAnalysis}
          extraControl={
            <div className="space-y-2">
              <Label htmlFor="depth">Depth</Label>
              <Select value={depth} onValueChange={handleDepthChange}>
                <SelectTrigger id="depth">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">1</SelectItem>
                  <SelectItem value="2">2</SelectItem>
                  <SelectItem value="3">3</SelectItem>
                </SelectContent>
              </Select>
            </div>
          }
        />

        <div className="mt-4 grid gap-4 lg:grid-cols-[1.3fr_auto]">
          <div className="space-y-2">
            <Label htmlFor="outcome-event-type">Outcome event type</Label>
            <Select value={selectedOutcomeEventType || OUTCOME_SENTINEL} onValueChange={handleOutcomeEventType}>
              <SelectTrigger id="outcome-event-type">
                <SelectValue placeholder="Select event type" />
              </SelectTrigger>
              <SelectContent>
                {!selectedOutcomeEventType && (
                  <SelectItem value={OUTCOME_SENTINEL} disabled>
                    Select event type
                  </SelectItem>
                )}
                {outcomeOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label} • {option.source}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {outcomeOptions.length} ontology-linked event options for this object model.
            </p>
          </div>
          <div className="flex items-end gap-2">
            <Button variant="outline" onClick={requestSuggestions} disabled={setupLoading}>
              <Sparkles className="mr-2 h-4 w-4" />
              {setupLoading ? "Suggesting..." : "Suggest outcomes"}
            </Button>
            <Badge variant={runState === "error" ? "destructive" : "outline"}>{runState}</Badge>
          </div>
        </div>

        <div className="mt-5 rounded-2xl border border-border bg-muted/30 p-4">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              Cohort filters
            </p>
            <Button size="sm" variant="outline" onClick={addFilter}>
              Add filter
            </Button>
          </div>
          <div className="mt-3 space-y-3">
            {filters.map((filter) => {
              const operatorOptions = operatorOptionsForFilterField(filter.field);
              const selectedOperator = normalizeOperatorForFilterField(filter.field, filter.op);
              return (
                <div key={filter.id} className="grid gap-3 lg:grid-cols-[1fr_180px_1fr_auto]">
                  <Select
                    value={filter.field || FILTER_FIELD_SENTINEL}
                    onValueChange={(value) => {
                      const nextField = value === FILTER_FIELD_SENTINEL ? "" : value;
                      updateFilter(filter.id, {
                        field: nextField,
                        op: defaultOperatorForFilterField(nextField),
                        value: "",
                      });
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select filter field" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={FILTER_FIELD_SENTINEL}>Select filter field</SelectItem>
                      {filter.field &&
                        !filterFieldOptions.some((option) => option.value === filter.field) && (
                          <SelectItem value={filter.field}>
                            {`${displayFilterFieldLabel(filter.field)} (Current)`}
                          </SelectItem>
                        )}
                      {filterFieldOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select
                    value={selectedOperator}
                    onValueChange={(value) =>
                      updateFilter(filter.id, { op: value as RootCauseFilterOperator })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {operatorOptions.map((operator) => (
                        <SelectItem key={`${filter.id}-${operator.value}`} value={operator.value}>
                          {operator.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {suggestedValuesForFilterField(filter.field).length > 0 ? (
                    <Select
                      value={filter.value || FILTER_FIELD_SENTINEL}
                      onValueChange={(value) =>
                        updateFilter(filter.id, {
                          value: value === FILTER_FIELD_SENTINEL ? "" : value,
                        })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select value" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={FILTER_FIELD_SENTINEL}>Select value</SelectItem>
                        {suggestedValuesForFilterField(filter.field).map((value) => (
                          <SelectItem key={`${filter.id}-${value}`} value={value}>
                            {value}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input
                      placeholder="value"
                      value={filter.value}
                      onChange={(event) => updateFilter(filter.id, { value: event.target.value })}
                    />
                  )}
                  <Button
                    variant="ghost"
                    onClick={() => removeFilter(filter.id)}
                    disabled={filters.length <= 1}
                  >
                    Remove
                  </Button>
                </div>
              );
            })}
          </div>
        </div>

        {(runError || setupError) && (
          <div className="mt-4 space-y-2">
            {runError && (
              <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {runError}
              </div>
            )}
            {setupError && (
              <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                {setupError}
              </div>
            )}
          </div>
        )}
      </Card>

      {(setupSuggestions.length > 0 || setupNotes.length > 0) && (
        <Card className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            <SearchCheck className="h-4 w-4" />
            Suggested Outcome Definitions
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            {setupSuggestions.map((suggestion, index) => (
              <button
                key={`${suggestion.outcome.event_type}-${index}`}
                type="button"
                onClick={() => handleOutcomeEventType(suggestion.outcome.event_type)}
                className={cn(
                  "rounded-xl border border-border bg-background p-4 text-left transition-colors hover:bg-accent"
                )}
              >
                <p className="font-medium">
                  {displayEventType(suggestion.outcome.event_type)}
                </p>
                <p className="mt-2 text-xs text-muted-foreground">{suggestion.rationale}</p>
              </button>
            ))}
          </div>
          {setupNotes.length > 0 && (
            <div className="mt-4 rounded-xl border border-border bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
              {setupNotes.map((note, index) => (
                <p key={`${note}-${index}`}>{index + 1}. {note}</p>
              ))}
            </div>
          )}
        </Card>
      )}

      {run && (
        <>
          <div ref={resultsSummaryRef}>
            <Card className="rounded-2xl border border-primary/25 bg-card p-6 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">Results Ready</p>
                  <h2 className="mt-2 font-display text-2xl">Root-cause run completed</h2>
                  <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
                    Review ranked hypotheses first, then open evidence traces to inspect concrete supporting examples.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => rankedInsightsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}>
                    Jump to Ranked Insights
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => evidenceSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}>
                    Jump to Evidence
                  </Button>
                </div>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-xl border border-border bg-background px-4 py-3">
                  <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Hypotheses</p>
                  <p className="mt-2 text-sm font-medium">{run.insights.length}</p>
                </div>
                <div className="rounded-xl border border-border bg-background px-4 py-3">
                  <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Cohort size</p>
                  <p className="mt-2 text-sm font-medium">{run.cohort_size}</p>
                </div>
                <div className="rounded-xl border border-border bg-background px-4 py-3">
                  <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Positives</p>
                  <p className="mt-2 text-sm font-medium">{run.positive_count}</p>
                </div>
                <div className="rounded-xl border border-border bg-background px-4 py-3">
                  <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Warnings</p>
                  <p className="mt-2 text-sm font-medium">{run.warnings.length}</p>
                </div>
              </div>
            </Card>
          </div>

          <Card className="rounded-2xl border border-border bg-card p-6 shadow-sm">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
              <div className="rounded-xl border border-border bg-background px-4 py-3">
                <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Anchor</p>
                <p className="mt-2 text-sm font-medium">
                  {ontologyDisplay.displayObjectType(run.anchor_object_type)}
                </p>
              </div>
              <div className="rounded-xl border border-border bg-background px-4 py-3">
                <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Cohort</p>
                <p className="mt-2 text-sm font-medium">{run.cohort_size}</p>
              </div>
              <div className="rounded-xl border border-border bg-background px-4 py-3">
                <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Positives</p>
                <p className="mt-2 text-sm font-medium">{run.positive_count}</p>
              </div>
              <div className="rounded-xl border border-border bg-background px-4 py-3">
                <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Baseline rate</p>
                <p className="mt-2 text-sm font-medium">{toPercent(run.baseline_rate)}</p>
              </div>
              <div className="rounded-xl border border-border bg-background px-4 py-3">
                <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Feature count</p>
                <p className="mt-2 text-sm font-medium">{run.feature_count}</p>
              </div>
            </div>
            {run.warnings.length > 0 && (
              <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                {run.warnings.map((warning, index) => (
                  <p key={`${warning}-${index}`}>- {warning}</p>
                ))}
              </div>
            )}
          </Card>

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,0.9fr)]">
            <div ref={rankedInsightsRef}>
              <Card className="rounded-2xl border border-border bg-card p-6 shadow-sm">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                    Ranked Insights
                  </div>
                  <Badge variant="outline">{run.insights.length} hypotheses</Badge>
                </div>
                <Table.Root className="mt-4" variant="surface" striped>
                  <Table.Header>
                    <Table.Row>
                      <Table.ColumnHeaderCell>Hypothesis</Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell className="text-right">WRAcc</Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell className="text-right">Lift</Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell className="text-right">Coverage</Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell className="text-right">Support</Table.ColumnHeaderCell>
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    {run.insights.map((insight) => (
                      <Table.Row
                        key={insight.insight_id}
                        className={cn(
                          "cursor-pointer",
                          selectedInsight?.insight_id === insight.insight_id && "bg-accent"
                        )}
                        onClick={() => onSelectInsight(insight)}
                      >
                        <Table.RowHeaderCell>
                          <div className="max-w-[360px] truncate">
                            {insight.rank}. {insight.title}
                          </div>
                          <div className="text-[11px] text-muted-foreground">
                            positives {insight.score.positives} / support {insight.score.support}
                          </div>
                        </Table.RowHeaderCell>
                        <Table.Cell className="text-right text-xs">
                          {insight.score.wracc.toFixed(4)}
                        </Table.Cell>
                        <Table.Cell className="text-right text-xs">
                          {insight.score.lift.toFixed(2)}
                        </Table.Cell>
                        <Table.Cell className="text-right text-xs">
                          {toPercent(insight.score.coverage)}
                        </Table.Cell>
                        <Table.Cell className="text-right text-xs">{insight.score.support}</Table.Cell>
                      </Table.Row>
                    ))}
                    {run.insights.length === 0 && (
                      <Table.Row>
                        <Table.Cell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                          No ranked hypotheses for this run.
                        </Table.Cell>
                      </Table.Row>
                    )}
                  </Table.Body>
                </Table.Root>
              </Card>
            </div>

            <Card className="rounded-2xl border border-border bg-card p-6 shadow-sm">
              <div className="text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                Selected Insight
              </div>
              {!selectedInsight && (
                <div className="mt-4 rounded-xl border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
                  Select an insight to inspect details and evidence.
                </div>
              )}
              {selectedInsight && (
                <div className="mt-4 space-y-4">
                  <div>
                    <p className="font-medium">{selectedInsight.title}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{selectedInsight.caveat}</p>
                  </div>
                  <DataList.Root>
                    <DataList.Item>
                      <DataList.Label minWidth="132px">WRAcc</DataList.Label>
                      <DataList.Value>{selectedInsight.score.wracc.toFixed(4)}</DataList.Value>
                    </DataList.Item>
                    <DataList.Item>
                      <DataList.Label minWidth="132px">Lift</DataList.Label>
                      <DataList.Value>{selectedInsight.score.lift.toFixed(2)}</DataList.Value>
                    </DataList.Item>
                    <DataList.Item>
                      <DataList.Label minWidth="132px">Coverage</DataList.Label>
                      <DataList.Value>{toPercent(selectedInsight.score.coverage)}</DataList.Value>
                    </DataList.Item>
                    <DataList.Item>
                      <DataList.Label minWidth="132px">Subgroup rate</DataList.Label>
                      <DataList.Value>{toPercent(selectedInsight.score.subgroup_rate)}</DataList.Value>
                    </DataList.Item>
                  </DataList.Root>
                </div>
              )}
            </Card>
          </div>

          <div ref={evidenceSectionRef}>
            <Card className="rounded-2xl border border-border bg-card p-6 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  Evidence Traces
                </div>
                <div className="flex items-center gap-2">
                  <Label htmlFor="evidence-limit" className="text-xs text-muted-foreground">
                    Trace limit
                  </Label>
                  <Select value={evidenceLimit} onValueChange={onEvidenceLimitChange}>
                    <SelectTrigger id="evidence-limit" className="h-8 w-[110px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="5">5</SelectItem>
                      <SelectItem value="10">10</SelectItem>
                      <SelectItem value="25">25</SelectItem>
                      <SelectItem value="50">50</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {evidenceLoading && (
                <div className="mt-4 rounded-xl border border-border px-4 py-3 text-sm text-muted-foreground">
                  Loading evidence traces...
                </div>
              )}
              {evidenceError && (
                <div className="mt-4 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                  {evidenceError}
                </div>
              )}
              {evidence && !evidenceLoading && (
                <div className="mt-4">
                  <div className="mb-3 grid gap-3 md:grid-cols-3">
                    <div className="rounded-lg border border-border px-3 py-2 text-xs">
                      Matched anchors: <span className="text-foreground">{evidence.matched_anchor_count}</span>
                    </div>
                    <div className="rounded-lg border border-border px-3 py-2 text-xs">
                      Matched positives: <span className="text-foreground">{evidence.matched_positive_count}</span>
                    </div>
                    <div className="rounded-lg border border-border px-3 py-2 text-xs">
                      Truncated: <span className="text-foreground">{evidence.truncated ? "Yes" : "No"}</span>
                    </div>
                  </div>
                  <Table.Root variant="surface" size="1">
                    <Table.Header>
                      <Table.Row>
                        <Table.ColumnHeaderCell>Object Type</Table.ColumnHeaderCell>
                        {evidenceAnchorColumns.length > 0 ? (
                          evidenceAnchorColumns.map((key) => (
                            <Table.ColumnHeaderCell key={`anchor-col-${key}`}>
                              {displayFilterFieldLabel(key)}
                            </Table.ColumnHeaderCell>
                          ))
                        ) : (
                          <Table.ColumnHeaderCell>Reference</Table.ColumnHeaderCell>
                        )}
                        <Table.ColumnHeaderCell>Outcome</Table.ColumnHeaderCell>
                        <Table.ColumnHeaderCell>Events</Table.ColumnHeaderCell>
                        <Table.ColumnHeaderCell>Window</Table.ColumnHeaderCell>
                      </Table.Row>
                    </Table.Header>
                    <Table.Body>
                      {evidenceTraceRows.map(({ trace, anchor }) => {
                        return (
                          <Table.Row key={`${trace.anchor_key}:${trace.anchor_object_ref_hash}`}>
                            <Table.RowHeaderCell>
                              <div>{ontologyDisplay.displayObjectType(anchor.objectType)}</div>
                            </Table.RowHeaderCell>
                            {evidenceAnchorColumns.length > 0 ? (
                              evidenceAnchorColumns.map((key) => (
                                <Table.Cell key={`${trace.anchor_key}:${key}`} className="max-w-[220px]">
                                  <div className="truncate text-xs font-medium">
                                    {anchor.keyParts[key] || "—"}
                                  </div>
                                </Table.Cell>
                              ))
                            ) : (
                              <Table.Cell className="max-w-[260px]">
                                <div className="truncate text-xs font-medium">{anchor.fallbackRef || "—"}</div>
                              </Table.Cell>
                            )}
                            <Table.Cell>
                              <Badge variant={trace.outcome ? "default" : "secondary"}>
                                {trace.outcome ? "Positive" : "Negative"}
                              </Badge>
                            </Table.Cell>
                            <Table.Cell className="max-w-[380px]">
                              <div className="truncate text-xs">
                                {summarizeTraceEvents(trace.events, displayEventType)}
                              </div>
                              <div className="text-[11px] text-muted-foreground">
                                {trace.events.length} events
                              </div>
                            </Table.Cell>
                            <Table.Cell className="text-xs">
                              <div>{formatDateTime(trace.events[0]?.occurred_at)}</div>
                              <div className="text-muted-foreground">
                                {formatDateTime(trace.events[trace.events.length - 1]?.occurred_at)}
                              </div>
                            </Table.Cell>
                          </Table.Row>
                        );
                      })}
                      {evidence.traces.length === 0 && (
                        <Table.Row>
                          <Table.Cell
                            colSpan={4 + (evidenceAnchorColumns.length > 0 ? evidenceAnchorColumns.length : 1)}
                            className="py-6 text-center text-sm text-muted-foreground"
                          >
                            No evidence traces for this insight.
                          </Table.Cell>
                        </Table.Row>
                      )}
                    </Table.Body>
                  </Table.Root>
                </div>
              )}
            </Card>
          </div>

          <Card className="rounded-2xl border border-border bg-card p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                <Bot className="h-4 w-4" />
                AI Interpretation
              </div>
              <Button variant="outline" onClick={runInterpretation} disabled={interpretLoading || run.insights.length === 0}>
                <FlaskConical className="mr-2 h-4 w-4" />
                {interpretLoading ? "Interpreting..." : "Interpret run"}
              </Button>
            </div>
            {interpretError && (
              <div className="mt-4 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {interpretError}
              </div>
            )}
            {interpretation && (
              <div className="mt-4 space-y-3">
                <div className="rounded-xl border border-border bg-background px-4 py-3 text-sm">
                  {interpretation.summary}
                </div>
                {interpretation.caveats.length > 0 && (
                  <div className="rounded-xl border border-border bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
                    <p className="mb-1 font-semibold uppercase tracking-[0.2em]">Caveats</p>
                    {interpretation.caveats.map((caveat, index) => (
                      <p key={`${caveat}-${index}`}>- {caveat}</p>
                    ))}
                  </div>
                )}
                {interpretation.next_steps.length > 0 && (
                  <div className="rounded-xl border border-border bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
                    <p className="mb-1 font-semibold uppercase tracking-[0.2em]">Next steps</p>
                    {interpretation.next_steps.map((step, index) => (
                      <p key={`${step}-${index}`}>{index + 1}. {step}</p>
                    ))}
                  </div>
                )}
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
