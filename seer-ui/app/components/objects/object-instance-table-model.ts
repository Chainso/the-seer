"use client";

import type {
  OntologyDisplayObjectModel,
  OntologyDisplayResolver,
} from "@/app/lib/ontology-display";

export type ObjectInstanceRowLike = {
  object_ref: Record<string, unknown>;
  object_payload: Record<string, unknown>;
};

export type ObjectInstanceColumnModel = {
  keyPartFieldKeys: string[];
  displayNameFieldKey: string | null;
  stateFieldKeys: string[];
};

function normalizeFieldRank(fieldKey: string, orderedFieldKeys: string[]): number {
  const index = orderedFieldKeys.indexOf(fieldKey);
  return index >= 0 ? index : Number.MAX_SAFE_INTEGER;
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

export function readObjectInstanceFieldValue(
  item: ObjectInstanceRowLike,
  fieldKey: string
): unknown {
  if (item.object_payload && Object.prototype.hasOwnProperty.call(item.object_payload, fieldKey)) {
    return item.object_payload[fieldKey];
  }
  if (Object.prototype.hasOwnProperty.call(item.object_ref, fieldKey)) {
    return item.object_ref[fieldKey];
  }
  return null;
}

export function stringifyObjectInstanceValue(value: unknown): string {
  if (value === null || value === undefined || value === "") {
    return "—";
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

export function buildObjectInstanceColumnModel(options: {
  rows: ObjectInstanceRowLike[];
  objectType: string;
  ontologyDisplay: OntologyDisplayResolver;
  selectedModel: OntologyDisplayObjectModel | null;
}): ObjectInstanceColumnModel {
  const { rows, objectType, ontologyDisplay, selectedModel } = options;

  const discoveredKeys = new Set<string>();
  rows.forEach((item) => {
    Object.keys(item.object_ref).forEach((key) => discoveredKeys.add(key));
  });

  const keyPartFieldKeys = Array.from(discoveredKeys).sort((left, right) => {
    const leftRank = normalizeFieldRank(left, selectedModel?.canonicalFieldKeys || []);
    const rightRank = normalizeFieldRank(right, selectedModel?.canonicalFieldKeys || []);
    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }
    return ontologyDisplay
      .displayFieldLabel(left, { objectType })
      .localeCompare(ontologyDisplay.displayFieldLabel(right, { objectType }));
  });

  const displayNameFieldCandidates = ["display_name", "name"];
  const localFieldCandidate = selectedModel?.localName
    ? `${snakeCase(selectedModel.localName)}_name`
    : null;
  if (localFieldCandidate) {
    displayNameFieldCandidates.push(localFieldCandidate);
  }

  const rawDisplayNameFieldKey =
    displayNameFieldCandidates.find((fieldKey) => selectedModel?.canonicalFieldKeys.includes(fieldKey)) ||
    null;
  const displayNameFieldKey =
    rawDisplayNameFieldKey && !keyPartFieldKeys.includes(rawDisplayNameFieldKey)
      ? rawDisplayNameFieldKey
      : null;

  const excludedFields = new Set([
    ...keyPartFieldKeys,
    ...(displayNameFieldKey ? [displayNameFieldKey] : []),
  ]);
  const orderedStateKeys: string[] = [];
  const seen = new Set<string>();

  const pushStateKey = (fieldKey: string | null | undefined) => {
    if (!fieldKey || excludedFields.has(fieldKey) || seen.has(fieldKey)) {
      return;
    }
    seen.add(fieldKey);
    orderedStateKeys.push(fieldKey);
  };

  pushStateKey(selectedModel?.stateFilterFieldKey);
  (selectedModel?.canonicalFieldKeys || []).forEach((fieldKey) => {
    if (isStateLikeFieldKey(fieldKey)) {
      pushStateKey(fieldKey);
    }
  });

  return {
    keyPartFieldKeys,
    displayNameFieldKey,
    stateFieldKeys: orderedStateKeys,
  };
}
