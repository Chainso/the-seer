'use client';

import { Handle, Position } from '@xyflow/react';
import { getOntologyConceptLabel } from './ontology-concept-label';
import { GraphNodeCard } from '@/app/components/graph/graph-node-card';

/**
 * Color scheme for different node types
 */
const NODE_COLORS: Record<string, { bg: string; border: string }> = {
  ObjectModel: { bg: '--graph-node-object-bg', border: '--graph-node-object-border' },
  Action: { bg: '--graph-node-action-bg', border: '--graph-node-action-border' },
  ActionInput: { bg: '--graph-node-action-input-bg', border: '--graph-node-action-input-border' },
  Event: { bg: '--graph-node-signal-bg', border: '--graph-node-signal-border' },
  EventTrigger: { bg: '--graph-node-trigger-bg', border: '--graph-node-trigger-border' },
  ObjectInterface: { bg: '--graph-node-object-bg', border: '--graph-node-object-border' },
  Taxonomy: { bg: '--graph-node-taxonomy-bg', border: '--graph-node-taxonomy-border' },
  Type: { bg: '--graph-node-type-bg', border: '--graph-node-type-border' },
  BaseType: { bg: '--graph-node-type-bg', border: '--graph-node-type-border' },
  CustomType: { bg: '--graph-node-type-bg', border: '--graph-node-type-border' },
  StructType: { bg: '--graph-node-type-bg', border: '--graph-node-type-border' },
  ListType: { bg: '--graph-node-type-bg', border: '--graph-node-type-border' },
  KeyDefinition: { bg: '--graph-node-key-bg', border: '--graph-node-key-border' },
  KeyPart: { bg: '--graph-node-key-bg', border: '--graph-node-key-border' },
};

export interface OntologyNodeData {
  label: string;
  uri: string;
  name?: string;
  description?: string;
  [key: string]: unknown;
}

export function OntologyNode({ data }: { data: OntologyNodeData }) {
  const colors = NODE_COLORS[data.label as keyof typeof NODE_COLORS] || {
    bg: '--graph-node-default-bg',
    border: '--graph-node-default-border',
  };

  return (
    <>
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <GraphNodeCard
        header={getOntologyConceptLabel(data.label)}
        title={data.name || data.uri}
        description={data.description}
        bgVar={colors.bg}
        borderVar={colors.border}
      />
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
    </>
  );
}
