"use client";

import { FormEvent, useMemo, useState } from "react";

import {
  InsightResult,
  RcaFilterCondition,
  RootCauseAssistInterpretResponse,
  RootCauseAssistSetupResponse,
  RootCauseEvidenceResponse,
  RootCauseRunResponse,
  assistRootCauseInterpret,
  assistRootCauseSetup,
  fetchRootCauseEvidence,
  runRootCause,
} from "@/lib/backend-root-cause";

function toLocalInputValue(value: Date): string {
  const offset = value.getTimezoneOffset() * 60_000;
  return new Date(value.getTime() - offset).toISOString().slice(0, 16);
}

function parseLocalInput(value: string): string {
  return new Date(value).toISOString();
}

export function RootCauseLab() {
  const now = useMemo(() => new Date(), []);
  const initialStart = useMemo(
    () => toLocalInputValue(new Date(now.getTime() - 24 * 60 * 60 * 1_000)),
    [now]
  );
  const initialEnd = useMemo(() => toLocalInputValue(now), [now]);

  const [anchorObjectType, setAnchorObjectType] = useState("Order");
  const [startAt, setStartAt] = useState(initialStart);
  const [endAt, setEndAt] = useState(initialEnd);
  const [depth, setDepth] = useState(1);
  const [outcomeEventType, setOutcomeEventType] = useState("order.delayed");
  const [outcomeObjectType, setOutcomeObjectType] = useState("");

  const [filterField, setFilterField] = useState("anchor.priority");
  const [filterOp, setFilterOp] = useState<RcaFilterCondition["op"]>("eq");
  const [filterValue, setFilterValue] = useState("high");
  const [filters, setFilters] = useState<RcaFilterCondition[]>([]);

  const [isRunning, setIsRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [runResult, setRunResult] = useState<RootCauseRunResponse | null>(null);

  const [setupLoading, setSetupLoading] = useState(false);
  const [setupResult, setSetupResult] = useState<RootCauseAssistSetupResponse | null>(null);

  const [interpretLoading, setInterpretLoading] = useState(false);
  const [interpretResult, setInterpretResult] = useState<RootCauseAssistInterpretResponse | null>(null);

  const [selectedInsight, setSelectedInsight] = useState<InsightResult | null>(null);
  const [evidenceLoading, setEvidenceLoading] = useState(false);
  const [evidenceError, setEvidenceError] = useState<string | null>(null);
  const [evidenceResult, setEvidenceResult] = useState<RootCauseEvidenceResponse | null>(null);

  function onAddFilter() {
    const field = filterField.trim();
    const value = filterValue.trim();
    if (!field || !value) {
      return;
    }

    setFilters((existing) => {
      const candidate: RcaFilterCondition = { field, op: filterOp, value };
      if (existing.some((item) => JSON.stringify(item) === JSON.stringify(candidate))) {
        return existing;
      }
      return [...existing, candidate];
    });
  }

  function onRemoveFilter(target: RcaFilterCondition) {
    setFilters((existing) =>
      existing.filter(
        (item) =>
          !(item.field === target.field && item.op === target.op && item.value === target.value)
      )
    );
  }

  async function onRun(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsRunning(true);
    setRunError(null);
    setInterpretResult(null);
    setEvidenceResult(null);
    setEvidenceError(null);
    setSelectedInsight(null);

    try {
      const response = await runRootCause({
        anchor_object_type: anchorObjectType.trim(),
        start_at: parseLocalInput(startAt),
        end_at: parseLocalInput(endAt),
        depth,
        outcome: {
          event_type: outcomeEventType.trim(),
          object_type: outcomeObjectType.trim() || null,
        },
        filters,
      });
      setRunResult(response);
    } catch (error) {
      setRunResult(null);
      setRunError(error instanceof Error ? error.message : "Root-cause run failed");
    } finally {
      setIsRunning(false);
    }
  }

  async function onSetupAssist() {
    setSetupLoading(true);
    setRunError(null);

    try {
      const response = await assistRootCauseSetup({
        anchor_object_type: anchorObjectType.trim(),
        start_at: parseLocalInput(startAt),
        end_at: parseLocalInput(endAt),
      });
      setSetupResult(response);
      if (response.suggestions.length > 0) {
        setOutcomeEventType(response.suggestions[0].outcome.event_type);
      }
      setDepth(response.suggested_depth);
    } catch (error) {
      setSetupResult(null);
      setRunError(error instanceof Error ? error.message : "AI setup assist failed");
    } finally {
      setSetupLoading(false);
    }
  }

  async function onInterpretAssist() {
    if (!runResult) {
      return;
    }

    setInterpretLoading(true);
    try {
      const response = await assistRootCauseInterpret({
        baseline_rate: runResult.baseline_rate,
        insights: runResult.insights,
      });
      setInterpretResult(response);
    } catch (error) {
      setInterpretResult({
        summary: error instanceof Error ? error.message : "Interpretation failed",
        caveats: [],
        next_steps: [],
      });
    } finally {
      setInterpretLoading(false);
    }
  }

  async function onLoadEvidence(insight: InsightResult) {
    setSelectedInsight(insight);
    setEvidenceLoading(true);
    setEvidenceError(null);

    try {
      const response = await fetchRootCauseEvidence(insight.evidence_handle, 10);
      setEvidenceResult(response);
    } catch (error) {
      setEvidenceResult(null);
      setEvidenceError(error instanceof Error ? error.message : "Evidence drill-down failed");
    } finally {
      setEvidenceLoading(false);
    }
  }

  return (
    <main className="root-cause-shell">
      <section className="root-cause-header">
        <p className="eyebrow">MVP Phase 4</p>
        <h1>Root-Cause Lab</h1>
        <p>
          Configure a bounded RCA run, inspect ranked associative hypotheses, and drill into
          supporting traces.
        </p>
      </section>

      <section className="root-cause-grid" aria-label="Root-cause controls and analysis panels">
        <article className="root-cause-panel">
          <h2>Run Setup</h2>
          <form onSubmit={onRun}>
            <label className="field-label" htmlFor="rca-anchor-type">
              Anchor object type
            </label>
            <input
              id="rca-anchor-type"
              value={anchorObjectType}
              onChange={(event) => setAnchorObjectType(event.target.value)}
              required
            />

            <label className="field-label" htmlFor="rca-start-at">
              Start time
            </label>
            <input
              id="rca-start-at"
              type="datetime-local"
              value={startAt}
              onChange={(event) => setStartAt(event.target.value)}
              required
            />

            <label className="field-label" htmlFor="rca-end-at">
              End time
            </label>
            <input
              id="rca-end-at"
              type="datetime-local"
              value={endAt}
              onChange={(event) => setEndAt(event.target.value)}
              required
            />

            <label className="field-label" htmlFor="rca-depth">
              Traversal depth (1-3)
            </label>
            <select
              id="rca-depth"
              value={depth}
              onChange={(event) => setDepth(Number(event.target.value))}
            >
              <option value={1}>1</option>
              <option value={2}>2</option>
              <option value={3}>3</option>
            </select>

            <label className="field-label" htmlFor="rca-outcome-event-type">
              Outcome event type
            </label>
            <input
              id="rca-outcome-event-type"
              value={outcomeEventType}
              onChange={(event) => setOutcomeEventType(event.target.value)}
              required
            />

            <label className="field-label" htmlFor="rca-outcome-object-type">
              Outcome object type (optional)
            </label>
            <input
              id="rca-outcome-object-type"
              value={outcomeObjectType}
              onChange={(event) => setOutcomeObjectType(event.target.value)}
              placeholder="Order"
            />

            <div className="filter-builder">
              <p className="field-label">Cohort filter (optional)</p>
              <input
                aria-label="Filter field"
                value={filterField}
                onChange={(event) => setFilterField(event.target.value)}
                placeholder="anchor.priority"
              />
              <select
                aria-label="Filter operator"
                value={filterOp}
                onChange={(event) => setFilterOp(event.target.value as RcaFilterCondition["op"])}
              >
                <option value="eq">eq</option>
                <option value="ne">ne</option>
                <option value="contains">contains</option>
              </select>
              <input
                aria-label="Filter value"
                value={filterValue}
                onChange={(event) => setFilterValue(event.target.value)}
                placeholder="high"
              />
              <button type="button" onClick={onAddFilter}>
                Add filter
              </button>
            </div>

            {filters.length > 0 ? (
              <ul className="filter-list" aria-label="Applied filters">
                {filters.map((filter) => (
                  <li key={`${filter.field}-${filter.op}-${filter.value}`}>
                    <span>{`${filter.field} ${filter.op} ${filter.value}`}</span>
                    <button type="button" onClick={() => onRemoveFilter(filter)}>
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}

            <button type="button" onClick={onSetupAssist} disabled={setupLoading}>
              {setupLoading ? "Drafting setup..." : "AI assist: draft setup"}
            </button>

            <button type="submit" disabled={isRunning}>
              {isRunning ? "Running RCA..." : "Run root-cause analysis"}
            </button>
          </form>
          {runError ? <p className="status degraded">{runError}</p> : null}
        </article>

        <article className="root-cause-panel">
          <h2>Ranked Insights</h2>
          {runResult ? (
            <>
              <p className="status ok">Run {runResult.run_id}</p>
              <p>
                Cohort: {runResult.cohort_size} anchors | Positives: {runResult.positive_count} | Baseline:
                {" "}
                {(runResult.baseline_rate * 100).toFixed(2)}%
              </p>
              <p>Lifted features: {runResult.feature_count}</p>
              {runResult.warnings.length > 0 ? (
                <p className="status degraded">{runResult.warnings.join(" | ")}</p>
              ) : null}
              <p className="rca-caveat">{runResult.interpretation_caveat}</p>

              <ul className="insight-list" aria-label="Ranked hypothesis list">
                {runResult.insights.map((insight) => (
                  <li key={insight.insight_id}>
                    <h3>{`#${insight.rank} ${insight.title}`}</h3>
                    <p>
                      WRAcc: {insight.score.wracc.toFixed(4)} | Lift: {insight.score.lift.toFixed(2)} |
                      Coverage: {(insight.score.coverage * 100).toFixed(2)}%
                    </p>
                    <p>
                      Support: {insight.score.support} anchors ({insight.evidence.matched_positive_count} positive)
                    </p>
                    <button type="button" onClick={() => onLoadEvidence(insight)}>
                      Evidence drill-down
                    </button>
                  </li>
                ))}
              </ul>

              <button type="button" onClick={onInterpretAssist} disabled={interpretLoading}>
                {interpretLoading ? "Interpreting..." : "AI assist: interpret findings"}
              </button>
            </>
          ) : (
            <p>Run an RCA analysis to generate ranked hypotheses.</p>
          )}
        </article>

        <article className="root-cause-panel">
          <h2>AI + Evidence</h2>
          {setupResult ? (
            <section className="assist-block" aria-label="AI setup suggestions">
              <h3>Setup Suggestions</h3>
              <ul>
                {setupResult.suggestions.map((item) => (
                  <li key={item.outcome.event_type}>
                    <p>{item.outcome.event_type}</p>
                    <p>{item.rationale}</p>
                  </li>
                ))}
              </ul>
              <ul>
                {setupResult.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            </section>
          ) : null}

          {interpretResult ? (
            <section className="assist-block" aria-label="AI interpretation summary">
              <h3>Interpretation</h3>
              <p>{interpretResult.summary}</p>
              <ul>
                {interpretResult.caveats.map((caveat) => (
                  <li key={caveat}>{caveat}</li>
                ))}
              </ul>
              <ul>
                {interpretResult.next_steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ul>
            </section>
          ) : null}

          {selectedInsight ? <p className="field-label">Evidence for {selectedInsight.insight_id}</p> : null}
          {evidenceLoading ? <p>Loading evidence...</p> : null}
          {evidenceError ? <p className="status degraded">{evidenceError}</p> : null}

          {evidenceResult ? (
            <section aria-live="polite" className="evidence-block">
              <p>
                Matched anchors: {evidenceResult.matched_anchor_count} | Positives:{" "}
                {evidenceResult.matched_positive_count}
                {evidenceResult.truncated ? " (truncated)" : ""}
              </p>
              <ul className="trace-list">
                {evidenceResult.traces.map((trace) => (
                  <li key={trace.anchor_key}>
                    <p>{trace.anchor_key}</p>
                    <p>Outcome: {trace.outcome ? "true" : "false"}</p>
                    <p>{trace.events.map((event) => event.event_type).join(" -> ")}</p>
                  </li>
                ))}
              </ul>
            </section>
          ) : (
            <p>Choose an insight to inspect supporting event traces.</p>
          )}
        </article>
      </section>
    </main>
  );
}
