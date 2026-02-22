export type RunState = "queued" | "running" | "completed" | "error";

type RunStatePillProps = {
  state: RunState;
  label?: string;
};

const DEFAULT_LABELS: Record<RunState, string> = {
  queued: "Queued",
  running: "Running",
  completed: "Completed",
  error: "Error",
};

export function RunStatePill({ state, label }: RunStatePillProps) {
  return <p className={`status run-state ${state}`}>{label ?? DEFAULT_LABELS[state]}</p>;
}
