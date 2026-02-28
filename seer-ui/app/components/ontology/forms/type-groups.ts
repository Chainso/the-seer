'use client';

import type { OntologyNode, InlineTypeSpec } from '@/app/types/ontology';
import type { SearchableSelectGroup } from '@/app/components/ui/searchable-select';

const asString = (value: unknown) => (typeof value === 'string' ? value : '');

const labelToGroup = (label: string) => {
  if (label === 'ObjectReference') return 'Object References';
  if (label === 'BaseType' || label === 'Type') return 'Base Types';
  if (label === 'CustomType') return 'Custom Types';
  if (label === 'StructType') return 'Struct Types';
  if (label === 'ListType') return 'List Types';
  return 'Other Types';
};

export const buildTypeGroups = (
  typeOptions: OntologyNode[],
  inlineTypes: InlineTypeSpec[],
  objectModels: OntologyNode[],
  buildUri: (name: string) => string
): SearchableSelectGroup[] => {
  const inlineNodes: OntologyNode[] = inlineTypes.map((inlineType) => ({
    uri: inlineType.payload.uri || buildUri(inlineType.payload.name),
    label:
      inlineType.kind === 'CUSTOM'
        ? 'CustomType'
        : inlineType.kind === 'STRUCT'
        ? 'StructType'
        : 'ListType',
    properties: { name: inlineType.payload.name },
  }));

  const objectReferenceOptions: OntologyNode[] = objectModels.map((model) => ({
    uri: `ref:${model.uri}`,
    label: 'ObjectReference',
    properties: {
      name: `${asString(model.properties.name) || model.uri} Reference`,
      description: asString(model.properties.description) || 'Object reference',
    },
  }));

  const combined = [...typeOptions, ...inlineNodes, ...objectReferenceOptions];
  const seen = new Set<string>();
  const grouped: Record<string, SearchableSelectGroup> = {};

  for (const node of combined) {
    if (seen.has(node.uri)) {
      continue;
    }
    seen.add(node.uri);
    const groupLabel = labelToGroup(node.label);
    if (!grouped[groupLabel]) {
      grouped[groupLabel] = { label: groupLabel, options: [] };
    }
    grouped[groupLabel].options.push({
      value: node.uri,
      label: asString(node.properties.name) || node.uri,
      description: asString(node.properties.description) || node.label,
    });
  }

  const orderedLabels = [
    'Object References',
    'Base Types',
    'Custom Types',
    'Struct Types',
    'List Types',
    'Other Types',
  ];

  return orderedLabels
    .map((label) => grouped[label])
    .filter((group): group is SearchableSelectGroup => Boolean(group && group.options.length));
};
