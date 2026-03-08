export type AgenticWorkflowStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'retry_wait'
  | 'failed_terminal'
  | 'dead_letter';

export type AgenticWorkflowActionKind = 'process' | 'workflow' | 'agentic_workflow';
export type AgenticWorkflowMessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface AgenticWorkflowActionSummary {
  action_id: string;
  user_id: string;
  action_uri: string;
  action_kind: AgenticWorkflowActionKind;
  status: AgenticWorkflowStatus;
  parent_execution_id: string | null;
  attempt_count: number;
  max_attempts: number;
  submitted_at: string;
  updated_at: string;
  completed_at: string | null;
  lease_owner_instance_id: string | null;
  lease_expires_at: string | null;
  last_error_code: string | null;
  last_error_detail: string | null;
}

export interface AgenticWorkflowExecutionSummary {
  action: AgenticWorkflowActionSummary;
  transcript_message_count: number;
  last_transcript_persisted_at: string | null;
}

export interface AgenticWorkflowExecutionListResponse {
  user_id: string;
  status: AgenticWorkflowStatus | null;
  workflow_uri: string | null;
  search: string | null;
  page: number;
  size: number;
  total: number;
  executions: AgenticWorkflowExecutionSummary[];
}

export interface AgenticWorkflowProducedEvent {
  event_id: string;
  occurred_at: string;
  event_type: string;
  source: string;
  payload: Record<string, unknown>;
  trace_id: string | null;
  attributes: Record<string, unknown> | null;
  produced_by_execution_id: string | null;
  ingested_at: string;
}

export interface AgenticWorkflowExecutionDetailResponse {
  execution: AgenticWorkflowExecutionSummary;
  parent_execution: AgenticWorkflowActionSummary | null;
  child_executions: AgenticWorkflowActionSummary[];
  produced_events: AgenticWorkflowProducedEvent[];
}

export interface AgenticWorkflowTranscriptMessage {
  ordinal: number;
  execution_id: string;
  workflow_uri: string;
  attempt_no: number;
  sequence_no: number;
  role: AgenticWorkflowMessageRole;
  message_kind: string | null;
  call_id: string | null;
  message: Record<string, unknown>;
  persisted_at: string;
}

export interface AgenticWorkflowMessagesResponse {
  execution_id: string;
  workflow_uri: string;
  total_messages: number;
  returned_messages: number;
  last_ordinal: number;
  messages: AgenticWorkflowTranscriptMessage[];
}

export interface AgenticWorkflowTranscriptSnapshotEvent {
  execution_id: string;
  workflow_uri: string;
  status: AgenticWorkflowStatus;
  attempt_count: number;
  last_ordinal: number;
  updated_at: string;
  terminal: boolean;
}

export interface AgenticWorkflowTranscriptErrorEvent {
  status_code?: number;
  code?: string;
  message?: string;
  [key: string]: unknown;
}
