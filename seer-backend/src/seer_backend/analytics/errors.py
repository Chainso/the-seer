"""Process mining domain errors."""

from __future__ import annotations


class ProcessMiningError(Exception):
    """Base process mining exception."""


class ProcessMiningDependencyUnavailableError(ProcessMiningError):
    """Raised when process mining dependencies are unavailable."""


class ProcessMiningValidationError(ProcessMiningError):
    """Raised when request validation fails inside the service layer."""


class ProcessMiningLimitExceededError(ProcessMiningError):
    """Raised when extraction exceeds configured guardrails."""


class ProcessMiningNoDataError(ProcessMiningError):
    """Raised when no data is available for a process mining run."""


class ProcessMiningTraceHandleError(ProcessMiningError):
    """Raised when a trace drill-down handle cannot be decoded or validated."""
