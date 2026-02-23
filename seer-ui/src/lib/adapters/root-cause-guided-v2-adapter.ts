import type { GuidedInvestigationResponse } from "@/lib/backend-ai";
import { buildViewModelMeta, type ViewModelMeta } from "@/lib/adapters/common";

export type RootCauseGuidedRunState = "queued" | "running" | "completed" | "error";

export type RootCauseGuidedStageKey =
  | "ontology_question"
  | "process_mining"
  | "process_interpret"
  | "root_cause_setup"
  | "root_cause_run"
  | "root_cause_interpret";

export type RootCauseGuidedStageViewModel = {
  key: RootCauseGuidedStageKey;
  label: string;
  summary: string;
  state: RootCauseGuidedRunState;
  detail: string;
};

export type RootCauseGuidedActionItemViewModel = {
  id: string;
  owner: "ontology" | "process" | "root_cause";
  text: string;
};

export type RootCauseGuidedHandoffLinkViewModel = {
  label: string;
  description: string;
  href: string;
};

export type RootCauseGuidedInvestigationV2ViewModel = {
  investigation_id: string;
  anchor_object_type: string;
  window_label: string;
  process_run_id: string;
  root_cause_run_id: string;
  baseline_rate_label: string;
  insight_count: number;
  ontology_policy: string;
  process_policy: string;
  root_cause_policy: string;
  action_items: RootCauseGuidedActionItemViewModel[];
  handoff_links: RootCauseGuidedHandoffLinkViewModel[];
  meta: ViewModelMeta;
};

export const ROOT_CAUSE_GUIDED_STAGE_META: Array<{
  key: RootCauseGuidedStageKey;
  label: string;
  summary: string;
}> = [
  {
    key: "ontology_question",
    label: "Ontology Question",
    summary: "Use ontology-aware policy checks to scope investigation context.",
  },
  {
    key: "process_mining",
    label: "Process Mining",
    summary: "Mine traces in the requested window and anchor-object scope.",
  },
  {
    key: "process_interpret",
    label: "Process Interpretation",
    summary: "Produce analytical process interpretation from mined graph statistics.",
  },
  {
    key: "root_cause_setup",
    label: "RCA Setup",
    summary: "Draft bounded RCA setup guidance with transparent caveats.",
  },
  {
    key: "root_cause_run",
    label: "Root-Cause Run",
    summary: "Execute ranked RCA insights over canonical root-cause contracts.",
  },
  {
    key: "root_cause_interpret",
    label: "RCA Interpretation",
    summary: "Summarize evidence-backed insights and next investigation actions.",
  },
];

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function formatDateTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) {
    return value;
  }
  return parsed.toLocaleString();
}

function buildRootCauseHref(dto: GuidedInvestigationResponse): string {
  const params = new URLSearchParams({
    anchor_object_type: dto.anchor_object_type,
    start_at: dto.start_at,
    end_at: dto.end_at,
    depth: String(dto.root_cause_run.depth),
    outcome_event_type: dto.root_cause_run.outcome.event_type,
  });
  if (dto.root_cause_run.outcome.object_type) {
    params.set("outcome_object_type", dto.root_cause_run.outcome.object_type);
  }
  return `/root-cause?${params.toString()}`;
}

function buildInsightsHref(dto: GuidedInvestigationResponse): string {
  const params = new URLSearchParams({
    question: dto.ontology.copilot.answer,
    anchor_object_type: dto.anchor_object_type,
    start_at: dto.start_at,
    end_at: dto.end_at,
    depth: String(dto.root_cause_run.depth),
    outcome_event_type: dto.root_cause_run.outcome.event_type,
  });
  return `/insights?${params.toString()}`;
}

function buildActionItems(dto: GuidedInvestigationResponse): RootCauseGuidedActionItemViewModel[] {
  const actions: RootCauseGuidedActionItemViewModel[] = [];

  dto.ontology.next_actions.forEach((action, index) => {
    actions.push({
      id: `ontology-${index}`,
      owner: "ontology",
      text: action,
    });
  });

  dto.process_ai.next_actions.forEach((action, index) => {
    actions.push({
      id: `process-${index}`,
      owner: "process",
      text: action,
    });
  });

  dto.root_cause_ai.next_actions.forEach((action, index) => {
    actions.push({
      id: `root-cause-${index}`,
      owner: "root_cause",
      text: action,
    });
  });

  return actions;
}

function buildCompletedDetail(
  key: RootCauseGuidedStageKey,
  dto: GuidedInvestigationResponse
): string {
  if (key === "ontology_question") {
    return `${dto.ontology.response_policy} policy | ${dto.ontology.evidence.length} evidence items`;
  }
  if (key === "process_mining") {
    return `Run ${dto.process_run.run_id} | ${dto.process_run.nodes.length} nodes, ${dto.process_run.edges.length} edges`;
  }
  if (key === "process_interpret") {
    return `${dto.process_ai.response_policy} policy | ${dto.process_ai.caveats.length} caveats`;
  }
  if (key === "root_cause_setup") {
    return `Suggested depth ${dto.root_cause_setup.setup.suggested_depth} | ${dto.root_cause_setup.setup.suggestions.length} outcomes`;
  }
  if (key === "root_cause_run") {
    return `Run ${dto.root_cause_run.run_id} | ${dto.root_cause_run.insights.length} insights`;
  }
  return `${dto.root_cause_ai.response_policy} policy | ${dto.root_cause_ai.next_actions.length} next actions`;
}

function buildPendingDetail(state: RootCauseGuidedRunState): string {
  if (state === "running") {
    return "Executing in backend orchestration.";
  }
  if (state === "queued") {
    return "Waiting for orchestration start.";
  }
  return "Pending.";
}

export function buildGuidedInvestigationStages(
  runState: RootCauseGuidedRunState,
  response: GuidedInvestigationResponse | null,
  errorMessage: string | null,
  activeStageIndex = 0
): RootCauseGuidedStageViewModel[] {
  const clampedIndex = Math.max(0, Math.min(activeStageIndex, ROOT_CAUSE_GUIDED_STAGE_META.length - 1));

  return ROOT_CAUSE_GUIDED_STAGE_META.map((stage, index) => {
    if (runState === "completed" && response) {
      return {
        ...stage,
        state: "completed",
        detail: buildCompletedDetail(stage.key, response),
      };
    }

    if (runState === "error") {
      if (index < clampedIndex) {
        return {
          ...stage,
          state: "completed",
          detail: "Completed before failure.",
        };
      }
      if (index === clampedIndex) {
        return {
          ...stage,
          state: "error",
          detail: errorMessage ?? "Failure while orchestrating guided investigation.",
        };
      }
      return {
        ...stage,
        state: "queued",
        detail: "Not executed due to upstream error.",
      };
    }

    if (runState === "running") {
      if (index < clampedIndex) {
        return {
          ...stage,
          state: "completed",
          detail: "Completed in current orchestration run.",
        };
      }
      if (index === clampedIndex) {
        return {
          ...stage,
          state: "running",
          detail: buildPendingDetail("running"),
        };
      }
      return {
        ...stage,
        state: "queued",
        detail: buildPendingDetail("queued"),
      };
    }

    return {
      ...stage,
      state: runState,
      detail: buildPendingDetail(runState),
    };
  });
}

export function adaptGuidedInvestigationV2(
  dto: GuidedInvestigationResponse
): RootCauseGuidedInvestigationV2ViewModel {
  return {
    investigation_id: dto.investigation_id,
    anchor_object_type: dto.anchor_object_type,
    window_label: `${formatDateTime(dto.start_at)} to ${formatDateTime(dto.end_at)}`,
    process_run_id: dto.process_run.run_id,
    root_cause_run_id: dto.root_cause_run.run_id,
    baseline_rate_label: formatPercent(dto.root_cause_run.baseline_rate),
    insight_count: dto.root_cause_run.insights.length,
    ontology_policy: dto.ontology.response_policy,
    process_policy: dto.process_ai.response_policy,
    root_cause_policy: dto.root_cause_ai.response_policy,
    action_items: buildActionItems(dto),
    handoff_links: [
      {
        label: "Open Root-Cause Workspace",
        description: "Continue evidence drill-down and hypothesis comparison in /root-cause.",
        href: buildRootCauseHref(dto),
      },
      {
        label: "Restart Guided Investigation",
        description: "Reuse this run window to ask a follow-up question in /insights.",
        href: buildInsightsHref(dto),
      },
      {
        label: "Open Process Explorer",
        description: "Inspect process graph details for this investigation window.",
        href: "/process",
      },
    ],
    meta: buildViewModelMeta(),
  };
}
