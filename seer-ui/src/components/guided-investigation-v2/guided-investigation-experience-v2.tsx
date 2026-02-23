"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

import { AiResponsePanel } from "@/components/ai-response-panel";
import { RunState, RunStatePill } from "@/components/run-state-pill";
import {
  ROOT_CAUSE_GUIDED_STAGE_META,
  adaptGuidedInvestigationV2,
  buildGuidedInvestigationStages,
} from "@/lib/adapters/root-cause-guided-v2-adapter";
import { GuidedInvestigationResponse, runGuidedInvestigation } from "@/lib/backend-ai";

import styles from "./guided-investigation-experience-v2.module.css";

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

export function GuidedInvestigationExperienceV2() {
  const searchParams = useSearchParams();
  const now = useMemo(() => new Date(), []);
  const defaultStart = useMemo(
    () => toLocalInputValue(new Date(now.getTime() - 24 * 60 * 60 * 1_000)),
    [now]
  );
  const defaultEnd = useMemo(() => toLocalInputValue(now), [now]);

  const [question, setQuestion] = useState(
    () => searchParams.get("question")?.trim() || "What is causing delayed orders in this window?"
  );
  const [anchorObjectType, setAnchorObjectType] = useState(
    () => searchParams.get("anchor_object_type")?.trim() || "Order"
  );
  const [startAt, setStartAt] = useState(() =>
    parseSearchDateInput(searchParams.get("start_at"), defaultStart)
  );
  const [endAt, setEndAt] = useState(() => parseSearchDateInput(searchParams.get("end_at"), defaultEnd));
  const [depth, setDepth] = useState(() => parseSearchDepth(searchParams.get("depth"), 2));
  const [outcomeEventType, setOutcomeEventType] = useState(
    () => searchParams.get("outcome_event_type")?.trim() || "order.delayed"
  );

  const [runState, setRunState] = useState<RunState>("completed");
  const [runError, setRunError] = useState<string | null>(null);
  const [result, setResult] = useState<GuidedInvestigationResponse | null>(null);
  const [activeStageIndex, setActiveStageIndex] = useState(0);

  const stageTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (stageTimerRef.current) {
        clearInterval(stageTimerRef.current);
      }
    };
  }, []);

  const stageTimeline = useMemo(
    () => buildGuidedInvestigationStages(runState, result, runError, activeStageIndex),
    [activeStageIndex, result, runError, runState]
  );
  const guidedView = useMemo(() => (result ? adaptGuidedInvestigationV2(result) : null), [result]);

  function startStageTicker(): void {
    if (stageTimerRef.current) {
      clearInterval(stageTimerRef.current);
    }
    setActiveStageIndex(0);
    stageTimerRef.current = setInterval(() => {
      setActiveStageIndex((current) =>
        current >= ROOT_CAUSE_GUIDED_STAGE_META.length - 1 ? current : current + 1
      );
    }, 900);
  }

  function stopStageTicker(): void {
    if (stageTimerRef.current) {
      clearInterval(stageTimerRef.current);
      stageTimerRef.current = null;
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const startIso = parseLocalInput(startAt, now.toISOString());
    const endIso = parseLocalInput(endAt, now.toISOString());

    if (new Date(startIso).valueOf() >= new Date(endIso).valueOf()) {
      setRunState("error");
      setRunError("End time must be after start time.");
      return;
    }

    setRunError(null);
    setRunState("queued");
    setResult(null);
    setActiveStageIndex(0);
    await Promise.resolve();
    setRunState("running");
    startStageTicker();

    try {
      const response = await runGuidedInvestigation({
        question: question.trim(),
        anchor_object_type: anchorObjectType.trim(),
        start_at: startIso,
        end_at: endIso,
        depth,
        outcome_event_type: outcomeEventType.trim() || undefined,
      });
      stopStageTicker();
      setResult(response);
      setActiveStageIndex(ROOT_CAUSE_GUIDED_STAGE_META.length - 1);
      setRunState("completed");
    } catch (error) {
      stopStageTicker();
      setResult(null);
      setRunError(error instanceof Error ? error.message : "Guided investigation failed");
      setRunState("error");
    }
  }

  return (
    <main className={styles.shell}>
      <section className={styles.headerCard}>
        <p className="eyebrow">Phase D Replatform</p>
        <h1>Guided Investigation v2</h1>
        <p>
          Primary AI-first investigation workflow orchestrating ontology context, process analysis,
          and root-cause evidence in one run.
        </p>
        <p className={styles.primaryBadge}>Primary AI Workflow</p>
      </section>

      <section className={styles.workspace} aria-label="Guided investigation v2 workspace">
        <div className={styles.leftRail}>
          <article className={styles.panel}>
            <div className={styles.panelHeader}>
              <h2>Run Guided Flow</h2>
              <p>Define the investigation question and RCA scope.</p>
            </div>

            <form className={styles.form} onSubmit={onSubmit}>
              <label className="field-label" htmlFor="guided-v2-question">
                Investigation question
              </label>
              <textarea
                id="guided-v2-question"
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                rows={4}
                required
              />

              <label className="field-label" htmlFor="guided-v2-anchor">
                Anchor object type
              </label>
              <input
                id="guided-v2-anchor"
                value={anchorObjectType}
                onChange={(event) => setAnchorObjectType(event.target.value)}
                required
              />

              <label className="field-label" htmlFor="guided-v2-start">
                Start time
              </label>
              <input
                id="guided-v2-start"
                type="datetime-local"
                value={startAt}
                onChange={(event) => setStartAt(event.target.value)}
                required
              />

              <label className="field-label" htmlFor="guided-v2-end">
                End time
              </label>
              <input
                id="guided-v2-end"
                type="datetime-local"
                value={endAt}
                onChange={(event) => setEndAt(event.target.value)}
                required
              />

              <div className={styles.fieldGrid}>
                <div>
                  <label className="field-label" htmlFor="guided-v2-depth">
                    RCA depth
                  </label>
                  <select
                    id="guided-v2-depth"
                    value={depth}
                    onChange={(event) => setDepth(Number(event.target.value))}
                  >
                    <option value={1}>1</option>
                    <option value={2}>2</option>
                    <option value={3}>3</option>
                  </select>
                </div>

                <div>
                  <label className="field-label" htmlFor="guided-v2-outcome">
                    Outcome event type (optional)
                  </label>
                  <input
                    id="guided-v2-outcome"
                    value={outcomeEventType}
                    onChange={(event) => setOutcomeEventType(event.target.value)}
                    placeholder="order.delayed"
                  />
                </div>
              </div>

              <button type="submit" disabled={runState === "running"}>
                {runState === "running"
                  ? "Running guided investigation..."
                  : "Run ontology -> process -> RCA"}
              </button>
            </form>

            <RunStatePill state={runState} label={`Guided run ${runState}`} />
            {runError ? <p className="status degraded">{runError}</p> : null}
          </article>

          <article className={styles.panel}>
            <div className={styles.panelHeader}>
              <h2>Orchestration Timeline</h2>
              <p>Backend execution order and current stage visibility.</p>
            </div>

            <ul className={styles.stageList} aria-label="Guided orchestration stages">
              {stageTimeline.map((stage) => (
                <li key={stage.key} data-state={stage.state}>
                  <p className={styles.stageLabel}>{stage.label}</p>
                  <p className={styles.stageSummary}>{stage.summary}</p>
                  <p className={styles.stageDetail}>{stage.detail}</p>
                </li>
              ))}
            </ul>
          </article>

          {guidedView ? (
            <article className={styles.panel}>
              <div className={styles.panelHeader}>
                <h2>Handoff Links</h2>
                <p>Move from guided orchestration into module-level verification.</p>
              </div>

              <ul className={styles.handoffList}>
                {guidedView.handoff_links.map((link) => (
                  <li key={link.href}>
                    <Link href={link.href}>{link.label}</Link>
                    <p>{link.description}</p>
                  </li>
                ))}
              </ul>
            </article>
          ) : null}
        </div>

        <div className={styles.rightRail}>
          <article className={styles.panel}>
            <div className={styles.panelHeader}>
              <h2>Investigation Output</h2>
              <p>Run identifiers, policy envelope, and module-level analytical outputs.</p>
            </div>

            {guidedView ? (
              <>
                <dl className={styles.kpiGrid}>
                  <div>
                    <dt>Investigation</dt>
                    <dd>{guidedView.investigation_id}</dd>
                  </div>
                  <div>
                    <dt>Anchor</dt>
                    <dd>{guidedView.anchor_object_type}</dd>
                  </div>
                  <div>
                    <dt>Process Run</dt>
                    <dd>{guidedView.process_run_id}</dd>
                  </div>
                  <div>
                    <dt>RCA Run</dt>
                    <dd>{guidedView.root_cause_run_id}</dd>
                  </div>
                  <div>
                    <dt>Baseline</dt>
                    <dd>{guidedView.baseline_rate_label}</dd>
                  </div>
                  <div>
                    <dt>RCA Insights</dt>
                    <dd>{guidedView.insight_count.toLocaleString()}</dd>
                  </div>
                </dl>

                <p className={styles.inlineMeta}>Window: {guidedView.window_label}</p>
                <div className={styles.policyBadges}>
                  <span>Ontology: {guidedView.ontology_policy}</span>
                  <span>Process: {guidedView.process_policy}</span>
                  <span>RCA: {guidedView.root_cause_policy}</span>
                </div>

                {result ? (
                  <>
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
                ) : null}
              </>
            ) : (
              <p className={styles.emptyState}>
                Run guided investigation to produce ontology, process, and RCA evidence in one flow.
              </p>
            )}
          </article>

          {guidedView ? (
            <article className={styles.panel}>
              <div className={styles.panelHeader}>
                <h2>Action Board</h2>
                <p>Prioritized next actions from ontology, process, and RCA outputs.</p>
              </div>

              <ul className={styles.actionList}>
                {guidedView.action_items.map((item) => (
                  <li key={item.id}>
                    <span data-owner={item.owner}>{item.owner.replace("_", " ")}</span>
                    <p>{item.text}</p>
                  </li>
                ))}
              </ul>
            </article>
          ) : null}

          <article className={styles.panel}>
            <div className={styles.panelHeader}>
              <h2>Current Scope</h2>
              <p>Inputs currently staged for the next guided run.</p>
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
                <dd>{outcomeEventType || "(auto)"}</dd>
              </div>
            </dl>
          </article>
        </div>
      </section>
    </main>
  );
}
