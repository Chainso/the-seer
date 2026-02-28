'use client';

import { useMemo, useState } from 'react';
import { Button } from '@/app/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/app/components/ui/dialog';
import { Input } from '@/app/components/ui/input';
import { Label } from '@/app/components/ui/label';
import { Textarea } from '@/app/components/ui/textarea';
import type {
  CreateCustomTypeRequest,
  CreateListTypeRequest,
  CreateStructTypeRequest,
  InlineTypeSpec,
  PropertyDefinitionInput,
} from '@/app/types/ontology';
import type { OntologyNode } from '@/app/types/ontology';
import { PropertyListEditor } from '../forms/property-list-editor';
import camelcase from 'camelcase';
import { SearchableSelect } from '@/app/components/ui/searchable-select';

interface InlineTypeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (type: InlineTypeSpec) => void;
  existingTypes: OntologyNode[];
}

const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const DEFAULT_BASE_TYPE_URI = 'http://seer.platform/standard-types#String';

const TYPE_KINDS = [
  { value: 'CUSTOM', label: 'Custom Type' },
  { value: 'STRUCT', label: 'Struct Type' },
  { value: 'LIST', label: 'List Type' },
] as const;

export function InlineTypeDialog({
  open,
  onOpenChange,
  onCreate,
  existingTypes,
}: InlineTypeDialogProps) {
  const [kind, setKind] = useState<'CUSTOM' | 'STRUCT' | 'LIST'>('CUSTOM');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [documentation, setDocumentation] = useState('');
  const [derivedFromUri, setDerivedFromUri] = useState('');
  const [itemTypeUri, setItemTypeUri] = useState('');
  const [structProps, setStructProps] = useState<PropertyDefinitionInput[]>([
    { name: '', fieldKey: '', valueTypeUri: '' },
  ]);
  const toFieldKey = (value: string) => camelcase(value || '');

  const baseTypes = useMemo(
    () => existingTypes.filter((node) => node.label === 'BaseType' || node.label === 'Type'),
    [existingTypes]
  );

  const typeOptions = useMemo(
    () =>
      existingTypes.filter((node) =>
        ['BaseType', 'Type', 'CustomType', 'StructType', 'ListType', 'ObjectReference'].includes(node.label)
      ),
    [existingTypes]
  );

  const resetState = () => {
    setKind('CUSTOM');
    setName('');
    setDescription('');
    setDocumentation('');
    setDerivedFromUri('');
    setItemTypeUri('');
    setStructProps([{ name: '', fieldKey: '', valueTypeUri: '' }]);
  };

  const handleCreate = () => {
    if (!name.trim()) {
      return;
    }

    if (kind === 'LIST' && !itemTypeUri) {
      return;
    }

    if (kind === 'STRUCT' && structProps.some((prop) => !prop.name.trim() || !prop.valueTypeUri)) {
      return;
    }

    if (kind === 'CUSTOM') {
      const resolvedDerivedFromUri =
        derivedFromUri || baseTypes[0]?.uri || DEFAULT_BASE_TYPE_URI;
      const payload: CreateCustomTypeRequest = {
        uri: slugify(name),
        name: name.trim(),
        description: description.trim() || undefined,
        documentation: documentation.trim() || undefined,
        derivedFromUri: resolvedDerivedFromUri,
      };
      onCreate({ kind, payload });
    }

    if (kind === 'STRUCT') {
      const payload: CreateStructTypeRequest = {
        uri: slugify(name),
        name: name.trim(),
        description: description.trim() || undefined,
        documentation: documentation.trim() || undefined,
        properties: structProps.map((prop) => ({
          ...prop,
          name: prop.name.trim(),
          fieldKey: prop.fieldKey.trim() || toFieldKey(prop.name),
        })),
      };
      onCreate({ kind, payload });
    }

    if (kind === 'LIST') {
      const payload: CreateListTypeRequest = {
        uri: slugify(name),
        name: name.trim(),
        description: description.trim() || undefined,
        documentation: documentation.trim() || undefined,
        itemTypeUri,
      };
      onCreate({ kind, payload });
    }

    resetState();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[720px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">Create Inline Type</DialogTitle>
          <DialogDescription>
            Create a type on the fly and reuse it immediately in your properties.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label>Type Kind</Label>
            <SearchableSelect
              value={kind}
              onValueChange={(value) => setKind(value as typeof kind)}
              groups={[
                {
                  label: 'Type Kinds',
                  options: TYPE_KINDS.map((item) => ({
                    value: item.value,
                    label: item.label,
                  })),
                },
              ]}
              placeholder="Select type kind"
              searchPlaceholder="Search type kinds..."
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="type-name">Type Name *</Label>
            <Input
              id="type-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="High Value Order"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="type-description">Description</Label>
            <Textarea
              id="type-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Used to classify orders above the approval threshold."
              rows={2}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="type-docs">Documentation</Label>
            <Textarea
              id="type-docs"
              value={documentation}
              onChange={(event) => setDocumentation(event.target.value)}
              placeholder="Notes, rules, or links for this type."
              rows={2}
            />
          </div>

          {kind === 'CUSTOM' && (
            <div className="grid gap-3 rounded-2xl border border-border bg-card p-4">
              <div className="grid gap-2">
                <Label>Base Type</Label>
                <SearchableSelect
                  value={derivedFromUri}
                  onValueChange={setDerivedFromUri}
                  groups={[
                    {
                      label: 'Base Types',
                      options: baseTypes.map((type) => ({
                        value: type.uri,
                        label: (type.properties.name as string) || type.uri,
                        description: type.label,
                      })),
                    },
                  ]}
                  placeholder="Select base type"
                  searchPlaceholder="Search base types..."
                />
              </div>
            </div>
          )}

          {kind === 'LIST' && (
            <div className="grid gap-2 rounded-2xl border border-border bg-card p-4">
              <Label>Item Type *</Label>
              <SearchableSelect
                value={itemTypeUri}
                onValueChange={setItemTypeUri}
                groups={[
                  {
                    label: 'Item Types',
                    options: typeOptions.map((type) => ({
                      value: type.uri,
                      label: (type.properties.name as string) || type.uri,
                      description: type.label,
                    })),
                  },
                ]}
                placeholder="Select item type"
                searchPlaceholder="Search item types..."
              />
            </div>
          )}

          {kind === 'STRUCT' && (
            <PropertyListEditor
              title="Struct Properties"
              properties={structProps}
              typeOptions={typeOptions}
              onChange={setStructProps}
              onRequestInlineType={() => undefined}
              allowInlineType={false}
            />
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleCreate}>Create Type</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
