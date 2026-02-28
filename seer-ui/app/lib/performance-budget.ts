export type PerformanceMetricKey =
  | "ontology_graph_load_ms"
  | "runtime_overlay_load_ms";

export interface PerformanceBudgetDefinition {
  key: PerformanceMetricKey;
  label: string;
  budgetMs: number;
}

interface PerformanceSample {
  durationMs: number;
  at: string;
}

interface PerformanceStore {
  [key: string]: PerformanceSample[];
}

export interface PerformanceBudgetSnapshot {
  key: PerformanceMetricKey;
  label: string;
  budgetMs: number;
  sampleCount: number;
  avgMs: number;
  p95Ms: number;
  latestMs: number | null;
  withinBudget: boolean;
}

const STORAGE_KEY = "seer_performance_budget_metrics_v1";
const MAX_SAMPLES = 120;

export const PERFORMANCE_BUDGETS: Record<PerformanceMetricKey, PerformanceBudgetDefinition> = {
  ontology_graph_load_ms: {
    key: "ontology_graph_load_ms",
    label: "Ontology Graph Load",
    budgetMs: 800,
  },
  runtime_overlay_load_ms: {
    key: "runtime_overlay_load_ms",
    label: "Runtime Overlay Load",
    budgetMs: 1000,
  },
};

function readStore(): PerformanceStore {
  if (typeof window === "undefined") {
    return {};
  }
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as PerformanceStore;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeStore(store: PerformanceStore) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = values.slice().sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

function summarize(
  key: PerformanceMetricKey,
  samples: PerformanceSample[]
): PerformanceBudgetSnapshot {
  const config = PERFORMANCE_BUDGETS[key];
  const durations = samples.map((sample) => sample.durationMs);
  const avgMs =
    durations.length === 0
      ? 0
      : Number((durations.reduce((sum, value) => sum + value, 0) / durations.length).toFixed(1));
  const p95Ms = Number(percentile(durations, 95).toFixed(1));
  const latest = samples[samples.length - 1];
  const latestMs = latest ? Number(latest.durationMs.toFixed(1)) : null;
  return {
    key,
    label: config.label,
    budgetMs: config.budgetMs,
    sampleCount: durations.length,
    avgMs,
    p95Ms,
    latestMs,
    withinBudget: durations.length === 0 ? true : p95Ms <= config.budgetMs,
  };
}

export function recordPerformanceMetric(key: PerformanceMetricKey, durationMs: number) {
  if (typeof window === "undefined") {
    return;
  }
  const boundedDuration = Math.max(0, Number(durationMs) || 0);
  const store = readStore();
  const prior = Array.isArray(store[key]) ? store[key] : [];
  const nextSamples = [
    ...prior,
    {
      durationMs: boundedDuration,
      at: new Date().toISOString(),
    },
  ].slice(-MAX_SAMPLES);
  store[key] = nextSamples;
  writeStore(store);
}

export function getPerformanceBudgetSnapshot(
  key: PerformanceMetricKey
): PerformanceBudgetSnapshot {
  const store = readStore();
  const samples = Array.isArray(store[key]) ? store[key] : [];
  return summarize(key, samples);
}

export function getAllPerformanceBudgetSnapshots(): PerformanceBudgetSnapshot[] {
  return (Object.keys(PERFORMANCE_BUDGETS) as PerformanceMetricKey[]).map((key) =>
    getPerformanceBudgetSnapshot(key)
  );
}
