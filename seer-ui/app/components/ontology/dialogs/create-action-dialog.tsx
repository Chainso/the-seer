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
import { SearchableSelect } from '@/app/components/ui/searchable-select';
import { Textarea } from '@/app/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/app/components/ui/select';
import { Plus } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/app/components/ui/tabs';
import {
  createAction,
  createCustomType,
  createListType,
  createStructType,
  getOntologyGraph,
} from '@/app/lib/api/ontology';
import camelcase from 'camelcase';
import type {
  ActionEventInput,
  ActionInputInput,
  InlineTypeSpec,
  OntologyNode,
  PropertyDefinitionInput,
} from '@/app/types/ontology';
import { InlineTypeDialog } from './inline-type-dialog';
import { PropertyListEditor } from '../forms/property-list-editor';
import { buildTypeGroups } from '../forms/type-groups';

interface CreateActionDialogProps {
  onActionCreated: () => void;
}

const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

export function CreateActionDialog({ onActionCreated }: CreateActionDialogProps) {
  const [open, setOpen] = useState(false);
  const [typeDialogOpen, setTypeDialogOpen] = useState(false);
  const [typeTargetIndex, setTypeTargetIndex] = useState<number | null>(null);
  const [typeTargetSection, setTypeTargetSection] = useState<'input' | 'output'>('input');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [documentation, setDocumentation] = useState('');
  const [type, setType] = useState<'PROCESS' | 'WORKFLOW'>('PROCESS');
  const [inputName, setInputName] = useState('Action Input');
  const [inputDescription, setInputDescription] = useState('');
  const [inputDocumentation, setInputDocumentation] = useState('');
  const [inputProperties, setInputProperties] = useState<PropertyDefinitionInput[]>([
    { name: '', fieldKey: '', valueTypeUri: '' },
  ]);
  const [outputName, setOutputName] = useState('Action Event');
  const [outputDescription, setOutputDescription] = useState('');
  const [outputDocumentation, setOutputDocumentation] = useState('');
  const [outputProperties, setOutputProperties] = useState<PropertyDefinitionInput[]>([
    { name: '', fieldKey: '', valueTypeUri: '' },
  ]);
  const [eventKind, setEventKind] = useState<'SIGNAL' | 'TRANSITION'>('SIGNAL');
  const [transitionOfUri, setTransitionOfUri] = useState('');
  const [fromStateUri, setFromStateUri] = useState('');
  const [toStateUri, setToStateUri] = useState('');
  const [inlineTypes, setInlineTypes] = useState<InlineTypeSpec[]>([]);
  const [typeOptions, setTypeOptions] = useState<OntologyNode[]>([]);
  const [objectModels, setObjectModels] = useState<OntologyNode[]>([]);
  const [stateNodes, setStateNodes] = useState<OntologyNode[]>([]);
  const [stateUrisByObject, setStateUrisByObject] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toFieldKey = (value: string) => camelcase(value || '');

  useEffect(() => {
    if (open) {
      getOntologyGraph().then((graph) => {
        const types = graph.nodes.filter((node) =>
          ['BaseType', 'Type', 'CustomType', 'StructType', 'ListType'].includes(node.label)
        );
        const models = graph.nodes.filter((node) => node.label === 'ObjectModel');
        const states = graph.nodes.filter((node) => node.label === 'State');
        const nextStateUrisByObject: Record<string, string[]> = {};
        graph.edges
          .filter((edge) => edge.type === 'hasPossibleState')
          .forEach((edge) => {
            const existing = nextStateUrisByObject[edge.fromUri] || [];
            nextStateUrisByObject[edge.fromUri] = [...existing, edge.toUri];
          });
        setTypeOptions(types);
        setObjectModels(models);
        setStateNodes(states);
        setStateUrisByObject(nextStateUrisByObject);
      });
    }
  }, [open]);

  useEffect(() => {
    if (eventKind === 'SIGNAL') {
      setTransitionOfUri('');
      setFromStateUri('');
      setToStateUri('');
    }
  }, [eventKind]);

  useEffect(() => {
    if (!transitionOfUri) {
      setFromStateUri('');
      setToStateUri('');
      return;
    }
    const validStateUris = new Set(stateUrisByObject[transitionOfUri] || []);
    if (!validStateUris.has(fromStateUri)) {
      setFromStateUri('');
    }
    if (!validStateUris.has(toStateUri)) {
      setToStateUri('');
    }
  }, [fromStateUri, toStateUri, transitionOfUri, stateUrisByObject]);

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

  const transitionStateOptions = useMemo(() => {
    if (!transitionOfUri) {
      return [];
    }
    const stateNameByUri = new Map(
      stateNodes.map((state) => [state.uri, (state.properties.name as string) || state.uri])
    );
    return (stateUrisByObject[transitionOfUri] || []).map((uri) => ({
      uri,
      name: stateNameByUri.get(uri) || uri,
    }));
  }, [stateNodes, stateUrisByObject, transitionOfUri]);

  const handleInlineTypeRequest = (index: number, section: 'input' | 'output') => {
    setTypeTargetIndex(index);
    setTypeTargetSection(section);
    setTypeDialogOpen(true);
  };

  const handleInlineTypeCreate = (typeSpec: InlineTypeSpec) => {
    const fallbackUri = typeSpec.payload.uri || slugify(typeSpec.payload.name);
    const payload = { ...typeSpec.payload, uri: fallbackUri };
    const nextType = { ...typeSpec, payload } as InlineTypeSpec;
    setInlineTypes((prev) => [...prev, nextType]);
    if (typeTargetIndex !== null) {
      if (typeTargetSection === 'input') {
        setInputProperties((prev) => {
          const draft = [...prev];
          draft[typeTargetIndex] = { ...draft[typeTargetIndex], valueTypeUri: payload.uri as string };
          return draft;
        });
      } else {
        setOutputProperties((prev) => {
          const draft = [...prev];
          draft[typeTargetIndex] = { ...draft[typeTargetIndex], valueTypeUri: payload.uri as string };
          return draft;
        });
      }
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

  const hasInvalidProps = (props: PropertyDefinitionInput[]) =>
    props.some((prop) => !prop.name.trim() || !prop.valueTypeUri);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim()) {
      setError('Action name is required');
      return;
    }

    if (hasInvalidProps(inputProperties) || hasInvalidProps(outputProperties)) {
      setError('All input and produced event properties must include a name and value type');
      return;
    }

    if (eventKind === 'TRANSITION' && (!transitionOfUri || !fromStateUri || !toStateUri)) {
      setError('Transition events require object model, from state, and to state');
      return;
    }

    if (eventKind === 'TRANSITION' && fromStateUri === toStateUri) {
      setError('Transition from state and to state must be different');
      return;
    }

    try {
      setLoading(true);
      setError(null);
      await createInlineTypes();

      const normalizedInputProperties = await normalizePropertyList(inputProperties);
      const normalizedOutputProperties = await normalizePropertyList(outputProperties);

      const input: ActionInputInput = {
        name: inputName.trim(),
        description: inputDescription.trim() || undefined,
        documentation: inputDocumentation.trim() || undefined,
        properties: normalizedInputProperties.map((prop) => ({
          ...prop,
          name: prop.name.trim(),
          fieldKey: prop.fieldKey?.trim() || toFieldKey(prop.name),
        })),
      };

      const event: ActionEventInput = {
        name: outputName.trim(),
        description: outputDescription.trim() || undefined,
        documentation: outputDocumentation.trim() || undefined,
        properties: normalizedOutputProperties.map((prop) => ({
          ...prop,
          name: prop.name.trim(),
          fieldKey: prop.fieldKey?.trim() || toFieldKey(prop.name),
        })),
        kind: eventKind,
        ...(eventKind === 'TRANSITION'
          ? {
              transitionOfUri,
              fromStateUri,
              toStateUri,
            }
          : {}),
      };

      await createAction({
        uri: slugify(name),
        name: name.trim(),
        description: description.trim() || undefined,
        documentation: documentation.trim() || undefined,
        type,
        input,
        event,
      });

      setName('');
      setDescription('');
      setDocumentation('');
      setType('PROCESS');
      setInputName('Action Input');
      setInputDescription('');
      setInputDocumentation('');
      setInputProperties([{ name: '', fieldKey: '', valueTypeUri: '' }]);
      setOutputName('Action Event');
      setOutputDescription('');
      setOutputDocumentation('');
      setOutputProperties([{ name: '', fieldKey: '', valueTypeUri: '' }]);
      setEventKind('SIGNAL');
      setTransitionOfUri('');
      setFromStateUri('');
      setToStateUri('');
      setInlineTypes([]);
      setOpen(false);
      onActionCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create action');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="h-4 w-4 mr-2" />
          New Action
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[760px] max-h-[85vh] overflow-y-auto">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle className="font-display text-xl">Create Action</DialogTitle>
            <DialogDescription>
              Actions define executable work. Specify the request input and resulting output event.
            </DialogDescription>
          </DialogHeader>
          <Tabs defaultValue="basics" className="mt-4">
            <TabsList className="h-10">
              <TabsTrigger value="basics">Basics</TabsTrigger>
              <TabsTrigger value="input">Input</TabsTrigger>
              <TabsTrigger value="event">Event</TabsTrigger>
            </TabsList>
            <TabsContent value="basics" className="mt-4 space-y-4">
              <div className="grid gap-2">
                <Label htmlFor="action-name">Action Name *</Label>
                <Input
                  id="action-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Process Order"
                  disabled={loading}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="action-description">Description</Label>
                <Textarea
                  id="action-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Automated workflow for fulfillment"
                  disabled={loading}
                  rows={2}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="action-docs">Documentation</Label>
                <Textarea
                  id="action-docs"
                  value={documentation}
                  onChange={(e) => setDocumentation(e.target.value)}
                  placeholder="Notes, constraints, or links"
                  disabled={loading}
                  rows={2}
                />
              </div>
              <div className="grid gap-2">
                <Label>Action Type *</Label>
                <Select value={type} onValueChange={(value) => setType(value as typeof type)} disabled={loading}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PROCESS">Process</SelectItem>
                    <SelectItem value="WORKFLOW">Workflow</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Processes are handled externally; workflows run coordinated steps in Seer.
                </p>
              </div>
            </TabsContent>
            <TabsContent value="input" className="mt-4 space-y-4">
              <div className="grid gap-3 rounded-2xl border border-border bg-muted/40 p-4">
                <h3 className="font-display text-lg">Action Input</h3>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Input
                    value={inputName}
                    onChange={(e) => setInputName(e.target.value)}
                    placeholder="Input name"
                  />
                  <Input
                    value={inputDescription}
                    onChange={(e) => setInputDescription(e.target.value)}
                    placeholder="Input description"
                  />
                </div>
                <Textarea
                  value={inputDocumentation}
                  onChange={(e) => setInputDocumentation(e.target.value)}
                  placeholder="Input documentation"
                  rows={2}
                />
                <PropertyListEditor
                  title="Input Properties"
                  properties={inputProperties}
                  typeOptions={typeOptions}
                  typeGroups={typeGroups}
                  onChange={setInputProperties}
                  onRequestInlineType={(index) => handleInlineTypeRequest(index, 'input')}
                />
              </div>
            </TabsContent>
            <TabsContent value="event" className="mt-4 space-y-4">
              <div className="grid gap-3 rounded-2xl border border-border bg-muted/40 p-4">
                <h3 className="font-display text-lg">Produced Event</h3>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Input
                    value={outputName}
                    onChange={(e) => setOutputName(e.target.value)}
                    placeholder="Event name"
                  />
                  <Input
                    value={outputDescription}
                    onChange={(e) => setOutputDescription(e.target.value)}
                    placeholder="Event description"
                  />
                </div>
                <div className="grid gap-2">
                  <Label>Produced Event Kind *</Label>
                  <Select
                    value={eventKind}
                    onValueChange={(value) => setEventKind(value as typeof eventKind)}
                    disabled={loading}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="SIGNAL">Signal</SelectItem>
                      <SelectItem value="TRANSITION">Transition</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {eventKind === 'TRANSITION' && (
                  <div className="grid gap-3 rounded-xl border border-border/60 bg-background p-3">
                    <div className="grid gap-2">
                      <Label>Object Model *</Label>
                      <SearchableSelect
                        value={transitionOfUri}
                        onValueChange={setTransitionOfUri}
                        disabled={loading}
                        groups={[
                          {
                            label: 'Object models',
                            options: objectModels.map((model) => ({
                              value: model.uri,
                              label: (model.properties.name as string) || model.uri,
                            })),
                          },
                        ]}
                        placeholder="Select object model"
                        searchPlaceholder="Search object models..."
                        emptyMessage="No object models found."
                      />
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <div className="grid gap-2">
                        <Label>From State *</Label>
                        <SearchableSelect
                          value={fromStateUri}
                          onValueChange={setFromStateUri}
                          disabled={loading || !transitionOfUri}
                          groups={[
                            {
                              label: 'States',
                              options: transitionStateOptions.map((state) => ({
                                value: state.uri,
                                label: state.name,
                              })),
                            },
                          ]}
                          placeholder="Select from state"
                          searchPlaceholder="Search states..."
                          emptyMessage="No states found."
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label>To State *</Label>
                        <SearchableSelect
                          value={toStateUri}
                          onValueChange={setToStateUri}
                          disabled={loading || !transitionOfUri}
                          groups={[
                            {
                              label: 'States',
                              options: transitionStateOptions.map((state) => ({
                                value: state.uri,
                                label: state.name,
                              })),
                            },
                          ]}
                          placeholder="Select to state"
                          searchPlaceholder="Search states..."
                          emptyMessage="No states found."
                        />
                      </div>
                    </div>
                  </div>
                )}
                <Textarea
                  value={outputDocumentation}
                  onChange={(e) => setOutputDocumentation(e.target.value)}
                  placeholder="Event documentation"
                  rows={2}
                />
                <PropertyListEditor
                  title="Event Properties"
                  properties={outputProperties}
                  typeOptions={typeOptions}
                  typeGroups={typeGroups}
                  onChange={setOutputProperties}
                  onRequestInlineType={(index) => handleInlineTypeRequest(index, 'output')}
                />
              </div>
            </TabsContent>
          </Tabs>
          {error && <p className="text-sm text-destructive mt-4">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={loading}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? 'Creating...' : 'Create Action'}
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
