import type { AssistantCompletionMessage } from '@/app/lib/api/assistant-chat';

export type AssistantArtifactType =
  | 'ocdfg'
  | 'process'
  | 'rca'
  | 'object-timeline'
  | 'table';

export interface AssistantArtifact {
  artifact_id: string;
  artifact_type: AssistantArtifactType;
  title: string;
  summary?: string | null;
  data: Record<string, unknown>;
}

export type AssistantCanvasActionKind = 'present' | 'update' | 'close';

export interface AssistantCanvasAction {
  action: AssistantCanvasActionKind;
  target: 'split-right';
  artifact_id?: string | null;
  title?: string | null;
}

export interface AssistantCanvasState {
  visible: boolean;
  target: 'split-right';
  action: AssistantCanvasActionKind | null;
  artifact: AssistantArtifact | null;
  title: string | null;
}

function parseToolPayload(message: AssistantCompletionMessage): Record<string, unknown> | null {
  if (message.role !== 'tool' || typeof message.content !== 'string' || !message.content.trim()) {
    return null;
  }

  try {
    const parsed = JSON.parse(message.content);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function parseArtifact(payload: Record<string, unknown>): AssistantArtifact | null {
  const artifact = payload.artifact;
  if (!artifact || typeof artifact !== 'object') return null;
  const parsed = artifact as Record<string, unknown>;
  if (
    typeof parsed.artifact_id !== 'string' ||
    typeof parsed.artifact_type !== 'string' ||
    typeof parsed.title !== 'string' ||
    !parsed.data ||
    typeof parsed.data !== 'object'
  ) {
    return null;
  }

  return {
    artifact_id: parsed.artifact_id,
    artifact_type: parsed.artifact_type as AssistantArtifactType,
    title: parsed.title,
    summary: typeof parsed.summary === 'string' ? parsed.summary : null,
    data: parsed.data as Record<string, unknown>,
  };
}

function parseCanvasAction(payload: Record<string, unknown>): AssistantCanvasAction | null {
  const canvasAction = payload.canvas_action;
  if (!canvasAction || typeof canvasAction !== 'object') return null;
  const parsed = canvasAction as Record<string, unknown>;
  if (
    (parsed.action !== 'present' && parsed.action !== 'update' && parsed.action !== 'close') ||
    parsed.target !== 'split-right'
  ) {
    return null;
  }

  return {
    action: parsed.action,
    target: 'split-right',
    artifact_id: typeof parsed.artifact_id === 'string' ? parsed.artifact_id : null,
    title: typeof parsed.title === 'string' ? parsed.title : null,
  };
}

export function deriveCanvasStateFromCompletionMessages(
  completionMessages: AssistantCompletionMessage[]
): AssistantCanvasState {
  const artifacts = new Map<string, AssistantArtifact>();
  let currentState: AssistantCanvasState = {
    visible: false,
    target: 'split-right',
    action: null,
    artifact: null,
    title: null,
  };

  for (const message of completionMessages) {
    const payload = parseToolPayload(message);
    if (!payload) continue;

    const artifact = parseArtifact(payload);
    if (artifact) {
      artifacts.set(artifact.artifact_id, artifact);
    }

    const canvasAction = parseCanvasAction(payload);
    if (!canvasAction) continue;

    if (canvasAction.action === 'close') {
      currentState = {
        visible: false,
        target: 'split-right',
        action: 'close',
        artifact: null,
        title: null,
      };
      continue;
    }

    const selectedArtifact = canvasAction.artifact_id
      ? artifacts.get(canvasAction.artifact_id) || null
      : null;
    currentState = {
      visible: selectedArtifact !== null,
      target: 'split-right',
      action: canvasAction.action,
      artifact: selectedArtifact,
      title: canvasAction.title || selectedArtifact?.title || null,
    };
  }

  return currentState;
}
