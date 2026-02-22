"use client";

import { FormEvent, useMemo, useState } from "react";

import {
  fetchProcessTraceDrilldown,
  ProcessMiningResponse,
  ProcessTraceDrilldownResponse,
  runProcessMining,
} from "@/lib/backend-process";

function toLocalInputValue(value: Date): string {
  const offset = value.getTimezoneOffset() * 60_000;
  return new Date(value.getTime() - offset).toISOString().slice(0, 16);
}

function parseLocalInput(value: string): string {
  return new Date(value).toISOString();
}

export function ProcessExplorer() {
  const now = useMemo(() => new Date(), []);
  const initialStart = useMemo(
    () => toLocalInputValue(new Date(now.getTime() - 6 * 60 * 60 * 1_000)),
    [now]
  );
  const initialEnd = useMemo(() => toLocalInputValue(now), [now]);

  const [anchorObjectType, setAnchorObjectType] = useState("Order");
  const [startAt, setStartAt] = useState(initialStart);
  const [endAt, setEndAt] = useState(initialEnd);
  const [isLoading, setIsLoading] = useState(false);
  const [runResult, setRunResult] = useState<ProcessMiningResponse | null>(null);
  const [runError, setRunError] = useState<string | null>(null);

  const [traceResult, setTraceResult] = useState<ProcessTraceDrilldownResponse | null>(null);
  const [traceError, setTraceError] = useState<string | null>(null);
  const [traceLoading, setTraceLoading] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsLoading(true);
    setRunError(null);
    setTraceResult(null);
    setTraceError(null);

    try {
      const response = await runProcessMining({
        anchor_object_type: anchorObjectType.trim(),
        start_at: parseLocalInput(startAt),
        end_at: parseLocalInput(endAt),
      });
      setRunResult(response);
    } catch (error) {
      setRunResult(null);
      setRunError(error instanceof Error ? error.message : "Process mining request failed");
    } finally {
      setIsLoading(false);
    }
  }

  async function onDrilldown(handle: string) {
    setTraceLoading(true);
    setTraceError(null);

    try {
      const response = await fetchProcessTraceDrilldown(handle, 25);
      setTraceResult(response);
    } catch (error) {
      setTraceResult(null);
      setTraceError(error instanceof Error ? error.message : "Trace drill-down failed");
    } finally {
      setTraceLoading(false);
    }
  }

  return (
    <main className="process-shell">
      <section className="process-header">
        <p className="eyebrow">MVP Phase 3</p>
        <h1>Process Explorer</h1>
        <p>
          Object-centric mining run form and model drill-down for traces produced from
          event/object/link history.
        </p>
      </section>

      <section className="process-grid" aria-label="Process mining controls and output">
        <article className="process-panel">
          <h2>Run Mining</h2>
          <form onSubmit={onSubmit}>
            <label className="field-label" htmlFor="anchor-type">
              Anchor object type
            </label>
            <input
              id="anchor-type"
              value={anchorObjectType}
              onChange={(event) => setAnchorObjectType(event.target.value)}
              required
            />

            <label className="field-label" htmlFor="start-at">
              Start time
            </label>
            <input
              id="start-at"
              type="datetime-local"
              value={startAt}
              onChange={(event) => setStartAt(event.target.value)}
              required
            />

            <label className="field-label" htmlFor="end-at">
              End time
            </label>
            <input
              id="end-at"
              type="datetime-local"
              value={endAt}
              onChange={(event) => setEndAt(event.target.value)}
              required
            />

            <button type="submit" disabled={isLoading}>
              {isLoading ? "Running..." : "Run process mining"}
            </button>
          </form>
          {runError ? <p className="status degraded">{runError}</p> : null}
        </article>

        <article className="process-panel">
          <h2>Model Output</h2>
          {runResult ? (
            <>
              <p className="status ok">Run {runResult.run_id}</p>
              <p>
                Window: {new Date(runResult.start_at).toLocaleString()} to{" "}
                {new Date(runResult.end_at).toLocaleString()}
              </p>
              <p>Object types: {runResult.object_types.join(", ") || "none"}</p>
              {runResult.warnings.length > 0 ? (
                <p className="status degraded">{runResult.warnings.join(" | ")}</p>
              ) : null}

              <h3>Nodes</h3>
              <ul className="process-list">
                {runResult.nodes.map((node) => (
                  <li key={node.id}>
                    <button type="button" onClick={() => onDrilldown(node.trace_handle)}>
                      {node.label} ({node.frequency})
                    </button>
                  </li>
                ))}
              </ul>

              <h3>Edges</h3>
              <ul className="process-list">
                {runResult.edges.map((edge) => (
                  <li key={edge.id}>
                    <button type="button" onClick={() => onDrilldown(edge.trace_handle)}>
                      {edge.object_type}: {edge.source.replace("event:", "")} -&gt;{" "}
                      {edge.target.replace("event:", "")} ({edge.count})
                    </button>
                  </li>
                ))}
              </ul>

              <h3>Path Stats</h3>
              <ul className="process-list">
                {runResult.path_stats.map((stat) => (
                  <li key={`${stat.object_type}-${stat.path}`}>
                    <button type="button" onClick={() => onDrilldown(stat.trace_handle)}>
                      {stat.object_type}: {stat.path} ({stat.count})
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p>Run a mining query to populate model output.</p>
          )}
        </article>

        <article className="process-panel">
          <h2>Trace Drill-Down</h2>
          {traceLoading ? <p>Loading traces...</p> : null}
          {traceError ? <p className="status degraded">{traceError}</p> : null}
          {traceResult ? (
            <>
              <p>
                Selector: {traceResult.selector_type} | Matches: {traceResult.matched_count}
                {traceResult.truncated ? " (truncated)" : ""}
              </p>
              <ul className="trace-list">
                {traceResult.traces.map((trace) => (
                  <li key={`${trace.object_type}-${trace.object_ref_hash}-${trace.start_at}`}>
                    <p>
                      {trace.object_type} #{trace.object_ref_hash}
                    </p>
                    <p>{trace.event_types.join(" -> ")}</p>
                    <p>
                      {new Date(trace.start_at).toLocaleTimeString()} to{" "}
                      {new Date(trace.end_at).toLocaleTimeString()}
                    </p>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p>Choose a node, edge, or path to load supporting traces.</p>
          )}
        </article>
      </section>
    </main>
  );
}
