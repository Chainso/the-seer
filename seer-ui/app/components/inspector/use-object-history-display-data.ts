"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { listEventObjectRelations, listObjectEvents } from "@/app/lib/api/history";
import {
  normalizeComparableToken,
  type OntologyDisplayValueContext,
  useOntologyDisplay,
} from "@/app/lib/ontology-display";
import type {
  EventObjectRelationItem,
  EventObjectRelationsResponse,
  ObjectEventItem,
} from "@/app/types/history";

import type {
  ObjectHistoryGraphEdge,
  ObjectHistoryGraphEventNode,
  ObjectHistoryGraphObjectNode,
} from "./object-history-activity-graph";
import type { ObjectHistoryTimelineGroup } from "./object-history-timeline";

export const OBJECT_HISTORY_TIMELINE_PAGE_SIZE = 25;
const GRAPH_EVENT_PAGE_SIZE = 50;
export const OBJECT_HISTORY_GRAPH_MAX_DEPTH = 4;
const GRAPH_MAX_OBJECT_EVENT_PAGES = 6;
const GRAPH_MAX_EVENTS = 240;
const GRAPH_MAX_OBJECTS = 240;
const GRAPH_MAX_EDGES = 900;
const GRAPH_RELATIONS_LIMIT = 200;

export type ObjectHistoryIdentity = {
  objectType: string;
  objectRefCanonical: string;
  objectRefHash?: number;
  objectRef?: Record<string, unknown>;
};

type InternalGraphObjectNode = ObjectHistoryIdentity & {
  key: string;
};

type InternalGraphEventNode = {
  eventId: string;
  eventType: string | null;
  occurredAt: string | null;
  linkedAt: string;
  source: string | null;
};

type InternalGraphEdge = {
  id: string;
  eventId: string;
  objectKey: string;
  role: string;
};

type BuiltGraph = {
  objects: InternalGraphObjectNode[];
  events: InternalGraphEventNode[];
  edges: InternalGraphEdge[];
  capMessages: string[];
};

export type TimeWindow = {
  startAt: string;
  endAt: string;
};

export function formatDateTime(value: string | null): string {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) return "-";
  return parsed.toLocaleString();
}

export function parseQueryNumber(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    return undefined;
  }
  return parsed;
}

export function parseCanonicalRef(canonical: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(canonical);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export function toDateTimeLocalValue(iso: string | undefined): string {
  if (!iso) return "";
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.valueOf())) {
    return "";
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}T${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`;
}

export function localDateTimeToIso(value: string): string | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) {
    return undefined;
  }
  return parsed.toISOString();
}

function objectKey(objectType: string, objectRefCanonical: string): string {
  return `${objectType}:${objectRefCanonical}`;
}

function timelineIdentityKey(item: ObjectEventItem): string {
  return `${item.event_id}:${item.object_history_id}`;
}

function eventTimeIso(item: Pick<ObjectEventItem, "occurred_at" | "linked_at">): string {
  return item.occurred_at || item.linked_at;
}

function humanizeIdentifierToken(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return value;
  }
  const normalized = trimmed
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_./-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) {
    return trimmed;
  }
  return normalized
    .split(" ")
    .map((part) => (part ? `${part[0]?.toUpperCase()}${part.slice(1).toLowerCase()}` : part))
    .join(" ");
}

function isMappedDisplayLabel(raw: string, candidate: string): boolean {
  const normalizedCandidate = candidate.trim();
  if (!normalizedCandidate || normalizedCandidate === "—") {
    return false;
  }
  return normalizedCandidate !== raw;
}

function readStateSnapshotValue(
  payload: Record<string, unknown> | null | undefined,
  fieldKey: string | null | undefined
): string | null {
  if (!payload || !fieldKey) {
    return null;
  }
  const normalizedFieldKey = normalizeComparableToken(fieldKey);
  if (!normalizedFieldKey) {
    return null;
  }
  const payloadKey = Object.keys(payload).find(
    (candidate) => normalizeComparableToken(candidate) === normalizedFieldKey
  );
  if (!payloadKey) {
    return null;
  }
  const rawValue = payload[payloadKey];
  if (typeof rawValue === "string") {
    const trimmed = rawValue.trim();
    return trimmed || null;
  }
  if (typeof rawValue === "number" || typeof rawValue === "boolean") {
    return String(rawValue);
  }
  return null;
}

async function fetchObjectEventsForGraph(
  identity: ObjectHistoryIdentity,
  window: TimeWindow,
  capMessages: Set<string>
): Promise<ObjectEventItem[]> {
  const events: ObjectEventItem[] = [];
  const seenEventIds = new Set<string>();

  for (let page = 0; page < GRAPH_MAX_OBJECT_EVENT_PAGES; page += 1) {
    const response = await listObjectEvents({
      objectType: identity.objectType,
      objectRefCanonical: identity.objectRefCanonical,
      objectRefHash: identity.objectRefHash,
      startAt: window.startAt,
      endAt: window.endAt,
      page,
      size: GRAPH_EVENT_PAGE_SIZE,
    });

    response.items.forEach((event) => {
      if (seenEventIds.has(event.event_id)) {
        return;
      }
      seenEventIds.add(event.event_id);
      events.push(event);
    });

    const reachedEnd = page + 1 >= response.total_pages;
    if (reachedEnd) {
      break;
    }

    if (page + 1 >= GRAPH_MAX_OBJECT_EVENT_PAGES) {
      capMessages.add(
        `Graph event lookup for ${identity.objectType} was capped at ${GRAPH_MAX_OBJECT_EVENT_PAGES} pages.`
      );
      break;
    }
  }

  return events;
}

async function buildObjectGraph(options: {
  anchor: ObjectHistoryIdentity;
  window: TimeWindow;
  depth: number;
}): Promise<BuiltGraph> {
  const { anchor, window, depth } = options;

  const objectsByKey = new Map<string, InternalGraphObjectNode>();
  const eventsById = new Map<string, InternalGraphEventNode>();
  const edgesById = new Map<string, InternalGraphEdge>();

  const expandedObjectKeys = new Set<string>();
  const relationsFetchedByEventId = new Set<string>();
  const capMessages = new Set<string>();

  const anchorKey = objectKey(anchor.objectType, anchor.objectRefCanonical);
  objectsByKey.set(anchorKey, {
    ...anchor,
    key: anchorKey,
    objectRef: anchor.objectRef || parseCanonicalRef(anchor.objectRefCanonical),
  });

  let frontier: ObjectHistoryIdentity[] = [anchor];

  for (let layer = 0; layer < depth; layer += 1) {
    if (frontier.length === 0) {
      break;
    }

    const nextFrontierMap = new Map<string, ObjectHistoryIdentity>();

    for (const identity of frontier) {
      const identityKey = objectKey(identity.objectType, identity.objectRefCanonical);
      if (expandedObjectKeys.has(identityKey)) {
        continue;
      }
      expandedObjectKeys.add(identityKey);

      const eventsForObject = await fetchObjectEventsForGraph(identity, window, capMessages);
      for (const event of eventsForObject) {
        if (!eventsById.has(event.event_id)) {
          if (eventsById.size >= GRAPH_MAX_EVENTS) {
            capMessages.add(`Graph events were capped at ${GRAPH_MAX_EVENTS}.`);
            continue;
          }
          eventsById.set(event.event_id, {
            eventId: event.event_id,
            eventType: event.event_type,
            occurredAt: event.occurred_at,
            linkedAt: event.linked_at,
            source: event.source,
          });
        }

        if (relationsFetchedByEventId.has(event.event_id)) {
          continue;
        }
        relationsFetchedByEventId.add(event.event_id);

        const relations: EventObjectRelationsResponse = await listEventObjectRelations({
          eventId: event.event_id,
          limit: GRAPH_RELATIONS_LIMIT,
        });

        if (relations.items.length >= GRAPH_RELATIONS_LIMIT) {
          capMessages.add(
            `Relations were capped at ${GRAPH_RELATIONS_LIMIT} for at least one event.`
          );
        }

        relations.items.forEach((relation: EventObjectRelationItem) => {
          const relatedObjectKey = objectKey(relation.object_type, relation.object_ref_canonical);
          if (!objectsByKey.has(relatedObjectKey)) {
            if (objectsByKey.size >= GRAPH_MAX_OBJECTS) {
              capMessages.add(`Graph objects were capped at ${GRAPH_MAX_OBJECTS}.`);
              return;
            }
            objectsByKey.set(relatedObjectKey, {
              key: relatedObjectKey,
              objectType: relation.object_type,
              objectRefCanonical: relation.object_ref_canonical,
              objectRefHash: relation.object_ref_hash,
              objectRef: relation.object_ref,
            });
          }

          const edgeId = `${relation.event_id}:${relatedObjectKey}:${relation.object_history_id}:${relation.relation_role ?? "linked"}`;
          if (!edgesById.has(edgeId)) {
            if (edgesById.size >= GRAPH_MAX_EDGES) {
              capMessages.add(`Graph relations were capped at ${GRAPH_MAX_EDGES}.`);
              return;
            }
            edgesById.set(edgeId, {
              id: edgeId,
              eventId: relation.event_id,
              objectKey: relatedObjectKey,
              role: relation.relation_role || "linked",
            });
          }

          if (layer + 1 < depth && !expandedObjectKeys.has(relatedObjectKey)) {
            nextFrontierMap.set(relatedObjectKey, {
              objectType: relation.object_type,
              objectRefCanonical: relation.object_ref_canonical,
              objectRefHash: relation.object_ref_hash,
              objectRef: relation.object_ref,
            });
          }
        });
      }
    }

    frontier = Array.from(nextFrontierMap.values());
  }

  return {
    objects: Array.from(objectsByKey.values()),
    events: Array.from(eventsById.values()),
    edges: Array.from(edgesById.values()),
    capMessages: Array.from(capMessages.values()),
  };
}

export function deriveFollowTimeWindow(timelineItems: ObjectEventItem[]): TimeWindow | null {
  if (timelineItems.length === 0) {
    return null;
  }

  let minTimestamp = Number.POSITIVE_INFINITY;
  let maxTimestamp = Number.NEGATIVE_INFINITY;

  timelineItems.forEach((item) => {
    const timestamp = Date.parse(eventTimeIso(item));
    if (Number.isNaN(timestamp)) {
      return;
    }
    minTimestamp = Math.min(minTimestamp, timestamp);
    maxTimestamp = Math.max(maxTimestamp, timestamp);
  });

  if (!Number.isFinite(minTimestamp) || !Number.isFinite(maxTimestamp)) {
    return null;
  }

  return {
    startAt: new Date(minTimestamp).toISOString(),
    endAt: new Date(maxTimestamp).toISOString(),
  };
}

export interface UseObjectHistoryDisplayDataOptions {
  anchorIdentity: ObjectHistoryIdentity | null;
  objectType: string;
  objectRefCanonical: string;
  timelineItems: ObjectEventItem[];
  timelineReady: boolean;
  activeGraphWindow: TimeWindow | null;
  graphDepth: number;
}

export interface UseObjectHistoryDisplayDataResult {
  objectTypeLabel: string;
  displayAnchorSummary: string;
  graphLoading: boolean;
  graphError: string | null;
  graphCapMessages: string[];
  graphObjects: ObjectHistoryGraphObjectNode[];
  graphEvents: ObjectHistoryGraphEventNode[];
  graphEdges: ObjectHistoryGraphEdge[];
  timelineGroups: ObjectHistoryTimelineGroup[];
}

export function useObjectHistoryDisplayData({
  anchorIdentity,
  objectType,
  objectRefCanonical,
  timelineItems,
  timelineReady,
  activeGraphWindow,
  graphDepth,
}: UseObjectHistoryDisplayDataOptions): UseObjectHistoryDisplayDataResult {
  const ontologyDisplay = useOntologyDisplay();
  const [graphResult, setGraphResult] = useState<{
    key: string;
    error: string | null;
    capMessages: string[];
    objects: ObjectHistoryGraphObjectNode[];
    events: ObjectHistoryGraphEventNode[];
    edges: ObjectHistoryGraphEdge[];
  }>({
    key: "",
    error: null,
    capMessages: [],
    objects: [],
    events: [],
    edges: [],
  });

  const identityKey = useMemo(
    () => (anchorIdentity ? objectKey(anchorIdentity.objectType, anchorIdentity.objectRefCanonical) : ""),
    [anchorIdentity]
  );
  const objectModel = useMemo(
    () => (objectType ? ontologyDisplay.resolveObjectModel(objectType) : null),
    [objectType, ontologyDisplay]
  );
  const stateLabelByToken = objectModel?.stateLabelByToken;
  const activeGraphWindowKey = useMemo(() => {
    if (!activeGraphWindow) {
      return "none";
    }
    return `${activeGraphWindow.startAt}:${activeGraphWindow.endAt}`;
  }, [activeGraphWindow]);
  const hasGraphInputs = Boolean(anchorIdentity && timelineReady && activeGraphWindow);
  const graphRequestKey = useMemo(() => {
    if (!hasGraphInputs) {
      return "";
    }
    return `${identityKey}:${graphDepth}:${activeGraphWindowKey}`;
  }, [activeGraphWindowKey, graphDepth, hasGraphInputs, identityKey]);

  const objectTypeLabel = useMemo(
    () => ontologyDisplay.displayObjectType(objectType),
    [objectType, ontologyDisplay]
  );
  const displayAnchorSummary = useMemo(() => {
    if (!anchorIdentity?.objectRef) {
      return objectRefCanonical;
    }
    return ontologyDisplay.summarizeObjectRef(anchorIdentity.objectRef, {
      objectType: anchorIdentity.objectType,
    });
  }, [anchorIdentity, objectRefCanonical, ontologyDisplay]);

  const displayRelationRole = useCallback(
    (value: string | null | undefined) => {
      const raw = value?.trim();
      if (!raw) {
        return "Linked";
      }
      const objectLabel = ontologyDisplay.displayObjectType(raw);
      if (isMappedDisplayLabel(raw, objectLabel)) {
        return objectLabel;
      }
      const conceptLabel = ontologyDisplay.displayConcept(raw);
      if (isMappedDisplayLabel(raw, conceptLabel)) {
        return conceptLabel;
      }
      return humanizeIdentifierToken(raw);
    },
    [ontologyDisplay]
  );

  const displayEventSource = useCallback(
    (value: string | null | undefined) => {
      const raw = value?.trim();
      if (!raw) {
        return "Source unavailable";
      }
      const conceptLabel = ontologyDisplay.displayConcept(raw);
      if (isMappedDisplayLabel(raw, conceptLabel)) {
        return conceptLabel;
      }
      const eventLabel = ontologyDisplay.displayEventType(raw, {
        fallbackObjectType: objectType,
      });
      if (isMappedDisplayLabel(raw, eventLabel)) {
        return eventLabel;
      }
      const objectLabel = ontologyDisplay.displayObjectType(raw);
      if (isMappedDisplayLabel(raw, objectLabel)) {
        return objectLabel;
      }
      return humanizeIdentifierToken(raw);
    },
    [objectType, ontologyDisplay]
  );

  useEffect(() => {
    if (!anchorIdentity || !timelineReady || !activeGraphWindow) {
      return;
    }

    let active = true;

    buildObjectGraph({
      anchor: anchorIdentity,
      window: activeGraphWindow,
      depth: graphDepth,
    })
      .then((result) => {
        if (!active) {
          return;
        }

        const viewObjects: ObjectHistoryGraphObjectNode[] = result.objects.map((node) => {
          const resolvedRef = node.objectRef || parseCanonicalRef(node.objectRefCanonical) || {};
          return {
            key: node.key,
            label: ontologyDisplay.displayObjectType(node.objectType),
            subtitle: ontologyDisplay.summarizeObjectRef(resolvedRef, { objectType: node.objectType }),
            isAnchor: node.key === identityKey,
          };
        });

        const viewEvents: ObjectHistoryGraphEventNode[] = result.events.map((eventNode) => {
          const sortKey = Date.parse(eventNode.occurredAt || eventNode.linkedAt);
          return {
            eventId: eventNode.eventId,
            label: ontologyDisplay.displayEventType(eventNode.eventType, {
              fallbackObjectType: objectType,
            }),
            subtitle: `${formatDateTime(eventNode.occurredAt || eventNode.linkedAt)}${eventNode.source ? ` | ${displayEventSource(eventNode.source)}` : ""}`,
            occurredAtSortKey: Number.isNaN(sortKey) ? 0 : sortKey,
          };
        });

        const viewEdges: ObjectHistoryGraphEdge[] = result.edges.map((edge) => ({
          id: edge.id,
          eventId: edge.eventId,
          objectKey: edge.objectKey,
          role: displayRelationRole(edge.role),
        }));

        setGraphResult({
          key: graphRequestKey,
          error: null,
          capMessages: result.capMessages,
          objects: viewObjects,
          events: viewEvents,
          edges: viewEdges,
        });
      })
      .catch((cause) => {
        if (!active) {
          return;
        }
        setGraphResult({
          key: graphRequestKey,
          error: cause instanceof Error ? cause.message : "Failed to build object graph",
          capMessages: [],
          objects: [],
          events: [],
          edges: [],
        });
      });

    return () => {
      active = false;
    };
  }, [
    activeGraphWindow,
    activeGraphWindowKey,
    anchorIdentity,
    displayEventSource,
    displayRelationRole,
    graphDepth,
    identityKey,
    objectType,
    ontologyDisplay,
    timelineReady,
    graphRequestKey,
  ]);

  const summarizeTimelinePayload = useCallback(
    (item: ObjectEventItem, excludedComparableKeys?: Set<string>) => {
      const payload = item.payload || item.object_payload || null;
      if (!payload) {
        return "—";
      }

      if (!excludedComparableKeys || excludedComparableKeys.size === 0) {
        return ontologyDisplay.summarizePayload(payload, {
          objectType,
          eventType: item.event_type,
          stateLabelByToken,
        });
      }

      const filteredEntries = Object.entries(payload).filter(([key]) => {
        const comparable = normalizeComparableToken(key);
        return !comparable || !excludedComparableKeys.has(comparable);
      });
      if (filteredEntries.length === 0) {
        return "—";
      }

      return ontologyDisplay.summarizePayload(
        Object.fromEntries(filteredEntries) as Record<string, unknown>,
        {
          objectType,
          eventType: item.event_type,
          stateLabelByToken,
        }
      );
    },
    [objectType, ontologyDisplay, stateLabelByToken]
  );

  const buildTimelineHighlights = useCallback(
    (
      item: ObjectEventItem,
      payload: Record<string, unknown>,
      excludedComparableKeys?: Set<string>
    ) => {
      const eventFieldKeys = Array.from(
        ontologyDisplay.fieldLabelsForEventType(item.event_type)?.keys() || []
      );
      const objectFieldKeys = objectModel?.canonicalFieldKeys || [];
      const payloadKeys = Object.keys(payload);

      const prioritized = [
        objectModel?.stateFilterFieldKey,
        "state",
        "status",
        ...eventFieldKeys,
        ...objectFieldKeys,
        ...payloadKeys,
      ].filter((key): key is string => Boolean(key));

      const selectedKeys: string[] = [];
      const seenNormalized = new Set<string>();
      for (const key of prioritized) {
        const normalized = normalizeComparableToken(key);
        if (
          !normalized ||
          seenNormalized.has(normalized) ||
          excludedComparableKeys?.has(normalized)
        ) {
          continue;
        }
        const payloadKey = payloadKeys.find(
          (candidate) => normalizeComparableToken(candidate) === normalized
        );
        if (!payloadKey) {
          continue;
        }
        const value = payload[payloadKey];
        if (
          value === null ||
          value === undefined ||
          typeof value === "object" ||
          (typeof value === "string" && !value.trim())
        ) {
          continue;
        }
        selectedKeys.push(payloadKey);
        seenNormalized.add(normalized);
        if (selectedKeys.length >= 4) {
          break;
        }
      }

      return selectedKeys.map((key) => {
        const rawValue = payload[key];
        const displayed = ontologyDisplay.displayFieldValue(key, rawValue, {
          objectType,
          eventType: item.event_type,
          stateLabelByToken,
        } satisfies OntologyDisplayValueContext);
        return {
          key,
          label: ontologyDisplay.displayFieldLabel(key, {
            objectType,
            eventType: item.event_type,
          }),
          value:
            typeof displayed === "string" ||
            typeof displayed === "number" ||
            typeof displayed === "boolean"
              ? String(displayed)
              : JSON.stringify(displayed),
        };
      });
    },
    [
      objectModel?.canonicalFieldKeys,
      objectModel?.stateFilterFieldKey,
      objectType,
      ontologyDisplay,
      stateLabelByToken,
    ]
  );

  const resolveLifecycleChange = useCallback(
    (
      item: ObjectEventItem,
      payload: Record<string, unknown>,
      previousPayload: Record<string, unknown> | null | undefined
    ) => {
      const stateFieldKey = objectModel?.stateFilterFieldKey;
      if (!stateFieldKey) {
        return null;
      }

      const fromRawValue = readStateSnapshotValue(previousPayload, stateFieldKey);
      const toRawValue = readStateSnapshotValue(payload, stateFieldKey);
      if (!fromRawValue || !toRawValue || fromRawValue === toRawValue) {
        return null;
      }

      const fromValue = ontologyDisplay.displayFieldValue(stateFieldKey, fromRawValue, {
        objectType,
        eventType: item.event_type,
        stateLabelByToken,
      });
      const toValue = ontologyDisplay.displayFieldValue(stateFieldKey, toRawValue, {
        objectType,
        eventType: item.event_type,
        stateLabelByToken,
      });

      return {
        from: fromValue ? String(fromValue) : "Unknown",
        to: toValue ? String(toValue) : "Unknown",
        payloadKeys: [stateFieldKey],
      };
    },
    [objectModel, objectType, ontologyDisplay, stateLabelByToken]
  );

  type TimelineBucket = ObjectHistoryTimelineGroup["entries"][number] & {
    dayKey: string;
    dayLabel: string;
  };

  const timelineBuckets = useMemo<TimelineBucket[]>(() => {
    const lifecycleChangesByIdentityKey = new Map<
      string,
      { from: string; to: string; payloadKeys: string[] }
    >();
    const ascendingItems = [...timelineItems].sort(
      (a, b) => Date.parse(eventTimeIso(a)) - Date.parse(eventTimeIso(b))
    );

    let previousPayload: Record<string, unknown> | null = null;
    ascendingItems.forEach((item) => {
      const payload = item.object_payload || item.payload || {};
      const lifecycleChange = resolveLifecycleChange(item, payload, previousPayload);
      if (lifecycleChange) {
        lifecycleChangesByIdentityKey.set(timelineIdentityKey(item), lifecycleChange);
      }
      previousPayload = item.object_payload || payload || null;
    });

    return [...timelineItems]
      .sort((a, b) => Date.parse(eventTimeIso(b)) - Date.parse(eventTimeIso(a)))
      .map((item) => {
        const payload = item.payload || item.object_payload || {};
        const eventDate = new Date(eventTimeIso(item));
        const lifecycleChange = lifecycleChangesByIdentityKey.get(timelineIdentityKey(item)) || null;
        const excludedComparableKeys = new Set<string>();
        for (const key of lifecycleChange?.payloadKeys || []) {
          const comparable = normalizeComparableToken(key);
          if (comparable) {
            excludedComparableKeys.add(comparable);
          }
        }
        const highlights = buildTimelineHighlights(item, payload, excludedComparableKeys);
        for (const highlight of highlights) {
          const comparable = normalizeComparableToken(highlight.key);
          if (comparable) {
            excludedComparableKeys.add(comparable);
          }
        }
        const payloadSummary = summarizeTimelinePayload(item, excludedComparableKeys);

        return {
          timelineKey: timelineIdentityKey(item),
          dayKey: Number.isNaN(eventDate.valueOf())
            ? "unknown-day"
            : `${eventDate.getFullYear()}-${eventDate.getMonth()}-${eventDate.getDate()}`,
          dayLabel: Number.isNaN(eventDate.valueOf())
            ? "Unknown day"
            : eventDate.toLocaleDateString(undefined, {
                weekday: "short",
                month: "short",
                day: "numeric",
                year: "numeric",
              }),
          eventName: ontologyDisplay.displayEventType(item.event_type, {
            fallbackObjectType: objectType,
          }),
          role: displayRelationRole(item.relation_role),
          time: formatDateTime(eventTimeIso(item)),
          source: displayEventSource(item.source),
          shortEventId: item.event_id.slice(0, 8),
          payloadSummary,
          highlights,
          lifecycleChange: lifecycleChange
            ? {
                from: lifecycleChange.from,
                to: lifecycleChange.to,
              }
            : null,
        };
      });
  }, [
    buildTimelineHighlights,
    displayEventSource,
    displayRelationRole,
    objectType,
    ontologyDisplay,
    resolveLifecycleChange,
    summarizeTimelinePayload,
    timelineItems,
  ]);

  const timelineGroups = useMemo<ObjectHistoryTimelineGroup[]>(() => {
    const groups: ObjectHistoryTimelineGroup[] = [];

    timelineBuckets.forEach((bucket) => {
      const current = groups[groups.length - 1];
      if (!current || current.dayKey !== bucket.dayKey) {
        groups.push({
          dayKey: bucket.dayKey,
          dayLabel: bucket.dayLabel,
          entries: [bucket],
        });
        return;
      }
      current.entries.push(bucket);
    });

    return groups;
  }, [timelineBuckets]);

  return {
    objectTypeLabel,
    displayAnchorSummary,
    graphLoading: hasGraphInputs ? graphResult.key !== graphRequestKey : false,
    graphError: hasGraphInputs && graphResult.key === graphRequestKey ? graphResult.error : null,
    graphCapMessages:
      hasGraphInputs && graphResult.key === graphRequestKey ? graphResult.capMessages : [],
    graphObjects:
      hasGraphInputs && graphResult.key === graphRequestKey ? graphResult.objects : [],
    graphEvents:
      hasGraphInputs && graphResult.key === graphRequestKey ? graphResult.events : [],
    graphEdges:
      hasGraphInputs && graphResult.key === graphRequestKey ? graphResult.edges : [],
    timelineGroups,
  };
}
