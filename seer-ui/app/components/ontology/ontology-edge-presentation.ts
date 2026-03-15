export interface OntologyEdgePresentation {
  type: string;
  label: string;
  stroke: string;
  strokeDasharray?: string;
  strokeWidth: number;
}

const PRESENTATION_BY_TYPE: Record<string, Omit<OntologyEdgePresentation, 'type'>> = {
  referencesObjectModel: {
    label: 'References Object Model',
    stroke: 'var(--graph-edge-reference)',
    strokeDasharray: '6 4',
    strokeWidth: 1.8,
  },
  producesEvent: {
    label: 'Produces Event',
    stroke: 'var(--graph-edge-transition)',
    strokeWidth: 1.8,
  },
  triggers: {
    label: 'Triggers',
    stroke: 'var(--graph-edge-transition)',
    strokeDasharray: '10 4',
    strokeWidth: 1.6,
  },
  listensTo: {
    label: 'Listens To',
    stroke: 'var(--graph-edge-transition)',
    strokeDasharray: '2 6',
    strokeWidth: 1.6,
  },
  invokes: {
    label: 'Invokes',
    stroke: 'var(--graph-edge-transition)',
    strokeDasharray: '1 5',
    strokeWidth: 1.6,
  },
};

function prettifyEdgeType(type: string) {
  return type
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/^./, (match) => match.toUpperCase());
}

export function getOntologyEdgePresentation(type: string): OntologyEdgePresentation {
  const presentation = PRESENTATION_BY_TYPE[type];
  if (presentation) {
    return { type, ...presentation };
  }

  return {
    type,
    label: prettifyEdgeType(type),
    stroke: 'var(--graph-edge-default)',
    strokeWidth: 1.2,
  };
}

export function listOntologyEdgePresentations(edgeTypes: string[]): OntologyEdgePresentation[] {
  const uniqueTypes = Array.from(new Set(edgeTypes));
  return uniqueTypes.map((type) => getOntologyEdgePresentation(type));
}
