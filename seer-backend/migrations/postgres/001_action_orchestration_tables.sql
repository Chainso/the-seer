CREATE TABLE IF NOT EXISTS actions (
    action_id UUID PRIMARY KEY,
    user_id TEXT NOT NULL,
    action_uri TEXT NOT NULL,
    action_kind TEXT NOT NULL,
    parent_execution_id UUID NULL REFERENCES actions(action_id),
    input_payload JSONB NOT NULL,
    status TEXT NOT NULL,
    priority INTEGER NOT NULL DEFAULT 0,
    idempotency_key TEXT NULL,
    ontology_release_id TEXT NOT NULL,
    validation_contract_hash TEXT NOT NULL,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts > 0),
    next_visible_at TIMESTAMPTZ NOT NULL,
    lease_owner_instance_id TEXT NULL,
    lease_expires_at TIMESTAMPTZ NULL,
    last_error_code TEXT NULL,
    last_error_detail TEXT NULL,
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_actions_user_status_visible
    ON actions (user_id, status, next_visible_at);

CREATE INDEX IF NOT EXISTS idx_actions_lease_expires
    ON actions (lease_expires_at);

CREATE INDEX IF NOT EXISTS idx_actions_submitted_at
    ON actions (submitted_at);

CREATE INDEX IF NOT EXISTS idx_actions_parent_execution
    ON actions (parent_execution_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_actions_user_idempotency
    ON actions (user_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS action_attempts (
    attempt_id UUID PRIMARY KEY,
    action_id UUID NOT NULL REFERENCES actions(action_id) ON DELETE CASCADE,
    attempt_no INTEGER NOT NULL CHECK (attempt_no > 0),
    instance_id TEXT NOT NULL,
    leased_at TIMESTAMPTZ NOT NULL,
    started_at TIMESTAMPTZ NULL,
    finished_at TIMESTAMPTZ NULL,
    outcome TEXT NULL,
    error_code TEXT NULL,
    error_detail TEXT NULL,
    UNIQUE (action_id, attempt_no)
);

CREATE INDEX IF NOT EXISTS idx_action_attempts_action_leased
    ON action_attempts (action_id, leased_at);

CREATE INDEX IF NOT EXISTS idx_action_attempts_instance_leased
    ON action_attempts (instance_id, leased_at);

CREATE TABLE IF NOT EXISTS instances (
    instance_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    last_seen_at TIMESTAMPTZ NOT NULL,
    capacity INTEGER NULL,
    metadata JSONB NULL,
    PRIMARY KEY (instance_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_instances_user_status_seen
    ON instances (user_id, status, last_seen_at);

CREATE TABLE IF NOT EXISTS action_dead_letters (
    action_id UUID PRIMARY KEY REFERENCES actions(action_id) ON DELETE CASCADE,
    dead_lettered_at TIMESTAMPTZ NOT NULL,
    reason_code TEXT NOT NULL,
    reason_detail TEXT NULL,
    replayed_from_action_id UUID NULL REFERENCES actions(action_id)
);

CREATE INDEX IF NOT EXISTS idx_action_dead_letters_dead_lettered_at
    ON action_dead_letters (dead_lettered_at);
