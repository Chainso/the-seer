"""Application settings loaded from environment variables."""

from __future__ import annotations

from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

_REPO_ROOT = Path(__file__).resolve().parents[4]
_DEFAULT_ASSISTANT_SKILL_DIRS = (
    str(_REPO_ROOT / "seer-backend" / "src" / "seer_backend" / "ai" / "assistant_skills"),
)


class Settings(BaseSettings):
    """Runtime configuration for the backend service."""

    model_config = SettingsConfigDict(env_prefix="SEER_", env_file=".env", case_sensitive=False)

    app_name: str = "seer-backend"
    app_env: str = "development"
    log_level: str = "INFO"
    assistant_turn_log_path: str | None = None
    assistant_skill_dirs: list[str] = Field(
        default_factory=lambda: list(_DEFAULT_ASSISTANT_SKILL_DIRS)
    )

    host: str = "0.0.0.0"
    port: int = 8000
    api_prefix: str = "/api/v1"

    fuseki_host: str = "fuseki"
    fuseki_port: int = 3030
    fuseki_dataset: str = "ds"
    fuseki_username: str | None = None
    fuseki_password: str | None = None
    fuseki_timeout_seconds: float = Field(default=5.0, ge=0.1, le=30.0)

    clickhouse_host: str = "clickhouse"
    clickhouse_port: int = 8123
    clickhouse_database: str = "seer"
    clickhouse_user: str = "seer"
    clickhouse_password: str = "seer"
    clickhouse_timeout_seconds: float = Field(default=5.0, ge=0.1, le=30.0)
    clickhouse_connect_timeout_seconds: float | None = Field(default=None, ge=0.1, le=30.0)
    clickhouse_send_receive_timeout_seconds: float | None = Field(
        default=None, ge=0.1, le=30.0
    )
    clickhouse_compression: str | None = "lz4"
    clickhouse_query_limit: int | None = Field(default=None, ge=1, le=1_000_000)
    clickhouse_migrations_dir: str = "migrations/clickhouse"
    actions_db_dsn: str = "postgresql+psycopg://seer:seer@postgres:5432/seer_actions"
    actions_db_pool_size: int = Field(default=5, ge=1, le=100)
    actions_db_max_overflow: int = Field(default=10, ge=0, le=100)
    actions_db_migrations_dir: str = "migrations/postgres"
    actions_lease_seconds: int = Field(default=60, ge=5, le=3600)
    actions_heartbeat_seconds: int = Field(default=20, ge=5, le=3600)
    actions_stale_instance_seconds: int = Field(default=90, ge=10, le=3600)
    actions_sweeper_interval_seconds: int = Field(default=20, ge=1, le=3600)
    actions_sweeper_enabled: bool = True
    actions_sweeper_batch_size: int = Field(default=100, ge=1, le=5000)
    actions_sweeper_advisory_lock_id: int = Field(default=104_729, ge=1, le=2_147_483_647)
    actions_sweeper_retry_delay_seconds: int = Field(default=2, ge=0, le=3600)
    actions_schema_bootstrap_on_startup: bool = False
    process_mining_max_events: int = Field(default=5_000, ge=100, le=200_000)
    process_mining_max_relations: int = Field(default=40_000, ge=100, le=500_000)
    process_mining_max_traces_per_handle: int = Field(default=100, ge=10, le=500)
    root_cause_max_events: int = Field(default=10_000, ge=100, le=250_000)
    root_cause_max_relations: int = Field(default=120_000, ge=100, le=1_000_000)
    root_cause_max_traces_per_insight: int = Field(default=30, ge=1, le=300)

    dependency_timeout_seconds: float = Field(default=1.0, ge=0.1, le=10.0)
    prophet_metamodel_path: str = "../prophet/prophet.ttl"
    openai_base_url: str = "https://opencode.ai/zen/v1/chat/completions"
    openai_model: str = "big-pickle"
    openai_api_key: str | None = None
    openai_timeout_seconds: float = Field(default=45.0, ge=1.0, le=300.0)
    copilot_query_row_limit: int = Field(default=100, ge=1, le=1000)
