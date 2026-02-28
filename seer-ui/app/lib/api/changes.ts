import { fetchApi } from "./client";
import { recordPerformanceMetric } from "@/app/lib/performance-budget";
import type {
  BlastRadiusEntry,
  CompatibilityClass,
  GovernanceMetric,
  GovernanceScorecard,
  SemanticConceptChange,
  SemanticDiffQuery,
  SemanticDiffReport,
  SemanticRelationChange,
} from "@/app/types/changes";

function toQuery(params: Record<string, string | undefined>) {
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (!value) return;
    searchParams.set(key, value);
  });
  const query = searchParams.toString();
  return query ? `?${query}` : "";
}

function emptyCompatibilityCounts(): Record<CompatibilityClass, number> {
  return {
    breaking: 0,
    risky: 0,
    additive: 0,
    non_functional: 0,
  };
}

function normalizeRelationChange(input: SemanticRelationChange): SemanticRelationChange {
  return {
    id: input.id,
    fromUri: input.fromUri,
    toUri: input.toUri,
    relationUri: input.relationUri,
    relationLabel: input.relationLabel,
    deltaKind: input.deltaKind,
    compatibility: input.compatibility,
    summary: input.summary,
  };
}

function normalizeConceptChange(input: SemanticConceptChange): SemanticConceptChange {
  return {
    id: input.id,
    conceptUri: input.conceptUri,
    conceptLabel: input.conceptLabel,
    nodeLabel: input.nodeLabel,
    deltaKind: input.deltaKind,
    compatibility: input.compatibility,
    summary: input.summary,
    rationale: input.rationale,
    impactedConceptUris: Array.isArray(input.impactedConceptUris)
      ? input.impactedConceptUris
      : [],
    relationChanges: Array.isArray(input.relationChanges)
      ? input.relationChanges.map(normalizeRelationChange)
      : [],
  };
}

function normalizeBlastRadiusEntry(input: BlastRadiusEntry): BlastRadiusEntry {
  return {
    id: input.id,
    ownerTeam: input.ownerTeam,
    service: input.service,
    severity: input.severity,
    reason: input.reason,
    conceptUris: Array.isArray(input.conceptUris) ? input.conceptUris : [],
  };
}

function normalizeGovernanceMetric(input: GovernanceMetric): GovernanceMetric {
  return {
    key: input.key,
    label: input.label,
    unit: input.unit,
    value: Number(input.value) || 0,
    target: Number(input.target) || 0,
    status: input.status,
    trend: input.trend,
    history: Array.isArray(input.history)
      ? input.history.map((point) => ({
          bucket: point.bucket,
          value: Number(point.value) || 0,
        }))
      : [],
  };
}

function normalizeGovernanceScorecard(input: GovernanceScorecard | undefined): GovernanceScorecard {
  if (!input) {
    return {
      domain: "default",
      generatedAt: new Date().toISOString(),
      overallScore: 0,
      metrics: [],
    };
  }

  return {
    domain: input.domain,
    generatedAt: input.generatedAt || new Date().toISOString(),
    overallScore: Number(input.overallScore) || 0,
    metrics: Array.isArray(input.metrics) ? input.metrics.map(normalizeGovernanceMetric) : [],
  };
}

function summarize(
  conceptChanges: SemanticConceptChange[],
  relationChanges: SemanticRelationChange[]
) {
  const compatibilityCounts = emptyCompatibilityCounts();
  conceptChanges.forEach((change) => {
    compatibilityCounts[change.compatibility] += 1;
  });
  relationChanges.forEach((change) => {
    compatibilityCounts[change.compatibility] += 1;
  });
  return {
    totalConceptChanges: conceptChanges.length,
    totalRelationChanges: relationChanges.length,
    compatibilityCounts,
  };
}

function normalizeReport(report: SemanticDiffReport): SemanticDiffReport {
  const conceptChanges = Array.isArray(report.conceptChanges)
    ? report.conceptChanges.map(normalizeConceptChange)
    : [];
  const relationChanges = Array.isArray(report.relationChanges)
    ? report.relationChanges.map(normalizeRelationChange)
    : [];
  const blastRadius = Array.isArray(report.blastRadius)
    ? report.blastRadius.map(normalizeBlastRadiusEntry)
    : [];
  const governance = normalizeGovernanceScorecard(report.governance);

  return {
    source: report.source || "api",
    generatedAt: report.generatedAt || new Date().toISOString(),
    pullRequestRef: report.pullRequestRef,
    baseRef: report.baseRef,
    headRef: report.headRef,
    summary: report.summary || summarize(conceptChanges, relationChanges),
    conceptChanges,
    relationChanges,
    blastRadius,
    governance,
  };
}

function getFallbackReport(query: SemanticDiffQuery): SemanticDiffReport {
  const relationChanges: SemanticRelationChange[] = [
    {
      id: "rel-1",
      fromUri: "support_local:act_triage_ticket",
      toUri: "support_local:evt_ticket_triaged",
      relationUri: "prophet:producesEvent",
      relationLabel: "producesEvent",
      deltaKind: "modified",
      compatibility: "breaking",
      summary: "Action now emits a transition event instead of signal event for triage completion.",
    },
    {
      id: "rel-2",
      fromUri: "support_local:evt_ticket_triaged",
      toUri: "support_local:transition_ticket_triaged_to_in_progress",
      relationUri: "prophet:transitionOf",
      relationLabel: "transitionOf",
      deltaKind: "added",
      compatibility: "additive",
      summary: "Transition association added so triage completion updates state progression.",
    },
    {
      id: "rel-3",
      fromUri: "support_local:trigger_escalation_watch",
      toUri: "support_local:act_escalate_ticket",
      relationUri: "prophet:invokes",
      relationLabel: "invokes",
      deltaKind: "modified",
      compatibility: "risky",
      summary: "Trigger invocation path now includes escalation guard condition metadata.",
    },
    {
      id: "rel-4",
      fromUri: "support_local:sig_ticket_triaged",
      toUri: "support_local:trigger_triage_completed",
      relationUri: "prophet:listensTo",
      relationLabel: "listensTo",
      deltaKind: "removed",
      compatibility: "non_functional",
      summary: "Legacy signal listener removed after transition-based event normalization.",
    },
  ];

  const conceptChanges: SemanticConceptChange[] = [
    {
      id: "concept-1",
      conceptUri: "support_local:evt_ticket_triaged",
      conceptLabel: "Ticket Triaged Event",
      nodeLabel: "Event",
      deltaKind: "modified",
      compatibility: "breaking",
      summary:
        "Event contract moved from signal payload to transition payload with fromState/toState refs.",
      rationale:
        "Existing consumers must resolve transition references to maintain downstream automation behavior.",
      impactedConceptUris: [
        "support_local:trigger_triage_completed",
        "support_local:act_triage_ticket",
        "support_local:obj_ticket",
      ],
      relationChanges: [relationChanges[0], relationChanges[1]],
    },
    {
      id: "concept-2",
      conceptUri: "support_local:trigger_escalation_watch",
      conceptLabel: "Escalation Watch Trigger",
      nodeLabel: "EventTrigger",
      deltaKind: "modified",
      compatibility: "risky",
      summary: "Trigger rule now includes SLA breach threshold filter and escalation policy context.",
      rationale:
        "Semantics are compatible but runtime event frequency and ownership notifications may change.",
      impactedConceptUris: [
        "support_local:act_escalate_ticket",
        "support_local:workflow_support_resolution",
      ],
      relationChanges: [relationChanges[2]],
    },
    {
      id: "concept-3",
      conceptUri: "support_local:sig_ticket_triaged",
      conceptLabel: "Ticket Triaged Signal",
      nodeLabel: "Signal",
      deltaKind: "removed",
      compatibility: "additive",
      summary: "Legacy signal retained for history only; live routing moved to transition event path.",
      rationale:
        "New model is additive to the canonical event path, but local tools should stop referencing signal.",
      impactedConceptUris: ["support_local:trigger_triage_completed"],
      relationChanges: [relationChanges[3]],
    },
  ];

  const blastRadius: BlastRadiusEntry[] = [
    {
      id: "blast-1",
      ownerTeam: "Support Automation",
      service: "workflow-orchestrator",
      severity: "high",
      reason:
        "Consumes triage event contract and transition references for routing state progression.",
      conceptUris: [
        "support_local:evt_ticket_triaged",
        "support_local:transition_ticket_triaged_to_in_progress",
      ],
    },
    {
      id: "blast-2",
      ownerTeam: "SLA Governance",
      service: "policy-evaluator",
      severity: "medium",
      reason:
        "Escalation trigger invocation path changed; policy checks and thresholds may need alignment.",
      conceptUris: [
        "support_local:trigger_escalation_watch",
        "support_local:act_escalate_ticket",
      ],
    },
    {
      id: "blast-3",
      ownerTeam: "CX Intelligence",
      service: "analytics-pipeline",
      severity: "low",
      reason: "Legacy signal listener removal affects historical lineage mapping only.",
      conceptUris: ["support_local:sig_ticket_triaged"],
    },
  ];

  const governance: GovernanceScorecard = {
    domain: "support_local",
    generatedAt: new Date().toISOString(),
    overallScore: 82,
    metrics: [
      {
        key: "shape_conformance",
        label: "Shape Conformance",
        unit: "percent",
        value: 93,
        target: 96,
        status: "warning",
        trend: "up",
        history: [
          { bucket: "w-4", value: 88 },
          { bucket: "w-3", value: 90 },
          { bucket: "w-2", value: 92 },
          { bucket: "w-1", value: 93 },
        ],
      },
      {
        key: "orphan_concepts",
        label: "Orphan Concepts",
        unit: "count",
        value: 4,
        target: 0,
        status: "warning",
        trend: "down",
        history: [
          { bucket: "w-4", value: 9 },
          { bucket: "w-3", value: 7 },
          { bucket: "w-2", value: 5 },
          { bucket: "w-1", value: 4 },
        ],
      },
      {
        key: "metadata_completeness",
        label: "Metadata Completeness",
        unit: "percent",
        value: 90,
        target: 95,
        status: "warning",
        trend: "up",
        history: [
          { bucket: "w-4", value: 82 },
          { bucket: "w-3", value: 85 },
          { bucket: "w-2", value: 88 },
          { bucket: "w-1", value: 90 },
        ],
      },
    ],
  };

  const pullRequestRef =
    query.prNumber !== undefined
      ? `PR #${query.prNumber}`
      : query.baseRef || query.headRef
      ? `${query.baseRef || "base"}...${query.headRef || "head"}`
      : "Local change set";

  return {
    source: "demo",
    generatedAt: new Date().toISOString(),
    pullRequestRef,
    baseRef: query.baseRef,
    headRef: query.headRef,
    summary: summarize(conceptChanges, relationChanges),
    conceptChanges,
    relationChanges,
    blastRadius,
    governance,
  };
}

export async function getSemanticDiffReport(
  query: SemanticDiffQuery
): Promise<SemanticDiffReport> {
  const startedAt =
    typeof window !== "undefined" && typeof window.performance !== "undefined"
      ? window.performance.now()
      : null;
  const endpoint = `/changes/semantic-diff${toQuery({
    pr: query.prNumber !== undefined ? String(query.prNumber) : undefined,
    baseRef: query.baseRef,
    headRef: query.headRef,
    ontologyUri: query.ontologyUri,
  })}`;

  try {
    const report = await fetchApi<SemanticDiffReport>(endpoint);
    return normalizeReport(report);
  } catch {
    return getFallbackReport(query);
  } finally {
    if (startedAt !== null && typeof window !== "undefined" && typeof window.performance !== "undefined") {
      recordPerformanceMetric("semantic_diff_load_ms", window.performance.now() - startedAt);
    }
  }
}
