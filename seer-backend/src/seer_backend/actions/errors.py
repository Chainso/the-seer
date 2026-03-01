"""Action orchestration domain errors."""

from __future__ import annotations

from dataclasses import dataclass


class ActionError(Exception):
    """Base exception for the action orchestration domain."""


class ActionDependencyUnavailableError(ActionError):
    """Raised when action orchestration dependencies are unavailable."""


class ActionRepositoryError(ActionError):
    """Raised for persistence-layer failures in the action domain."""


class ActionNotFoundError(ActionError):
    """Raised when an action does not exist."""


@dataclass(slots=True, frozen=True)
class ActionConflictError(ActionError):
    """Raised when lifecycle transitions conflict with current action state."""

    code: str
    message: str

    def __str__(self) -> str:
        return self.message


@dataclass(slots=True, frozen=True)
class ActionValidationIssue:
    code: str
    message: str
    field: str | None = None


class ActionValidationError(ActionError):
    """Raised when submit payload fails ontology-backed validation."""

    def __init__(
        self,
        message: str,
        *,
        issues: list[ActionValidationIssue] | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.issues = list(issues or [])
