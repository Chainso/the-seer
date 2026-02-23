"use client";

import Link from "next/link";
import { FormEvent, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

import { AiResponsePanel } from "@/components/ai-response-panel";
import { RunState, RunStatePill } from "@/components/run-state-pill";
import {
  adaptRootCauseEvidenceV2,
  adaptRootCauseRunV2,
  buildRootCauseInsightComparison,
  selectRootCauseInsightsForComparison,
} from "@/lib/adapters/root-cause-v2-adapter";
import {
  AiRootCauseInterpretResponse,
  AiRootCauseSetupResponse,
  assistAiRootCauseSetup,
  interpretAiRootCause,
} from "@/lib/backend-ai";
import {
  InsightResult,
  RcaFilterCondition,
  RootCauseEvidenceResponse,
  RootCauseRunResponse,
  fetchRootCauseEvidence,
  runRootCause,
} from "@/lib/backend-root-cause";

import styles from "./root-cause-experience-v2.module.css";

type EvidenceEntry = {
  run_state: RunState;
  error: string | null;
  data: RootCauseEvidenceResponse | null;
};

const MAX_COMPARE_INSIGHTS = 2;

function toLocalInputValue(value: Date): string {
  const offset = value.getTimezoneOffset() * 60_000;
  return new Date(value.getTime() - offset).toISOString().slice(0, 16);
}

function parseLocalInput(value: string, fallbackIso: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) {
    return fallbackIso;
  }
  return parsed.toISOString();
}

function parseSearchDateInput(value: string | null, fallback: string): string {
  if (!value) {
    return fallback;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) {
    return fallback;
  }
  return toLocalInputValue(parsed);
}

function parseSearchDepth(value: string | null, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(1, Math.min(3, Math.round(parsed)));
}

function formatDateTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) {
    return value;
  }
  return parsed.toLocaleString();
}

function buildGuidedInvestigationHref(input: {
  anchor_object_type: string;
  start_at: string;
  end_at: string;
  depth: number;
  outcome_event_type: string;
}): string {
  const params = new URLSearchParams({
    anchor_object_type: input.anchor_object_type,
    start_at: input.start_at,
    end_at: input.end_at,
    depth: String(input.depth),
    outcome_event_type: input.outcome_event_type,
    question: "What root-cause hypotheses should I verify next?",
  });
  return `/insights?${params.toString()}`;
}

export function RootCauseExperienceV2() {
  const searchParams = useSearchParams();
  const now = useMemo(() => new Date(), []);
  const defaultStart = useMemo(
    () => toLocalInputValue(new Date(now.getTime() - 24 * 60 * 60 * 1_000)),
    [now]
  );
  const defaultEnd = useMemo(() => toLocalInputValue(now), [now]);

  const initialAnchorObjectType = searchParams.get("anchor_object_type")?.trim() || "Order";
  const initialOutcomeEventType = searchParams.get("outcome_event_type")?.trim() || "order.delayed";
  const initialOutcomeObjectType = searchParams.get("outcome_object_type")?.trim() || "";
  const initialStartAt = parseSearchDateInput(searchParams.get("start_at"), defaultStart);
  const initialEndAt = parseSearchDateInput(searchParams.get("end_at"), defaultEnd);
  const initialDepth = parseSearchDepth(searchParams.get("depth"), 1);

  const [anchorObjectType, setAnchorObjectType] = useState(initialAnchorObjectType);
  const [startAt, setStartAt] = useState(initialStartAt);
  const [endAt, setEndAt] = useState(initialEndAt);
  const [depth, setDepth] = useState(initialDepth);
  const [outcomeEventType, setOutcomeEventType] = useState(initialOutcomeEventType);
  const [outcomeObjectType, setOutcomeObjectType] = useState(initialOutcomeObjectType);

  const [filterField, setFilterField] = useState("anchor.priority");
  const [filterOp, setFilterOp] = useState<RcaFilterCondition["op"]>("eq");
  const [filterValue, setFilterValue] = useState("high");
  const [filters, setFilters] = useState<RcaFilterCondition[]>([]);

  const [runState, setRunState] = useState<RunState>("completed");
  const [runError, setRunError] = useState<string | null>(null);
  const [runResult, setRunResult] = useState<RootCauseRunResponse | null>(null);

  const [setupState, setSetupState] = useState<RunState>("completed");
  const [setupError, setSetupError] = useState<string | null>(null);
  const [setupResult, setSetupResult] = useState<AiRootCauseSetupResponse | null>(null);

  const [interpretState, setInterpretState] = useState<RunState>("completed");
  const [interpretError, setInterpretError] = useState<string | null>(null);
  const [interpretResult, setInterpretResult] = useState<AiRootCauseInterpretResponse | null>(null);

  const [activeInsightId, setActiveInsightId] = useState<string | null>(null);
  const [comparedInsightIds, setComparedInsightIds] = useState<string[]>([]);
  const [evidenceByInsight, setEvidenceByInsight] = useState<Record<string, EvidenceEntry>>({});

  const runView = useMemo(() => (runResult ? adaptRootCauseRunV2(runResult) : null), [runResult]);

  const insightById = useMemo(() => {
    const pairs = runResult?.insights.map((insight) => [insight.insight_id, insight] as const) ?? [];
    return new Map(pairs);
  }, [runResult]);

  const activeInsight = useMemo(() => {
    if (!activeInsightId) {
      return null;
    }
    return insightById.get(activeInsightId) ?? null;
  }, [activeInsightId, insightById]);

  const activeEvidenceEntry = useMemo(() => {
    if (!activeInsightId) {
      return null;
    }
    return evidenceByInsight[activeInsightId] ?? null;
  }, [activeInsightId, evidenceByInsight]);

  const activeEvidenceView = useMemo(() => {
    if (!activeEvidenceEntry?.data) {
      return null;
    }
    return adaptRootCauseEvidenceV2(activeEvidenceEntry.data);
  }, [activeEvidenceEntry]);

  const comparedInsights = useMemo(() => {
    if (!runResult) {
      return [];
    }
    return selectRootCauseInsightsForComparison(runResult.insights, comparedInsightIds);
  }, [runResult, comparedInsightIds]);

  const comparisonView = useMemo(() => {
    if (!runResult || comparedInsightIds.length < MAX_COMPARE_INSIGHTS) {
      return null;
    }
    return buildRootCauseInsightComparison(
      runResult.insights,
      comparedInsightIds[0],
      comparedInsightIds[1]
    );
  }, [comparedInsightIds, runResult]);

  const guidedHref = useMemo(() => {
    const startIso = parseLocalInput(startAt, now.toISOString());
    const endIso = parseLocalInput(endAt, now.toISOString());
    return buildGuidedInvestigationHref({
      anchor_object_type: anchorObjectType.trim() || "Order",
      start_at: startIso,
      end_at: endIso,
      depth,
      outcome_event_type: outcomeEventType.trim() || "order.delayed",
    });
  }, [anchorObjectType, depth, endAt, now, outcomeEventType, startAt]);

  function setEvidenceEntry(insightId: string, entry: EvidenceEntry): void {
    setEvidenceByInsight((current) => ({
      ...current,
      [insightId]: entry,
    }));
  }

  function onAddFilter() {
    const field = filterField.trim();
    const value = filterValue.trim();
    if (!field || !value) {
      return;
    }

    setFilters((existing) => {
      const candidate: RcaFilterCondition = { field, op: filterOp, value };
      if (
        existing.some(
          (item) =>
            item.field === candidate.field &&
            item.op === candidate.op &&
            item.value === candidate.value
        )
      ) {
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

  async function runEvidenceLookup(insight: InsightResult) {
    const existing = evidenceByInsight[insight.insight_id];
    if (existing?.run_state === "running") {
      return;
    }

    setEvidenceEntry(insight.insight_id, {
      run_state: "queued",
      error: null,
      data: existing?.data ?? null,
    });
    await Promise.resolve();

    setEvidenceEntry(insight.insight_id, {
      run_state: "running",
      error: null,
      data: existing?.data ?? null,
    });

    try {
      const response = await fetchRootCauseEvidence(insight.evidence_handle, 24);
      setEvidenceEntry(insight.insight_id, {
        run_state: "completed",
        error: null,
        data: response,
      });
    } catch (error) {
      setEvidenceEntry(insight.insight_id, {
        run_state: "error",
        error: error instanceof Error ? error.message : "Evidence drill-down failed",
        data: null,
      });
    }
  }

  function onInspectInsight(insightId: string) {
    const insight = insightById.get(insightId);
    if (!insight) {
      return;
    }

    setActiveInsightId(insightId);
    void runEvidenceLookup(insight);
  }

  function onToggleCompare(insightId: string) {
    setComparedInsightIds((current) => {
      if (current.includes(insightId)) {
        return current.filter((id) => id !== insightId);
      }
      if (current.length < MAX_COMPARE_INSIGHTS) {
        return [...current, insightId];
      }
      return [current[1], insightId];
    });
  }

  async function onRun(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const startIso = parseLocalInput(startAt, now.toISOString());
    const endIso = parseLocalInput(endAt, now.toISOString());

    if (new Date(startIso).valueOf() >= new Date(endIso).valueOf()) {
      setRunState("error");
      setRunError("End time must be after start time.");
      return;
    }

    setRunState("queued");
    setRunError(null);
    setRunResult(null);
    setInterpretResult(null);
    setInterpretError(null);
    setComparedInsightIds([]);
    setActiveInsightId(null);
    setEvidenceByInsight({});
    await Promise.resolve();
    setRunState("running");

    try {
      const response = await runRootCause({
        anchor_object_type: anchorObjectType.trim(),
        start_at: startIso,
        end_at: endIso,
        depth,
        outcome: {
          event_type: outcomeEventType.trim(),
          object_type: outcomeObjectType.trim() || null,
        },
        filters,
      });
      setRunResult(response);
      setRunState("completed");
      if (response.insights.length > 0) {
        setActiveInsightId(response.insights[0].insight_id);
      }
    } catch (error) {
      setRunResult(null);
      setRunError(error instanceof Error ? error.message : "Root-cause run failed");
      setRunState("error");
    }
  }

  async function onSetupAssist() {
    setSetupState("queued");
    setSetupError(null);
    await Promise.resolve();
    setSetupState("running");

    try {
      const response = await assistAiRootCauseSetup({
        anchor_object_type: anchorObjectType.trim(),
        start_at: parseLocalInput(startAt, now.toISOString()),
        end_at: parseLocalInput(endAt, now.toISOString()),
      });
      setSetupResult(response);
      setDepth(Math.max(1, Math.min(3, response.setup.suggested_depth)));
      if (response.setup.suggestions[0]) {
        setOutcomeEventType(response.setup.suggestions[0].outcome.event_type);
      }
      setSetupState("completed");
    } catch (error) {
      setSetupResult(null);
      setSetupError(error instanceof Error ? error.message : "AI setup assist failed");
      setSetupState("error");
    }
  }

  async function onInterpretAssist() {
    if (!runResult) {
      return;
    }

    setInterpretState("queued");
    setInterpretError(null);
    await Promise.resolve();
    setInterpretState("running");

    try {
      const response = await interpretAiRootCause({
        baseline_rate: runResult.baseline_rate,
        insights: runResult.insights,
      });
      setInterpretResult(response);
      setInterpretState("completed");
    } catch (error) {
      setInterpretResult(null);
      setInterpretError(error instanceof Error ? error.message : "AI interpretation failed");
      setInterpretState("error");
    }
  }

  return (
    <main className={styles.shell}>
      <section className={styles.headerCard}>
        <p className="eyebrow">Phase D Replatform</p>
        <h1>Root-Cause Experience v2</h1>
        <p>
          Ranked hypothesis workspace with evidence drill-down, side-by-side comparison, and AI
          setup/interpretation grounded in canonical RCA contracts.
        </p>
        <div className={styles.headerActions}>
          <Link href={guidedHref} className={styles.headerLink}>
            Continue in Guided Investigation
          </Link>
          {runView ? <p className={styles.inlineMeta}>Run {runView.run_id}</p> : null}
        </div>
      </section>

      <section className={styles.workspace} aria-label="Root-cause v2 workspace">
        <div className={styles.leftRail}>
          <article className={styles.panel}>
            <div className={styles.panelHeader}>
              <h2>Run Setup</h2>
              <p>Configure bounded RCA parameters and optional cohort filters.</p>
            </div>

            <form className={styles.form} onSubmit={onRun}>
              <label className="field-label" htmlFor="rca-v2-anchor">
                Anchor object type
              </label>
              <input
                id="rca-v2-anchor"
                value={anchorObjectType}
                onChange={(event) => setAnchorObjectType(event.target.value)}
                required
              />

              <label className="field-label" htmlFor="rca-v2-start">
                Start time
              </label>
              <input
                id="rca-v2-start"
                type="datetime-local"
                value={startAt}
                onChange={(event) => setStartAt(event.target.value)}
                required
              />

              <label className="field-label" htmlFor="rca-v2-end">
                End time
              </label>
              <input
                id="rca-v2-end"
                type="datetime-local"
                value={endAt}
                onChange={(event) => setEndAt(event.target.value)}
                required
              />

              <div className={styles.fieldGrid}>
                <div>
                  <label className="field-label" htmlFor="rca-v2-depth">
                    Traversal depth
                  </label>
                  <select
                    id="rca-v2-depth"
                    value={depth}
                    onChange={(event) => setDepth(Number(event.target.value))}
                  >
                    <option value={1}>1</option>
                    <option value={2}>2</option>
                    <option value={3}>3</option>
                  </select>
                </div>

                <div>
                  <label className="field-label" htmlFor="rca-v2-outcome-event">
                    Outcome event type
                  </label>
                  <input
                    id="rca-v2-outcome-event"
                    value={outcomeEventType}
                    onChange={(event) => setOutcomeEventType(event.target.value)}
                    required
                  />
                </div>
              </div>

              <label className="field-label" htmlFor="rca-v2-outcome-object">
                Outcome object type (optional)
              </label>
              <input
                id="rca-v2-outcome-object"
                value={outcomeObjectType}
                onChange={(event) => setOutcomeObjectType(event.target.value)}
                placeholder="Order"
              />

              <fieldset className={styles.filterFieldset}>
                <legend className="field-label">Cohort filter (optional)</legend>
                <div className={styles.filterRow}>
                  <input
                    aria-label="Filter field"
                    value={filterField}
                    onChange={(event) => setFilterField(event.target.value)}
                    placeholder="anchor.priority"
                  />
                  <select
                    aria-label="Filter operator"
                    value={filterOp}
                    onChange={(event) =>
                      setFilterOp(event.target.value as RcaFilterCondition["op"])
                    }
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
                </div>
                <button type="button" onClick={onAddFilter}>
                  Add filter
                </button>
              </fieldset>

              {filters.length > 0 ? (
                <ul className={styles.filterList} aria-label="Applied filters">
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

              <button type="button" onClick={onSetupAssist} disabled={setupState === "running"}>
                {setupState === "running" ? "Drafting setup..." : "AI assist: draft setup"}
              </button>
              <RunStatePill state={setupState} label={`Setup AI ${setupState}`} />

              <button type="submit" disabled={runState === "running"}>
                {runState === "running" ? "Running RCA..." : "Run root-cause analysis"}
              </button>
              <RunStatePill state={runState} label={`RCA run ${runState}`} />
            </form>

            {setupError ? <p className="status degraded">{setupError}</p> : null}
            {runError ? <p className="status degraded">{runError}</p> : null}
          </article>

          <article className={styles.panel}>
            <div className={styles.panelHeader}>
              <h2>Run Scope</h2>
              <p>Current RCA bounds and latest query window.</p>
            </div>
            <dl className={styles.scopeGrid}>
              <div>
                <dt>Anchor</dt>
                <dd>{anchorObjectType}</dd>
              </div>
              <div>
                <dt>Window</dt>
                <dd>
                  {formatDateTime(parseLocalInput(startAt, now.toISOString()))} to{" "}
                  {formatDateTime(parseLocalInput(endAt, now.toISOString()))}
                </dd>
              </div>
              <div>
                <dt>Depth</dt>
                <dd>{depth}</dd>
              </div>
              <div>
                <dt>Outcome</dt>
                <dd>{outcomeEventType}</dd>
              </div>
            </dl>
          </article>
        </div>

        <div className={styles.centerRail}>
          <article className={styles.panel}>
            <div className={styles.panelHeader}>
              <h2>Ranked Insights</h2>
              <p>Prioritize evidence-backed hypotheses and select up to two for comparison.</p>
            </div>

            {runView ? (
              <>
                <dl className={styles.kpiGrid}>
                  <div>
                    <dt>Cohort</dt>
                    <dd>{runView.cohort_size.toLocaleString()}</dd>
                  </div>
                  <div>
                    <dt>Positives</dt>
                    <dd>{runView.positive_count.toLocaleString()}</dd>
                  </div>
                  <div>
                    <dt>Baseline</dt>
                    <dd>{runView.baseline_rate_label}</dd>
                  </div>
                  <div>
                    <dt>Features</dt>
                    <dd>{runView.feature_count.toLocaleString()}</dd>
                  </div>
                </dl>

                <p className={styles.inlineMeta}>Window: {runView.window_label}</p>
                <p className={styles.inlineMeta}>Outcome: {runView.outcome_label}</p>

                {runView.warnings.length > 0 ? (
                  <ul className={styles.warningList}>
                    {runView.warnings.map((warning) => (
                      <li key={warning} className="status degraded">
                        {warning}
                      </li>
                    ))}
                  </ul>
                ) : null}

                <p className={styles.caveat}>{runView.interpretation_caveat}</p>

                <ul className={styles.insightList} aria-label="Ranked hypothesis list">
                  {runView.insights.map((insight) => {
                    const evidenceState = evidenceByInsight[insight.insight_id]?.run_state ?? "completed";
                    const compared = comparedInsightIds.includes(insight.insight_id);
                    const active = activeInsightId === insight.insight_id;
                    const canAddToCompare =
                      compared || comparedInsightIds.length < MAX_COMPARE_INSIGHTS;

                    return (
                      <li
                        key={insight.insight_id}
                        className={styles.insightCard}
                        data-active={active ? "true" : "false"}
                      >
                        <header>
                          <p className={styles.insightTitle}>{`#${insight.rank} ${insight.title}`}</p>
                          <p className={styles.insightCondition}>{insight.condition_label}</p>
                        </header>

                        <dl className={styles.metricGrid}>
                          <div>
                            <dt>WRAcc</dt>
                            <dd>{insight.wracc_label}</dd>
                          </div>
                          <div>
                            <dt>Lift</dt>
                            <dd>{insight.lift_label}</dd>
                          </div>
                          <div>
                            <dt>Coverage</dt>
                            <dd>{insight.coverage_label}</dd>
                          </div>
                          <div>
                            <dt>Support</dt>
                            <dd>{insight.support.toLocaleString()}</dd>
                          </div>
                        </dl>

                        <p className={styles.insightCaveat}>{insight.caveat}</p>

                        <div className={styles.actionRow}>
                          <button
                            type="button"
                            onClick={() => onInspectInsight(insight.insight_id)}
                            disabled={evidenceState === "running"}
                          >
                            {evidenceState === "running"
                              ? "Loading evidence..."
                              : "Inspect evidence"}
                          </button>
                          <button
                            type="button"
                            onClick={() => onToggleCompare(insight.insight_id)}
                            disabled={!canAddToCompare}
                          >
                            {compared ? "Remove compare" : "Add compare"}
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>

                <button
                  type="button"
                  onClick={onInterpretAssist}
                  disabled={interpretState === "running"}
                >
                  {interpretState === "running" ? "Interpreting findings..." : "AI assist: interpret findings"}
                </button>
                <RunStatePill state={interpretState} label={`Interpret AI ${interpretState}`} />
                {interpretError ? <p className="status degraded">{interpretError}</p> : null}
              </>
            ) : (
              <p className={styles.emptyState}>Run an RCA analysis to generate ranked hypotheses.</p>
            )}
          </article>

          <article className={styles.panel}>
            <div className={styles.panelHeader}>
              <h2>Insight Comparison</h2>
              <p>Compare two selected hypotheses to prioritize verification order.</p>
            </div>

            {comparedInsights.length === 0 ? (
              <p className={styles.emptyState}>Add insights to compare from the ranked list.</p>
            ) : (
              <ul className={styles.compareList}>
                {comparedInsights.map((insight) => {
                  const evidenceEntry = evidenceByInsight[insight.insight_id];
                  const evidenceLabel = evidenceEntry?.data
                    ? `${evidenceEntry.data.matched_anchor_count} anchors`
                    : evidenceEntry?.run_state === "running"
                      ? "Loading evidence"
                      : "Evidence not loaded";

                  return (
                    <li key={insight.insight_id}>
                      <p>
                        <strong>{`#${insight.rank}`}</strong> {insight.title}
                      </p>
                      <p>Lift {insight.lift_label} | Coverage {insight.coverage_label}</p>
                      <p>{evidenceLabel}</p>
                    </li>
                  );
                })}
              </ul>
            )}

            {comparisonView ? (
              <div className={styles.compareDelta}>
                <p className={styles.inlineMeta}>
                  Higher lift: <strong>{comparisonView.leading_insight_id}</strong>
                </p>
                <p>Lift delta: {comparisonView.lift_delta_label}</p>
                <p>Coverage delta: {comparisonView.coverage_delta_label}</p>
                <p>Support delta: {comparisonView.support_delta_label}</p>
              </div>
            ) : (
              <p className={styles.emptyState}>Select two insights to view deltas.</p>
            )}

            <Link href={guidedHref} className={styles.inlineLink}>
              Escalate comparison context to Guided Investigation
            </Link>
          </article>
        </div>

        <div className={styles.rightRail}>
          <article className={styles.panel}>
            <div className={styles.panelHeader}>
              <h2>AI Assistance</h2>
              <p>Shared evidence and caveat rendering for setup and interpretation workflows.</p>
            </div>

            {setupResult ? (
              <AiResponsePanel
                title="Setup Guidance"
                summary={setupResult.summary}
                evidence={setupResult.evidence}
                caveats={setupResult.caveats}
                nextActions={setupResult.next_actions}
              />
            ) : null}

            {interpretResult ? (
              <AiResponsePanel
                title="Interpretation"
                summary={interpretResult.summary}
                evidence={interpretResult.evidence}
                caveats={interpretResult.caveats}
                nextActions={interpretResult.next_actions}
              />
            ) : null}

            {!setupResult && !interpretResult ? (
              <p className={styles.emptyState}>Run AI assists to populate setup and interpretation guidance.</p>
            ) : null}
          </article>

          <article className={styles.panel}>
            <div className={styles.panelHeader}>
              <h2>Evidence Drill-Down</h2>
              <p>Inspect trace-level supporting evidence for the selected insight.</p>
            </div>

            {activeInsight ? (
              <p className={styles.inlineMeta}>{`Insight ${activeInsight.insight_id}`}</p>
            ) : (
              <p className={styles.emptyState}>Select an insight from the ranked list to inspect traces.</p>
            )}

            {activeEvidenceEntry ? (
              <>
                <RunStatePill
                  state={activeEvidenceEntry.run_state}
                  label={`Evidence ${activeEvidenceEntry.run_state}`}
                />
                {activeEvidenceEntry.error ? (
                  <p className="status degraded">{activeEvidenceEntry.error}</p>
                ) : null}
              </>
            ) : null}

            {activeEvidenceView ? (
              <section className={styles.evidencePanel} aria-live="polite">
                <p>
                  Matched anchors: {activeEvidenceView.matched_anchor_count} | Positives:{" "}
                  {activeEvidenceView.matched_positive_count}
                </p>
                <p>
                  Positive rate: {activeEvidenceView.positive_rate_label}
                  {activeEvidenceView.truncated ? " (truncated)" : ""}
                </p>

                <ul className={styles.traceList}>
                  {activeEvidenceView.traces.map((trace) => (
                    <li key={trace.anchor_key}>
                      <div className={styles.traceHeader}>
                        <strong>{trace.anchor_key}</strong>
                        <span data-outcome={trace.outcome_label}>{trace.outcome_label}</span>
                      </div>
                      <p>{trace.event_flow}</p>
                      <p>
                        Events: {trace.event_count} | {formatDateTime(trace.occurred_at_start ?? "n/a")} to{" "}
                        {formatDateTime(trace.occurred_at_end ?? "n/a")}
                      </p>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </article>
        </div>
      </section>
    </main>
  );
}
