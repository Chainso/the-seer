"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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

const EVENT_NODE_LABELS = new Set(["Event", "Signal", "Transition"]);
const OUTCOME_SENTINEL = "__select_outcome__";
const FILTER_FIELD_SENTINEL = "__select_filter_field__";

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

function toPascalToken(value: string): string {
  return value
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((token) => token[0]?.toUpperCase() + token.slice(1))
    .join("");
}

function legacyObjectTypeFromUri(uri: string): string {
  const localName = iriLocalName(uri).replace(/^obj[_:-]?/i, "");
  const canonical = toPascalToken(localName);
  return canonical || iriLocalName(uri);
}

function legacyEventTypeFromLocalName(localName: string): string {
  if (localName.startsWith("trans_")) {
    return `${toPascalToken(localName.slice("trans_".length))}Transition`;
  }
  if (localName.startsWith("aout_")) {
    return `${toPascalToken(localName.slice("aout_".length))}Result`;
  }
  if (localName.startsWith("ain_")) {
    return `${toPascalToken(localName.slice("ain_".length))}Command`;
  }
  if (localName.startsWith("sig_")) {
    return toPascalToken(localName.slice("sig_".length));
  }
  if (localName.startsWith("evt_")) {
    return toPascalToken(localName.slice("evt_".length));
  }
  return "";
}

function legacyEventTypeFromUri(uri: string): string {
  const localName = iriLocalName(uri).trim();
  if (!localName) {
    return uri;
  }
  return legacyEventTypeFromLocalName(localName) || localName;
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

export function ProcessInsightsPanel() {
  const ontologyDisplay = useOntologyDisplay();
  const [ontologyGraph, setOntologyGraph] = useState<OntologyGraph | null>(null);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [anchorModelUri, setAnchorModelUri] = useState("");
  const [windowPreset, setWindowPreset] = useState<SharedWindowPreset>("24h");
  const [from, setFrom] = useState(() => {
    const now = new Date();
    return toDatetimeLocalValue(new Date(now.getTime() - 24 * 60 * 60 * 1000));
  });
  const [to, setTo] = useState(() => toDatetimeLocalValue(new Date()));
  const [depth, setDepth] = useState("1");
  const [outcomeEventType, setOutcomeEventType] = useState("");
  const [filters, setFilters] = useState<FilterDraft[]>([
    { id: "filter-0", field: "", op: "contains", value: "" },
  ]);
  const [evidenceLimit, setEvidenceLimit] = useState("10");

  const [runState, setRunState] = useState<RunState>("idle");
  const [runError, setRunError] = useState<string | null>(null);
  const [run, setRun] = useState<RootCauseRunResponseContract | null>(null);

  const [selectedInsightId, setSelectedInsightId] = useState<string | null>(null);
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
              objectType: legacyObjectTypeFromUri(node.uri),
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
      const value = (suggestion.outcome.event_type_uri || suggestion.outcome.event_type || "").trim();
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
    if (!outcomeEventType) {
      return;
    }
    const stillApplicable = baseOutcomeOptions.some((option) => option.value === outcomeEventType);
    if (!stillApplicable) {
      setOutcomeEventType("");
    }
  }, [baseOutcomeOptions, outcomeEventType]);

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
    setFrom(toDatetimeLocalValue(start));
    setTo(toDatetimeLocalValue(now));
  };

  const loadEvidence = async (insight: RootCauseInsightResultContract, limitOverride?: number) => {
    const limit = limitOverride || parseEvidenceLimit(evidenceLimit);
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
  };

  const runAnalysis = async () => {
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
        anchor_object_type: anchorObjectType,
        anchor_object_type_uri: anchorModelUri,
        start_at: new Date(from).toISOString(),
        end_at: new Date(to).toISOString(),
        depth: Number(depth),
        outcome: {
          event_type: legacyEventTypeFromUri(outcomeEventTypeUri),
          event_type_uri: outcomeEventTypeUri,
          object_type: anchorObjectType,
          object_type_uri: anchorModelUri,
        },
        filters: activeFilterPayload,
      });
      setRun(response);
      const firstInsight = response.insights[0] || null;
      if (firstInsight) {
        setSelectedInsightId(firstInsight.insight_id);
        void loadEvidence(firstInsight);
      } else {
        setSelectedInsightId(null);
      }
      setRunState("completed");
    } catch (error) {
      setRun(null);
      setRunState("error");
      setRunError(error instanceof Error ? error.message : "Root-cause analysis failed.");
    }
  };

  const requestSuggestions = async () => {
    if (!anchorObjectType) {
      setSetupError("Select an anchor model before requesting suggestions.");
      return;
    }
    setSetupLoading(true);
    setSetupError(null);
    try {
      const response = await assistRootCauseSetup({
        anchor_object_type: anchorObjectType,
        anchor_object_type_uri: anchorModelUri,
        start_at: new Date(from).toISOString(),
        end_at: new Date(to).toISOString(),
      });
      setSetupSuggestions(response.suggestions);
      setSetupNotes(response.notes);
      if (response.suggested_depth >= 1 && response.suggested_depth <= 3) {
        setDepth(String(response.suggested_depth));
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
      { id: `filter-${Date.now()}`, field: "", op: "contains", value: "" },
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
    void loadEvidence(insight);
  };

  const onEvidenceLimitChange = (value: string) => {
    setEvidenceLimit(value);
    if (!selectedInsight) {
      return;
    }
    void loadEvidence(selectedInsight, parseEvidenceLimit(value));
  };

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
          onModelChange={setAnchorModelUri}
          fromId="insights-from"
          fromValue={from}
          onFromChange={setFrom}
          toId="insights-to"
          toValue={to}
          onToChange={setTo}
          runLabel="Run insights"
          runningLabel="Running..."
          isRunning={runState === "running"}
          runDisabled={runState === "running"}
          onRun={runAnalysis}
          extraControl={
            <div className="space-y-2">
              <Label htmlFor="depth">Depth</Label>
              <Select value={depth} onValueChange={setDepth}>
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
            <Select value={selectedOutcomeEventType || OUTCOME_SENTINEL} onValueChange={setOutcomeEventType}>
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
                <Select value={selectedOperator} onValueChange={(value) => updateFilter(filter.id, { op: value as RootCauseFilterOperator })}>
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
                  <Select value={filter.value || FILTER_FIELD_SENTINEL} onValueChange={(value) => updateFilter(filter.id, { value: value === FILTER_FIELD_SENTINEL ? "" : value })}>
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
                <Button variant="ghost" onClick={() => removeFilter(filter.id)} disabled={filters.length <= 1}>
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
                key={`${suggestion.outcome.event_type_uri || suggestion.outcome.event_type}-${index}`}
                type="button"
                onClick={() =>
                  setOutcomeEventType(suggestion.outcome.event_type_uri || suggestion.outcome.event_type)
                }
                className={cn(
                  "rounded-xl border border-border bg-background p-4 text-left transition-colors hover:bg-accent"
                )}
              >
                <p className="font-medium">
                  {displayEventType(suggestion.outcome.event_type_uri || suggestion.outcome.event_type)}
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
          <Card className="rounded-2xl border border-border bg-card p-6 shadow-sm">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
              <div className="rounded-xl border border-border bg-background px-4 py-3">
                <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Anchor</p>
                <p className="mt-2 text-sm font-medium">{run.anchor_object_type}</p>
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
            <Card className="rounded-2xl border border-border bg-card p-6 shadow-sm">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  Ranked Insights
                </div>
                <Badge variant="outline">{run.insights.length} hypotheses</Badge>
              </div>
              <Table.Root className="mt-4" variant="surface">
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
                      <Table.Cell className="text-right text-xs">{insight.score.wracc.toFixed(4)}</Table.Cell>
                      <Table.Cell className="text-right text-xs">{insight.score.lift.toFixed(2)}</Table.Cell>
                      <Table.Cell className="text-right text-xs">{toPercent(insight.score.coverage)}</Table.Cell>
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
                                <div className="truncate text-xs font-medium">{anchor.keyParts[key] || "—"}</div>
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
                            <div className="text-[11px] text-muted-foreground">{trace.events.length} events</div>
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
