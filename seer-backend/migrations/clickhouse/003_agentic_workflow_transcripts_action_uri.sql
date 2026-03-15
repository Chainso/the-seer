ALTER TABLE agentic_workflow_completion_messages
    RENAME COLUMN IF EXISTS workflow_uri TO action_uri;
