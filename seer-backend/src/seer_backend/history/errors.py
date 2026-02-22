"""History domain errors."""

from __future__ import annotations


class HistoryError(Exception):
    """Base history exception."""


class HistoryDependencyUnavailableError(HistoryError):
    """Raised when history persistence dependencies are unavailable."""


class DuplicateEventError(HistoryError):
    """Raised when event_id already exists."""


class ObjectTypeMismatchError(HistoryError):
    """Raised when event-object links do not match object_history object_type."""
