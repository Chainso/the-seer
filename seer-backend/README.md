# Seer Backend

FastAPI backend for Seer's catalog, investigation, history, action, and managed-agent surfaces.

## Local Development

1. `cd seer-backend`
2. `uv sync --extra dev`
3. `cp .env.example .env`
4. `uv run uvicorn seer_backend.main:app --reload --host 0.0.0.0 --port 8000`

Console entry points:

1. `uv run seer-actions-maintenance`
2. `uv run seer-managed-agent-runner`

## Environment

Copy `.env.example` to `.env` and adjust values as needed.

Set `SEER_ASSISTANT_TURN_LOG_PATH` when you want assistant turn lifecycle logs
written to a dedicated JSONL file for local debugging.

Set `SEER_MANAGED_AGENT_LOG_PATH` when you want managed-agent runner logs
written to a dedicated JSONL file for local debugging.

The backend also supports:

1. `SEER_ASSISTANT_SKILL_DIRS` for additional assistant skill search paths.
2. `SEER_MANAGED_AGENT_RUNNER_ENABLED`, `SEER_MANAGED_AGENT_RUNNER_INTERVAL_SECONDS`, and `SEER_MANAGED_AGENT_RUNNER_BATCH_SIZE` for the Seer-owned managed-agent runner.
3. `SEER_ACTIONS_SCHEMA_BOOTSTRAP_ON_STARTUP` to create the actions schema during app startup.

## Related Specs

1. `../docs/product-specs/action-orchestration-backend-service.md`
2. `../docs/product-specs/assistant-primary-surface.md`
3. `../docs/product-specs/managed-agentic-workflows.md`
4. `../docs/product-specs/managed-agent-controls-and-approvals.md`

## API Surface

The application mounts these API groups under `/api/v1`:

1. `/health`
2. `/catalog`
3. `/ontology`
4. `/history`
5. `/actions`
6. `/agentic-workflows`
7. `/process`
8. `/root-cause`
9. `/ai`

## Catalog APIs

1. `GET /api/v1/catalog/objects`
2. `GET /api/v1/catalog/objects/{catalog_key}`
3. `GET /api/v1/catalog/objects/{catalog_key}/instances`
4. `GET /api/v1/catalog/actions`
5. `GET /api/v1/catalog/actions/{catalog_key}`
6. `GET /api/v1/catalog/actions/{catalog_key}/runs`
7. `GET /api/v1/catalog/events`
8. `GET /api/v1/catalog/events/{catalog_key}`
9. `GET /api/v1/catalog/events/{catalog_key}/occurrences`
10. `GET /api/v1/catalog/triggers`
11. `GET /api/v1/catalog/triggers/{catalog_key}`
12. `GET /api/v1/catalog/triggers/{catalog_key}/firings`

## Ontology APIs

1. `POST /api/v1/ontology/ingest`
2. `GET /api/v1/ontology/current`
3. `GET /api/v1/ontology/concepts`
4. `GET /api/v1/ontology/concept-detail`
5. `GET /api/v1/ontology/graph`
6. `POST /api/v1/ontology/query`
7. `POST /api/v1/ontology/copilot`

## Action APIs

1. `POST /api/v1/actions/submit`
2. `POST /api/v1/actions/claim`
3. `GET /api/v1/actions`
4. `GET /api/v1/actions/{action_id}`
5. `GET /api/v1/actions/{action_id}/stream`
6. `POST /api/v1/actions/{action_id}/complete`
7. `POST /api/v1/actions/{action_id}/fail`
8. `POST /api/v1/actions/{action_id}/retry`
9. `POST /api/v1/actions/instances/heartbeat`

## Managed-Agent APIs

1. `GET /api/v1/agentic-workflows/managed-agents`
2. `GET /api/v1/agentic-workflows/managed-agents/editor-catalog`
3. `GET /api/v1/agentic-workflows/managed-agents/{managed_agent_key}`
4. `POST /api/v1/agentic-workflows/managed-agents`
5. `PUT /api/v1/agentic-workflows/managed-agents/{managed_agent_key}`
6. `GET /api/v1/agentic-workflows/executions`
7. `GET /api/v1/agentic-workflows/executions/{execution_id}`
8. `GET /api/v1/agentic-workflows/executions/{execution_id}/messages`
9. `GET /api/v1/agentic-workflows/executions/{execution_id}/messages/stream`

## Assistant APIs

1. `POST /api/v1/ai/assistant/chat`
2. `POST /api/v1/ai/workbench/chat`
3. `POST /api/v1/ai/ontology/question`
4. `POST /api/v1/ai/process/interpret`
5. `POST /api/v1/ai/root-cause/setup`
6. `POST /api/v1/ai/root-cause/interpret`
7. `POST /api/v1/ai/guided-investigation`

## ClickHouse Client Approach

1. Runtime ClickHouse repositories use SQLAlchemy Core with the `clickhousedb` dialect as the canonical query/execution path.
2. Backend transport is centralized through the shared `clickhouse-connect` client utilities instead of per-repository HTTP wiring.
3. Direct repository `httpx` + `FORMAT JSON` transport/parsing paths are intentionally removed.
4. ClickHouse engine options are wired from `SEER_CLICKHOUSE_*` settings, including DSN options (`SEER_CLICKHOUSE_COMPRESSION`, `SEER_CLICKHOUSE_QUERY_LIMIT`) and timeout options (`SEER_CLICKHOUSE_TIMEOUT_SECONDS`, `SEER_CLICKHOUSE_CONNECT_TIMEOUT_SECONDS`, `SEER_CLICKHOUSE_SEND_RECEIVE_TIMEOUT_SECONDS`).
5. Runtime limitations are explicit:
   - no `UPDATE` expectation in repository paths,
   - no transaction guarantees from SQLAlchemy `begin/commit/rollback`,
   - no reliance on `RETURNING` or sequence/autoincrement semantics.

## History APIs

1. `POST /api/v1/history/events/ingest`
2. `GET /api/v1/history/events`
3. `GET /api/v1/history/objects/timeline`
4. `GET /api/v1/history/objects/latest`
5. `POST /api/v1/history/objects/latest/search`
6. `GET /api/v1/history/objects/events`
7. `GET /api/v1/history/relations`

ClickHouse history tables are defined in `migrations/clickhouse/001_mvp_phase2_history_tables.sql`
and are applied lazily on first history API usage.

## Process Mining APIs

1. `POST /api/v1/process/ocdfg/mine`
2. `GET /api/v1/process/traces`

Mining requests require `anchor_object_type`, `start_at`, and `end_at`.
They do not accept `traceId` or `workflowId` request fields; clients must use
object-model scope plus time window, then use trace drill-down handles for deeper inspection.
Responses include the UI payload fields plus trace drill-down handles for model elements.

`POST /api/v1/process/ocdfg/mine` returns OC-DFG payload fields (`nodes`, `edges`,
`start_activities`, `end_activities`, `object_types`, `warnings`) with trace handles
compatible with `GET /api/v1/process/traces`.

OC-DFG mining is computed directly from ClickHouse query results in the backend repository path.
The response preserves the existing diagram contract and now also includes richer metric-family
counts on OC-DFG elements:
1. nodes expose `event_count`, `unique_object_count`, and `total_object_count`,
2. edges expose `event_couple_count`, `unique_object_count`, and `total_object_count`,
3. start/end activities expose `event_count`, `unique_object_count`, and `total_object_count`.

## Root-Cause Analysis APIs

1. `POST /api/v1/root-cause/run`
2. `GET /api/v1/root-cause/evidence`
3. `POST /api/v1/root-cause/assist/setup`
4. `POST /api/v1/root-cause/assist/interpret`

RCA requests require anchor + time window + bounded depth + outcome definition, and may include
optional cohort filters. Responses provide ranked insights (`WRAcc`, coverage, lift), plus
evidence handles for trace drill-down.
