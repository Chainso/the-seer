"use client";

import { FormEvent, useMemo, useState } from "react";

import { AiResponsePanel } from "@/components/ai-response-panel";
import { RunStatePill, RunState } from "@/components/run-state-pill";
import {
  GuidedInvestigationResponse,
  runGuidedInvestigation,
} from "@/lib/backend-ai";

function toLocalInputValue(value: Date): string {
  const offset = value.getTimezoneOffset() * 60_000;
  return new Date(value.getTime() - offset).toISOString().slice(0, 16);
}

function parseLocalInput(value: string): string {
  return new Date(value).toISOString();
}

export function GuidedInvestigation() {
  const now = useMemo(() => new Date(), []);
  const initialStart = useMemo(
    () => toLocalInputValue(new Date(now.getTime() - 24 * 60 * 60 * 1_000)),
    [now]
  );
  const initialEnd = useMemo(() => toLocalInputValue(now), [now]);

  const [question, setQuestion] = useState("What is causing delayed orders in this window?");
  const [anchorObjectType, setAnchorObjectType] = useState("Order");
  const [startAt, setStartAt] = useState(initialStart);
  const [endAt, setEndAt] = useState(initialEnd);
  const [depth, setDepth] = useState(2);
  const [outcomeEventType, setOutcomeEventType] = useState("order.delayed");

  const [runState, setRunState] = useState<RunState>("completed");
  const [runError, setRunError] = useState<string | null>(null);
  const [result, setResult] = useState<GuidedInvestigationResponse | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRunError(null);
    setRunState("queued");
    await Promise.resolve();
    setRunState("running");

    try {
      const response = await runGuidedInvestigation({
        question: question.trim(),
        anchor_object_type: anchorObjectType.trim(),
        start_at: parseLocalInput(startAt),
        end_at: parseLocalInput(endAt),
        depth,
        outcome_event_type: outcomeEventType.trim() || undefined,
      });
      setResult(response);
      setRunState("completed");
    } catch (error) {
      setResult(null);
      setRunError(error instanceof Error ? error.message : "Guided investigation failed");
      setRunState("error");
    }
  }

  return (
    <main className="insights-shell">
      <section className="insights-header">
        <p className="eyebrow">MVP Phase 5</p>
        <h1>Guided Investigation</h1>
        <p>
          Unified AI investigation path that connects ontology context, process exploration, and
          root-cause analysis.
        </p>
      </section>

      <section className="insights-grid" aria-label="Guided investigation controls and output">
        <article className="insights-panel">
          <h2>Run Guided Flow</h2>
          <form onSubmit={onSubmit}>
            <label className="field-label" htmlFor="guided-question">
              Investigation question
            </label>
            <textarea
              id="guided-question"
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              rows={3}
              required
            />

            <label className="field-label" htmlFor="guided-anchor">
              Anchor object type
            </label>
            <input
              id="guided-anchor"
              value={anchorObjectType}
              onChange={(event) => setAnchorObjectType(event.target.value)}
              required
            />

            <label className="field-label" htmlFor="guided-start">
              Start time
            </label>
            <input
              id="guided-start"
              type="datetime-local"
              value={startAt}
              onChange={(event) => setStartAt(event.target.value)}
              required
            />

            <label className="field-label" htmlFor="guided-end">
              End time
            </label>
            <input
              id="guided-end"
              type="datetime-local"
              value={endAt}
              onChange={(event) => setEndAt(event.target.value)}
              required
            />

            <label className="field-label" htmlFor="guided-depth">
              RCA depth
            </label>
            <select
              id="guided-depth"
              value={depth}
              onChange={(event) => setDepth(Number(event.target.value))}
            >
              <option value={1}>1</option>
              <option value={2}>2</option>
              <option value={3}>3</option>
            </select>

            <label className="field-label" htmlFor="guided-outcome">
              Outcome event type override (optional)
            </label>
            <input
              id="guided-outcome"
              value={outcomeEventType}
              onChange={(event) => setOutcomeEventType(event.target.value)}
              placeholder="order.delayed"
            />

            <button type="submit" disabled={runState === "running"}>
              {runState === "running"
                ? "Running guided investigation..."
                : "Run ontology -> process -> RCA"}
            </button>
          </form>

          <RunStatePill state={runState} label={`Guided run ${runState}`} />
          {runError ? <p className="status degraded">{runError}</p> : null}
        </article>

        <article className="insights-panel">
          <h2>Flow Output</h2>
          {result ? (
            <>
              <p className="status ok">Investigation {result.investigation_id}</p>
              <p>
                Anchor: {result.anchor_object_type} | Window: {new Date(result.start_at).toLocaleString()} to{" "}
                {new Date(result.end_at).toLocaleString()}
              </p>
              <p>
                Process run {result.process_run.run_id} | RCA run {result.root_cause_run.run_id}
              </p>
              <p>
                RCA insights: {result.root_cause_run.insights.length} | Baseline outcome: {" "}
                {(result.root_cause_run.baseline_rate * 100).toFixed(2)}%
              </p>

              <AiResponsePanel
                title="Ontology AI"
                summary={result.ontology.summary}
                evidence={result.ontology.evidence}
                caveats={result.ontology.caveats}
                nextActions={result.ontology.next_actions}
              />

              <AiResponsePanel
                title="Process AI"
                summary={result.process_ai.summary}
                evidence={result.process_ai.evidence}
                caveats={result.process_ai.caveats}
                nextActions={result.process_ai.next_actions}
              />

              <AiResponsePanel
                title="Root-Cause AI"
                summary={result.root_cause_ai.summary}
                evidence={result.root_cause_ai.evidence}
                caveats={result.root_cause_ai.caveats}
                nextActions={result.root_cause_ai.next_actions}
              />
            </>
          ) : (
            <p>Run guided investigation to produce ontology, process, and RCA evidence in one flow.</p>
          )}
        </article>
      </section>
    </main>
  );
}
