import type {
  GuidedInvestigationShortcutInput,
  GuidedInvestigationShortcutLink,
} from "@/lib/assistant/types";

function clampDepth(value: number | undefined): number {
  if (!value || !Number.isFinite(value)) {
    return 2;
  }
  return Math.max(1, Math.min(3, Math.round(value)));
}

function normalizeDate(value: string, fallback: Date): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) {
    return fallback.toISOString();
  }
  return parsed.toISOString();
}

function defaultTimeWindow(hoursBack: number): { startAt: string; endAt: string } {
  const end = new Date();
  const start = new Date(end.getTime() - hoursBack * 60 * 60 * 1000);

  return {
    startAt: start.toISOString(),
    endAt: end.toISOString(),
  };
}

export function buildGuidedInvestigationShortcutHref(input: GuidedInvestigationShortcutInput): string {
  const now = new Date();
  const fallbackStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const params = new URLSearchParams({
    question: input.question.trim(),
    anchor_object_type: input.anchorObjectType.trim() || "Order",
    start_at: normalizeDate(input.startAt, fallbackStart),
    end_at: normalizeDate(input.endAt, now),
    depth: String(clampDepth(input.depth)),
  });

  if (input.outcomeEventType?.trim()) {
    params.set("outcome_event_type", input.outcomeEventType.trim());
  }

  return `/insights?${params.toString()}`;
}

export function buildOntologyGuidedShortcut(input: {
  conceptLabel: string;
  anchorObjectType?: string;
  startAt?: string;
  endAt?: string;
}): GuidedInvestigationShortcutLink {
  const fallbackWindow = defaultTimeWindow(24);

  return {
    id: "ontology-guided-shortcut",
    source: "ontology",
    label: "Investigate with Guided Flow",
    description: `Carry ontology context for ${input.conceptLabel} into the guided AI workflow.`,
    href: buildGuidedInvestigationShortcutHref({
      source: "ontology",
      question: `How does ${input.conceptLabel} influence current investigation outcomes?`,
      anchorObjectType: input.anchorObjectType ?? "Order",
      startAt: input.startAt ?? fallbackWindow.startAt,
      endAt: input.endAt ?? fallbackWindow.endAt,
      depth: 2,
    }),
  };
}

export function buildProcessGuidedShortcut(input: {
  anchorObjectType: string;
  startAt: string;
  endAt: string;
}): GuidedInvestigationShortcutLink {
  return {
    id: "process-guided-shortcut",
    source: "process",
    label: "Escalate Process Findings",
    description: "Open Guided Investigation with the active process window and object scope.",
    href: buildGuidedInvestigationShortcutHref({
      source: "process",
      question: "Which process path deviations should be validated in RCA next?",
      anchorObjectType: input.anchorObjectType,
      startAt: input.startAt,
      endAt: input.endAt,
      depth: 2,
    }),
  };
}

export function buildRootCauseGuidedShortcut(input: {
  anchorObjectType: string;
  startAt: string;
  endAt: string;
  depth: number;
  outcomeEventType?: string;
}): GuidedInvestigationShortcutLink {
  return {
    id: "root-cause-guided-shortcut",
    source: "root-cause",
    label: "Continue in Guided Investigation",
    description: "Carry RCA hypotheses and outcome signals into guided orchestration.",
    href: buildGuidedInvestigationShortcutHref({
      source: "root-cause",
      question: "What root-cause hypotheses should I verify next?",
      anchorObjectType: input.anchorObjectType,
      startAt: input.startAt,
      endAt: input.endAt,
      depth: input.depth,
      outcomeEventType: input.outcomeEventType,
    }),
  };
}

export function buildModuleGuidedShortcuts(input: {
  ontology?: {
    conceptLabel: string;
    anchorObjectType?: string;
    startAt?: string;
    endAt?: string;
  };
  process?: {
    anchorObjectType: string;
    startAt: string;
    endAt: string;
  };
  rootCause?: {
    anchorObjectType: string;
    startAt: string;
    endAt: string;
    depth: number;
    outcomeEventType?: string;
  };
}): GuidedInvestigationShortcutLink[] {
  const shortcuts: GuidedInvestigationShortcutLink[] = [];

  if (input.ontology) {
    shortcuts.push(buildOntologyGuidedShortcut(input.ontology));
  }
  if (input.process) {
    shortcuts.push(buildProcessGuidedShortcut(input.process));
  }
  if (input.rootCause) {
    shortcuts.push(buildRootCauseGuidedShortcut(input.rootCause));
  }

  return shortcuts;
}
