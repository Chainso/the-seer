"use client";

import { FormEvent } from "react";

import { RunState, RunStatePill } from "@/components/run-state-pill";

import styles from "./process-experience-v2.module.css";

export type ProcessRunControlValues = {
  anchor_object_type: string;
  include_object_types: string;
  start_at: string;
  end_at: string;
  max_events: string;
  max_relations: string;
  max_traces_per_handle: string;
  trace_limit: number;
};

type ProcessRunControlsProps = {
  values: ProcessRunControlValues;
  run_state: RunState;
  run_error: string | null;
  on_change: (next: Partial<ProcessRunControlValues>) => void;
  on_submit: (event: FormEvent<HTMLFormElement>) => void;
};

export function ProcessRunControls({
  values,
  run_state,
  run_error,
  on_change,
  on_submit,
}: ProcessRunControlsProps) {
  return (
    <article className={styles.panel}>
      <div className={styles.panelHeader}>
        <h2>Run Controls</h2>
        <p>Configure bounded mining runs and trace limits before launching analysis.</p>
      </div>
      <form className={styles.runForm} onSubmit={on_submit}>
        <label className={styles.fieldLabel} htmlFor="process-v2-anchor-type">
          Anchor object type
        </label>
        <input
          id="process-v2-anchor-type"
          value={values.anchor_object_type}
          onChange={(event) => on_change({ anchor_object_type: event.target.value })}
          required
        />

        <label className={styles.fieldLabel} htmlFor="process-v2-include-types">
          Include object types (optional)
        </label>
        <input
          id="process-v2-include-types"
          value={values.include_object_types}
          onChange={(event) => on_change({ include_object_types: event.target.value })}
          placeholder="Order, Shipment, Invoice"
        />
        <p className={styles.fieldHint}>Comma-separated object type filter for mining context.</p>

        <div className={styles.fieldGrid}>
          <div>
            <label className={styles.fieldLabel} htmlFor="process-v2-start-at">
              Start time
            </label>
            <input
              id="process-v2-start-at"
              type="datetime-local"
              value={values.start_at}
              onChange={(event) => on_change({ start_at: event.target.value })}
              required
            />
          </div>
          <div>
            <label className={styles.fieldLabel} htmlFor="process-v2-end-at">
              End time
            </label>
            <input
              id="process-v2-end-at"
              type="datetime-local"
              value={values.end_at}
              onChange={(event) => on_change({ end_at: event.target.value })}
              required
            />
          </div>
        </div>

        <div className={styles.fieldGrid}>
          <div>
            <label className={styles.fieldLabel} htmlFor="process-v2-max-events">
              Max events (optional)
            </label>
            <input
              id="process-v2-max-events"
              type="number"
              min={1}
              max={200000}
              value={values.max_events}
              onChange={(event) => on_change({ max_events: event.target.value })}
              placeholder="Default guardrail"
            />
          </div>
          <div>
            <label className={styles.fieldLabel} htmlFor="process-v2-max-relations">
              Max relations (optional)
            </label>
            <input
              id="process-v2-max-relations"
              type="number"
              min={1}
              max={500000}
              value={values.max_relations}
              onChange={(event) => on_change({ max_relations: event.target.value })}
              placeholder="Default guardrail"
            />
          </div>
        </div>

        <div className={styles.fieldGrid}>
          <div>
            <label className={styles.fieldLabel} htmlFor="process-v2-max-handle-traces">
              Max traces per handle (optional)
            </label>
            <input
              id="process-v2-max-handle-traces"
              type="number"
              min={1}
              max={500}
              value={values.max_traces_per_handle}
              onChange={(event) => on_change({ max_traces_per_handle: event.target.value })}
              placeholder="Service default"
            />
          </div>
          <div>
            <label className={styles.fieldLabel} htmlFor="process-v2-trace-limit">
              Drill-down fetch limit
            </label>
            <input
              id="process-v2-trace-limit"
              type="number"
              min={1}
              max={500}
              value={values.trace_limit}
              onChange={(event) =>
                on_change({
                  trace_limit: Number.isNaN(event.target.valueAsNumber)
                    ? 25
                    : event.target.valueAsNumber,
                })
              }
              required
            />
          </div>
        </div>

        <button type="submit" disabled={run_state === "running"}>
          {run_state === "running" ? "Running mining..." : "Run process mining"}
        </button>
      </form>
      <div className={styles.stateRow}>
        <RunStatePill state={run_state} label={`Process run ${run_state}`} />
        {run_error ? (
          <p className={`status degraded ${styles.inlineStatus}`} role="alert">
            {run_error}
          </p>
        ) : null}
      </div>
    </article>
  );
}
