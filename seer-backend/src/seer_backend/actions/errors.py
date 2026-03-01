"""Action orchestration domain errors."""

from __future__ import annotations


class ActionError(Exception):
    """Base exception for the action orchestration domain."""


class ActionDependencyUnavailableError(ActionError):
    """Raised when action orchestration dependencies are unavailable."""


class ActionRepositoryError(ActionError):
    """Raised for persistence-layer failures in the action domain."""
