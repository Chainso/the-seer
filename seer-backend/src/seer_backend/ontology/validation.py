"""SHACL validation utilities for ontology ingest."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from seer_backend.ontology.constants import SEER_EXTENSION_TURTLE
from seer_backend.ontology.errors import OntologyDependencyUnavailableError
from seer_backend.ontology.models import ValidationDiagnostic, ValidationOutcome

try:
    from pyshacl import validate as pyshacl_validate
    from rdflib import Graph, Namespace
    from rdflib.namespace import RDF
except ImportError:  # pragma: no cover - covered via dependency availability checks
    pyshacl_validate = None
    Graph = None
    Namespace = None
    RDF = None


class ShaclValidator:
    """Runs SHACL validation of local ontology Turtle against Prophet plus Seer base ontology."""

    def __init__(self, metamodel_path: str) -> None:
        if pyshacl_validate is None or Graph is None or Namespace is None or RDF is None:
            raise OntologyDependencyUnavailableError(
                "pyshacl/rdflib are required for ontology validation"
            )
        self.metamodel_path = str(Path(metamodel_path).resolve())
        self._base_graph = Graph()
        self._base_graph.parse(self.metamodel_path, format="turtle")
        self._base_graph.parse(data=SEER_EXTENSION_TURTLE, format="turtle")
        serialized = self._base_graph.serialize(format="turtle")
        self._base_turtle = (
            serialized.decode("utf-8")
            if isinstance(serialized, bytes)
            else serialized
        )
        self._sh = Namespace("http://www.w3.org/ns/shacl#")

    @property
    def base_turtle(self) -> str:
        return self._base_turtle

    def validate(self, ontology_turtle: str) -> ValidationOutcome:
        data_graph = Graph()
        data_graph += self._base_graph
        try:
            data_graph.parse(data=ontology_turtle, format="turtle")
        except Exception as exc:
            return ValidationOutcome(
                conforms=False,
                diagnostics=[
                    ValidationDiagnostic(
                        severity="Violation",
                        message=f"Unable to parse Turtle input: {exc}",
                    )
                ],
            )

        try:
            conforms, results_graph, _ = pyshacl_validate(
                data_graph=data_graph,
                shacl_graph=self._base_graph,
                ont_graph=self._base_graph,
                inference="rdfs",
                advanced=True,
            )
        except Exception as exc:
            return ValidationOutcome(
                conforms=False,
                diagnostics=[
                    ValidationDiagnostic(
                        severity="Violation",
                        message=f"SHACL execution failed: {exc}",
                    )
                ],
            )

        diagnostics = self._extract_diagnostics(results_graph)
        return ValidationOutcome(conforms=bool(conforms), diagnostics=diagnostics)

    def _extract_diagnostics(self, results_graph: Any) -> list[ValidationDiagnostic]:
        diagnostics: list[ValidationDiagnostic] = []
        for result_node in results_graph.subjects(RDF.type, self._sh.ValidationResult):
            message = _to_string(results_graph.value(result_node, self._sh.resultMessage))
            severity = (
                _to_string(results_graph.value(result_node, self._sh.resultSeverity))
                or "Violation"
            )
            source_shape = _to_string(results_graph.value(result_node, self._sh.sourceShape))
            focus_node = _to_string(results_graph.value(result_node, self._sh.focusNode))
            result_path = _to_string(results_graph.value(result_node, self._sh.resultPath))
            diagnostics.append(
                ValidationDiagnostic(
                    severity=severity.rsplit("#", maxsplit=1)[-1],
                    source_shape=source_shape,
                    focus_node=focus_node,
                    result_path=result_path,
                    message=message or "Validation failed",
                )
            )
        return diagnostics


def _to_string(value: Any) -> str | None:
    if value is None:
        return None
    if hasattr(value, "toPython"):
        py_value = value.toPython()
        return str(py_value) if py_value is not None else None
    return str(value)
