'use client';

import { useEffect, useState } from 'react';
import { ObjectList } from '../lists/object-list';
import { EditObjectDialog } from '../dialogs/edit-object-dialog';
import { CreateObjectDialog } from '../dialogs/create-object-dialog';
import {
  createState,
  createTransition,
  getOntologyGraph,
  updateObjectModelDefinition,
  updateState,
  updateTransition,
} from '@/app/lib/api/ontology';
import { Loader2, ArrowLeft, Layers } from 'lucide-react';
import { Button } from '@/app/components/ui/button';
import type { OntologyNode, OntologyEdge, CreateObjectModelRequest } from '@/app/types/ontology';
import { ObjectStateGraph } from '../object-state-graph';
import type { OntologyGraph } from '@/app/types/ontology';
import { Label } from '@/app/components/ui/label';
import { Input } from '@/app/components/ui/input';
import { Textarea } from '@/app/components/ui/textarea';
import {
  mapKeyDefinition,
  mapPropertyDefinitions,
  mapInitialStateUri,
  mapStates,
} from '@/app/lib/ontology-helpers';
import { buildReferenceEdges } from '../graph-reference-edges';

interface ObjectsTabProps {
  onRefresh?: () => void;
  selectedObjectUri?: string;
  onSelectObjectUri?: (objectUri: string | null) => void;
}

const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

export function ObjectsTab({ onRefresh, selectedObjectUri, onSelectObjectUri }: ObjectsTabProps) {
  const [objects, setObjects] = useState<OntologyNode[]>([]);
  const [edges, setEdges] = useState<OntologyEdge[]>([]);
  const [nodes, setNodes] = useState<OntologyNode[]>([]);
  const [selectedObject, setSelectedObject] = useState<OntologyNode | null>(null);
  const [stateEditorOpen, setStateEditorOpen] = useState(false);
  const [stateEditorMode, setStateEditorMode] = useState<'initial' | 'fromState' | 'editState' | null>(null);
  const [sourceState, setSourceState] = useState<OntologyNode | null>(null);
  const [stateName, setStateName] = useState('');
  const [stateDescription, setStateDescription] = useState('');
  const [stateDocumentation, setStateDocumentation] = useState('');
  const [transitionName, setTransitionName] = useState('');
  const [transitionDescription, setTransitionDescription] = useState('');
  const [transitionDocumentation, setTransitionDocumentation] = useState('');
  const [transitionAutoName, setTransitionAutoName] = useState(true);
  const [stateError, setStateError] = useState<string | null>(null);
  const [stateLoading, setStateLoading] = useState(false);
  const [transitionEditorOpen, setTransitionEditorOpen] = useState(false);
  const [transitionEditorMode, setTransitionEditorMode] = useState<'create' | 'edit'>('edit');
  const [transitionTarget, setTransitionTarget] = useState<OntologyNode | null>(null);
  const [transitionFrom, setTransitionFrom] = useState<OntologyNode | null>(null);
  const [transitionTo, setTransitionTo] = useState<OntologyNode | null>(null);
  const [transitionEditName, setTransitionEditName] = useState('');
  const [transitionEditDescription, setTransitionEditDescription] = useState('');
  const [transitionEditDocumentation, setTransitionEditDocumentation] = useState('');
  const [transitionEditError, setTransitionEditError] = useState<string | null>(null);
  const [transitionEditLoading, setTransitionEditLoading] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editObject, setEditObject] = useState<OntologyNode | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadObjects = async () => {
    try {
      setLoading(true);
      setError(null);
      const graph = await getOntologyGraph();

      // Filter for ObjectModel nodes
      const objectModels = graph.nodes.filter(node => node.label === 'ObjectModel');
      setObjects(objectModels);
      setEdges(graph.edges);
      setNodes(graph.nodes);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load object models');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadObjects();
  }, []);

  useEffect(() => {
    if (!selectedObjectUri) {
      setSelectedObject(null);
      return;
    }
    const selected = nodes.find((node) => node.uri === selectedObjectUri) || null;
    setSelectedObject(selected);
  }, [selectedObjectUri, nodes]);

  useEffect(() => {
    setStateEditorOpen(false);
    setStateEditorMode(null);
    setSourceState(null);
    setStateName('');
    setStateDescription('');
    setStateDocumentation('');
    setTransitionName('');
    setTransitionDescription('');
    setTransitionDocumentation('');
    setTransitionAutoName(true);
    setStateError(null);
    setTransitionEditorOpen(false);
    setTransitionEditorMode('edit');
    setTransitionTarget(null);
    setTransitionFrom(null);
    setTransitionTo(null);
    setTransitionEditName('');
    setTransitionEditDescription('');
    setTransitionEditDocumentation('');
    setTransitionEditError(null);
  }, [selectedObject?.uri]);

  useEffect(() => {
    if (stateEditorMode === 'fromState' && transitionAutoName) {
      const fromLabel = (sourceState?.properties.name as string) || 'State';
      const toLabel = stateName.trim() || 'New State';
      setTransitionName(`${fromLabel} to ${toLabel}`);
    }
  }, [sourceState, stateEditorMode, stateName, transitionAutoName]);

  const handleChange = () => {
    loadObjects();
    onRefresh?.();
  };

  const handleEdit = (object: OntologyNode) => {
    setEditObject(object);
    setEditOpen(true);
  };

  const handleSelectObject = (object: OntologyNode | null) => {
    setSelectedObject(object);
    onSelectObjectUri?.(object?.uri ?? null);
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-2">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Loading object models...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-destructive">{error}</p>
      </div>
    );
  }

  // Detail view for selected object
  if (selectedObject) {
    const ecosystem = buildEcosystemGraph(selectedObject, nodes, edges);
    const stateUris = edges
      .filter((edge) => edge.type === 'hasPossibleState' && edge.fromUri === selectedObject.uri)
      .map((edge) => edge.toUri);
    const stateNodes = stateUris
      .map((uri) => nodes.find((node) => node.uri === uri))
      .filter(Boolean) as OntologyNode[];

    const hasInitialState = edges.some(
      (edge) => edge.type === 'initialState' && edge.fromUri === selectedObject.uri
    );

    const openInitialStateEditor = () => {
      if (hasInitialState) {
        return;
      }
      setStateEditorMode('initial');
      setSourceState(null);
      setStateName('');
      setStateDescription('');
      setStateDocumentation('');
      setTransitionName('');
      setTransitionDescription('');
      setTransitionDocumentation('');
      setTransitionAutoName(true);
      setStateError(null);
      setStateEditorOpen(true);
      setTransitionEditorOpen(false);
    };

    const openFromStateEditor = (stateUri: string) => {
      const source = stateNodes.find((state) => state.uri === stateUri) || null;
      setStateEditorMode('fromState');
      setSourceState(source);
      setStateName('');
      setStateDescription('');
      setStateDocumentation('');
      setTransitionName('');
      setTransitionDescription('');
      setTransitionDocumentation('');
      setTransitionAutoName(true);
      setStateError(null);
      setStateEditorOpen(true);
      setTransitionEditorOpen(false);
    };

    const openEditStateEditor = (stateUri: string) => {
      const state = stateNodes.find((node) => node.uri === stateUri);
      if (!state) {
        return;
      }
      setStateEditorMode('editState');
      setSourceState(state);
      setStateName((state.properties.name as string) || '');
      setStateDescription((state.properties.description as string) || '');
      setStateDocumentation((state.properties.documentation as string) || '');
      setTransitionName('');
      setTransitionDescription('');
      setTransitionDocumentation('');
      setTransitionAutoName(true);
      setStateError(null);
      setStateEditorOpen(true);
      setTransitionEditorOpen(false);
    };

    const openEditTransition = (transitionUri: string) => {
      const transitionNode = nodes.find(
        (node) => node.uri === transitionUri && node.label === 'Transition'
      );
      if (!transitionNode) {
        return;
      }
      const fromUri = edges.find(
        (edge) => edge.type === 'fromState' && edge.fromUri === transitionUri
      )?.toUri;
      const toUri = edges.find(
        (edge) => edge.type === 'toState' && edge.fromUri === transitionUri
      )?.toUri;
      setTransitionTarget(transitionNode);
      setTransitionFrom(stateNodes.find((state) => state.uri === fromUri) || null);
      setTransitionTo(stateNodes.find((state) => state.uri === toUri) || null);
      setTransitionEditName((transitionNode.properties.name as string) || '');
      setTransitionEditDescription((transitionNode.properties.description as string) || '');
      setTransitionEditDocumentation((transitionNode.properties.documentation as string) || '');
      setTransitionEditError(null);
      setTransitionEditorMode('edit');
      setTransitionEditorOpen(true);
      setStateEditorOpen(false);
    };

    const openCreateTransition = (fromStateUri: string, toStateUri: string) => {
      const fromState = stateNodes.find((state) => state.uri === fromStateUri) || null;
      const toState = stateNodes.find((state) => state.uri === toStateUri) || null;
      if (!fromState || !toState) {
        return;
      }
      const fromLabel = (fromState.properties.name as string) || 'State';
      const toLabel = (toState.properties.name as string) || 'State';
      setTransitionTarget(null);
      setTransitionFrom(fromState);
      setTransitionTo(toState);
      setTransitionEditName(`${fromLabel} to ${toLabel}`);
      setTransitionEditDescription('');
      setTransitionEditDocumentation('');
      setTransitionEditError(null);
      setTransitionEditorMode('create');
      setTransitionEditorOpen(true);
      setStateEditorOpen(false);
    };

    const buildObjectModelPayload = (
      objectNode: OntologyNode,
      newState: OntologyNode,
      initialUri: string | undefined
    ): CreateObjectModelRequest => {
      const properties = mapPropertyDefinitions(objectNode.uri, nodes, edges);
      const existingStates = mapStates(objectNode.uri, nodes, edges);
      const stateList = [
        ...existingStates,
        {
          uri: newState.uri,
          name: (newState.properties.name as string) || stateName.trim(),
          description: stateDescription.trim() || undefined,
          documentation: stateDocumentation.trim() || undefined,
        },
      ];
      const primaryKey = mapKeyDefinition(objectNode.uri, 'hasPrimaryKey', nodes, edges);
      const displayKey = mapKeyDefinition(objectNode.uri, 'hasDisplayKey', nodes, edges);
      const currentInitial = mapInitialStateUri(objectNode.uri, edges);
      return {
        name: (objectNode.properties.name as string) || objectNode.uri,
        description: (objectNode.properties.description as string) || undefined,
        documentation: (objectNode.properties.documentation as string) || undefined,
        properties,
        primaryKey,
        displayKey,
        initialStateUri: initialUri || currentInitial || undefined,
        states: stateList,
      };
    };

    const handleCreateState = async () => {
      if (!stateName.trim()) {
        setStateError('State name is required.');
        return;
      }
      if (stateEditorMode === 'fromState' && !transitionName.trim()) {
        setStateError('Transition name is required.');
        return;
      }
      if (stateEditorMode === 'fromState' && !sourceState) {
        setStateError('Select a source state.');
        return;
      }

      try {
        setStateLoading(true);
        setStateError(null);
        if (stateEditorMode === 'editState' && sourceState) {
          await updateState(sourceState.uri, {
            name: stateName.trim(),
            description: stateDescription.trim() || undefined,
            documentation: stateDocumentation.trim() || undefined,
          });
          setStateEditorOpen(false);
          setStateEditorMode(null);
          setSourceState(null);
          setStateName('');
          setStateDescription('');
          setStateDocumentation('');
          setTransitionName('');
          setTransitionDescription('');
          setTransitionDocumentation('');
          setTransitionAutoName(true);
          await loadObjects();
          onRefresh?.();
          return;
        }

        const newState = await createState({
          name: stateName.trim(),
          description: stateDescription.trim() || undefined,
          documentation: stateDocumentation.trim() || undefined,
          objectModelUri: selectedObject.uri,
        });

        if (stateEditorMode === 'initial') {
          const payload = buildObjectModelPayload(selectedObject, newState, newState.uri);
          await updateObjectModelDefinition(selectedObject.uri, payload);
        }

        if (stateEditorMode === 'fromState' && sourceState) {
          await createTransition({
            uri: slugify(transitionName),
            name: transitionName.trim(),
            description: transitionDescription.trim() || undefined,
            documentation: transitionDocumentation.trim() || undefined,
            transitionOfUri: selectedObject.uri,
            fromStateUri: sourceState.uri,
            toStateUri: newState.uri,
          });
        }

        setStateEditorOpen(false);
        setStateEditorMode(null);
        setSourceState(null);
        setStateName('');
        setStateDescription('');
        setStateDocumentation('');
        setTransitionName('');
        setTransitionDescription('');
        setTransitionDocumentation('');
        setTransitionAutoName(true);
        await loadObjects();
        onRefresh?.();
      } catch (err) {
        setStateError(err instanceof Error ? err.message : 'Failed to create state');
      } finally {
        setStateLoading(false);
      }
    };

    const handleSaveTransition = async () => {
      if (!transitionEditName.trim()) {
        setTransitionEditError('Transition name is required.');
        return;
      }
      try {
        setTransitionEditLoading(true);
        setTransitionEditError(null);
        if (transitionEditorMode === 'edit' && transitionTarget) {
          await updateTransition(transitionTarget.uri, {
            name: transitionEditName.trim(),
            description: transitionEditDescription.trim() || undefined,
            documentation: transitionEditDocumentation.trim() || undefined,
          });
        } else if (transitionEditorMode === 'create' && transitionFrom && transitionTo) {
          await createTransition({
            uri: slugify(transitionEditName),
            name: transitionEditName.trim(),
            description: transitionEditDescription.trim() || undefined,
            documentation: transitionEditDocumentation.trim() || undefined,
            transitionOfUri: selectedObject.uri,
            fromStateUri: transitionFrom.uri,
            toStateUri: transitionTo.uri,
          });
        }
        setTransitionEditorOpen(false);
        setTransitionEditorMode('edit');
        setTransitionTarget(null);
        setTransitionFrom(null);
        setTransitionTo(null);
        setTransitionEditName('');
        setTransitionEditDescription('');
        setTransitionEditDocumentation('');
        await loadObjects();
        onRefresh?.();
      } catch (err) {
        setTransitionEditError(err instanceof Error ? err.message : 'Failed to update transition');
      } finally {
        setTransitionEditLoading(false);
      }
    };
    return (
      <div className="flex flex-col gap-4 h-full">
        <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleSelectObject(null)}
            >
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back to List
          </Button>
          <div>
            <h2 className="text-lg font-semibold">
              {(selectedObject.properties.name as string) || selectedObject.uri}
            </h2>
            <p className="text-sm text-muted-foreground">
              {(selectedObject.properties.description as string) || 'No description'}
            </p>
          </div>
        </div>
        <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
          <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h3 className="font-display text-lg">Object Ecosystem</h3>
                <p className="text-xs text-muted-foreground">
                  States and transitions linked to this object.
                </p>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Layers className="h-4 w-4" />
                {ecosystem.nodes.length} nodes
              </div>
            </div>
            <div className="mb-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <div className="flex items-center gap-2">
                <span
                  className="h-0.5 w-6 border-t-2"
                  style={{
                    borderColor: 'var(--graph-edge-default)',
                    borderStyle: 'dashed',
                  }}
                />
                <span style={{ color: 'var(--graph-edge-label-default)' }}>Initial</span>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className="h-0.5 w-6 border-t-2"
                  style={{
                    borderColor: 'var(--graph-edge-transition)',
                    borderStyle: 'dashed',
                  }}
                />
                <span style={{ color: 'var(--graph-edge-label-transition)' }}>Transition</span>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className="h-0.5 w-6 border-t-2"
                  style={{
                    borderColor: 'var(--graph-edge-reference)',
                    borderStyle: 'dashed',
                  }}
                />
                <span style={{ color: 'var(--graph-edge-label-reference)' }}>Reference</span>
              </div>
            </div>
            <div className="h-[520px]">
              <ObjectStateGraph
                data={ecosystem}
                objectUri={selectedObject.uri}
                canAddInitialState={!hasInitialState}
                onAddInitialState={openInitialStateEditor}
                onAddFromState={openFromStateEditor}
                onSelectState={openEditStateEditor}
                onSelectTransition={openEditTransition}
                onCreateTransition={openCreateTransition}
              />
            </div>
          </div>
          <div className="grid gap-4">
            <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
              <h4 className="font-display text-base">Object Properties</h4>
              <div className="mt-3 space-y-2 text-sm text-muted-foreground">
                <p>URI: <span className="font-mono text-foreground">{selectedObject.uri}</span></p>
                <p>States: {edges.filter(edge => edge.type === 'hasPossibleState' && edge.fromUri === selectedObject.uri).length}</p>
                <p>Transitions: {edges.filter(edge => edge.type === 'transitionOf' && edge.toUri === selectedObject.uri).length}</p>
              </div>
            </div>
            <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
              <h4 className="font-display text-base">
                {transitionEditorOpen ? 'Transition Builder' : 'State Builder'}
              </h4>
              <p className="mt-2 text-xs text-muted-foreground">
                {transitionEditorOpen
                  ? 'Edit or create transitions between states.'
                  : 'Click the + icon on the object or a state to add a new state and transition.'}
              </p>
              {stateEditorOpen ? (
                <div className="mt-4 grid gap-3">
                  <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                    {stateEditorMode === 'editState' ? 'Edit State' : 'New State'}
                  </div>
                  <div className="grid gap-2">
                    <Label>State Name *</Label>
                    <Input
                      value={stateName}
                      onChange={(event) => setStateName(event.target.value)}
                      placeholder="Processing"
                      disabled={stateLoading}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label>Description</Label>
                    <Input
                      value={stateDescription}
                      onChange={(event) => setStateDescription(event.target.value)}
                      placeholder="Order is being prepared."
                      disabled={stateLoading}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label>Documentation</Label>
                    <Textarea
                      value={stateDocumentation}
                      onChange={(event) => setStateDocumentation(event.target.value)}
                      placeholder="Optional notes or documentation"
                      rows={2}
                      disabled={stateLoading}
                    />
                  </div>

                  {stateEditorMode === 'fromState' && (
                    <div className="grid gap-3 rounded-xl border border-border bg-muted/30 p-3">
                      <div className="text-xs text-muted-foreground">
                        Transition from: <span className="text-foreground">{(sourceState?.properties.name as string) || sourceState?.uri}</span>
                      </div>
                      <div className="grid gap-2">
                        <Label>Transition Name *</Label>
                        <Input
                          value={transitionName}
                          onChange={(event) => {
                            setTransitionName(event.target.value);
                            setTransitionAutoName(false);
                          }}
                          placeholder="Move to Processing"
                          disabled={stateLoading}
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label>Transition Description</Label>
                        <Input
                          value={transitionDescription}
                          onChange={(event) => setTransitionDescription(event.target.value)}
                          placeholder="Triggered when payment is confirmed."
                          disabled={stateLoading}
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label>Transition Documentation</Label>
                        <Textarea
                          value={transitionDocumentation}
                          onChange={(event) => setTransitionDocumentation(event.target.value)}
                          placeholder="Optional documentation for this transition."
                          rows={2}
                          disabled={stateLoading}
                        />
                      </div>
                    </div>
                  )}

                  {stateEditorMode === 'initial' && (
                    <div className="rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
                      This state will be set as the initial state for the object.
                    </div>
                  )}

                  {stateError && <p className="text-sm text-destructive">{stateError}</p>}
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setStateEditorOpen(false)}
                      disabled={stateLoading}
                    >
                      Cancel
                    </Button>
                    <Button type="button" onClick={handleCreateState} disabled={stateLoading}>
                      {stateLoading ? 'Saving...' : stateEditorMode === 'editState' ? 'Save Changes' : 'Create State'}
                    </Button>
                  </div>
                </div>
              ) : null}
              {transitionEditorOpen ? (
                <div className="mt-4 grid gap-3">
                  <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                    {transitionEditorMode === 'create' ? 'New Transition' : 'Edit Transition'}
                  </div>
                  <div className="grid gap-2">
                    <Label>Transition Name *</Label>
                    <Input
                      value={transitionEditName}
                      onChange={(event) => setTransitionEditName(event.target.value)}
                      placeholder="Approve Order"
                      disabled={transitionEditLoading}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label>Description</Label>
                    <Input
                      value={transitionEditDescription}
                      onChange={(event) => setTransitionEditDescription(event.target.value)}
                      placeholder="Triggered when payment clears."
                      disabled={transitionEditLoading}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label>Documentation</Label>
                    <Textarea
                      value={transitionEditDocumentation}
                      onChange={(event) => setTransitionEditDocumentation(event.target.value)}
                      placeholder="Optional documentation for this transition."
                      rows={2}
                      disabled={transitionEditLoading}
                    />
                  </div>
                  <div className="rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
                    From: <span className="text-foreground">{(transitionFrom?.properties.name as string) || transitionFrom?.uri || 'Unknown'}</span>
                    <br />
                    To: <span className="text-foreground">{(transitionTo?.properties.name as string) || transitionTo?.uri || 'Unknown'}</span>
                  </div>
                  {transitionEditError && <p className="text-sm text-destructive">{transitionEditError}</p>}
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setTransitionEditorOpen(false)}
                      disabled={transitionEditLoading}
                    >
                      Cancel
                    </Button>
                    <Button type="button" onClick={handleSaveTransition} disabled={transitionEditLoading}>
                      {transitionEditLoading
                        ? 'Saving...'
                        : transitionEditorMode === 'create'
                        ? 'Create Transition'
                        : 'Save Transition'}
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // List view
  return (
    <div className="flex flex-col gap-4 h-full">
      <div className="flex items-center justify-between rounded-2xl border border-border bg-card p-4 shadow-sm">
        <div>
          <h2 className="font-display text-lg">Object Models</h2>
          <p className="text-sm text-muted-foreground">
            Manage business object definitions and their state lifecycles
          </p>
        </div>
        <CreateObjectDialog onObjectCreated={handleChange} />
      </div>
      <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <ObjectList
            objects={objects}
            edges={edges}
            onViewDetails={handleSelectObject}
            onEdit={handleEdit}
          />
      </div>
      <EditObjectDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        object={editObject}
        nodes={nodes}
        edges={edges}
        onObjectUpdated={handleChange}
      />
    </div>
  );
}

type ObjectGraphEdge = OntologyEdge & { data?: { transitionUri?: string } };

const ACTION_LABELS = new Set(['Action', 'Process', 'Workflow']);
const EVENT_LABELS = new Set(['Signal', 'Transition']);
const OBJECT_LABEL = 'ObjectModel';
const TRIGGER_LABEL = 'EventTrigger';

function buildEcosystemGraph(
  objectNode: OntologyNode,
  allNodes: OntologyNode[],
  allEdges: OntologyEdge[]
): OntologyGraph {
  const nodeMap = new Map(allNodes.map((node) => [node.uri, node]));
  const selectedNodes = new Map<string, OntologyNode>();
  const selectedEdges: ObjectGraphEdge[] = [];
  const referenceEdges = buildReferenceEdges(allNodes, allEdges);

  const includeNode = (uri: string) => {
    const node = nodeMap.get(uri);
    if (node) {
      selectedNodes.set(uri, node);
    }
  };

  includeNode(objectNode.uri);

  const stateEdges = allEdges.filter(
    (edge) => edge.fromUri === objectNode.uri && edge.type === 'hasPossibleState'
  );
  stateEdges.forEach((edge) => {
    includeNode(edge.toUri);
  });

  const initialStateEdge = allEdges.find(
    (edge) => edge.fromUri === objectNode.uri && edge.type === 'initialState'
  );
  if (initialStateEdge) {
    selectedEdges.push(initialStateEdge);
  }

  const transitions = allEdges.filter(
    (edge) => edge.type === 'transitionOf' && edge.toUri === objectNode.uri
  );
  const transitionUris = transitions.map((edge) => edge.fromUri);
  transitionUris.forEach((transitionUri) => {
    const fromState = allEdges.find(
      (edge) => edge.fromUri === transitionUri && edge.type === 'fromState'
    )?.toUri;
    const toState = allEdges.find(
      (edge) => edge.fromUri === transitionUri && edge.type === 'toState'
    )?.toUri;
    if (fromState && toState) {
      includeNode(fromState);
      includeNode(toState);
      selectedEdges.push({
        fromUri: fromState,
        toUri: toState,
        type: 'transition',
        data: { transitionUri },
      });
    }
  });

  const referencedByObject = referenceEdges.filter(
    (edge) => edge.type === 'referencesObjectModel' && edge.toUri === objectNode.uri
  );
  const linkedNodes = referencedByObject
    .map((edge) => nodeMap.get(edge.fromUri))
    .filter(Boolean) as OntologyNode[];
  linkedNodes.forEach((node) => {
    if (ACTION_LABELS.has(node.label) || EVENT_LABELS.has(node.label)) {
      includeNode(node.uri);
    }
  });

  const linkedNodeUris = new Set(linkedNodes.map((node) => node.uri));
  referenceEdges.forEach((edge) => {
    if (linkedNodeUris.has(edge.fromUri)) {
      const targetNode = nodeMap.get(edge.toUri);
      if (targetNode && targetNode.label === OBJECT_LABEL) {
        includeNode(targetNode.uri);
      }
    }
  });

  const selectedNodeUris = new Set(selectedNodes.keys());
  referenceEdges.forEach((edge) => {
    if (selectedNodeUris.has(edge.fromUri) && selectedNodeUris.has(edge.toUri)) {
      selectedEdges.push(edge);
    }
  });

  const triggers = allNodes.filter((node) => node.label === TRIGGER_LABEL);
  const triggerUriSet = new Set(triggers.map((node) => node.uri));
  const listensToByTrigger = new Map<string, string>();
  const invokesByTrigger = new Map<string, string>();
  allEdges.forEach((edge) => {
    if (!triggerUriSet.has(edge.fromUri)) {
      return;
    }
    if (edge.type === 'listensTo') {
      listensToByTrigger.set(edge.fromUri, edge.toUri);
    }
    if (edge.type === 'invokes') {
      invokesByTrigger.set(edge.fromUri, edge.toUri);
    }
  });

  triggerUriSet.forEach((triggerUri) => {
    const eventUri = listensToByTrigger.get(triggerUri);
    const actionUri = invokesByTrigger.get(triggerUri);
    if (eventUri && actionUri && selectedNodeUris.has(eventUri) && selectedNodeUris.has(actionUri)) {
      selectedEdges.push({
        fromUri: eventUri,
        toUri: actionUri,
        type: 'eventTrigger',
      });
    }
  });

  return {
    nodes: Array.from(selectedNodes.values()),
    edges: selectedEdges as OntologyEdge[],
  };
}
