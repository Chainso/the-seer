export type AgenticWorkflowStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'retry_wait'
  | 'failed_terminal'
  | 'dead_letter';

export type AgenticWorkflowActionKind = 'action' | 'agentic_workflow';
export type AgenticWorkflowMessageRole = 'system' | 'user' | 'assistant' | 'tool';
export type ManagedAgentFieldType = 'value_type' | 'object_reference';

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
  status: AgenticWorkflowStatus | null;
  action_uri: string | null;
  search: string | null;
  page: number;
  size: number;
  total: number;
  executions: AgenticWorkflowExecutionSummary[];
}

export interface AgenticWorkflowCapabilityOption {
  value: string;
  label: string;
}

export interface ManagedAgentFieldDefinition {
  field_key: string;
  label: string;
  description: string | null;
  required: boolean;
  multi_value: boolean;
  field_type: ManagedAgentFieldType;
  value_type_iri: string | null;
  object_model_iri: string | null;
}

export interface ManagedAgentSummary {
  managed_agent_key: string;
  action_uri: string;
  name: string;
  description: string | null;
  instruction: string;
  enabled: boolean;
  updated_at: string;
  input_field_count: number;
  output_field_count: number;
}

export interface ManagedAgentDetail {
  managed_agent_key: string;
  action_uri: string;
  name: string;
  description: string | null;
  instruction: string;
  enabled: boolean;
  updated_at: string;
  input_name: string;
  input_description: string | null;
  output_name: string;
  output_description: string | null;
  input_fields: ManagedAgentFieldDefinition[];
  output_fields: ManagedAgentFieldDefinition[];
}

export interface ManagedAgentListResponse {
  total: number;
  managed_agents: ManagedAgentSummary[];
}

export interface ManagedAgentCatalogItem {
  iri: string;
  label: string;
  kind: string;
}

export interface ManagedAgentEditorCatalog {
  object_models: ManagedAgentCatalogItem[];
  value_types: ManagedAgentCatalogItem[];
}

export interface ManagedAgentUpsertRequest {
  managed_agent_key: string;
  name: string;
  description: string | null;
  instruction: string;
  enabled: boolean;
  input_name: string;
  input_description: string | null;
  output_name: string;
  output_description: string | null;
  input_fields: ManagedAgentFieldDefinition[];
  output_fields: ManagedAgentFieldDefinition[];
}

export interface ManagedAgentApiErrorDetail {
  code?: string;
  message?: string;
  field?: string;
  diagnostics?: Array<Record<string, unknown>>;
  [key: string]: unknown;
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
  action_uri: string;
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
  action_uri: string;
  total_messages: number;
  returned_messages: number;
  last_ordinal: number;
  messages: AgenticWorkflowTranscriptMessage[];
}

export interface AgenticWorkflowTranscriptSnapshotEvent {
  execution_id: string;
  action_uri: string;
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
