import { fetchApi } from "./client";
import type {
  RootCauseAssistInterpretRequestContract,
  RootCauseAssistInterpretResponseContract,
  RootCauseAssistSetupRequestContract,
  RootCauseAssistSetupResponseContract,
  RootCauseEvidenceResponseContract,
  RootCauseRequestContract,
  RootCauseRunResponseContract,
} from "@/app/types/root-cause";

export async function runRootCause(
  request: RootCauseRequestContract
): Promise<RootCauseRunResponseContract> {
  return fetchApi<RootCauseRunResponseContract>("/root-cause/run", {
    method: "POST",
    body: JSON.stringify(request),
  });
}

export async function getRootCauseEvidence(
  handle: string,
  limit = 10
): Promise<RootCauseEvidenceResponseContract> {
  const query = new URLSearchParams({
    handle,
    limit: String(limit),
  }).toString();
  return fetchApi<RootCauseEvidenceResponseContract>(`/root-cause/evidence?${query}`);
}

export async function assistRootCauseSetup(
  request: RootCauseAssistSetupRequestContract
): Promise<RootCauseAssistSetupResponseContract> {
  return fetchApi<RootCauseAssistSetupResponseContract>("/root-cause/assist/setup", {
    method: "POST",
    body: JSON.stringify(request),
  });
}

export async function assistRootCauseInterpret(
  request: RootCauseAssistInterpretRequestContract
): Promise<RootCauseAssistInterpretResponseContract> {
  return fetchApi<RootCauseAssistInterpretResponseContract>("/root-cause/assist/interpret", {
    method: "POST",
    body: JSON.stringify(request),
  });
}
