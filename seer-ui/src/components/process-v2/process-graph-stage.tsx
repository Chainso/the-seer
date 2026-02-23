"use client";

import {
  ProcessDrilldownSelectorViewModel,
  ProcessRunViewModelV2,
} from "@/lib/adapters/process-v2-adapter";

import styles from "./process-experience-v2.module.css";

type ProcessGraphStageProps = {
  run: ProcessRunViewModelV2;
  selected_selector_id: string | null;
  on_select: (selector: ProcessDrilldownSelectorViewModel) => void;
};

export function ProcessGraphStage({ run, selected_selector_id, on_select }: ProcessGraphStageProps) {
  const nodeSelectors = run.selectors.filter((selector) => selector.kind === "node").slice(0, 16);
  const pathSelectors = run.selectors.filter((selector) => selector.kind === "path").slice(0, 8);

  return (
    <article className={styles.panel}>
      <div className={styles.panelHeader}>
        <h2>Graph + Drilldown</h2>
        <p>Inspector-style lanes by object type, with direct trace selectors for nodes, edges, and paths.</p>
      </div>

      <section className={styles.nodeCloud} aria-label="High-frequency event nodes">
        {nodeSelectors.map((selector) => {
          const isActive = selector.id === selected_selector_id;
          const frequency = selector.count.toLocaleString();
          return (
            <button
              key={selector.id}
              type="button"
              className={`${styles.nodeChip} ${isActive ? styles.selectorActive : ""}`}
              onClick={() => on_select(selector)}
              aria-pressed={isActive}
            >
              <span>{selector.label}</span>
              <small>{frequency}</small>
            </button>
          );
        })}
      </section>

      <section className={styles.lanes} aria-label="Object type flow lanes">
        {run.lanes.map((lane) => (
          <div key={lane.object_type} className={styles.laneCard}>
            <div className={styles.laneHeader}>
              <h3>{lane.object_type}</h3>
              <p>
                {lane.edge_count} edges | {lane.total_count.toLocaleString()} linked observations
              </p>
            </div>
            <ul className={styles.edgeList}>
              {lane.edges.slice(0, 10).map((edge) => {
                const selector = run.selectors.find((item) => item.id === `edge:${edge.id}`);
                if (!selector) {
                  return null;
                }
                const isActive = selector.id === selected_selector_id;
                const width = Math.max(10, Math.round(edge.share * 100));
                return (
                  <li key={edge.id}>
                    <button
                      type="button"
                      onClick={() => on_select(selector)}
                      className={`${styles.edgeButton} ${isActive ? styles.selectorActive : ""}`}
                      aria-pressed={isActive}
                    >
                      <div className={styles.edgeLabelRow}>
                        <span>{selector.label}</span>
                        <strong>{edge.count.toLocaleString()}</strong>
                      </div>
                      <span className={styles.edgeMeter} style={{ inlineSize: `${width}%` }} />
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </section>

      <section className={styles.pathStrip} aria-label="Top path selectors">
        {pathSelectors.map((selector) => {
          const isActive = selector.id === selected_selector_id;
          return (
            <button
              key={selector.id}
              type="button"
              onClick={() => on_select(selector)}
              className={`${styles.pathButton} ${isActive ? styles.selectorActive : ""}`}
              aria-pressed={isActive}
            >
              <span>{selector.label}</span>
              <small>{selector.count.toLocaleString()}</small>
            </button>
          );
        })}
      </section>
    </article>
  );
}
