'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/app/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/app/components/ui/dialog';
import { Input } from '@/app/components/ui/input';
import { Label } from '@/app/components/ui/label';
import { Textarea } from '@/app/components/ui/textarea';
import { Plus, X } from 'lucide-react';
import {
  createCustomType,
  createListType,
  createObjectModel,
  createStructType,
  getNodesByLabel,
} from '@/app/lib/api/ontology';
import camelcase from 'camelcase';
import type {
  InlineTypeSpec,
  KeyDefinitionInput,
  KeyPartInput,
  OntologyNode,
  PropertyDefinitionInput,
} from '@/app/types/ontology';
import { PropertyListEditor } from '../forms/property-list-editor';
import { InlineTypeDialog } from './inline-type-dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/app/components/ui/tabs';
import { buildTypeGroups } from '../forms/type-groups';
import { SearchableSelect } from '@/app/components/ui/searchable-select';

interface CreateObjectDialogProps {
  onObjectCreated: () => void;
}

const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

export function CreateObjectDialog({ onObjectCreated }: CreateObjectDialogProps) {
  const [open, setOpen] = useState(false);
  const [typeDialogOpen, setTypeDialogOpen] = useState(false);
  const [typeTargetIndex, setTypeTargetIndex] = useState<number | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [documentation, setDocumentation] = useState('');
  const [properties, setProperties] = useState<PropertyDefinitionInput[]>([
    { name: '', fieldKey: '', valueTypeUri: '' },
  ]);
  const [primaryKeyParts, setPrimaryKeyParts] = useState<KeyPartInput[]>([
    { name: '', partIndex: 0, partPropertyUri: '' } as KeyPartInput,
  ]);
  const [displayKeyParts, setDisplayKeyParts] = useState<KeyPartInput[]>([
    { name: '', partIndex: 0, partPropertyUri: '' } as KeyPartInput,
  ]);
  const [inlineTypes, setInlineTypes] = useState<InlineTypeSpec[]>([]);
  const [typeOptions, setTypeOptions] = useState<OntologyNode[]>([]);
  const [objectModels, setObjectModels] = useState<OntologyNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toFieldKey = (value: string) => camelcase(value || '');

  useEffect(() => {
    if (open) {
      Promise.all([
        getNodesByLabel(['BaseType', 'Type', 'CustomType', 'StructType', 'ListType']),
        getNodesByLabel('ObjectModel'),
      ]).then(([types, models]) => {
        setTypeOptions(types);
        setObjectModels(models);
      });
    }
  }, [open]);

  const typeGroups = useMemo(
    () => buildTypeGroups(typeOptions, inlineTypes, objectModels, slugify),
    [inlineTypes, objectModels, typeOptions]
  );

  const existingTypes = useMemo(() => {
    const objectReferenceNodes = objectModels.map((model) => ({
      uri: `ref:${model.uri}`,
      label: 'ObjectReference',
      properties: {
        name: `${(model.properties.name as string) || model.uri} Reference`,
      },
    }));
    const combined = [...typeOptions, ...objectReferenceNodes];
    const seen = new Set<string>();
    return combined.filter((node) => {
      if (seen.has(node.uri)) {
        return false;
      }
      seen.add(node.uri);
      return true;
    });
  }, [objectModels, typeOptions]);

  const handleInlineTypeRequest = (index: number) => {
    setTypeTargetIndex(index);
    setTypeDialogOpen(true);
  };

  const handleInlineTypeCreate = (typeSpec: InlineTypeSpec) => {
    const fallbackUri = typeSpec.payload.uri || slugify(typeSpec.payload.name);
    const payload = { ...typeSpec.payload, uri: fallbackUri };
    const nextType = { ...typeSpec, payload } as InlineTypeSpec;
    setInlineTypes((prev) => [...prev, nextType]);
    if (typeTargetIndex !== null) {
      setProperties((prev) => {
        const draft = [...prev];
        draft[typeTargetIndex] = { ...draft[typeTargetIndex], valueTypeUri: payload.uri as string };
        return draft;
      });
    }
  };

  const createInlineTypes = async () => {
    for (const inlineType of inlineTypes) {
      if (inlineType.kind === 'CUSTOM') {
        await createCustomType(inlineType.payload);
      }
      if (inlineType.kind === 'STRUCT') {
        const properties = await normalizePropertyList(inlineType.payload.properties);
        await createStructType({ ...inlineType.payload, properties });
      }
      if (inlineType.kind === 'LIST') {
        const itemTypeUri = await normalizeValueType(inlineType.payload.itemTypeUri);
        await createListType({ ...inlineType.payload, itemTypeUri });
      }
    }
  };

  const normalizeValueType = async (valueTypeUri: string) => valueTypeUri;

  const normalizePropertyList = async (props: PropertyDefinitionInput[]) =>
    Promise.all(
      props.map(async (prop) => ({
        ...prop,
        valueTypeUri: await normalizeValueType(prop.valueTypeUri),
      }))
    );

  const propertyOptions = useMemo(
    () =>
      properties
        .map((prop, index) => {
          const fieldKey = prop.fieldKey.trim() || toFieldKey(prop.name);
          if (!fieldKey) {
            return null;
          }
          return {
            id: `${index}`,
            label: prop.name.trim() || fieldKey,
            fieldKey,
          };
        })
        .filter((prop): prop is { id: string; label: string; fieldKey: string } => Boolean(prop)),
    [properties]
  );

  const addKeyPart = (setter: React.Dispatch<React.SetStateAction<KeyPartInput[]>>) => {
    setter((prev) => [
      ...prev,
      { name: '', partIndex: prev.length, partPropertyUri: '' } as KeyPartInput,
    ]);
  };

  const updateKeyPart = (
    setter: React.Dispatch<React.SetStateAction<KeyPartInput[]>>,
    index: number,
    patch: Partial<KeyPartInput>
  ) => {
    setter((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], ...patch };
      return next;
    });
  };

  const removeKeyPart = (setter: React.Dispatch<React.SetStateAction<KeyPartInput[]>>, index: number) => {
    setter((prev) => prev.filter((_, i) => i !== index));
  };

  const buildKeyDefinition = (keyName: string, parts: KeyPartInput[]): KeyDefinitionInput => ({
    name: keyName,
    keyParts: parts.map((part, index) => ({
      ...part,
      name: part.name.trim() || keyName,
      partIndex: index,
    })),
  });

  const hasInvalidProps = properties.some(
    (prop) => !prop.name.trim() || !prop.valueTypeUri
  );

  const propertyIds = useMemo(() => new Set(propertyOptions.map((prop) => prop.id)), [propertyOptions]);

  const hasInvalidKey = (parts: KeyPartInput[]) =>
    parts.length === 0 || parts.some((part) => !propertyIds.has(part.partPropertyUri));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim()) {
      setError('Object model name is required');
      return;
    }

    if (hasInvalidProps) {
      setError('All properties must include a name and value type');
      return;
    }

    if (hasInvalidKey(primaryKeyParts) || hasInvalidKey(displayKeyParts)) {
      setError('Primary and display keys must include at least one property');
      return;
    }

    try {
      setLoading(true);
      setError(null);
      await createInlineTypes();

      const modelUri = slugify(name);
      const normalizedProperties = (await normalizePropertyList(properties)).map((prop) => ({
        ...prop,
        fieldKey: prop.fieldKey?.trim() || toFieldKey(prop.name),
        uri: prop.uri || `${modelUri}_${(prop.fieldKey?.trim() || toFieldKey(prop.name))}`,
        name: prop.name.trim(),
      }));

      const propertyUriById = new Map(
        normalizedProperties.map((prop, index) => [`${index}`, prop.uri as string])
      );
      const normalizeKeyParts = (parts: KeyPartInput[]) =>
        parts.map((part, index) => ({
          ...part,
          name: part.name.trim() || `Key Part ${index + 1}`,
          partIndex: index,
          partPropertyUri: propertyUriById.get(part.partPropertyUri) || '',
        }));

      await createObjectModel({
        uri: modelUri,
        name: name.trim(),
        description: description.trim() || undefined,
        documentation: documentation.trim() || undefined,
        properties: normalizedProperties,
        primaryKey: {
          ...buildKeyDefinition('Primary Key', normalizeKeyParts(primaryKeyParts)),
        },
        displayKey: {
          ...buildKeyDefinition('Display Key', normalizeKeyParts(displayKeyParts)),
        },
      });

      setName('');
      setDescription('');
      setDocumentation('');
      setProperties([{ name: '', fieldKey: '', valueTypeUri: '' }]);
      setPrimaryKeyParts([{ name: '', partIndex: 0, partPropertyUri: '' } as KeyPartInput]);
      setDisplayKeyParts([{ name: '', partIndex: 0, partPropertyUri: '' } as KeyPartInput]);
      setInlineTypes([]);
      setOpen(false);
      onObjectCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create object model');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="h-4 w-4 mr-2" />
          New Object Model
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[840px] max-h-[85vh] overflow-y-auto">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle className="font-display text-xl">Create Object Model</DialogTitle>
            <DialogDescription>
              Define the object schema and keys. States and transitions are modeled in the graph.
            </DialogDescription>
          </DialogHeader>
          <Tabs defaultValue="basics" className="mt-4">
            <TabsList className="h-10">
              <TabsTrigger value="basics">Basics</TabsTrigger>
              <TabsTrigger value="properties">Properties</TabsTrigger>
              <TabsTrigger value="keys">Keys</TabsTrigger>
            </TabsList>
            <TabsContent value="basics" className="mt-4 space-y-4">
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="object-name">Object Name *</Label>
                  <Input
                    id="object-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Order"
                    disabled={loading}
                  />
                </div>
              </div>
              <div className="grid gap-2">
                <Label>Description</Label>
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Represents a customer order"
                  rows={2}
                />
              </div>
              <div className="grid gap-2">
                <Label>Documentation</Label>
                <Textarea
                  value={documentation}
                  onChange={(e) => setDocumentation(e.target.value)}
                  placeholder="Notes, guidelines, or links"
                  rows={2}
                />
              </div>
            </TabsContent>
            <TabsContent value="properties" className="mt-4 space-y-4">
              <PropertyListEditor
                title="Object Properties"
                properties={properties}
                typeOptions={typeOptions}
                typeGroups={typeGroups}
                onChange={setProperties}
                onRequestInlineType={handleInlineTypeRequest}
              />
            </TabsContent>
            <TabsContent value="keys" className="mt-4 space-y-4">
              <div className="grid gap-4 rounded-2xl border border-border bg-muted/40 p-4">
                <div>
                  <h3 className="font-display text-lg">Keys</h3>
                  <p className="text-xs text-muted-foreground">
                    Keys reference object properties. Choose which fields identify and display instances.
                  </p>
                </div>
                <div className="grid gap-3">
                  <Label>Primary Key *</Label>
                  {primaryKeyParts.map((part, index) => (
                    <div key={`pk-${index}`} className="flex items-center gap-2">
                      <SearchableSelect
                        value={part.partPropertyUri}
                        onValueChange={(value) =>
                          updateKeyPart(setPrimaryKeyParts, index, { partPropertyUri: value })
                        }
                        groups={[
                          {
                            label: 'Properties',
                            options: propertyOptions.map((prop) => ({
                              value: prop.id,
                              label: prop.label,
                              description: prop.fieldKey,
                            })),
                          },
                        ]}
                        placeholder="Select property"
                        searchPlaceholder="Search properties..."
                      />
                      {primaryKeyParts.length > 1 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => removeKeyPart(setPrimaryKeyParts, index)}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  ))}
                  <Button type="button" variant="secondary" onClick={() => addKeyPart(setPrimaryKeyParts)}>
                    <Plus className="h-3 w-3 mr-1" />
                    Add Primary Key Part
                  </Button>
                </div>

                <div className="grid gap-3">
                  <Label>Display Key *</Label>
                  {displayKeyParts.map((part, index) => (
                    <div key={`dk-${index}`} className="flex items-center gap-2">
                      <SearchableSelect
                        value={part.partPropertyUri}
                        onValueChange={(value) =>
                          updateKeyPart(setDisplayKeyParts, index, { partPropertyUri: value })
                        }
                        groups={[
                          {
                            label: 'Properties',
                            options: propertyOptions.map((prop) => ({
                              value: prop.id,
                              label: prop.label,
                              description: prop.fieldKey,
                            })),
                          },
                        ]}
                        placeholder="Select property"
                        searchPlaceholder="Search properties..."
                      />
                      {displayKeyParts.length > 1 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => removeKeyPart(setDisplayKeyParts, index)}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  ))}
                  <Button type="button" variant="secondary" onClick={() => addKeyPart(setDisplayKeyParts)}>
                    <Plus className="h-3 w-3 mr-1" />
                    Add Display Key Part
                  </Button>
                </div>
              </div>
            </TabsContent>
          </Tabs>

          {error && <p className="text-sm text-destructive mt-4">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={loading}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? 'Creating...' : 'Create Object Model'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
      <InlineTypeDialog
        open={typeDialogOpen}
        onOpenChange={setTypeDialogOpen}
        onCreate={handleInlineTypeCreate}
        existingTypes={existingTypes}
      />
    </Dialog>
  );
}
