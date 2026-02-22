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

    clickhouse_host: str = "clickhouse"
    clickhouse_port: int = 8123

    dependency_timeout_seconds: float = Field(default=1.0, ge=0.1, le=10.0)
