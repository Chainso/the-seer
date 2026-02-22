"""Application settings loaded from environment variables."""

from __future__ import annotations

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration for the backend service."""

    model_config = SettingsConfigDict(env_prefix="SEER_", env_file=".env", case_sensitive=False)

    app_name: str = "seer-backend"
    app_env: str = "development"
    log_level: str = "INFO"

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
    clickhouse_migrations_dir: str = "migrations/clickhouse"
    process_mining_max_events: int = Field(default=5_000, ge=100, le=200_000)
    process_mining_max_relations: int = Field(default=40_000, ge=100, le=500_000)
    process_mining_max_traces_per_handle: int = Field(default=100, ge=10, le=500)
    root_cause_max_events: int = Field(default=10_000, ge=100, le=250_000)
    root_cause_max_relations: int = Field(default=120_000, ge=100, le=1_000_000)
    root_cause_max_traces_per_insight: int = Field(default=30, ge=1, le=300)

    dependency_timeout_seconds: float = Field(default=1.0, ge=0.1, le=10.0)
    prophet_metamodel_path: str = "../prophet/prophet.ttl"
    gemini_cli_bin: str = "gemini"
    gemini_timeout_seconds: float = Field(default=45.0, ge=1.0, le=300.0)
    copilot_query_row_limit: int = Field(default=100, ge=1, le=1000)
