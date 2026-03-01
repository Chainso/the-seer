'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { X } from 'lucide-react';
import camelcase from 'camelcase';
import type {
  InlineTypeSpec,
  KeyDefinitionInput,
  KeyPartInput,
  OntologyEdge,
  OntologyNode,
  PropertyDefinitionInput,
} from '@/app/types/ontology';
import { PropertyListEditor } from '../forms/property-list-editor';
import { InlineTypeDialog } from './inline-type-dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/app/components/ui/tabs';
import { buildTypeGroups } from '../forms/type-groups';
import { SearchableSelect } from '@/app/components/ui/searchable-select';
import { buildReferenceEdges } from '../graph-reference-edges';
import {
  createCustomType,
  createListType,
  createStructType,
  updateObjectModelDefinition,
} from '@/app/lib/api/ontology';
import {
  mapKeyDefinition,
  mapPropertyDefinitions,
  mapInitialStateUri,
  mapStates,
} from '@/app/lib/ontology-helpers';

interface EditObjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  object: OntologyNode | null;
  nodes: OntologyNode[];
  edges: OntologyEdge[];
  onObjectUpdated: () => void;
}

const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

export function EditObjectDialog({
  open,
  onOpenChange,
  object,
  nodes,
  edges,
  onObjectUpdated,
}: EditObjectDialogProps) {
  const [typeDialogOpen, setTypeDialogOpen] = useState(false);
  const [typeTargetIndex, setTypeTargetIndex] = useState<number | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [documentation, setDocumentation] = useState('');
  const [properties, setProperties] = useState<PropertyDefinitionInput[]>([]);
  const [primaryKeyParts, setPrimaryKeyParts] = useState<KeyPartInput[]>([]);
  const [displayKeyParts, setDisplayKeyParts] = useState<KeyPartInput[]>([]);
  const [inlineTypes, setInlineTypes] = useState<InlineTypeSpec[]>([]);
  const [typeOptions, setTypeOptions] = useState<OntologyNode[]>([]);
  const [objectModels, setObjectModels] = useState<OntologyNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toFieldKey = useCallback((value: string) => camelcase(value || ''), []);

  useEffect(() => {
    if (!open || !object) {
      return;
    }

    setName((object.properties.name as string) || '');
    setDescription((object.properties.description as string) || '');
    setDocumentation((object.properties.documentation as string) || '');
    setProperties(mapPropertyDefinitions(object.uri, nodes, edges));

    const primaryKey = mapKeyDefinition(object.uri, 'hasPrimaryKey', nodes, edges);
    const displayKey = mapKeyDefinition(object.uri, 'hasDisplayKey', nodes, edges);
    setPrimaryKeyParts(primaryKey.keyParts.length ? primaryKey.keyParts : [{ name: '', partIndex: 0, partPropertyUri: '' }]);
    setDisplayKeyParts(displayKey.keyParts.length ? displayKey.keyParts : [{ name: '', partIndex: 0, partPropertyUri: '' }]);

    const typeNodes = nodes.filter((node) =>
      ['BaseType', 'Type', 'CustomType', 'StructType', 'ListType'].includes(node.label)
    );
    const modelNodes = nodes.filter((node) => node.label === 'ObjectModel');
    setTypeOptions(typeNodes);
    setObjectModels(modelNodes);
    setInlineTypes([]);
    setError(null);
  }, [open, object, nodes, edges]);

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
        .map((prop) => {
          const fieldKey = prop.fieldKey.trim() || toFieldKey(prop.name);
          if (!fieldKey) {
            return null;
          }
          return {
            label: prop.name.trim() || fieldKey,
            fieldKey,
            uri: prop.uri || `${object?.uri || 'object'}_${fieldKey}`,
          };
        })
        .filter((prop): prop is { label: string; fieldKey: string; uri: string } => Boolean(prop)),
    [object?.uri, properties, toFieldKey]
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
      name: part.name.trim() || `Key Part ${index + 1}`,
      partIndex: index,
    })),
  });

  const hasInvalidProps = properties.some(
    (prop) => !prop.name.trim() || !prop.valueTypeUri
  );

  const hasInvalidKey = (parts: KeyPartInput[]) =>
    parts.length === 0 || parts.some((part) => !part.partPropertyUri);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!object) {
      return;
    }

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

      const normalizedProperties = (await normalizePropertyList(properties)).map((prop) => ({
        ...prop,
        fieldKey: prop.fieldKey?.trim() || toFieldKey(prop.name),
        uri: prop.uri || `${object.uri}_${prop.fieldKey?.trim() || toFieldKey(prop.name)}`,
        name: prop.name.trim(),
      }));

      const normalizeKeyParts = (parts: KeyPartInput[]) =>
        parts.map((part, index) => ({
          ...part,
          name: part.name.trim() || `Key Part ${index + 1}`,
          partIndex: index,
          partPropertyUri: part.partPropertyUri,
        }));

      const normalizedStates = mapStates(object.uri, nodes, edges).map((state) => ({
        ...state,
        name: state.name.trim(),
        description: state.description?.trim() || undefined,
        documentation: state.documentation?.trim() || undefined,
      }));
      const selectedInitial = mapInitialStateUri(object.uri, edges);

      await updateObjectModelDefinition(object.uri, {
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
        initialStateUri: selectedInitial || undefined,
        states: normalizedStates,
      });

      onOpenChange(false);
      onObjectUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update object model');
    } finally {
      setLoading(false);
    }
  };

  const nodeMap = useMemo(() => new Map(nodes.map((node) => [node.uri, node])), [nodes]);
  const dependencySummary = useMemo(() => {
    if (!object) {
      return null;
    }
    const stateUris = edges
      .filter((edge) => edge.type === 'hasPossibleState' && edge.fromUri === object.uri)
      .map((edge) => edge.toUri);
    const transitionUris = edges
      .filter((edge) => edge.type === 'transitionOf' && edge.toUri === object.uri)
      .map((edge) => edge.fromUri);
    const referenceEdges = buildReferenceEdges(nodes, edges);
    const referencedByUris = referenceEdges
      .filter((edge) => edge.type === 'referencesObjectModel' && edge.toUri === object.uri)
      .map((edge) => edge.fromUri);
    const uniqueReferences = Array.from(new Set(referencedByUris)).filter(
      (uri) => uri !== object.uri
    );

    return {
      stateCount: stateUris.length,
      transitionCount: transitionUris.length,
      referencedBy: uniqueReferences.map((uri) => {
        const node = nodeMap.get(uri);
        return (node?.properties.name as string) || node?.uri || uri;
      }),
    };
  }, [edges, nodeMap, nodes, object]);

  const renderList = (items: string[], emptyLabel: string) => {
    if (items.length === 0) {
      return <span className="text-muted-foreground">{emptyLabel}</span>;
    }
    const visible = items.slice(0, 3);
    const remaining = items.length - visible.length;
    return (
      <span>
        {visible.join(', ')}
        {remaining > 0 ? ` +${remaining} more` : ''}
      </span>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[840px] max-h-[85vh] overflow-y-auto">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle className="font-display text-xl">Edit Object Model</DialogTitle>
            <DialogDescription>
              Update the object schema and keys. States and transitions are modeled in the graph.
            </DialogDescription>
          </DialogHeader>
          {dependencySummary && (
            <div className="mt-4 grid gap-3 rounded-2xl border border-border bg-muted/40 p-4 text-sm">
              <div>
                <h4 className="font-display text-base">Dependencies</h4>
                <p className="text-xs text-muted-foreground">
                  See how this object connects to the rest of the ontology.
                </p>
              </div>
              <div className="grid gap-2 text-sm">
                <p>
                  <span className="text-muted-foreground">States:</span> {dependencySummary.stateCount}
                </p>
                <p>
                  <span className="text-muted-foreground">Transitions:</span>{' '}
                  {dependencySummary.transitionCount}
                </p>
                <p>
                  <span className="text-muted-foreground">Referenced by:</span>{' '}
                  {renderList(dependencySummary.referencedBy, 'No references')}
                </p>
              </div>
            </div>
          )}
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
                              value: prop.uri,
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
                              value: prop.uri,
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
                    Add Display Key Part
                  </Button>
                </div>
              </div>
            </TabsContent>
          </Tabs>

          {error && <p className="text-sm text-destructive mt-4">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? 'Saving...' : 'Save Changes'}
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
