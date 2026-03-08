ALTER TABLE event_history
    ADD COLUMN IF NOT EXISTS produced_by_execution_id Nullable(UUID) AFTER attributes;

CREATE TABLE IF NOT EXISTS agentic_workflow_completion_messages (
    execution_id UUID,
    workflow_uri String,
    attempt_no UInt32,
    sequence_no UInt64,
    message_role String,
    message_kind Nullable(String),
    call_id Nullable(String),
    message_json String,
    persisted_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = MergeTree
ORDER BY (execution_id, attempt_no, sequence_no);
