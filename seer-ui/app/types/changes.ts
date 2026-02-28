export type CompatibilityClass = "breaking" | "risky" | "additive" | "non_functional";

export type DeltaKind = "added" | "removed" | "modified" | "renamed";

export interface SemanticRelationChange {
  id: string;
  fromUri: string;
  toUri: string;
  relationUri: string;
  relationLabel: string;
  deltaKind: DeltaKind;
  compatibility: CompatibilityClass;
  summary: string;
}

export interface SemanticConceptChange {
  id: string;
  conceptUri: string;
  conceptLabel: string;
  nodeLabel: string;
  deltaKind: DeltaKind;
  compatibility: CompatibilityClass;
  summary: string;
  rationale: string;
  impactedConceptUris: string[];
  relationChanges: SemanticRelationChange[];
}

export interface SemanticDiffSummary {
  totalConceptChanges: number;
  totalRelationChanges: number;
  compatibilityCounts: Record<CompatibilityClass, number>;
}

export type BlastRadiusSeverity = "high" | "medium" | "low";

export interface BlastRadiusEntry {
  id: string;
  ownerTeam: string;
  service: string;
  severity: BlastRadiusSeverity;
  reason: string;
  conceptUris: string[];
}

export type GovernanceMetricStatus = "healthy" | "warning" | "critical";
export type GovernanceMetricTrend = "up" | "down" | "flat";

export interface GovernanceTrendPoint {
  bucket: string;
  value: number;
}

export interface GovernanceMetric {
  key: "shape_conformance" | "orphan_concepts" | "metadata_completeness";
  label: string;
  unit: "percent" | "count";
  value: number;
  target: number;
  status: GovernanceMetricStatus;
  trend: GovernanceMetricTrend;
  history: GovernanceTrendPoint[];
}

export interface GovernanceScorecard {
  domain: string;
  generatedAt: string;
  overallScore: number;
  metrics: GovernanceMetric[];
}

export interface SemanticDiffReport {
  source: "api" | "demo";
  generatedAt: string;
  pullRequestRef?: string;
  baseRef?: string;
  headRef?: string;
  summary: SemanticDiffSummary;
  conceptChanges: SemanticConceptChange[];
  relationChanges: SemanticRelationChange[];
  blastRadius: BlastRadiusEntry[];
  governance: GovernanceScorecard;
}

export interface SemanticDiffQuery {
  prNumber?: number;
  baseRef?: string;
  headRef?: string;
  ontologyUri?: string;
}
