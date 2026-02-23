"use client";

import Link from "next/link";
import { FormEvent, useMemo, useRef, useState } from "react";

import { AiResponsePanel } from "@/components/ai-response-panel";
import { RunState, RunStatePill } from "@/components/run-state-pill";
import {
  ProcessDrilldownSelectorViewModel,
  adaptProcessRunV2,
  adaptProcessTraceDrilldownV2,
  filterSelectorsByText,
} from "@/lib/adapters/process-v2-adapter";
import { AiProcessInterpretResponse, interpretAiProcessRun } from "@/lib/backend-ai";
import {
  ProcessMiningRequest,
  ProcessMiningResponse,
  ProcessTraceDrilldownResponse,
  fetchProcessTraceDrilldown,
  runProcessMining,
} from "@/lib/backend-process";

import { ProcessGraphStage } from "./process-graph-stage";
import { ProcessRunControlValues, ProcessRunControls } from "./process-run-controls";
import styles from "./process-experience-v2.module.css";

function toLocalInputValue(value: Date): string {
  const offset = value.getTimezoneOffset() * 60_000;
  return new Date(value.getTime() - offset).toISOString().slice(0, 16);
}

function parseLocalInput(value: string): string {
  return new Date(value).toISOString();
}

function parseCommaSeparated(value: string): string[] {
  const unique = new Set<string>();
  value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .forEach((part) => unique.add(part));
  return Array.from(unique);
}

function parsePositiveNumber(value: string): number | undefined {
  if (!value.trim()) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }
  return Math.floor(parsed);
}

function formatDateTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) {
    return value;
  }
  return parsed.toLocaleString();
}

function formatDuration(milliseconds: number): string {
  if (milliseconds <= 0) {
    return "0m";
  }
  const minutes = Math.round(milliseconds / 60000);
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

function buildIngestionHref(
  trace: {
    object_type: string;
    object_ref_canonical: string;
    start_at: string;
    end_at: string;
  },
  selector: ProcessDrilldownSelectorViewModel | null
): string {
  const params = new URLSearchParams({
    source: "process-v2",
    object_type: trace.object_type,
    object_ref: trace.object_ref_canonical,
    start_at: trace.start_at,
    end_at: trace.end_at,
  });
  if (selector) {
    params.set("selector_type", selector.kind);
    params.set("selector_label", selector.label);
  }
  return `/ingestion?${params.toString()}`;
}

export function ProcessExperienceV2() {
  const now = useMemo(() => new Date(), []);
  const initialStart = useMemo(
    () => toLocalInputValue(new Date(now.getTime() - 8 * 60 * 60 * 1_000)),
    [now]
  );
  const initialEnd = useMemo(() => toLocalInputValue(now), [now]);

  const [controls, setControls] = useState<ProcessRunControlValues>({
    anchor_object_type: "Order",
    include_object_types: "",
    start_at: initialStart,
    end_at: initialEnd,
    max_events: "",
    max_relations: "",
    max_traces_per_handle: "",
    trace_limit: 25,
  });
  const [selectorSearch, setSelectorSearch] = useState("");
  const [selectedSelectorId, setSelectedSelectorId] = useState<string | null>(null);

  const [runState, setRunState] = useState<RunState>("completed");
  const [runError, setRunError] = useState<string | null>(null);
  const [runResult, setRunResult] = useState<ProcessMiningResponse | null>(null);

  const [traceState, setTraceState] = useState<RunState>("completed");
  const [traceError, setTraceError] = useState<string | null>(null);
  const [traceResult, setTraceResult] = useState<ProcessTraceDrilldownResponse | null>(null);

  const [aiState, setAiState] = useState<RunState>("completed");
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiResult, setAiResult] = useState<AiProcessInterpretResponse | null>(null);

  const traceRequestNonce = useRef(0);

  const runView = useMemo(() => (runResult ? adaptProcessRunV2(runResult) : null), [runResult]);
  const traceView = useMemo(
    () => (traceResult ? adaptProcessTraceDrilldownV2(traceResult) : null),
    [traceResult]
  );
  const visibleSelectors = useMemo(
    () => (runView ? filterSelectorsByText(runView.selectors, selectorSearch) : []),
    [runView, selectorSearch]
  );
  const selectedSelector = useMemo(() => {
    if (!runView || !selectedSelectorId) {
      return null;
    }
    return runView.selectors.find((selector) => selector.id === selectedSelectorId) ?? null;
  }, [runView, selectedSelectorId]);

  function updateControls(next: Partial<ProcessRunControlValues>): void {
    setControls((current) => ({ ...current, ...next }));
  }

  function buildMiningPayload(): ProcessMiningRequest {
    const payload: ProcessMiningRequest = {
      anchor_object_type: controls.anchor_object_type.trim(),
      start_at: parseLocalInput(controls.start_at),
      end_at: parseLocalInput(controls.end_at),
    };

    const includeObjectTypes = parseCommaSeparated(controls.include_object_types);
    if (includeObjectTypes.length > 0) {
      payload.include_object_types = includeObjectTypes;
    }

    const maxEvents = parsePositiveNumber(controls.max_events);
    if (maxEvents) {
      payload.max_events = maxEvents;
    }
    const maxRelations = parsePositiveNumber(controls.max_relations);
    if (maxRelations) {
      payload.max_relations = maxRelations;
    }
    const maxTracesPerHandle = parsePositiveNumber(controls.max_traces_per_handle);
    if (maxTracesPerHandle) {
      payload.max_traces_per_handle = maxTracesPerHandle;
    }

    return payload;
  }

  async function onRunSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRunState("queued");
    setRunError(null);
    setSelectedSelectorId(null);
    setRunResult(null);
    setTraceResult(null);
    setTraceError(null);
    setTraceState("completed");
    setAiResult(null);
    setAiError(null);
    setAiState("completed");
    await Promise.resolve();
    setRunState("running");

    try {
      const response = await runProcessMining(buildMiningPayload());
      setRunResult(response);
      setRunState("completed");
    } catch (error) {
      setRunResult(null);
      setRunState("error");
      setRunError(error instanceof Error ? error.message : "Process mining request failed");
    }
  }

  async function loadTraceDrilldown(selector: ProcessDrilldownSelectorViewModel) {
    setSelectedSelectorId(selector.id);
    setTraceState("queued");
    setTraceError(null);
    setTraceResult(null);
    const requestId = traceRequestNonce.current + 1;
    traceRequestNonce.current = requestId;
    await Promise.resolve();
    setTraceState("running");

    const clampedLimit = Math.max(1, Math.min(500, controls.trace_limit));

    try {
      const response = await fetchProcessTraceDrilldown(selector.trace_handle, clampedLimit);
      if (traceRequestNonce.current !== requestId) {
        return;
      }
      setTraceResult(response);
      setTraceState("completed");
    } catch (error) {
      if (traceRequestNonce.current !== requestId) {
        return;
      }
      setTraceResult(null);
      setTraceState("error");
      setTraceError(error instanceof Error ? error.message : "Trace drill-down failed");
    }
  }

  async function onAiInterpret() {
    if (!runResult) {
      return;
    }
    setAiState("queued");
    setAiError(null);
    setAiResult(null);
    await Promise.resolve();
    setAiState("running");
    try {
      const response = await interpretAiProcessRun({ run: runResult });
      setAiResult(response);
      setAiState("completed");
    } catch (error) {
      setAiResult(null);
      setAiState("error");
      setAiError(error instanceof Error ? error.message : "AI interpretation failed");
    }
  }

  return (
    <main className={styles.shell}>
      <section className={styles.headerCard}>
        <p className="eyebrow">Phase C Replatform</p>
        <h1>Process Explorer Experience v2</h1>
        <p>
          Inspector-style process analysis workspace using canonical process APIs with deterministic
          drill-down and integrated analytical AI interpretation.
        </p>
        {runView ? (
          <div className={styles.headerMeta}>
            <p className={styles.inlineMeta}>Run {runView.run_id}</p>
            <p className={styles.inlineMeta}>Window: {runView.window_label}</p>
          </div>
        ) : null}
      </section>

      <section className={styles.workspace} aria-label="Process explorer v2 workspace">
        <div className={styles.leftRail}>
          <ProcessRunControls
            values={controls}
            run_state={runState}
            run_error={runError}
            on_change={updateControls}
            on_submit={onRunSubmit}
          />

          <article className={styles.panel}>
            <div className={styles.panelHeader}>
              <h2>Run Statistics</h2>
              <p>Deterministic model totals and object-type scope for investigation handoffs.</p>
            </div>
            {runView ? (
              <>
                <dl className={styles.kpiGrid}>
                  <div>
                    <dt>Nodes</dt>
                    <dd>{runView.kpis.node_count.toLocaleString()}</dd>
                  </div>
                  <div>
                    <dt>Edges</dt>
                    <dd>{runView.kpis.edge_count.toLocaleString()}</dd>
                  </div>
                  <div>
                    <dt>Paths</dt>
                    <dd>{runView.kpis.path_count.toLocaleString()}</dd>
                  </div>
                  <div>
                    <dt>Edge Obs</dt>
                    <dd>{runView.kpis.total_edge_observations.toLocaleString()}</dd>
                  </div>
                </dl>
                <p className={styles.inlineMeta}>
                  Anchor: <strong>{runView.anchor_object_type}</strong>
                </p>
                <div className={styles.objectTypeBadges} aria-label="Object types in run scope">
                  {runView.object_types.map((objectType) => (
                    <span key={objectType}>{objectType}</span>
                  ))}
                </div>
                {runView.warnings.length > 0 ? (
                  <ul className={styles.warningList}>
                    {runView.warnings.map((warning) => (
                      <li key={warning} className="status degraded">
                        {warning}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </>
            ) : (
              <p className={styles.emptyState}>Run process mining to populate model statistics.</p>
            )}
          </article>
        </div>

        <div className={styles.centerRail}>
          {runView ? (
            <ProcessGraphStage
              run={runView}
              selected_selector_id={selectedSelectorId}
              on_select={loadTraceDrilldown}
            />
          ) : (
            <article className={styles.panel}>
              <div className={styles.panelHeader}>
                <h2>Graph + Drilldown</h2>
              </div>
              <p className={styles.emptyState}>
                Run mining to render object-type lanes and interaction-ready selectors.
              </p>
            </article>
          )}
        </div>

        <div className={styles.rightRail}>
          <article className={styles.panel}>
            <div className={styles.panelHeader}>
              <h2>Selector Queue</h2>
              <p>Search and run deterministic selectors across nodes, edges, and paths.</p>
            </div>
            <label className={styles.fieldLabel} htmlFor="process-v2-selector-search">
              Filter selectors
            </label>
            <input
              id="process-v2-selector-search"
              value={selectorSearch}
              onChange={(event) => setSelectorSearch(event.target.value)}
              placeholder="Search event, object type, or path"
            />
            <p className={styles.fieldHint}>
              {runView ? `${visibleSelectors.length} selectors available` : "Run required"}
            </p>
            <ul className={styles.selectorList}>
              {visibleSelectors.slice(0, 28).map((selector) => {
                const isActive = selector.id === selectedSelectorId;
                return (
                  <li key={selector.id}>
                    <button
                      type="button"
                      onClick={() => loadTraceDrilldown(selector)}
                      className={`${styles.selectorButton} ${isActive ? styles.selectorActive : ""}`}
                      aria-pressed={isActive}
                    >
                      <strong>{selector.label}</strong>
                      <small>
                        {selector.kind} | {selector.detail} | {selector.count.toLocaleString()}
                      </small>
                    </button>
                  </li>
                );
              })}
            </ul>
          </article>

          <article className={styles.panel}>
            <div className={styles.panelHeader}>
              <h2>Trace Drill-Down</h2>
              <p>Load supporting traces and handoff object context to ingestion exploration.</p>
            </div>
            <RunStatePill state={traceState} label={`Trace drill-down ${traceState}`} />
            {selectedSelector ? (
              <p className={styles.inlineMeta}>
                Selected: <strong>{selectedSelector.label}</strong>
              </p>
            ) : (
              <p className={styles.emptyState}>Choose a selector to load traces.</p>
            )}
            {traceError ? (
              <p className={`status degraded ${styles.inlineStatus}`} role="alert">
                {traceError}
              </p>
            ) : null}
            {traceView ? (
              <section aria-live="polite">
                <p className={styles.inlineMeta}>
                  {traceView.matched_count.toLocaleString()} matches
                  {traceView.truncated ? " (truncated)" : ""} | Selector type:{" "}
                  {traceView.selector_type}
                </p>
                <ul className={styles.traceList}>
                  {traceView.traces.map((trace) => (
                    <li key={trace.id}>
                      <div className={styles.traceTitleRow}>
                        <strong>
                          {trace.object_type} #{trace.object_ref_hash}
                        </strong>
                        <span>{formatDuration(trace.duration_ms)}</span>
                      </div>
                      <p>{trace.event_path_label || "No event type path available"}</p>
                      <p>
                        {formatDateTime(trace.start_at)} to {formatDateTime(trace.end_at)}
                      </p>
                      <Link href={buildIngestionHref(trace, selectedSelector)}>Open in ingestion</Link>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </article>

          <article className={styles.panel}>
            <div className={styles.panelHeader}>
              <h2>AI Interpretation</h2>
              <p>Analytical summary on-demand, preserving shared run-state behavior.</p>
            </div>
            <button type="button" onClick={onAiInterpret} disabled={!runResult || aiState === "running"}>
              {aiState === "running" ? "Generating interpretation..." : "AI assist: interpret run"}
            </button>
            <RunStatePill state={aiState} label={`AI ${aiState}`} />
            {aiError ? (
              <p className={`status degraded ${styles.inlineStatus}`} role="alert">
                {aiError}
              </p>
            ) : null}
            {aiResult ? (
              <AiResponsePanel
                title="Process AI Interpretation"
                summary={aiResult.summary}
                evidence={aiResult.evidence}
                caveats={aiResult.caveats}
                nextActions={aiResult.next_actions}
              />
            ) : null}
          </article>
        </div>
      </section>
    </main>
  );
}
