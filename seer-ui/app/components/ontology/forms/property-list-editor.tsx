'use client';

import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Label } from '@/app/components/ui/label';
import camelcase from 'camelcase';
import { Plus, X } from 'lucide-react';
import type { OntologyNode, PropertyDefinitionInput } from '@/app/types/ontology';
import {
  SearchableSelect,
  type SearchableSelectGroup,
} from '@/app/components/ui/searchable-select';

interface PropertyListEditorProps {
  title: string;
  properties: PropertyDefinitionInput[];
  typeOptions: OntologyNode[];
  typeGroups?: SearchableSelectGroup[];
  onChange: (next: PropertyDefinitionInput[]) => void;
  onRequestInlineType: (propertyIndex: number) => void;
  allowInlineType?: boolean;
}

export function PropertyListEditor({
  title,
  properties,
  typeOptions,
  typeGroups,
  onChange,
  onRequestInlineType,
  allowInlineType = true,
}: PropertyListEditorProps) {
  const toFieldKey = (value: string) => camelcase(value || '');
  const asString = (value: unknown) => (typeof value === 'string' ? value : '');

  const fallbackGroups: SearchableSelectGroup[] = [
    {
      label: 'All Types',
      options: typeOptions.map((type) => ({
        value: type.uri,
        label: asString(type.properties.name) || type.uri,
        description: asString(type.properties.description) || type.label,
      })),
    },
  ];
  const groups = typeGroups?.length ? typeGroups : fallbackGroups;

  const updateProperty = (index: number, patch: Partial<PropertyDefinitionInput>) => {
    const next = [...properties];
    const updated = { ...next[index], ...patch, maxCardinality: 1 };
    if (patch.name !== undefined) {
      updated.fieldKey = toFieldKey(patch.name);
    }
    next[index] = updated;
    onChange(next);
  };

  const addProperty = () => {
    onChange([
      ...properties,
      {
        name: '',
        fieldKey: '',
        valueTypeUri: '',
        maxCardinality: 1,
      },
    ]);
  };

  const removeProperty = (index: number) => {
    onChange(properties.filter((_, i) => i !== index));
  };

  return (
    <div className="grid gap-3 rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <div>
          {title && <h4 className="font-display text-base">{title}</h4>}
          <p className="text-xs text-muted-foreground">Define the data contract for this concept.</p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={addProperty}>
          <Plus className="h-3 w-3 mr-1" />
          Add Property
        </Button>
      </div>
      <div className="grid gap-3">
        {properties.map((property, index) => (
          <div key={`property-${index}`} className="grid gap-3 rounded-xl border border-border bg-background p-3">
            <div className="flex items-center justify-between">
              <Label>{property.name?.trim() ? property.name : 'New Property'}</Label>
              {properties.length > 1 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => removeProperty(index)}
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
            <div className="grid gap-2">
              <Input
                value={property.name}
                onChange={(event) => updateProperty(index, { name: event.target.value })}
                placeholder="Property name"
              />
            </div>
            <div className={`grid gap-2 ${allowInlineType ? 'sm:grid-cols-[1fr_auto]' : ''}`}>
              <SearchableSelect
                value={property.valueTypeUri}
                onValueChange={(value) => updateProperty(index, { valueTypeUri: value })}
                groups={groups}
                placeholder="Select value type"
                searchPlaceholder="Search types..."
              />
              {allowInlineType && (
                <Button type="button" variant="secondary" onClick={() => onRequestInlineType(index)}>
                  New Type
                </Button>
              )}
            </div>
            <div className="flex items-center gap-3">
              <input
                id={`required-${index}`}
                type="checkbox"
                className="h-4 w-4 rounded border border-border text-primary"
                checked={Boolean(property.minCardinality && property.minCardinality > 0)}
                onChange={(event) =>
                  updateProperty(index, {
                    minCardinality: event.target.checked ? 1 : undefined,
                    maxCardinality: event.target.checked ? 1 : undefined,
                  })
                }
              />
              <Label htmlFor={`required-${index}`} className="text-sm">
                Required
              </Label>
            </div>
            <details className="rounded-lg border border-border bg-muted/30 px-3 py-2">
              <summary className="cursor-pointer text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                Details
              </summary>
              <div className="mt-3 grid gap-2">
                <Input
                  value={property.description ?? ''}
                  onChange={(event) => updateProperty(index, { description: event.target.value })}
                  placeholder="Description"
                />
                <Input
                  value={property.documentation ?? ''}
                  onChange={(event) => updateProperty(index, { documentation: event.target.value })}
                  placeholder="Documentation"
                />
              </div>
            </details>
          </div>
        ))}
      </div>
    </div>
  );
}
