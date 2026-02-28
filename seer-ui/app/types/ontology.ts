/**
 * TypeScript types for Ontology API
 * These match the backend DTOs
 */

// ===== Response Types =====

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

// ===== Request Types =====

export interface PropertyDefinitionInput {
  uri?: string;
  name: string;
  description?: string;
  documentation?: string;
  fieldKey: string;
  valueTypeUri: string;
  minCardinality?: number | null;
  maxCardinality?: number | null;
}

export interface KeyPartInput {
  uri?: string;
  name: string;
  description?: string;
  documentation?: string;
  inLocalOntologyUri?: string;
  partIndex: number;
  partPropertyUri: string;
}

export interface KeyDefinitionInput {
  uri?: string;
  name: string;
  description?: string;
  documentation?: string;
  inLocalOntologyUri?: string;
  keyParts: KeyPartInput[];
}

export interface StateInput {
  uri?: string;
  name: string;
  description?: string;
  documentation?: string;
  inLocalOntologyUri?: string;
  isInitial?: boolean;
}

export interface ActionInputInput {
  uri?: string;
  name: string;
  description?: string;
  documentation?: string;
  inLocalOntologyUri?: string;
  properties: PropertyDefinitionInput[];
}

export interface ActionEventInput {
  uri?: string;
  name: string;
  description?: string;
  documentation?: string;
  inLocalOntologyUri?: string;
  properties: PropertyDefinitionInput[];
  kind?: 'SIGNAL' | 'TRANSITION';
  transitionOfUri?: string;
  fromStateUri?: string;
  toStateUri?: string;
}

export interface CreateObjectModelRequest {
  uri?: string;
  name: string;
  description?: string;
  documentation?: string;
  inLocalOntologyUri?: string;
  properties: PropertyDefinitionInput[];
  primaryKey: KeyDefinitionInput;
  displayKey: KeyDefinitionInput;
  initialStateUri?: string;
  states?: StateInput[];
}

export interface CreateActionRequest {
  uri?: string;
  name: string;
  description?: string;
  documentation?: string;
  inLocalOntologyUri?: string;
  type: 'PROCESS' | 'WORKFLOW';
  input: ActionInputInput;
  event: ActionEventInput;
}

export interface CreateSignalRequest {
  uri?: string;
  name: string;
  description?: string;
  documentation?: string;
  inLocalOntologyUri?: string;
  properties: PropertyDefinitionInput[];
}

export interface CreateStateRequest {
  uri?: string;
  name: string;
  description?: string;
  documentation?: string;
  inLocalOntologyUri?: string;
  objectModelUri: string;
}

export interface CreateTransitionRequest {
  uri?: string;
  name: string;
  description?: string;
  documentation?: string;
  inLocalOntologyUri?: string;
  transitionOfUri: string;
  fromStateUri: string;
  toStateUri: string;
  properties?: PropertyDefinitionInput[];
}

export interface CreateEventTriggerRequest {
  uri?: string;
  name: string;
  description?: string;
  documentation?: string;
  inLocalOntologyUri?: string;
  listensToUri: string;
  invokesUri: string;
}

export interface CreateLocalOntologyRequest {
  uri?: string;
  name: string;
  description?: string;
  documentation?: string;
  importsLocalOntologyUris?: string[];
}

export interface CreateCustomTypeRequest {
  uri?: string;
  name: string;
  description?: string;
  documentation?: string;
  inLocalOntologyUri?: string;
  derivedFromUri: string;
  hasConstraintUri?: string;
}

export interface CreateStructTypeRequest {
  uri?: string;
  name: string;
  description?: string;
  documentation?: string;
  inLocalOntologyUri?: string;
  properties: PropertyDefinitionInput[];
}

export interface CreateListTypeRequest {
  uri?: string;
  name: string;
  description?: string;
  documentation?: string;
  inLocalOntologyUri?: string;
  itemTypeUri: string;
}

export interface UpdateConceptRequest {
  uri: string;
  name?: string | null;
  description?: string | null;
  documentation?: string | null;
}

export type InlineTypeSpec =
  | { kind: 'CUSTOM'; payload: CreateCustomTypeRequest }
  | { kind: 'STRUCT'; payload: CreateStructTypeRequest }
  | { kind: 'LIST'; payload: CreateListTypeRequest };

// ===== Helper Types =====

export type ActionType = 'PROCESS' | 'WORKFLOW';
export type NodeLabel =
  | 'ObjectModel'
  | 'State'
  | 'Action'
  | 'Process'
  | 'Workflow'
  | 'Signal'
  | 'Transition'
  | 'Event'
  | 'ActionInput'
  | 'EventTrigger'
  | 'LocalOntology'
  | 'PropertyDefinition'
  | 'NodeShape'
  | 'Class'
  | 'EventInterface'
  | 'KeyDefinition'
  | 'KeyPart'
  | 'ObjectInterface'
  | 'Taxonomy'
  | 'Type'
  | 'BaseType'
  | 'CustomType'
  | 'StructType'
  | 'ListType'
  | 'ObjectReference';
