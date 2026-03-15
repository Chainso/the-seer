export interface OntologyNode {
  uri: string;
  label: string;
  properties: Record<string, unknown>;
}

export interface OntologyEdge {
  fromUri: string;
  toUri: string;
  type: string;
}

export interface OntologyGraph {
  nodes: OntologyNode[];
  edges: OntologyEdge[];
}

export type NodeLabel =
  | "ObjectModel"
  | "Action"
  | "Event"
  | "ActionInput"
  | "EventTrigger"
  | "LocalOntology"
  | "PropertyDefinition"
  | "NodeShape"
  | "Class"
  | "EventInterface"
  | "KeyDefinition"
  | "KeyPart"
  | "ObjectInterface"
  | "Taxonomy"
  | "Type"
  | "BaseType"
  | "CustomType"
  | "StructType"
  | "ListType"
  | "ObjectReference";
