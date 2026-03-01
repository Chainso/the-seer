"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Clock3, GitBranch, Network } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";

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

import {
  ObjectHistoryActivityGraph,
  type ObjectHistoryGraphEdge,
  type ObjectHistoryGraphEventNode,
  type ObjectHistoryGraphObjectNode,
} from "./object-history-activity-graph";
import {
  ObjectHistoryTimeline,
  type ObjectHistoryTimelineGroup,
} from "./object-history-timeline";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";

const TIMELINE_PAGE_SIZE = 25;
const GRAPH_EVENT_PAGE_SIZE = 50;
const GRAPH_MAX_DEPTH = 4;
const GRAPH_MAX_OBJECT_EVENT_PAGES = 6;
const GRAPH_MAX_EVENTS = 240;
const GRAPH_MAX_OBJECTS = 240;
const GRAPH_MAX_EDGES = 900;
const GRAPH_RELATIONS_LIMIT = 200;

type GraphTimeSource = "follow" | "custom";

type ObjectIdentity = {
  objectType: string;
  objectRefCanonical: string;
  objectRefHash?: number;
  objectRef?: Record<string, unknown>;
};

type InternalGraphObjectNode = ObjectIdentity & {
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

type TimeWindow = {
  startAt: string;
  endAt: string;
};

function formatDateTime(value: string | null): string {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) return "-";
  return parsed.toLocaleString();
}

function parseQueryNumber(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    return undefined;
  }
  return parsed;
}

function objectKey(objectType: string, objectRefCanonical: string): string {
  return `${objectType}:${objectRefCanonical}`;
}

function timelineIdentityKey(item: ObjectEventItem): string {
  return `${item.event_id}:${item.object_history_id}`;
}

function parseCanonicalRef(canonical: string): Record<string, unknown> | undefined {
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

function eventTimeIso(item: Pick<ObjectEventItem, "occurred_at" | "linked_at">): string {
  return item.occurred_at || item.linked_at;
}

function toDateTimeLocalValue(iso: string | undefined): string {
  if (!iso) return "";
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.valueOf())) {
    return "";
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}T${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`;
}

function localDateTimeToIso(value: string): string | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) {
    return undefined;
  }
  return parsed.toISOString();
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

async function fetchObjectEventsForGraph(
  identity: ObjectIdentity,
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
  anchor: ObjectIdentity;
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

  let frontier: ObjectIdentity[] = [anchor];

  for (let layer = 0; layer < depth; layer += 1) {
    if (frontier.length === 0) {
      break;
    }

    const nextFrontierMap = new Map<string, ObjectIdentity>();

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

export function ObjectHistoryDetailsPanel() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const ontologyDisplay = useOntologyDisplay();

  const objectType = searchParams.get("object_type")?.trim() || "";
  const objectRefCanonical = searchParams.get("object_ref_canonical")?.trim() || "";
  const objectRefHash = parseQueryNumber(searchParams.get("object_ref_hash"));

  const hasRequiredIdentity = Boolean(objectType && objectRefCanonical);

  const anchorObjectRef = useMemo(
    () => parseCanonicalRef(objectRefCanonical),
    [objectRefCanonical]
  );

  const anchorIdentity = useMemo<ObjectIdentity | null>(() => {
    if (!hasRequiredIdentity) {
      return null;
    }
    return {
      objectType,
      objectRefCanonical,
      objectRefHash,
      objectRef: anchorObjectRef,
    };
  }, [anchorObjectRef, hasRequiredIdentity, objectRefCanonical, objectRefHash, objectType]);

  const identityKey = useMemo(
    () => (anchorIdentity ? objectKey(anchorIdentity.objectType, anchorIdentity.objectRefCanonical) : ""),
    [anchorIdentity]
  );

  const [timelineItems, setTimelineItems] = useState<ObjectEventItem[]>([]);
  const [timelinePage, setTimelinePage] = useState(0);
  const [timelineTotalPages, setTimelineTotalPages] = useState(0);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [timelineError, setTimelineError] = useState<string | null>(null);
  const [timelineReady, setTimelineReady] = useState(false);

  const [graphTimeSource, setGraphTimeSource] = useState<GraphTimeSource>("follow");
  const [graphDepthInput, setGraphDepthInput] = useState("1");
  const [customFromDraft, setCustomFromDraft] = useState("");
  const [customToDraft, setCustomToDraft] = useState("");
  const [appliedCustomRange, setAppliedCustomRange] = useState<TimeWindow | null>(null);
  const [customRangeError, setCustomRangeError] = useState<string | null>(null);

  const [graphLoading, setGraphLoading] = useState(false);
  const [graphError, setGraphError] = useState<string | null>(null);
  const [graphCapMessages, setGraphCapMessages] = useState<string[]>([]);
  const [graphObjects, setGraphObjects] = useState<ObjectHistoryGraphObjectNode[]>([]);
  const [graphEvents, setGraphEvents] = useState<ObjectHistoryGraphEventNode[]>([]);
  const [graphEdges, setGraphEdges] = useState<ObjectHistoryGraphEdge[]>([]);

  const objectModel = useMemo(
    () => (objectType ? ontologyDisplay.resolveObjectModel(objectType) : null),
    [objectType, ontologyDisplay]
  );

  const stateLabelByToken = objectModel?.stateLabelByToken;

  const graphDepth = useMemo(() => {
    const parsed = Number.parseInt(graphDepthInput, 10);
    if (Number.isNaN(parsed) || parsed < 1) {
      return 1;
    }
    return Math.min(parsed, GRAPH_MAX_DEPTH);
  }, [graphDepthInput]);

  const followWindow = useMemo<TimeWindow | null>(() => {
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
  }, [timelineItems]);

  useEffect(() => {
    if (!followWindow) {
      return;
    }
    setCustomFromDraft((previous) => previous || toDateTimeLocalValue(followWindow.startAt));
    setCustomToDraft((previous) => previous || toDateTimeLocalValue(followWindow.endAt));
    setAppliedCustomRange((previous) => previous || followWindow);
  }, [followWindow]);

  const activeGraphWindow = useMemo<TimeWindow | null>(() => {
    if (graphTimeSource === "follow") {
      return followWindow;
    }
    return appliedCustomRange;
  }, [appliedCustomRange, followWindow, graphTimeSource]);

  const activeGraphWindowKey = useMemo(() => {
    if (!activeGraphWindow) {
      return "none";
    }
    return `${graphTimeSource}:${activeGraphWindow.startAt}:${activeGraphWindow.endAt}`;
  }, [activeGraphWindow, graphTimeSource]);

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

  const loadTimelinePage = useCallback(
    async (page: number, mode: "replace" | "append") => {
      if (!anchorIdentity) {
        return;
      }

      setTimelineLoading(true);
      setTimelineError(null);

      try {
        const response = await listObjectEvents({
          objectType: anchorIdentity.objectType,
          objectRefCanonical: anchorIdentity.objectRefCanonical,
          objectRefHash: anchorIdentity.objectRefHash,
          page,
          size: TIMELINE_PAGE_SIZE,
        });

        setTimelinePage(response.page);
        setTimelineTotalPages(response.total_pages);

        setTimelineItems((previous) => {
          const source = mode === "append" ? [...previous, ...response.items] : response.items;
          const deduped: ObjectEventItem[] = [];
          const seen = new Set<string>();
          source.forEach((item) => {
            const key = timelineIdentityKey(item);
            if (seen.has(key)) {
              return;
            }
            seen.add(key);
            deduped.push(item);
          });
          return deduped;
        });

        setTimelineReady(true);
      } catch (cause) {
        setTimelineError(cause instanceof Error ? cause.message : "Failed to load timeline");
        if (mode === "replace") {
          setTimelineItems([]);
          setTimelineTotalPages(0);
          setTimelinePage(0);
        }
      } finally {
        setTimelineLoading(false);
      }
    },
    [anchorIdentity]
  );

  useEffect(() => {
    setTimelineItems([]);
    setTimelinePage(0);
    setTimelineTotalPages(0);
    setTimelineError(null);
    setTimelineReady(false);
    setGraphObjects([]);
    setGraphEvents([]);
    setGraphEdges([]);
    setGraphCapMessages([]);
    setGraphError(null);

    if (!anchorIdentity) {
      return;
    }

    void loadTimelinePage(0, "replace");
  }, [anchorIdentity, loadTimelinePage]);

  useEffect(() => {
    if (!anchorIdentity || !timelineReady || !activeGraphWindow) {
      return;
    }

    let active = true;

    setGraphLoading(true);
    setGraphError(null);

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

        setGraphObjects(viewObjects);
        setGraphEvents(viewEvents);
        setGraphEdges(viewEdges);
        setGraphCapMessages(result.capMessages);
      })
      .catch((cause) => {
        if (!active) {
          return;
        }
        setGraphObjects([]);
        setGraphEvents([]);
        setGraphEdges([]);
        setGraphCapMessages([]);
        setGraphError(cause instanceof Error ? cause.message : "Failed to build object graph");
      })
      .finally(() => {
        if (!active) {
          return;
        }
        setGraphLoading(false);
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
  ]);

  const canLoadOlder = timelineReady && !timelineLoading && timelinePage + 1 < timelineTotalPages;

  const applyCustomRange = () => {
    const startAt = localDateTimeToIso(customFromDraft);
    const endAt = localDateTimeToIso(customToDraft);

    if (!startAt || !endAt) {
      setCustomRangeError("Custom range requires both From and To values.");
      return;
    }

    if (startAt > endAt) {
      setCustomRangeError("Custom range From must be earlier than To.");
      return;
    }

    setCustomRangeError(null);
    setAppliedCustomRange({ startAt, endAt });
  };

  const displayAnchorSummary = useMemo(() => {
    if (!anchorIdentity?.objectRef) {
      return objectRefCanonical;
    }
    return ontologyDisplay.summarizeObjectRef(anchorIdentity.objectRef, {
      objectType: anchorIdentity.objectType,
    });
  }, [anchorIdentity, objectRefCanonical, ontologyDisplay]);

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
        "from_state",
        "to_state",
        "state",
        "status",
        ...eventFieldKeys,
        ...objectFieldKeys,
        ...payloadKeys,
      ];

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
    [objectModel?.canonicalFieldKeys, objectType, ontologyDisplay, stateLabelByToken]
  );

  const resolveStateTransition = useCallback(
    (item: ObjectEventItem, payload: Record<string, unknown>) => {
      const fromKey = Object.keys(payload).find(
        (key) => normalizeComparableToken(key) === "fromstate"
      );
      const toKey = Object.keys(payload).find(
        (key) => normalizeComparableToken(key) === "tostate"
      );
      if (!fromKey && !toKey) {
        return null;
      }

      const fromValue = fromKey
        ? ontologyDisplay.displayFieldValue(fromKey, payload[fromKey], {
            objectType,
            eventType: item.event_type,
            stateLabelByToken,
          })
        : null;
      const toValue = toKey
        ? ontologyDisplay.displayFieldValue(toKey, payload[toKey], {
            objectType,
            eventType: item.event_type,
            stateLabelByToken,
          })
        : null;

      const payloadKeys = [fromKey, toKey].filter((key): key is string => Boolean(key));

      return {
        from: fromValue ? String(fromValue) : "Unknown",
        to: toValue ? String(toValue) : "Unknown",
        payloadKeys,
      };
    },
    [objectType, ontologyDisplay, stateLabelByToken]
  );

  type TimelineBucket = ObjectHistoryTimelineGroup["entries"][number] & {
    dayKey: string;
    dayLabel: string;
  };

  const timelineBuckets = useMemo<TimelineBucket[]>(() => {
    return [...timelineItems]
      .sort((a, b) => Date.parse(eventTimeIso(b)) - Date.parse(eventTimeIso(a)))
      .map((item) => {
        const payload = item.payload || item.object_payload || {};
        const eventDate = new Date(eventTimeIso(item));
        const stateTransition = resolveStateTransition(item, payload);
        const excludedComparableKeys = new Set<string>();
        for (const key of stateTransition?.payloadKeys || []) {
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
          stateTransition: stateTransition
            ? {
                from: stateTransition.from,
                to: stateTransition.to,
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
    resolveStateTransition,
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

  if (!hasRequiredIdentity) {
    return (
      <Card className="rounded-2xl border border-destructive/40 bg-destructive/10 p-6 text-sm text-destructive">
        Missing required query params: <code>object_type</code> and <code>object_ref_canonical</code>.
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="rounded-3xl border border-border bg-card p-8 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-3">
            <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">Object History</p>
            <h1 className="font-display text-3xl">Object-Centric Timeline + Graph</h1>
            <p className="max-w-3xl text-sm text-muted-foreground">
              Timeline cards are grouped by day and use ontology labels for event names, field highlights, and state transitions.
            </p>
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline" className="rounded-full">
                {ontologyDisplay.displayObjectType(objectType)}
              </Badge>
              <Badge variant="outline" className="rounded-full max-w-[820px] truncate">
                {displayAnchorSummary}
              </Badge>
            </div>
          </div>
          <Button type="button" variant="outline" onClick={() => router.push("/inspector/history")}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Object Store
          </Button>
        </div>
      </Card>

      <Card className="rounded-2xl border border-border bg-card p-6 shadow-sm">
        <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          <Network className="h-4 w-4" />
          Graph Controls
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-[1.1fr_1fr_1.2fr]">
          <div className="space-y-2">
            <Label htmlFor="graph-time-source">Graph time source</Label>
            <Select
              value={graphTimeSource}
              onValueChange={(value) => setGraphTimeSource(value as GraphTimeSource)}
            >
              <SelectTrigger id="graph-time-source">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="follow">Follow Timeline</SelectItem>
                <SelectItem value="custom">Custom Range</SelectItem>
              </SelectContent>
            </Select>
            {graphTimeSource === "follow" && (
              <p className="text-xs text-muted-foreground">
                Graph uses the loaded timeline window and expands automatically when older pages are loaded.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="graph-depth">Graph depth</Label>
            <Input
              id="graph-depth"
              type="number"
              min={1}
              max={GRAPH_MAX_DEPTH}
              value={graphDepthInput}
              onChange={(event) => setGraphDepthInput(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">Depth defaults to 1 and can be increased to {GRAPH_MAX_DEPTH}.</p>
          </div>

          <div className="space-y-2">
            <Label>Active graph window</Label>
            {activeGraphWindow ? (
              <div className="rounded-xl border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                {formatDateTime(activeGraphWindow.startAt)} to {formatDateTime(activeGraphWindow.endAt)}
              </div>
            ) : (
              <div className="rounded-xl border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                Waiting for timeline data.
              </div>
            )}
          </div>
        </div>

        {graphTimeSource === "custom" && (
          <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_1fr_auto]">
            <div className="space-y-2">
              <Label htmlFor="graph-custom-from">From</Label>
              <Input
                id="graph-custom-from"
                type="datetime-local"
                value={customFromDraft}
                onChange={(event) => setCustomFromDraft(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="graph-custom-to">To</Label>
              <Input
                id="graph-custom-to"
                type="datetime-local"
                value={customToDraft}
                onChange={(event) => setCustomToDraft(event.target.value)}
              />
            </div>
            <div className="flex items-end">
              <Button type="button" className="w-full" onClick={applyCustomRange}>
                Apply Range
              </Button>
            </div>
          </div>
        )}

        {customRangeError && (
          <div className="mt-4 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {customRangeError}
          </div>
        )}
      </Card>

      <div className="grid gap-6 xl:grid-cols-[1.25fr_1fr]">
        <Card className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              <GitBranch className="h-4 w-4" />
              Graph View
            </div>
            <Badge variant="outline" className="rounded-full">
              {graphObjects.length} objects / {graphEvents.length} events
            </Badge>
          </div>

          {graphError ? (
            <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
              {graphError}
            </div>
          ) : graphLoading ? (
            <div className="flex h-[560px] items-center justify-center rounded-2xl border border-dashed border-border text-sm text-muted-foreground">
              Building graph...
            </div>
          ) : graphEvents.length === 0 || graphEdges.length === 0 ? (
            <div className="flex h-[560px] items-center justify-center rounded-2xl border border-dashed border-border text-sm text-muted-foreground">
              No graphable relations in the active time window.
            </div>
          ) : (
            <ObjectHistoryActivityGraph objects={graphObjects} events={graphEvents} edges={graphEdges} />
          )}

          {graphCapMessages.length > 0 && (
            <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-xs text-amber-900">
              {graphCapMessages.join(" ")}
            </div>
          )}
        </Card>

        <Card className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              <Clock3 className="h-4 w-4" />
              Timeline by Day
            </div>
            <Badge variant="outline" className="rounded-full">
              {timelineItems.length} loaded
            </Badge>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Event cards prioritize ontology-aware summaries, highlights, and state changes for this object identity.
          </p>

          {timelineError && (
            <div className="mt-4 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {timelineError}
            </div>
          )}

          <div className="mt-4 space-y-5">
            <ObjectHistoryTimeline
              groups={timelineGroups}
              hasAnyEvents={timelineItems.length > 0}
              loading={timelineLoading}
            />
          </div>

          <div className="mt-4 flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              Page {timelineTotalPages === 0 ? 0 : timelinePage + 1} of {timelineTotalPages}
            </p>
            <Button
              type="button"
              variant="outline"
              disabled={!canLoadOlder}
              onClick={() => void loadTimelinePage(timelinePage + 1, "append")}
            >
              {timelineLoading ? "Loading..." : "Load older"}
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
