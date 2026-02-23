import { buildViewModelMeta, type ViewModelMeta } from "@/lib/adapters/common";
import type {
  HistoryEventItem,
  HistoryEventTimelineResponse,
  HistoryObjectTimelineItem,
  HistoryObjectTimelineResponse,
  HistoryRelationItem,
  HistoryRelationsResponse,
} from "@/lib/backend-history";

export type ObjectExplorerKpisViewModel = {
  snapshot_count: number;
  relation_count: number;
  unique_related_event_count: number;
  event_detail_count: number;
};

export type ObjectTimelineEntryViewModel = {
  id: string;
  object_history_id: string;
  recorded_at: string;
  source_event_id: string | null;
  object_payload_preview: string;
};

export type RelationEntryViewModel = {
  id: string;
  event_id: string;
  object_history_id: string;
  relation_role: string | null;
  event_type: string | null;
  source: string | null;
  occurred_at: string | null;
  linked_at: string;
  has_event_detail: boolean;
  object_payload_preview: string | null;
};

export type EventDetailViewModel = {
  event_id: string;
  occurred_at: string;
  ingested_at: string;
  event_type: string;
  source: string;
  trace_id: string | null;
  payload_preview: string;
  attributes_preview: string | null;
};

export type ObjectExplorerWindowViewModel = {
  start_at: string | null;
  end_at: string | null;
};

export type ObjectExplorerViewModel = {
  object_type: string;
  object_ref_hash: string;
  object_ref_canonical: string | null;
  source: string | null;
  timeline: ObjectTimelineEntryViewModel[];
  relations: RelationEntryViewModel[];
  event_details: EventDetailViewModel[];
  window: ObjectExplorerWindowViewModel;
  kpis: ObjectExplorerKpisViewModel;
  meta: ViewModelMeta;
};

function toEpoch(value: string | null): number {
  if (!value) {
    return Number.NaN;
  }
  return new Date(value).valueOf();
}

function compareAscending(left: string | null, right: string | null): number {
  const leftEpoch = toEpoch(left);
  const rightEpoch = toEpoch(right);

  if (Number.isNaN(leftEpoch) && Number.isNaN(rightEpoch)) {
    return 0;
  }
  if (Number.isNaN(leftEpoch)) {
    return 1;
  }
  if (Number.isNaN(rightEpoch)) {
    return -1;
  }
  return leftEpoch - rightEpoch;
}

function stringifyJsonPreview(value: unknown, maxLength = 180): string {
  const serialized = JSON.stringify(value);
  if (!serialized) {
    return "{}";
  }

  if (serialized.length <= maxLength) {
    return serialized;
  }

  return `${serialized.slice(0, maxLength)}…`;
}

function adaptTimelineEntry(item: HistoryObjectTimelineItem): ObjectTimelineEntryViewModel {
  return {
    id: item.object_history_id,
    object_history_id: item.object_history_id,
    recorded_at: item.recorded_at,
    source_event_id: item.source_event_id,
    object_payload_preview: stringifyJsonPreview(item.object_payload),
  };
}

function adaptRelationEntry(
  item: HistoryRelationItem,
  eventIdsWithDetails: ReadonlySet<string>
): RelationEntryViewModel {
  return {
    id: `${item.event_id}:${item.object_history_id}`,
    event_id: item.event_id,
    object_history_id: item.object_history_id,
    relation_role: item.relation_role,
    event_type: item.event_type,
    source: item.source,
    occurred_at: item.occurred_at,
    linked_at: item.linked_at,
    has_event_detail: eventIdsWithDetails.has(item.event_id),
    object_payload_preview: item.object_payload ? stringifyJsonPreview(item.object_payload) : null,
  };
}

function adaptEventItem(item: HistoryEventItem): EventDetailViewModel {
  return {
    event_id: item.event_id,
    occurred_at: item.occurred_at,
    ingested_at: item.ingested_at,
    event_type: item.event_type,
    source: item.source,
    trace_id: item.trace_id,
    payload_preview: stringifyJsonPreview(item.payload),
    attributes_preview: item.attributes ? stringifyJsonPreview(item.attributes) : null,
  };
}

function inferWindow(params: {
  explicit_start_at?: string;
  explicit_end_at?: string;
  timeline: ObjectTimelineEntryViewModel[];
  relations: RelationEntryViewModel[];
}): ObjectExplorerWindowViewModel {
  if (params.explicit_start_at || params.explicit_end_at) {
    return {
      start_at: params.explicit_start_at ?? null,
      end_at: params.explicit_end_at ?? null,
    };
  }

  const candidates: string[] = [];
  for (const item of params.timeline) {
    if (item.recorded_at) {
      candidates.push(item.recorded_at);
    }
  }
  for (const item of params.relations) {
    if (item.occurred_at) {
      candidates.push(item.occurred_at);
    }
  }

  if (candidates.length === 0) {
    return { start_at: null, end_at: null };
  }

  const ordered = candidates
    .map((value) => ({ value, epoch: toEpoch(value) }))
    .filter((item) => !Number.isNaN(item.epoch))
    .sort((left, right) => left.epoch - right.epoch);

  if (ordered.length === 0) {
    return { start_at: null, end_at: null };
  }

  return {
    start_at: ordered[0]?.value ?? null,
    end_at: ordered[ordered.length - 1]?.value ?? null,
  };
}

export function adaptObjectExplorerViewModel(input: {
  object_type: string;
  object_ref_hash: string;
  object_ref_canonical: string | null;
  source: string | null;
  explicit_start_at?: string;
  explicit_end_at?: string;
  object_timeline: HistoryObjectTimelineResponse;
  relations: HistoryRelationsResponse;
  events: HistoryEventTimelineResponse | null;
}): ObjectExplorerViewModel {
  const timeline = input.object_timeline.items
    .map(adaptTimelineEntry)
    .sort((left, right) => compareAscending(left.recorded_at, right.recorded_at));

  const eventDetails = (input.events?.items ?? [])
    .map(adaptEventItem)
    .sort((left, right) => compareAscending(left.occurred_at, right.occurred_at));

  const eventIdsWithDetails = new Set(eventDetails.map((item) => item.event_id));

  const relations = input.relations.items
    .map((item) => adaptRelationEntry(item, eventIdsWithDetails))
    .sort((left, right) => {
      const byOccurred = compareAscending(left.occurred_at, right.occurred_at);
      if (byOccurred !== 0) {
        return byOccurred;
      }
      return compareAscending(left.linked_at, right.linked_at);
    });

  const uniqueRelatedEvents = new Set(relations.map((item) => item.event_id));

  return {
    object_type: input.object_type,
    object_ref_hash: input.object_ref_hash,
    object_ref_canonical: input.object_ref_canonical,
    source: input.source,
    timeline,
    relations,
    event_details: eventDetails,
    window: inferWindow({
      explicit_start_at: input.explicit_start_at,
      explicit_end_at: input.explicit_end_at,
      timeline,
      relations,
    }),
    kpis: {
      snapshot_count: timeline.length,
      relation_count: relations.length,
      unique_related_event_count: uniqueRelatedEvents.size,
      event_detail_count: eventDetails.length,
    },
    meta: buildViewModelMeta(),
  };
}

export function getEventIdsForDetailLookup(params: {
  timeline: HistoryObjectTimelineResponse;
  relations: HistoryRelationsResponse;
}): string[] {
  const eventIds = new Set<string>();

  for (const item of params.timeline.items) {
    if (item.source_event_id) {
      eventIds.add(item.source_event_id);
    }
  }

  for (const item of params.relations.items) {
    eventIds.add(item.event_id);
  }

  return Array.from(eventIds);
}
