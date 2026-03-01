"use client";

import { Badge } from "../ui/badge";

export type ObjectHistoryTimelineHighlight = {
  key: string;
  label: string;
  value: string;
};

export type ObjectHistoryTimelineStateTransition = {
  from: string;
  to: string;
};

export type ObjectHistoryTimelineEntry = {
  timelineKey: string;
  eventName: string;
  time: string;
  role: string;
  source: string;
  shortEventId: string;
  payloadSummary: string;
  highlights: ObjectHistoryTimelineHighlight[];
  stateTransition: ObjectHistoryTimelineStateTransition | null;
};

export type ObjectHistoryTimelineGroup = {
  dayKey: string;
  dayLabel: string;
  entries: ObjectHistoryTimelineEntry[];
};

interface ObjectHistoryTimelineProps {
  groups: ObjectHistoryTimelineGroup[];
  hasAnyEvents: boolean;
  loading: boolean;
}

export function ObjectHistoryTimeline({ groups, hasAnyEvents, loading }: ObjectHistoryTimelineProps) {
  if (!hasAnyEvents && !loading) {
    return (
      <div className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        No events found for this object identity.
      </div>
    );
  }

  return (
    <>
      {groups.map((group) => (
        <section key={group.dayKey} className="space-y-3">
          <div className="sticky top-0 z-[1] rounded-md bg-card/90 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground backdrop-blur">
            {group.dayLabel}
          </div>
          <div className="relative space-y-3 pl-5">
            <div className="pointer-events-none absolute bottom-2 left-1 top-2 w-px bg-border/70" />
            {group.entries.map((entry) => (
              <div key={entry.timelineKey} className="relative">
                <span className="absolute -left-[19px] top-4 h-2.5 w-2.5 rounded-full border border-border bg-card" />
                <article className="rounded-2xl border border-border bg-card p-4 shadow-sm">
                  <header className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-[0.65rem] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                        Event
                      </div>
                      <div className="font-display text-sm">{entry.eventName}</div>
                      <div className="text-xs text-muted-foreground">{entry.time}</div>
                    </div>
                    <Badge className="rounded-full border border-foreground/15 bg-background px-3 py-1 text-[0.6rem] font-semibold uppercase tracking-[0.2em] text-foreground">
                      {entry.role}
                    </Badge>
                  </header>

                  {entry.stateTransition && (
                    <div className="mt-3 flex items-center gap-2 text-xs">
                      <span className="font-medium text-muted-foreground">State</span>
                      <Badge variant="outline" className="rounded-full">
                        {entry.stateTransition.from}
                      </Badge>
                      <span className="text-muted-foreground">to</span>
                      <Badge variant="outline" className="rounded-full">
                        {entry.stateTransition.to}
                      </Badge>
                    </div>
                  )}

                  {entry.highlights.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {entry.highlights.map((highlight) => (
                        <span
                          key={`${entry.shortEventId}-${highlight.key}`}
                          className="inline-flex max-w-full items-center gap-1 rounded-full border border-border bg-muted/30 px-2.5 py-1 text-[11px] text-foreground"
                          title={`${highlight.label}: ${highlight.value}`}
                        >
                          <span className="text-muted-foreground">{highlight.label}</span>
                          <span className="truncate">{highlight.value}</span>
                        </span>
                      ))}
                    </div>
                  )}

                  <p className="mt-3 text-xs text-muted-foreground">{entry.payloadSummary}</p>
                  <footer className="mt-3 text-xs text-muted-foreground">
                    {entry.source} • Event {entry.shortEventId}
                  </footer>
                </article>
              </div>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}
