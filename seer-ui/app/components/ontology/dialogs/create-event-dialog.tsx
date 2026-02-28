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
import { Plus } from 'lucide-react';
import {
  createCustomType,
  createListType,
  createSignal,
  createStructType,
  getNodesByLabel,
} from '@/app/lib/api/ontology';
import camelcase from 'camelcase';
import type { InlineTypeSpec, OntologyNode, PropertyDefinitionInput } from '@/app/types/ontology';
import { PropertyListEditor } from '../forms/property-list-editor';
import { InlineTypeDialog } from './inline-type-dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/app/components/ui/tabs';
import { buildTypeGroups } from '../forms/type-groups';

interface CreateEventDialogProps {
  onEventCreated: () => void;
}

const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

export function CreateEventDialog({ onEventCreated }: CreateEventDialogProps) {
  const [open, setOpen] = useState(false);
  const [typeDialogOpen, setTypeDialogOpen] = useState(false);
  const [typeTargetIndex, setTypeTargetIndex] = useState<number | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [documentation, setDocumentation] = useState('');
  const [properties, setProperties] = useState<PropertyDefinitionInput[]>([
    { name: '', fieldKey: '', valueTypeUri: '' },
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

  const handleInlineTypeCreate = (type: InlineTypeSpec) => {
    const fallbackUri = type.payload.uri || slugify(type.payload.name);
    const payload = { ...type.payload, uri: fallbackUri };
    const nextType = { ...type, payload } as InlineTypeSpec;
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
      await createSignal({
        uri: slugify(name),
        name: name.trim(),
        description: description.trim() || undefined,
        documentation: documentation.trim() || undefined,
        properties: normalizedProperties.map((prop) => ({
          ...prop,
          name: prop.name.trim(),
          fieldKey: prop.fieldKey?.trim() || toFieldKey(prop.name),
        })),
      });

      setName('');
      setDescription('');
      setDocumentation('');
      setProperties([{ name: '', fieldKey: '', valueTypeUri: '' }]);
      setInlineTypes([]);
      setOpen(false);
      onEventCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create signal');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="h-4 w-4 mr-2" />
          New Signal
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[720px] max-h-[85vh] overflow-y-auto">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle className="font-display text-xl">Create Signal</DialogTitle>
            <DialogDescription>
              Signals capture external system events. Define the payload schema here.
            </DialogDescription>
          </DialogHeader>
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
          {error && (
            <p className="text-sm text-destructive mt-4">{error}</p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={loading}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? 'Creating...' : 'Create Signal'}
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
