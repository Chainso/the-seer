"""Shared agent orchestration error types."""


class AgentOrchestrationError(Exception):
    """Base agent orchestration exception."""


class AgentOrchestrationDependencyUnavailableError(AgentOrchestrationError):
    """Raised when the transcript store or runtime dependencies are unavailable."""
