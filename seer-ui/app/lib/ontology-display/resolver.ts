import type { OntologyDisplayCatalog, OntologyDisplayObjectModel } from "./catalog";
import {
  iriLocalName,
  normalizeComparableToken,
  normalizeToken,
  preferredOntologyName,
  tokenVariants,
} from "./catalog";

export type OntologyDisplayFieldKind = "string" | "number" | "count" | "boolean" | "temporal";
export type OntologyDisplayOperator = "eq" | "ne" | "contains" | "gt" | "gte" | "lt" | "lte";
export type OntologyDisplayOperatorProfile = "history" | "insights";
export type OntologyDisplayOperatorOption = { value: OntologyDisplayOperator; label: string };

export type OntologyDisplayResolveContext = {
  objectType?: string | null;
  eventType?: string | null;
};

export type OntologyDisplayValueContext = OntologyDisplayResolveContext & {
  stateLabelByToken?: Map<string, string>;
};

export type OntologyDisplayFieldKindContext = OntologyDisplayResolveContext & {
  knownFieldKinds?:
    | Map<string, OntologyDisplayFieldKind>
    | Partial<Record<string, OntologyDisplayFieldKind>>;
  valueTypeHints?: Array<string | undefined>;
};

export type OntologyDisplayOperatorContext = OntologyDisplayFieldKindContext & {
  profile?: OntologyDisplayOperatorProfile;
};

export type OntologyDisplayLifecycleLabelMode = "plain" | "explicit";

export type OntologyDisplayLifecycleOptions = {
  lifecycleLabelMode?: OntologyDisplayLifecycleLabelMode;
};

export type OntologyDisplayConceptContext = OntologyDisplayLifecycleOptions & {
  conceptKind?: string | null;
  conceptLabel?: string | null;
};

export type OntologyDisplayNodeLike = {
  uri: string;
  label?: string | null;
  properties?: Record<string, unknown> | null;
};

export type OntologyDisplayResolver = {
  catalog: OntologyDisplayCatalog;
  resolveObjectModel: (objectType: string | null | undefined) => OntologyDisplayObjectModel | null;
  displayObjectType: (objectType: string | null | undefined) => string;
  displayEventType: (
    eventType: string | null | undefined,
    options?: { fallbackObjectType?: string }
  ) => string;
  displayConcept: (
    conceptType: string | null | undefined,
    options?: OntologyDisplayConceptContext
  ) => string;
  displayNode: (node: OntologyDisplayNodeLike | null | undefined, options?: OntologyDisplayLifecycleOptions) => string;
  fieldLabelsForObjectType: (objectType: string | null | undefined) => Map<string, string> | undefined;
  fieldLabelsForEventType: (eventType: string | null | undefined) => Map<string, string> | undefined;
  mergedFieldLabels: (context?: OntologyDisplayResolveContext) => Map<string, string>;
  displayFieldLabel: (key: string, context?: OntologyDisplayResolveContext) => string;
  displayFieldValue: (key: string, value: unknown, context?: OntologyDisplayValueContext) => unknown;
  summarizeObjectRef: (
    ref: Record<string, unknown>,
    context?: OntologyDisplayResolveContext
  ) => string;
  summarizePayload: (
    payload: Record<string, unknown> | null | undefined,
    context?: OntologyDisplayValueContext
  ) => string;
  fieldKindForKey: (key: string, options?: OntologyDisplayFieldKindContext) => OntologyDisplayFieldKind;
  operatorOptionsForField: (
    key: string,
    options?: OntologyDisplayOperatorContext
  ) => OntologyDisplayOperatorOption[];
  defaultOperatorForField: (
    key: string,
    options?: OntologyDisplayOperatorContext
  ) => OntologyDisplayOperator;
  normalizeOperatorForField: (
    key: string,
    operator: OntologyDisplayOperator,
    options?: OntologyDisplayOperatorContext
  ) => OntologyDisplayOperator;
};

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

const OPERATOR_OPTIONS: Array<OntologyDisplayOperatorOption> = [
  { value: "eq", label: "Equals" },
  { value: "ne", label: "Not equals" },
  { value: "contains", label: "Contains" },
  { value: "gt", label: "Greater than" },
  { value: "gte", label: "Greater or equal" },
  { value: "lt", label: "Less than" },
  { value: "lte", label: "Less or equal" },
];

const OPERATORS_BY_PROFILE_AND_KIND: Record<
  OntologyDisplayOperatorProfile,
  Record<OntologyDisplayFieldKind, OntologyDisplayOperator[]>
> = {
  history: {
    string: ["eq", "contains"],
    number: ["eq", "contains", "gt", "gte", "lt", "lte"],
    count: ["eq", "gt", "gte", "lt", "lte"],
    boolean: ["eq"],
    temporal: ["eq", "gt", "gte", "lt", "lte"],
  },
  insights: {
    string: ["eq", "ne", "contains"],
    number: ["eq", "ne", "contains", "gt", "gte", "lt", "lte"],
    count: ["eq", "ne", "gt", "gte", "lt", "lte"],
    boolean: ["eq", "ne"],
    temporal: ["eq", "ne", "gt", "gte", "lt", "lte"],
  },
};

function mapLookupByComparable<T>(lookup: Map<string, T>, key: string): T | undefined {
  const direct = lookup.get(key);
  if (direct !== undefined) {
    return direct;
  }
  const comparable = normalizeComparableToken(key);
  if (!comparable) {
    return undefined;
  }
  for (const [candidateKey, candidateValue] of lookup.entries()) {
    if (normalizeComparableToken(candidateKey) === comparable) {
      return candidateValue;
    }
  }
  return undefined;
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
  const normalized = normalizeComparableToken(key);
  return normalized === "state" || normalized === "fromstate" || normalized === "tostate";
}

function formatStateLabel(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return value;
  }
  return trimmed
    .replace(/[_-]+/g, " ")
    .split(/\s+/)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

function resolveObjectModel(
  catalog: OntologyDisplayCatalog,
  objectType: string | null | undefined
): OntologyDisplayObjectModel | null {
  if (!objectType || !objectType.trim()) {
    return null;
  }
  return (
    catalog.objectModelByToken.get(normalizeToken(objectType)) ||
    catalog.objectModelByToken.get(normalizeComparableToken(objectType)) ||
    null
  );
}

function lookupConceptLabel(catalog: OntologyDisplayCatalog, value: string): string | null {
  for (const token of tokenVariants(value)) {
    const mapped = catalog.conceptLabelByToken.get(token);
    if (mapped) {
      return mapped;
    }
  }
  return null;
}

function resolveOwnerObjectByConcept(
  conceptType: string,
  ownerByUri: Map<string, OntologyDisplayObjectModel>,
  ownerByToken: Map<string, OntologyDisplayObjectModel>
): OntologyDisplayObjectModel | null {
  const byUri = ownerByUri.get(conceptType);
  if (byUri) {
    return byUri;
  }
  for (const token of tokenVariants(conceptType)) {
    const mapped = ownerByToken.get(token);
    if (mapped) {
      return mapped;
    }
  }
  return null;
}

function resolveStateOwnerObject(
  catalog: OntologyDisplayCatalog,
  conceptType: string
): OntologyDisplayObjectModel | null {
  return resolveOwnerObjectByConcept(
    conceptType,
    catalog.stateOwnerObjectByUri,
    catalog.stateOwnerObjectByToken
  );
}

function resolveTransitionOwnerObject(
  catalog: OntologyDisplayCatalog,
  conceptType: string
): OntologyDisplayObjectModel | null {
  return resolveOwnerObjectByConcept(
    conceptType,
    catalog.transitionOwnerObjectByUri,
    catalog.transitionOwnerObjectByToken
  );
}

function lifecycleLabelMode(options?: OntologyDisplayLifecycleOptions): OntologyDisplayLifecycleLabelMode {
  return options?.lifecycleLabelMode === "explicit" ? "explicit" : "plain";
}

function resolveConceptLabel(
  catalog: OntologyDisplayCatalog,
  conceptType: string,
  conceptLabel?: string | null
): string {
  if (typeof conceptLabel === "string" && conceptLabel.trim()) {
    return conceptLabel.trim();
  }
  const ontologyLabel = lookupConceptLabel(catalog, conceptType);
  if (ontologyLabel) {
    return ontologyLabel;
  }
  return iriLocalName(conceptType);
}

function displayConcept(
  catalog: OntologyDisplayCatalog,
  conceptType: string | null | undefined,
  options?: OntologyDisplayConceptContext
): string {
  if (!conceptType || !conceptType.trim()) {
    return "—";
  }

  const baseLabel = resolveConceptLabel(catalog, conceptType, options?.conceptLabel);
  if (lifecycleLabelMode(options) !== "explicit") {
    return baseLabel;
  }

  const normalizedKind = normalizeComparableToken(options?.conceptKind || "");
  if (normalizedKind && normalizedKind !== "state" && normalizedKind !== "transition") {
    return baseLabel;
  }

  if (normalizedKind === "state") {
    const owner = resolveStateOwnerObject(catalog, conceptType);
    return owner ? `${owner.name} ${baseLabel}` : baseLabel;
  }
  if (normalizedKind === "transition") {
    const owner = resolveTransitionOwnerObject(catalog, conceptType);
    return owner ? `${baseLabel} ${owner.name}` : baseLabel;
  }

  const stateOwner = resolveStateOwnerObject(catalog, conceptType);
  if (stateOwner) {
    return `${stateOwner.name} ${baseLabel}`;
  }
  const transitionOwner = resolveTransitionOwnerObject(catalog, conceptType);
  if (transitionOwner) {
    return `${baseLabel} ${transitionOwner.name}`;
  }
  return baseLabel;
}

function displayNode(
  catalog: OntologyDisplayCatalog,
  node: OntologyDisplayNodeLike | null | undefined,
  options?: OntologyDisplayLifecycleOptions
): string {
  if (!node?.uri || !node.uri.trim()) {
    return "—";
  }
  const conceptLabel = preferredOntologyName(node.properties || undefined);
  return displayConcept(catalog, node.uri, {
    conceptKind: node.label || null,
    conceptLabel,
    lifecycleLabelMode: options?.lifecycleLabelMode,
  });
}

function displayObjectType(catalog: OntologyDisplayCatalog, objectType: string | null | undefined): string {
  if (!objectType || !objectType.trim()) {
    return "—";
  }
  const model = resolveObjectModel(catalog, objectType);
  if (model) {
    return model.name;
  }
  const ontologyLabel = lookupConceptLabel(catalog, objectType);
  if (ontologyLabel) {
    return ontologyLabel;
  }
  return iriLocalName(objectType);
}

function displayEventType(
  catalog: OntologyDisplayCatalog,
  eventType: string | null | undefined,
  options?: { fallbackObjectType?: string }
): string {
  if (!eventType || !eventType.trim()) {
    return "Unknown event";
  }

  for (const token of tokenVariants(eventType)) {
    const mapped = catalog.eventTypeLabelByToken.get(token);
    if (mapped) {
      return mapped;
    }
  }

  const ontologyLabel = lookupConceptLabel(catalog, eventType);
  if (ontologyLabel) {
    return ontologyLabel;
  }

  const [entityToken, actionToken] = eventType.split(".", 2);
  if (entityToken && actionToken) {
    const objectLabel = displayObjectType(catalog, options?.fallbackObjectType || entityToken);
    return `${objectLabel} ${actionToken}`;
  }
  return iriLocalName(eventType);
}

function fieldLabelsForObjectType(
  catalog: OntologyDisplayCatalog,
  objectType: string | null | undefined
): Map<string, string> | undefined {
  const model = resolveObjectModel(catalog, objectType);
  if (model) {
    return model.fieldLabelByKey;
  }
  if (!objectType || !objectType.trim()) {
    return undefined;
  }
  for (const token of tokenVariants(objectType)) {
    const mapped = catalog.conceptFieldLabelsByToken.get(token);
    if (mapped) {
      return mapped;
    }
  }
  return undefined;
}

function fieldLabelsForEventType(
  catalog: OntologyDisplayCatalog,
  eventType: string | null | undefined
): Map<string, string> | undefined {
  if (!eventType || !eventType.trim()) {
    return undefined;
  }
  for (const token of tokenVariants(eventType)) {
    const mapped = catalog.conceptFieldLabelsByToken.get(token);
    if (mapped) {
      return mapped;
    }
  }
  return undefined;
}

function mergedFieldLabels(
  catalog: OntologyDisplayCatalog,
  context?: OntologyDisplayResolveContext
): Map<string, string> {
  const merged = new Map<string, string>(catalog.globalFieldLabelByKey);
  const objectLabels = fieldLabelsForObjectType(catalog, context?.objectType);
  const eventLabels = fieldLabelsForEventType(catalog, context?.eventType);
  for (const [key, label] of objectLabels?.entries() || []) {
    merged.set(key, label);
  }
  for (const [key, label] of eventLabels?.entries() || []) {
    merged.set(key, label);
  }
  return merged;
}

function resolveFieldLabelFromLookup(fieldLabelByKey: Map<string, string>, key: string): string | undefined {
  const exact = mapLookupByComparable(fieldLabelByKey, key);
  if (exact) {
    return exact;
  }

  const suffixRules: Array<{
    suffix: string;
    decorate: (label: string) => string;
    extras?: string[];
  }> = [
    { suffix: "_id", decorate: (label) => `${label} ID` },
    { suffix: "_count", decorate: (label) => `${label} Count`, extras: ["s"] },
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
      const baseLabel = mapLookupByComparable(fieldLabelByKey, candidate);
      if (baseLabel) {
        return rule.decorate(baseLabel);
      }
    }
  }

  return undefined;
}

function displayFilterFieldLabel(
  catalog: OntologyDisplayCatalog,
  key: string,
  context?: OntologyDisplayResolveContext
): string | null {
  if (key.startsWith("anchor.")) {
    return `Anchor • ${displayFieldLabel(catalog, key.slice("anchor.".length), context)}`;
  }
  if (key.startsWith("object_type.count.")) {
    return `Object count bucket • ${displayObjectType(
      catalog,
      key.slice("object_type.count.".length)
    )}`;
  }
  if (key.startsWith("event.present.")) {
    return `Event present • ${displayEventType(catalog, key.slice("event.present.".length), {
      fallbackObjectType: context?.objectType || undefined,
    })}`;
  }
  if (key.startsWith("event.count.")) {
    return `Event count bucket • ${displayEventType(catalog, key.slice("event.count.".length), {
      fallbackObjectType: context?.objectType || undefined,
    })}`;
  }
  return null;
}

function displayFieldLabel(
  catalog: OntologyDisplayCatalog,
  key: string,
  context?: OntologyDisplayResolveContext
): string {
  const filterLabel = displayFilterFieldLabel(catalog, key, context);
  if (filterLabel) {
    return filterLabel;
  }

  if (isStateLikeFieldKey(key)) {
    return fallbackFieldLabel(key);
  }
  const label = resolveFieldLabelFromLookup(mergedFieldLabels(catalog, context), key);
  return label || fallbackFieldLabel(key);
}

function resolveStateLabelMap(
  catalog: OntologyDisplayCatalog,
  context: OntologyDisplayValueContext | undefined
): Map<string, string> | undefined {
  if (context?.stateLabelByToken) {
    return context.stateLabelByToken;
  }
  return resolveObjectModel(catalog, context?.objectType)?.stateLabelByToken;
}

function displayFieldValue(
  catalog: OntologyDisplayCatalog,
  key: string,
  value: unknown,
  context?: OntologyDisplayValueContext
): unknown {
  if (typeof value !== "string" || !value.trim()) {
    return value;
  }
  if (!isStateLikeFieldKey(key)) {
    return value;
  }
  const stateLabelByToken = resolveStateLabelMap(catalog, context);
  if (!stateLabelByToken) {
    return formatStateLabel(value);
  }
  const mapped =
    stateLabelByToken.get(normalizeToken(value)) ||
    stateLabelByToken.get(normalizeComparableToken(value));
  return mapped || formatStateLabel(value);
}

function stringifyDisplayValue(value: unknown): string {
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

function summarizeObjectRef(
  catalog: OntologyDisplayCatalog,
  ref: Record<string, unknown>,
  context?: OntologyDisplayResolveContext
): string {
  const entries = Object.entries(ref);
  if (entries.length === 0) {
    return "—";
  }
  return entries
    .slice(0, 2)
    .map(([key, value]) => {
      const label = displayFieldLabel(catalog, key, context);
      return `${label} · ${stringifyDisplayValue(value)}`;
    })
    .join(" | ");
}

function summarizePayload(
  catalog: OntologyDisplayCatalog,
  payload: Record<string, unknown> | null | undefined,
  context?: OntologyDisplayValueContext
): string {
  if (!payload) {
    return "—";
  }
  const entries = Object.entries(payload).filter(([, value]) =>
    ["string", "number", "boolean"].includes(typeof value)
  );
  if (entries.length === 0) {
    return "—";
  }
  return entries
    .slice(0, 3)
    .map(([key, value]) => {
      const label = displayFieldLabel(catalog, key, context);
      const displayValue = displayFieldValue(catalog, key, value, context);
      return `${label} · ${stringifyDisplayValue(displayValue)}`;
    })
    .join(" | ");
}

function kindFromTypeToken(token: string): OntologyDisplayFieldKind {
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

function fieldKindFromTypeHints(hints: Array<string | undefined>): OntologyDisplayFieldKind {
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

function resolveKnownFieldKind(
  key: string,
  knownFieldKinds:
    | Map<string, OntologyDisplayFieldKind>
    | Partial<Record<string, OntologyDisplayFieldKind>>
): OntologyDisplayFieldKind | undefined {
  if (knownFieldKinds instanceof Map) {
    return (
      knownFieldKinds.get(key) ||
      knownFieldKinds.get(normalizeToken(key)) ||
      knownFieldKinds.get(normalizeComparableToken(key))
    );
  }
  if (knownFieldKinds[key]) {
    return knownFieldKinds[key];
  }
  const normalized = normalizeToken(key);
  if (knownFieldKinds[normalized]) {
    return knownFieldKinds[normalized];
  }
  const comparable = normalizeComparableToken(key);
  if (knownFieldKinds[comparable]) {
    return knownFieldKinds[comparable];
  }
  return undefined;
}

function resolveObjectPropertyValueType(
  catalog: OntologyDisplayCatalog,
  key: string,
  objectType: string | null | undefined
): string | undefined {
  const model = resolveObjectModel(catalog, objectType);
  if (!model) {
    return undefined;
  }
  const direct = model.propertyValueTypeByKey.get(key);
  if (direct) {
    return direct;
  }
  return mapLookupByComparable(model.propertyValueTypeByKey, key);
}

function fieldKindForKey(
  catalog: OntologyDisplayCatalog,
  key: string,
  options?: OntologyDisplayFieldKindContext
): OntologyDisplayFieldKind {
  if (!key) {
    return "string";
  }

  if (options?.knownFieldKinds) {
    const knownKind = resolveKnownFieldKind(key, options.knownFieldKinds);
    if (knownKind) {
      return knownKind;
    }
  }

  if (key.startsWith("event.present.")) {
    return "boolean";
  }
  if (key.startsWith("event.count.") || key.startsWith("object_type.count.")) {
    return "count";
  }

  const kindFromModel = fieldKindFromTypeHints([
    resolveObjectPropertyValueType(catalog, key, options?.objectType),
  ]);
  if (kindFromModel !== "string") {
    return kindFromModel;
  }

  const kindFromHints = fieldKindFromTypeHints(options?.valueTypeHints || []);
  if (kindFromHints !== "string") {
    return kindFromHints;
  }
  return "string";
}

function operatorOptionsForField(
  catalog: OntologyDisplayCatalog,
  key: string,
  options?: OntologyDisplayOperatorContext
): OntologyDisplayOperatorOption[] {
  const profile = options?.profile || "insights";
  const kind = fieldKindForKey(catalog, key, options);
  const allowed = new Set(OPERATORS_BY_PROFILE_AND_KIND[profile][kind]);
  return OPERATOR_OPTIONS.filter((option) => allowed.has(option.value));
}

function defaultOperatorForField(
  catalog: OntologyDisplayCatalog,
  key: string,
  options?: OntologyDisplayOperatorContext
): OntologyDisplayOperator {
  const optionsForField = operatorOptionsForField(catalog, key, options);
  return optionsForField[0]?.value || (options?.profile === "history" ? "eq" : "contains");
}

function normalizeOperatorForField(
  catalog: OntologyDisplayCatalog,
  key: string,
  operator: OntologyDisplayOperator,
  options?: OntologyDisplayOperatorContext
): OntologyDisplayOperator {
  const optionsForField = operatorOptionsForField(catalog, key, options);
  if (optionsForField.some((option) => option.value === operator)) {
    return operator;
  }
  return defaultOperatorForField(catalog, key, options);
}

export function createOntologyDisplayResolver(catalog: OntologyDisplayCatalog): OntologyDisplayResolver {
  return {
    catalog,
    resolveObjectModel: (objectType) => resolveObjectModel(catalog, objectType),
    displayObjectType: (objectType) => displayObjectType(catalog, objectType),
    displayEventType: (eventType, options) => displayEventType(catalog, eventType, options),
    displayConcept: (conceptType, options) => displayConcept(catalog, conceptType, options),
    displayNode: (node, options) => displayNode(catalog, node, options),
    fieldLabelsForObjectType: (objectType) => fieldLabelsForObjectType(catalog, objectType),
    fieldLabelsForEventType: (eventType) => fieldLabelsForEventType(catalog, eventType),
    mergedFieldLabels: (context) => mergedFieldLabels(catalog, context),
    displayFieldLabel: (key, context) => displayFieldLabel(catalog, key, context),
    displayFieldValue: (key, value, context) => displayFieldValue(catalog, key, value, context),
    summarizeObjectRef: (ref, context) => summarizeObjectRef(catalog, ref, context),
    summarizePayload: (payload, context) => summarizePayload(catalog, payload, context),
    fieldKindForKey: (key, options) => fieldKindForKey(catalog, key, options),
    operatorOptionsForField: (key, options) => operatorOptionsForField(catalog, key, options),
    defaultOperatorForField: (key, options) => defaultOperatorForField(catalog, key, options),
    normalizeOperatorForField: (key, operator, options) =>
      normalizeOperatorForField(catalog, key, operator, options),
  };
}
