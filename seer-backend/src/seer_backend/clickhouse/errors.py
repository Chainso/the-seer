"""Shared ClickHouse client error types."""

from __future__ import annotations


class ClickHouseClientError(Exception):
    """Base ClickHouse client exception."""


class ClickHouseQueryExecutionError(ClickHouseClientError):
    """Raised when a ClickHouse SELECT-style query fails."""


class ClickHouseCommandExecutionError(ClickHouseClientError):
    """Raised when a ClickHouse command/statement fails."""
