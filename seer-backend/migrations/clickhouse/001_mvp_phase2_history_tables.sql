CREATE TABLE IF NOT EXISTS event_history (
    event_id UUID,
    occurred_at DateTime64(3, 'UTC'),
    event_type String,
    source String,
    payload String,
    trace_id Nullable(String),
    attributes Nullable(String),
    ingested_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = MergeTree
ORDER BY (occurred_at, event_id);

CREATE TABLE IF NOT EXISTS object_history (
    object_history_id UUID,
    object_type String,
    object_ref String,
    object_ref_canonical String,
    object_ref_hash UInt64,
    object_payload String,
    recorded_at DateTime64(3, 'UTC'),
    source_event_id Nullable(UUID)
)
ENGINE = MergeTree
ORDER BY (object_type, object_ref_hash, recorded_at, object_history_id);

CREATE TABLE IF NOT EXISTS event_object_links (
    event_id UUID,
    object_history_id UUID,
    object_type String,
    object_ref String,
    object_ref_canonical String,
    object_ref_hash UInt64,
    relation_role Nullable(String),
    linked_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = MergeTree
ORDER BY (event_id, object_type, object_ref_hash, object_history_id);
