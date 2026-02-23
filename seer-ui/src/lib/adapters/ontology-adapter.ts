import type {
  OntologyConceptDetail,
  OntologyConceptSummary,
  OntologyCurrent,
} from "@/lib/backend-ontology";
import { buildViewModelMeta, type ViewModelMeta } from "@/lib/adapters/common";

export type OntologyConceptListItemViewModel = {
  iri: string;
  label: string;
  category: string;
};

export type OntologyConceptDetailViewModel = {
  iri: string;
  label: string;
  category: string;
  comment: string;
  outgoing_predicates: string[];
  incoming_predicates: string[];
};

export type OntologyWorkspaceViewModel = {
  release_id: string | null;
  current_graph_iri: string | null;
  meta_graph_iri: string;
  updated_at: string | null;
  concepts: OntologyConceptListItemViewModel[];
  selected: OntologyConceptDetailViewModel | null;
  meta: ViewModelMeta;
};

export function adaptOntologyConceptList(
  concepts: OntologyConceptSummary[]
): OntologyConceptListItemViewModel[] {
  return concepts.map((concept) => ({
    iri: concept.iri,
    label: concept.label,
    category: concept.category,
  }));
}

export function adaptOntologyConceptDetail(
  detail: OntologyConceptDetail
): OntologyConceptDetailViewModel {
  return {
    iri: detail.iri,
    label: detail.label,
    category: detail.category,
    comment: detail.comment ?? "",
    outgoing_predicates: detail.outgoing_relations,
    incoming_predicates: detail.incoming_relations,
  };
}

export function adaptOntologyWorkspace(
  current: OntologyCurrent,
  concepts: OntologyConceptSummary[],
  selected: OntologyConceptDetail | null
): OntologyWorkspaceViewModel {
  return {
    release_id: current.release_id,
    current_graph_iri: current.current_graph_iri,
    meta_graph_iri: current.meta_graph_iri,
    updated_at: current.updated_at,
    concepts: adaptOntologyConceptList(concepts),
    selected: selected ? adaptOntologyConceptDetail(selected) : null,
    meta: buildViewModelMeta(),
  };
}
