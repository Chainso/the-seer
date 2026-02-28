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
} from '@/app/components/ui/dialog';
import { Input } from '@/app/components/ui/input';
import { Label } from '@/app/components/ui/label';
import { Textarea } from '@/app/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/app/components/ui/tabs';
import camelcase from 'camelcase';
import type {
  InlineTypeSpec,
  OntologyEdge,
  OntologyNode,
  PropertyDefinitionInput,
} from '@/app/types/ontology';
import { PropertyListEditor } from '../forms/property-list-editor';
import { InlineTypeDialog } from './inline-type-dialog';
import {
  createCustomType,
  createListType,
  createStructType,
  updateSignalDefinition,
} from '@/app/lib/api/ontology';
import { mapEventDefinition } from '@/app/lib/ontology-helpers';
import { buildTypeGroups } from '../forms/type-groups';

interface EditEventDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  event: OntologyNode | null;
  nodes: OntologyNode[];
  edges: OntologyEdge[];
  onEventUpdated: () => void;
}

const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

export function EditEventDialog({
  open,
  onOpenChange,
  event,
  nodes,
  edges,
  onEventUpdated,
}: EditEventDialogProps) {
  const [typeDialogOpen, setTypeDialogOpen] = useState(false);
  const [typeTargetIndex, setTypeTargetIndex] = useState<number | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [documentation, setDocumentation] = useState('');
  const [properties, setProperties] = useState<PropertyDefinitionInput[]>([]);
  const [inlineTypes, setInlineTypes] = useState<InlineTypeSpec[]>([]);
  const [typeOptions, setTypeOptions] = useState<OntologyNode[]>([]);
  const [objectModels, setObjectModels] = useState<OntologyNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toFieldKey = (value: string) => camelcase(value || '');

  useEffect(() => {
    if (!open || !event) {
      return;
    }

    const definition = mapEventDefinition(event.uri, nodes, edges);
    setName(definition.name);
    setDescription(definition.description || '');
    setDocumentation(definition.documentation || '');
    setProperties(definition.properties.length ? definition.properties : [{ name: '', fieldKey: '', valueTypeUri: '' }]);

    const typeNodes = nodes.filter((node) =>
      ['BaseType', 'Type', 'CustomType', 'StructType', 'ListType'].includes(node.label)
    );
    const modelNodes = nodes.filter((node) => node.label === 'ObjectModel');
    setTypeOptions(typeNodes);
    setObjectModels(modelNodes);
    setInlineTypes([]);
    setError(null);
  }, [open, event, nodes, edges]);

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!event) {
      return;
    }

    if (!name.trim()) {
      setError('Name is required');
      return;
    }

    if (properties.some((prop) => !prop.name.trim() || !prop.valueTypeUri)) {
      setError('All properties must include a name and value type');
      return;
    }

    try {
      setLoading(true);
      setError(null);
      await createInlineTypes();

      const normalizedProperties = await normalizePropertyList(properties);
      await updateSignalDefinition(event.uri, {
        name: name.trim(),
        description: description.trim() || undefined,
        documentation: documentation.trim() || undefined,
        properties: normalizedProperties.map((prop) => ({
          ...prop,
          name: prop.name.trim(),
          fieldKey: prop.fieldKey?.trim() || toFieldKey(prop.name),
        })),
      });

      onOpenChange(false);
      onEventUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update signal');
    } finally {
      setLoading(false);
    }
  };

  const nodeMap = useMemo(() => new Map(nodes.map((node) => [node.uri, node])), [nodes]);
  const dependencySummary = useMemo(() => {
    if (!event) {
      return null;
    }
    const triggerUris = edges
      .filter((edge) => edge.type === 'listensTo' && edge.toUri === event.uri)
      .map((edge) => edge.fromUri);
    const triggers = triggerUris
      .map((uri) => nodeMap.get(uri))
      .filter(Boolean)
      .map((node) => (node?.properties.name as string) || node?.uri || '');

    return {
      triggerNames: triggers,
    };
  }, [edges, event, nodeMap]);

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
      <DialogContent className="sm:max-w-[720px] max-h-[85vh] overflow-y-auto">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle className="font-display text-xl">Edit Signal</DialogTitle>
            <DialogDescription>
              Signals capture external system events. Update the payload schema here.
            </DialogDescription>
          </DialogHeader>
          {dependencySummary && (
            <div className="mt-4 grid gap-3 rounded-2xl border border-border bg-muted/40 p-4 text-sm">
              <div>
                <h4 className="font-display text-base">Dependencies</h4>
                <p className="text-xs text-muted-foreground">
                  See which triggers depend on this signal.
                </p>
              </div>
              <div className="grid gap-2 text-sm">
                <p>
                  <span className="text-muted-foreground">Used by triggers:</span>{' '}
                  {renderList(dependencySummary.triggerNames, 'No triggers')}
                </p>
              </div>
            </div>
          )}
          <Tabs defaultValue="basics" className="mt-4">
            <TabsList className="h-10">
              <TabsTrigger value="basics">Basics</TabsTrigger>
              <TabsTrigger value="properties">Properties</TabsTrigger>
            </TabsList>
            <TabsContent value="basics" className="mt-4 space-y-4">
              <div className="grid gap-2">
                <Label htmlFor="name">Signal Name *</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="order-created"
                  disabled={loading}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="description">Description</Label>
                <Input
                  id="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Payment gateway emitted success event"
                  disabled={loading}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="documentation">Documentation</Label>
                <Textarea
                  id="documentation"
                  value={documentation}
                  onChange={(e) => setDocumentation(e.target.value)}
                  placeholder="Reference links or event shape notes"
                  disabled={loading}
                  rows={2}
                />
              </div>
            </TabsContent>
            <TabsContent value="properties" className="mt-4 space-y-4">
              <PropertyListEditor
                title="Signal Properties"
                properties={properties}
                typeOptions={typeOptions}
                typeGroups={typeGroups}
                onChange={setProperties}
                onRequestInlineType={handleInlineTypeRequest}
              />
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
