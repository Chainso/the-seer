"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { RootCauseResultsSurface } from "@/app/components/inspector/root-cause-results-surface";
import { assistRootCauseInterpret, getRootCauseEvidence } from "@/app/lib/api/root-cause";
import { useOntologyDisplay } from "@/app/lib/ontology-display";
import type {
  RootCauseAssistInterpretResponseContract,
  RootCauseEvidenceResponseContract,
  RootCauseInsightResultContract,
  RootCauseRunResponseContract,
} from "@/app/types/root-cause";

interface AssistantRootCauseCanvasProps {
  run: RootCauseRunResponseContract;
}

function parseEvidenceLimit(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 10;
  }
  return Math.floor(parsed);
}

export function AssistantRootCauseCanvas({ run }: AssistantRootCauseCanvasProps) {
  const ontologyDisplay = useOntologyDisplay();
  const [selectedInsightId, setSelectedInsightId] = useState<string | null>(run.insights[0]?.insight_id ?? null);
  const [evidenceLimit, setEvidenceLimit] = useState("10");
  const [evidence, setEvidence] = useState<RootCauseEvidenceResponseContract | null>(null);
  const [evidenceLoading, setEvidenceLoading] = useState(false);
  const [evidenceError, setEvidenceError] = useState<string | null>(null);
  const [interpretation, setInterpretation] = useState<RootCauseAssistInterpretResponseContract | null>(null);
  const [interpretLoading, setInterpretLoading] = useState(false);
  const [interpretError, setInterpretError] = useState<string | null>(null);
  const evidenceSignatureRef = useRef("");

  const selectedInsight = useMemo(
    () => run.insights.find((insight) => insight.insight_id === selectedInsightId) || run.insights[0] || null,
    [run.insights, selectedInsightId]
  );
  const displayObjectType = useCallback(
    (objectType: string) => ontologyDisplay.displayObjectType(objectType),
    [ontologyDisplay]
  );
  const displayEventType = useCallback(
    (eventType: string) =>
      ontologyDisplay.displayEventType(eventType, {
        fallbackObjectType: run.anchor_object_type,
      }),
    [ontologyDisplay, run.anchor_object_type]
  );
  const displayFilterFieldLabel = useCallback(
    (field: string) =>
      ontologyDisplay.displayFieldLabel(field, {
        objectType: run.anchor_object_type,
      }),
    [ontologyDisplay, run.anchor_object_type]
  );
  const loadEvidence = useCallback(async (insight: RootCauseInsightResultContract) => {
    const limit = parseEvidenceLimit(evidenceLimit);
    setEvidenceLoading(true);
    setEvidenceError(null);
    try {
      const response = await getRootCauseEvidence(insight.evidence_handle, limit);
      setEvidence(response);
    } catch (error) {
      setEvidence(null);
      setEvidenceError(error instanceof Error ? error.message : "Failed to load evidence traces.");
    } finally {
      setEvidenceLoading(false);
    }
  }, [evidenceLimit]);

  useEffect(() => {
    setSelectedInsightId((current) => {
      if (current && run.insights.some((insight) => insight.insight_id === current)) {
        return current;
      }
      return run.insights[0]?.insight_id ?? null;
    });
    setEvidence(null);
    setEvidenceError(null);
    setInterpretation(null);
    setInterpretError(null);
    evidenceSignatureRef.current = "";
  }, [run]);

  useEffect(() => {
    if (!selectedInsight) {
      evidenceSignatureRef.current = "";
      return;
    }
    const signature = `${selectedInsight.evidence_handle}|${evidenceLimit}`;
    if (evidenceSignatureRef.current === signature) {
      return;
    }
    evidenceSignatureRef.current = signature;
    void loadEvidence(selectedInsight);
  }, [evidenceLimit, loadEvidence, selectedInsight]);

  const runInterpretation = useCallback(async () => {
    if (run.insights.length === 0) {
      setInterpretError("Run analysis first to generate insights.");
      return;
    }
    setInterpretLoading(true);
    setInterpretError(null);
    try {
      const response = await assistRootCauseInterpret({
        baseline_rate: run.baseline_rate,
        insights: run.insights,
      });
      setInterpretation(response);
    } catch (error) {
      setInterpretation(null);
      setInterpretError(error instanceof Error ? error.message : "Failed to interpret insights.");
    } finally {
      setInterpretLoading(false);
    }
  }, [run.baseline_rate, run.insights]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto p-5" data-assistant-rca-canvas>
      <RootCauseResultsSurface
        run={run}
        selectedInsightId={selectedInsightId}
        onSelectInsight={(insight) => setSelectedInsightId(insight.insight_id)}
        evidenceLimit={evidenceLimit}
        onEvidenceLimitChange={setEvidenceLimit}
        evidence={evidence}
        evidenceLoading={evidenceLoading}
        evidenceError={evidenceError}
        interpretation={interpretation}
        interpretLoading={interpretLoading}
        interpretError={interpretError}
        onRunInterpretation={runInterpretation}
        displayObjectType={displayObjectType}
        displayFilterFieldLabel={displayFilterFieldLabel}
        displayEventType={displayEventType}
      />
    </div>
  );
}
