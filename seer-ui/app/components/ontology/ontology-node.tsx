'use client';

import { Handle, Position, NodeProps } from '@xyflow/react';
import { Card } from '../ui/card';

/**
 * Color scheme for different node types
 */
const NODE_COLORS: Record<string, { bg: string; border: string }> = {
  ObjectModel: { bg: '--graph-node-object-bg', border: '--graph-node-object-border' },
  State: { bg: '--graph-node-state-bg', border: '--graph-node-state-border' },
  Process: { bg: '--graph-node-action-bg', border: '--graph-node-action-border' },
  Workflow: { bg: '--graph-node-action-bg', border: '--graph-node-action-border' },
  Action: { bg: '--graph-node-action-bg', border: '--graph-node-action-border' },
  ActionInput: { bg: '--graph-node-action-input-bg', border: '--graph-node-action-input-border' },
  Signal: { bg: '--graph-node-signal-bg', border: '--graph-node-signal-border' },
  Transition: { bg: '--graph-node-transition-bg', border: '--graph-node-transition-border' },
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
    <Card
      className="px-4 py-2 min-w-[160px] border-2 shadow-sm"
      style={{
        backgroundColor: `var(${colors.bg})`,
        borderColor: `var(${colors.border})`,
      }}
    >
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <div>
        <div className="text-[0.65rem] font-semibold uppercase tracking-[0.2em] text-muted-foreground mb-1">
          {data.label}
        </div>
        <div className="text-sm font-display">
          {data.name || data.uri}
        </div>
        {data.description && (
          <div className="text-xs text-muted-foreground mt-1 truncate max-w-[200px]">
            {data.description}
          </div>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
    </Card>
  );
}
