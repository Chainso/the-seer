"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

import { RunState, RunStatePill } from "@/components/run-state-pill";
import {
  adaptObjectExplorerViewModel,
  getEventIdsForDetailLookup,
  type EventDetailViewModel,
  type ObjectExplorerViewModel,
} from "@/lib/adapters/history-object-explorer-adapter";
import { resolveObjectRefHash, xxhash64Uint64 } from "@/lib/adapters/history-hash-adapter";
import {
  fetchHistoryEvents,
  fetchHistoryObjectTimeline,
  fetchHistoryRelations,
  type HistoryEventTimelineResponse,
  type HistoryObjectTimelineResponse,
  type HistoryRelationsResponse,
} from "@/lib/backend-history";

import styles from "./ingestion-object-explorer-experience-v2.module.css";

type ExplorerControls = {
  object_type: string;
  object_ref_hash: string;
  object_ref: string;
  event_id: string;
  start_at: string;
  end_at: string;
  timeline_limit: string;
  relation_limit: string;
  event_limit: string;
  event_type: string;
};

function toLocalInputValue(value: Date): string {
  const offset = value.getTimezoneOffset() * 60_000;
  return new Date(value.getTime() - offset).toISOString().slice(0, 16);
}

function parseSearchDateInput(value: string | null): string {
  if (!value) {
    return "";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) {
    return "";
  }
  return toLocalInputValue(parsed);
}

function parseOptionalLocalInput(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.valueOf())) {
    return undefined;
  }
  return parsed.toISOString();
}

function parseLimit(value: string, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.max(1, Math.min(1000, Math.floor(parsed)));
}

function formatDateTime(value: string | null): string {
  if (!value) {
    return "Unknown";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) {
    return value;
  }
  return parsed.toLocaleString();
}

function compactId(value: string): string {
  if (value.length <= 18) {
    return value;
  }
  return `${value.slice(0, 8)}…${value.slice(-8)}`;
}

function deriveEventLookupWindow(params: {
  explicit_start_at?: string;
  explicit_end_at?: string;
  timeline: HistoryObjectTimelineResponse;
  relations: HistoryRelationsResponse;
}): { start_at?: string; end_at?: string } {
  if (params.explicit_start_at || params.explicit_end_at) {
    return {
      start_at: params.explicit_start_at,
      end_at: params.explicit_end_at,
    };
  }

  const points: Array<{ timestamp: string; epoch: number }> = [];

  for (const item of params.timeline.items) {
    const epoch = new Date(item.recorded_at).valueOf();
    if (!Number.isNaN(epoch)) {
      points.push({ timestamp: item.recorded_at, epoch });
    }
  }

  for (const item of params.relations.items) {
    const occurredEpoch = item.occurred_at ? new Date(item.occurred_at).valueOf() : Number.NaN;
    if (!Number.isNaN(occurredEpoch) && item.occurred_at) {
      points.push({ timestamp: item.occurred_at, epoch: occurredEpoch });
      continue;
    }

    const linkedEpoch = new Date(item.linked_at).valueOf();
    if (!Number.isNaN(linkedEpoch)) {
      points.push({ timestamp: item.linked_at, epoch: linkedEpoch });
    }
  }

  if (points.length === 0) {
    return {};
  }

  points.sort((left, right) => left.epoch - right.epoch);
  const start = points[0]?.timestamp;
  const end = points[points.length - 1]?.timestamp;

  return {
    start_at: start,
    end_at: end,
  };
}

function findInitialSelectedEvent(
  currentId: string | null,
  eventDetails: EventDetailViewModel[]
): string | null {
  if (eventDetails.length === 0) {
    return null;
  }

  if (currentId && eventDetails.some((item) => item.event_id === currentId)) {
    return currentId;
  }

  return eventDetails[0]?.event_id ?? null;
}

export function IngestionObjectExplorerExperienceV2() {
  const searchParams = useSearchParams();

  const [controls, setControls] = useState<ExplorerControls>({
    object_type: searchParams.get("object_type")?.trim() || "",
    object_ref_hash: searchParams.get("object_ref_hash")?.trim() || "",
    object_ref: searchParams.get("object_ref")?.trim() || "",
    event_id: searchParams.get("event_id")?.trim() || "",
    start_at: parseSearchDateInput(searchParams.get("start_at")),
    end_at: parseSearchDateInput(searchParams.get("end_at")),
    timeline_limit: "200",
    relation_limit: "200",
    event_limit: "400",
    event_type: searchParams.get("event_type")?.trim() || "",
  });

  const [runState, setRunState] = useState<RunState>("completed");
  const [runError, setRunError] = useState<string | null>(null);
  const [view, setView] = useState<ObjectExplorerViewModel | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);

  const source = searchParams.get("source")?.trim() || null;
  const selectorType = searchParams.get("selector_type")?.trim() || null;
  const selectorLabel = searchParams.get("selector_label")?.trim() || null;

  const didAutoRun = useRef(false);

  const eventDetailMap = useMemo(() => {
    const map = new Map<string, EventDetailViewModel>();
    for (const item of view?.event_details ?? []) {
      map.set(item.event_id, item);
    }
    return map;
  }, [view]);

  const selectedEventDetail = useMemo(() => {
    if (!selectedEventId) {
      return null;
    }
    return eventDetailMap.get(selectedEventId) ?? null;
  }, [eventDetailMap, selectedEventId]);

  const eventIdsWithDetails = useMemo(() => new Set(view?.event_details.map((item) => item.event_id) ?? []), [view]);

  const runExplorer = useCallback(async () => {
    const timelineLimit = parseLimit(controls.timeline_limit, 200);
    const relationLimit = parseLimit(controls.relation_limit, 200);
    const eventLimit = parseLimit(controls.event_limit, 400);

    const explicitStart = parseOptionalLocalInput(controls.start_at);
    const explicitEnd = parseOptionalLocalInput(controls.end_at);

    if (explicitStart && explicitEnd && new Date(explicitStart).valueOf() >= new Date(explicitEnd).valueOf()) {
      setRunState("error");
      setRunError("End time must be after start time.");
      return;
    }

    setRunState("queued");
    setRunError(null);
    setView(null);
    setSelectedEventId(null);
    await Promise.resolve();
    setRunState("running");

    try {
      const inputObjectType = controls.object_type.trim();
      const inputEventId = controls.event_id.trim();

      let resolvedObjectType = inputObjectType;
      let resolvedObjectRefHash = "";
      let resolvedObjectRefCanonical: string | null = null;

      if (inputObjectType && (controls.object_ref_hash.trim() || controls.object_ref.trim())) {
        const resolved = resolveObjectRefHash({
          object_ref_hash: controls.object_ref_hash,
          object_ref: controls.object_ref,
        });
        resolvedObjectType = inputObjectType;
        resolvedObjectRefHash = resolved.object_ref_hash;
        resolvedObjectRefCanonical = resolved.object_ref_canonical;
      } else if (inputEventId) {
        const relationLookup = await fetchHistoryRelations({
          event_id: inputEventId,
          limit: relationLimit,
        });
        const candidate =
          relationLookup.items.find((item) => !inputObjectType || item.object_type === inputObjectType) ??
          relationLookup.items[0];

        if (!candidate) {
          throw new Error("No related objects found for the provided event id.");
        }

        resolvedObjectType = candidate.object_type;
        resolvedObjectRefCanonical = candidate.object_ref_canonical;
        resolvedObjectRefHash = xxhash64Uint64(candidate.object_ref_canonical);
      } else {
        throw new Error("Provide object type + object ref hash/object ref, or provide event id.");
      }

      const [timelineResponse, relationsResponse] = await Promise.all([
        fetchHistoryObjectTimeline({
          object_type: resolvedObjectType,
          object_ref_hash: resolvedObjectRefHash,
          start_at: explicitStart,
          end_at: explicitEnd,
          limit: timelineLimit,
        }),
        fetchHistoryRelations({
          object_type: resolvedObjectType,
          object_ref_hash: resolvedObjectRefHash,
          limit: relationLimit,
        }),
      ]);

      const eventIds = getEventIdsForDetailLookup({
        timeline: timelineResponse,
        relations: relationsResponse,
      });
      const lookupWindow = deriveEventLookupWindow({
        explicit_start_at: explicitStart,
        explicit_end_at: explicitEnd,
        timeline: timelineResponse,
        relations: relationsResponse,
      });

      let eventsResponse: HistoryEventTimelineResponse | null = null;
      if (
        eventIds.length > 0 &&
        (lookupWindow.start_at || lookupWindow.end_at || controls.event_type.trim())
      ) {
        const eventTimeline = await fetchHistoryEvents({
          start_at: lookupWindow.start_at,
          end_at: lookupWindow.end_at,
          event_type: controls.event_type.trim() || undefined,
          limit: eventLimit,
        });

        const relevantEventIds = new Set(eventIds);
        eventsResponse = {
          items: eventTimeline.items.filter((item) => relevantEventIds.has(item.event_id)),
        };
      }

      const nextView = adaptObjectExplorerViewModel({
        object_type: resolvedObjectType,
        object_ref_hash: resolvedObjectRefHash,
        object_ref_canonical: resolvedObjectRefCanonical,
        source,
        explicit_start_at: explicitStart,
        explicit_end_at: explicitEnd,
        object_timeline: timelineResponse,
        relations: relationsResponse,
        events: eventsResponse,
      });

      setView(nextView);
      setSelectedEventId((current) => findInitialSelectedEvent(current, nextView.event_details));

      setControls((current) => ({
        ...current,
        object_type: resolvedObjectType,
        object_ref_hash: resolvedObjectRefHash,
        object_ref: resolvedObjectRefCanonical ?? current.object_ref,
      }));

      setRunState("completed");
    } catch (error) {
      setRunState("error");
      setView(null);
      setRunError(error instanceof Error ? error.message : "Object explorer request failed");
    }
  }, [controls, source]);

  useEffect(() => {
    if (didAutoRun.current) {
      return;
    }

    didAutoRun.current = true;
    const hasDeepLinkContext = Boolean(
      controls.object_ref_hash.trim() || controls.object_ref.trim() || controls.event_id.trim()
    );

    if (!hasDeepLinkContext) {
      return;
    }

    void runExplorer();
  }, [controls.event_id, controls.object_ref, controls.object_ref_hash, runExplorer]);

  function updateControls(next: Partial<ExplorerControls>): void {
    setControls((current) => ({ ...current, ...next }));
  }

  function onSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void runExplorer();
  }

  return (
    <main className={styles.shell}>
      <section className={styles.headerCard}>
        <p className="eyebrow">Phase G Replatform</p>
        <h1>Ingestion Object Explorer v2</h1>
        <p>
          Object-centric history explorer powered by canonical history contracts for timeline,
          relations, and supporting event detail lookup.
        </p>
        <div className={styles.headerMeta}>
          {source ? <p className={styles.inlineMeta}>Source: {source}</p> : null}
          {selectorType ? <p className={styles.inlineMeta}>Selector: {selectorType}</p> : null}
          {selectorLabel ? <p className={styles.inlineMeta}>Label: {selectorLabel}</p> : null}
        </div>
      </section>

      <section className={styles.workspace} aria-label="Ingestion object explorer workspace">
        <div className={styles.leftRail}>
          <article className={styles.panel}>
            <div className={styles.panelHeader}>
              <h2>Object Context</h2>
              <p>Provide object context directly, or provide an event id to pivot into related objects.</p>
            </div>

            <form className={styles.form} onSubmit={onSubmit}>
              <label className="field-label" htmlFor="ingest-v2-object-type">
                Object type
              </label>
              <input
                id="ingest-v2-object-type"
                value={controls.object_type}
                onChange={(event) => updateControls({ object_type: event.target.value })}
                placeholder="Order"
              />

              <label className="field-label" htmlFor="ingest-v2-object-ref-hash">
                Object ref hash (optional)
              </label>
              <input
                id="ingest-v2-object-ref-hash"
                value={controls.object_ref_hash}
                onChange={(event) => updateControls({ object_ref_hash: event.target.value })}
                inputMode="numeric"
                placeholder="10102171535360337240"
              />

              <label className="field-label" htmlFor="ingest-v2-object-ref">
                Canonical object ref (optional)
              </label>
              <textarea
                id="ingest-v2-object-ref"
                value={controls.object_ref}
                onChange={(event) => updateControls({ object_ref: event.target.value })}
                rows={4}
                placeholder='{"id":"order-1","tenant":"acme"}'
              />

              <label className="field-label" htmlFor="ingest-v2-event-id">
                Event id pivot (optional)
              </label>
              <input
                id="ingest-v2-event-id"
                value={controls.event_id}
                onChange={(event) => updateControls({ event_id: event.target.value })}
                placeholder="UUID"
              />

              <div className={styles.fieldGrid}>
                <div>
                  <label className="field-label" htmlFor="ingest-v2-start">
                    Start time
                  </label>
                  <input
                    id="ingest-v2-start"
                    type="datetime-local"
                    value={controls.start_at}
                    onChange={(event) => updateControls({ start_at: event.target.value })}
                  />
                </div>

                <div>
                  <label className="field-label" htmlFor="ingest-v2-end">
                    End time
                  </label>
                  <input
                    id="ingest-v2-end"
                    type="datetime-local"
                    value={controls.end_at}
                    onChange={(event) => updateControls({ end_at: event.target.value })}
                  />
                </div>
              </div>

              <div className={styles.fieldGrid}>
                <div>
                  <label className="field-label" htmlFor="ingest-v2-timeline-limit">
                    Timeline limit
                  </label>
                  <input
                    id="ingest-v2-timeline-limit"
                    type="number"
                    min={1}
                    max={1000}
                    value={controls.timeline_limit}
                    onChange={(event) => updateControls({ timeline_limit: event.target.value })}
                  />
                </div>

                <div>
                  <label className="field-label" htmlFor="ingest-v2-relation-limit">
                    Relation limit
                  </label>
                  <input
                    id="ingest-v2-relation-limit"
                    type="number"
                    min={1}
                    max={1000}
                    value={controls.relation_limit}
                    onChange={(event) => updateControls({ relation_limit: event.target.value })}
                  />
                </div>
              </div>

              <div className={styles.fieldGrid}>
                <div>
                  <label className="field-label" htmlFor="ingest-v2-event-limit">
                    Event detail limit
                  </label>
                  <input
                    id="ingest-v2-event-limit"
                    type="number"
                    min={1}
                    max={1000}
                    value={controls.event_limit}
                    onChange={(event) => updateControls({ event_limit: event.target.value })}
                  />
                </div>

                <div>
                  <label className="field-label" htmlFor="ingest-v2-event-type">
                    Event type filter (optional)
                  </label>
                  <input
                    id="ingest-v2-event-type"
                    value={controls.event_type}
                    onChange={(event) => updateControls({ event_type: event.target.value })}
                    placeholder="order.updated"
                  />
                </div>
              </div>

              <button type="submit" disabled={runState === "running"}>
                {runState === "running" ? "Loading object history..." : "Load object explorer"}
              </button>
            </form>

            <div className={styles.stateRow}>
              <RunStatePill state={runState} label={runState === "completed" ? "Ready" : undefined} />
              {runError ? <p className={styles.errorText}>{runError}</p> : null}
            </div>
          </article>

          <article className={styles.panel}>
            <div className={styles.panelHeader}>
              <h2>Explorer Summary</h2>
              <p>Current object context and coverage across history panels.</p>
            </div>

            {view ? (
              <>
                <dl className={styles.contextGrid}>
                  <div>
                    <dt>Object type</dt>
                    <dd>{view.object_type}</dd>
                  </div>
                  <div>
                    <dt>Object ref hash</dt>
                    <dd>{view.object_ref_hash}</dd>
                  </div>
                  <div>
                    <dt>Window start</dt>
                    <dd>{formatDateTime(view.window.start_at)}</dd>
                  </div>
                  <div>
                    <dt>Window end</dt>
                    <dd>{formatDateTime(view.window.end_at)}</dd>
                  </div>
                </dl>

                <dl className={styles.kpiGrid}>
                  <div>
                    <dt>Snapshots</dt>
                    <dd>{view.kpis.snapshot_count}</dd>
                  </div>
                  <div>
                    <dt>Relations</dt>
                    <dd>{view.kpis.relation_count}</dd>
                  </div>
                  <div>
                    <dt>Related events</dt>
                    <dd>{view.kpis.unique_related_event_count}</dd>
                  </div>
                  <div>
                    <dt>Event details</dt>
                    <dd>{view.kpis.event_detail_count}</dd>
                  </div>
                </dl>

                {view.object_ref_canonical ? (
                  <p className={styles.inlineMeta}>Canonical ref: {view.object_ref_canonical}</p>
                ) : null}
                <p className={styles.inlineMeta}>Adapted at: {formatDateTime(view.meta.adapted_at)}</p>
              </>
            ) : (
              <p className={styles.emptyState}>Run a lookup to see object explorer KPIs and context.</p>
            )}
          </article>
        </div>

        <div className={styles.centerRail}>
          <article className={styles.panel}>
            <div className={styles.panelHeader}>
              <h2>Object Timeline</h2>
              <p>Chronological object snapshots for the selected object reference.</p>
            </div>

            {view && view.timeline.length > 0 ? (
              <ul className={styles.timelineList}>
                {view.timeline.map((item) => {
                  const hasDetails = item.source_event_id ? eventIdsWithDetails.has(item.source_event_id) : false;

                  return (
                    <li key={item.id} className={styles.timelineItem}>
                      <div className={styles.timelineHead}>
                        <h3>{formatDateTime(item.recorded_at)}</h3>
                        {item.source_event_id ? (
                          <p className={styles.itemMeta}>Event {compactId(item.source_event_id)}</p>
                        ) : (
                          <p className={styles.itemMeta}>No source event</p>
                        )}
                      </div>

                      <p className={styles.codeBlock}>{item.object_payload_preview}</p>

                      {item.source_event_id && hasDetails ? (
                        <button
                          type="button"
                          className={styles.inlineButton}
                          onClick={() => setSelectedEventId(item.source_event_id)}
                        >
                          Inspect event detail
                        </button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className={styles.emptyState}>No object snapshots found for this context.</p>
            )}
          </article>

          <article className={styles.panel}>
            <div className={styles.panelHeader}>
              <h2>Object Relations</h2>
              <p>Event-object relations for the selected object hash.</p>
            </div>

            {view && view.relations.length > 0 ? (
              <ul className={styles.relationList}>
                {view.relations.map((item) => (
                  <li key={item.id} className={styles.relationItem}>
                    <div className={styles.relationHead}>
                      <h3>{item.event_type ?? "event"}</h3>
                      <p className={styles.itemMeta}>{formatDateTime(item.occurred_at ?? item.linked_at)}</p>
                    </div>
                    <p className={styles.itemMeta}>
                      Event {compactId(item.event_id)} | Source {item.source ?? "n/a"} | Role {item.relation_role ?? "n/a"}
                    </p>
                    {item.object_payload_preview ? (
                      <p className={styles.codeBlock}>{item.object_payload_preview}</p>
                    ) : null}

                    {item.has_event_detail ? (
                      <button
                        type="button"
                        className={styles.inlineButton}
                        onClick={() => setSelectedEventId(item.event_id)}
                      >
                        Inspect event detail
                      </button>
                    ) : (
                      <p className={styles.itemMeta}>No matching event detail loaded.</p>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className={styles.emptyState}>No relations found for this object context.</p>
            )}
          </article>
        </div>

        <div className={styles.rightRail}>
          <article className={styles.panel}>
            <div className={styles.panelHeader}>
              <h2>Event Details</h2>
              <p>Event timeline records matched to object relations and snapshot events.</p>
            </div>

            {view && view.event_details.length > 0 ? (
              <>
                <ul className={styles.eventList}>
                  {view.event_details.map((event) => (
                    <li key={event.event_id}>
                      <button
                        type="button"
                        className={styles.eventButton}
                        data-active={event.event_id === selectedEventId}
                        onClick={() => setSelectedEventId(event.event_id)}
                      >
                        <strong>{event.event_type}</strong>
                        <span>{formatDateTime(event.occurred_at)}</span>
                        <small>{compactId(event.event_id)}</small>
                      </button>
                    </li>
                  ))}
                </ul>

                {selectedEventDetail ? (
                  <section className={styles.eventDetailPanel} aria-live="polite">
                    <h3>{selectedEventDetail.event_type}</h3>
                    <p className={styles.itemMeta}>
                      Event {selectedEventDetail.event_id} | Occurred {formatDateTime(selectedEventDetail.occurred_at)}
                    </p>
                    <p className={styles.itemMeta}>
                      Source {selectedEventDetail.source} | Trace {selectedEventDetail.trace_id ?? "n/a"}
                    </p>
                    <p className={styles.codeBlock}>{selectedEventDetail.payload_preview}</p>
                    {selectedEventDetail.attributes_preview ? (
                      <p className={styles.codeBlock}>{selectedEventDetail.attributes_preview}</p>
                    ) : null}
                  </section>
                ) : null}
              </>
            ) : (
              <p className={styles.emptyState}>
                No event details loaded. Keep the window narrow and increase the event limit when required.
              </p>
            )}
          </article>
        </div>
      </section>
    </main>
  );
}
