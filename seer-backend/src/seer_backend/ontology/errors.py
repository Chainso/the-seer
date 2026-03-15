"""Ontology domain errors."""

from __future__ import annotations


class OntologyError(Exception):
    """Base ontology exception."""


class OntologyDependencyUnavailableError(OntologyError):
    """Raised when required ontology dependencies are unavailable."""


class OntologyNotReadyError(OntologyError):
    """Raised when current ontology state is unavailable."""


class OntologyReadOnlyViolationError(OntologyError):
    """Raised when a SPARQL query attempts mutation or unsupported clauses."""


class ManagedAgentAuthoringError(OntologyError):
    """Raised when managed-agent authoring validation fails."""

    def __init__(self, message: str, detail: object | None = None) -> None:
        super().__init__(message)
        self.detail = detail
