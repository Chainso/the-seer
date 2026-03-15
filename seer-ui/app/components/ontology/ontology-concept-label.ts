const DISPLAY_LABELS: Record<string, string> = {
  ObjectModel: 'Object Model',
  Action: 'Action',
  ActionInput: 'Action Input',
  Event: 'Event',
  EventTrigger: 'Event Trigger',
  LocalOntology: 'Local Ontology',
  PropertyDefinition: 'Property Definition',
  NodeShape: 'Node Shape',
  Class: 'Class',
  EventInterface: 'Event Interface',
  KeyDefinition: 'Key Definition',
  KeyPart: 'Key Part',
  ObjectInterface: 'Object Interface',
  Taxonomy: 'Taxonomy',
  Type: 'Type',
  BaseType: 'Base Type',
  CustomType: 'Custom Type',
  StructType: 'Struct Type',
  ListType: 'List Type',
  ObjectReference: 'Object Reference',
};

function prettifyConceptLabel(label: string) {
  return label
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/^./, (match) => match.toUpperCase());
}

export function getOntologyConceptLabel(label: string) {
  return DISPLAY_LABELS[label] ?? prettifyConceptLabel(label);
}
