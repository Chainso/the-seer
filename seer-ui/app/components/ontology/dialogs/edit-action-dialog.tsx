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
  ActionEventInput,
  ActionInputInput,
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
  updateActionDefinition,
} from '@/app/lib/api/ontology';
import { mapActionIo } from '@/app/lib/ontology-helpers';
import { buildTypeGroups } from '../forms/type-groups';
import { buildReferenceEdges } from '../graph-reference-edges';

interface EditActionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  action: OntologyNode | null;
  nodes: OntologyNode[];
  edges: OntologyEdge[];
  onActionUpdated: () => void;
  defaultTab?: 'basics' | 'input' | 'event';
}

const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

export function EditActionDialog({
  open,
  onOpenChange,
  action,
  nodes,
  edges,
  onActionUpdated,
  defaultTab = 'basics',
}: EditActionDialogProps) {
  const [typeDialogOpen, setTypeDialogOpen] = useState(false);
  const [typeTargetIndex, setTypeTargetIndex] = useState<number | null>(null);
  const [typeTargetSection, setTypeTargetSection] = useState<'input' | 'output'>('input');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [documentation, setDocumentation] = useState('');
  const [type, setType] = useState<'PROCESS' | 'WORKFLOW'>('PROCESS');
  const [inputName, setInputName] = useState('');
  const [inputDescription, setInputDescription] = useState('');
  const [inputDocumentation, setInputDocumentation] = useState('');
  const [inputProperties, setInputProperties] = useState<PropertyDefinitionInput[]>([]);
  const [outputName, setOutputName] = useState('');
  const [outputDescription, setOutputDescription] = useState('');
  const [outputDocumentation, setOutputDocumentation] = useState('');
  const [outputProperties, setOutputProperties] = useState<PropertyDefinitionInput[]>([]);
  const [eventKind, setEventKind] = useState<'SIGNAL' | 'TRANSITION'>('SIGNAL');
  const [transitionOfUri, setTransitionOfUri] = useState('');
  const [fromStateUri, setFromStateUri] = useState('');
  const [toStateUri, setToStateUri] = useState('');
  const [inlineTypes, setInlineTypes] = useState<InlineTypeSpec[]>([]);
  const [typeOptions, setTypeOptions] = useState<OntologyNode[]>([]);
  const [objectModels, setObjectModels] = useState<OntologyNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toFieldKey = (value: string) => camelcase(value || '');

  useEffect(() => {
    if (!open || !action) {
      return;
    }

    setName((action.properties.name as string) || '');
    setDescription((action.properties.description as string) || '');
    setDocumentation((action.properties.documentation as string) || '');
    setType(action.label === 'Workflow' ? 'WORKFLOW' : 'PROCESS');

    const input = mapActionIo(action.uri, 'acceptsInput', nodes, edges);
    const output = mapActionIo(action.uri, 'producesEvent', nodes, edges);

    setInputName(input.name || 'Action Input');
    setInputDescription(input.description || '');
    setInputDocumentation(input.documentation || '');
    setInputProperties(input.properties.length ? input.properties : [{ name: '', fieldKey: '', valueTypeUri: '' }]);

    setOutputName(output.name || 'Action Event');
    setOutputDescription(output.description || '');
    setOutputDocumentation(output.documentation || '');
    setOutputProperties(output.properties.length ? output.properties : [{ name: '', fieldKey: '', valueTypeUri: '' }]);

    const outputUri = edges.find(
      (edge) => edge.type === 'producesEvent' && edge.fromUri === action.uri
    )?.toUri;
    const outputNode = outputUri ? nodes.find((node) => node.uri === outputUri) : undefined;
    const nextKind = outputNode?.label === 'Transition' ? 'TRANSITION' : 'SIGNAL';
    setEventKind(nextKind);
    setTransitionOfUri(
      outputUri
        ? edges.find((edge) => edge.type === 'transitionOf' && edge.fromUri === outputUri)?.toUri || ''
        : ''
    );
    setFromStateUri(
      outputUri
        ? edges.find((edge) => edge.type === 'fromState' && edge.fromUri === outputUri)?.toUri || ''
        : ''
    );
    setToStateUri(
      outputUri
        ? edges.find((edge) => edge.type === 'toState' && edge.fromUri === outputUri)?.toUri || ''
        : ''
    );

    const typeNodes = nodes.filter((node) =>
      ['BaseType', 'Type', 'CustomType', 'StructType', 'ListType'].includes(node.label)
    );
    const modelNodes = nodes.filter((node) => node.label === 'ObjectModel');
    setTypeOptions(typeNodes);
    setObjectModels(modelNodes);
    setInlineTypes([]);
    setError(null);
  }, [open, action, nodes, edges]);

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
    const validStateUris = new Set(
      edges
        .filter((edge) => edge.type === 'hasPossibleState' && edge.fromUri === transitionOfUri)
        .map((edge) => edge.toUri)
    );
    if (!validStateUris.has(fromStateUri)) {
      setFromStateUri('');
    }
    if (!validStateUris.has(toStateUri)) {
      setToStateUri('');
    }
  }, [edges, fromStateUri, toStateUri, transitionOfUri]);

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
      nodes
        .filter((node) => node.label === 'State')
        .map((state) => [state.uri, (state.properties.name as string) || state.uri])
    );
    return edges
      .filter((edge) => edge.type === 'hasPossibleState' && edge.fromUri === transitionOfUri)
      .map((edge) => ({
        uri: edge.toUri,
        name: stateNameByUri.get(edge.toUri) || edge.toUri,
      }));
  }, [edges, nodes, transitionOfUri]);

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

    if (!action) {
      return;
    }

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

      await updateActionDefinition(action.uri, {
        name: name.trim(),
        description: description.trim() || undefined,
        documentation: documentation.trim() || undefined,
        type,
        input,
        event,
      });

      onOpenChange(false);
      onActionUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update action');
    } finally {
      setLoading(false);
    }
  };

  const nodeMap = useMemo(() => new Map(nodes.map((node) => [node.uri, node])), [nodes]);
  const dependencySummary = useMemo(() => {
    if (!action) {
      return null;
    }
    const outputUri = edges.find(
      (edge) => edge.type === 'producesEvent' && edge.fromUri === action.uri
    )?.toUri;
    const outputNode = outputUri ? nodeMap.get(outputUri) : undefined;
    const triggerUris = edges
      .filter((edge) => edge.type === 'invokes' && edge.toUri === action.uri)
      .map((edge) => edge.fromUri);
    const triggers = triggerUris
      .map((uri) => nodeMap.get(uri))
      .filter(Boolean)
      .map((node) => (node?.properties.name as string) || node?.uri || '');
    const referenceEdges = buildReferenceEdges(nodes, edges);
    const referencedModels = referenceEdges
      .filter((edge) => edge.type === 'referencesObjectModel' && edge.fromUri === action.uri)
      .map((edge) => edge.toUri);
    const referenceNames = referencedModels
      .map((modelUri) => {
        const modelNode = nodeMap.get(modelUri);
        return (modelNode?.properties.name as string) || modelNode?.uri || modelUri;
      });

    return {
      outputName: outputNode ? ((outputNode.properties.name as string) || outputNode.uri) : null,
      triggerNames: triggers,
      referenceNames,
    };
  }, [action, edges, nodeMap, nodes]);

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

  const tabKey = `${action?.uri || 'action'}-${defaultTab}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[760px] max-h-[85vh] overflow-y-auto">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle className="font-display text-xl">Edit Action</DialogTitle>
            <DialogDescription>
              Actions define executable work. Update the request input and produced event schemas.
            </DialogDescription>
          </DialogHeader>
          {dependencySummary && (
            <div className="mt-4 grid gap-3 rounded-2xl border border-border bg-muted/40 p-4 text-sm">
              <div>
                <h4 className="font-display text-base">Dependencies</h4>
                <p className="text-xs text-muted-foreground">
                  See which events and models this action touches.
                </p>
              </div>
              <div className="grid gap-2 text-sm">
                <p>
                  <span className="text-muted-foreground">Output event:</span>{' '}
                  {dependencySummary.outputName || 'None'}
                </p>
                <p>
                  <span className="text-muted-foreground">Triggered by:</span>{' '}
                  {renderList(dependencySummary.triggerNames, 'No triggers')}
                </p>
                <p>
                  <span className="text-muted-foreground">References:</span>{' '}
                  {renderList(dependencySummary.referenceNames, 'No object references')}
                </p>
              </div>
            </div>
          )}
          <Tabs key={tabKey} defaultValue={defaultTab} className="mt-4">
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
                <Label>Action Type</Label>
                <Input value={type === 'PROCESS' ? 'Process' : 'Workflow'} disabled />
                <p className="text-xs text-muted-foreground">
                  Action type is immutable after creation.
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
                  <select
                    className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                    value={eventKind}
                    onChange={(event) => setEventKind(event.target.value as typeof eventKind)}
                    disabled={loading}
                  >
                    <option value="SIGNAL">Signal</option>
                    <option value="TRANSITION">Transition</option>
                  </select>
                </div>
                {eventKind === 'TRANSITION' && (
                  <div className="grid gap-3 rounded-xl border border-border/60 bg-background p-3">
                    <div className="grid gap-2">
                      <Label>Object Model *</Label>
                      <select
                        className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                        value={transitionOfUri}
                        onChange={(event) => setTransitionOfUri(event.target.value)}
                        disabled={loading}
                      >
                        <option value="">Select object model</option>
                        {objectModels.map((model) => (
                          <option key={model.uri} value={model.uri}>
                            {(model.properties.name as string) || model.uri}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <div className="grid gap-2">
                        <Label>From State *</Label>
                        <select
                          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                          value={fromStateUri}
                          onChange={(event) => setFromStateUri(event.target.value)}
                          disabled={loading || !transitionOfUri}
                        >
                          <option value="">Select from state</option>
                          {transitionStateOptions.map((state) => (
                            <option key={state.uri} value={state.uri}>
                              {state.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="grid gap-2">
                        <Label>To State *</Label>
                        <select
                          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                          value={toStateUri}
                          onChange={(event) => setToStateUri(event.target.value)}
                          disabled={loading || !transitionOfUri}
                        >
                          <option value="">Select to state</option>
                          {transitionStateOptions.map((state) => (
                            <option key={state.uri} value={state.uri}>
                              {state.name}
                            </option>
                          ))}
                        </select>
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
