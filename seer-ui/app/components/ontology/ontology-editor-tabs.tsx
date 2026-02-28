'use client';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/app/components/ui/tabs';
import { OntologyGraphVisualization } from './ontology-graph';
import { EventsTab } from './tabs/events-tab';
import { ActionsTab } from './tabs/actions-tab';
import { EventTriggersTab } from './tabs/event-triggers-tab';
import { ObjectsTab } from './tabs/objects-tab';
import type { OntologyGraph } from '@/app/types/ontology';
import type { OntologyNode } from '@/app/types/ontology';
import { useMemo, useState } from 'react';
import { buildReferenceEdges } from './graph-reference-edges';
import { EditObjectDialog } from './dialogs/edit-object-dialog';
import { EditActionDialog } from './dialogs/edit-action-dialog';
import { EditEventDialog } from './dialogs/edit-event-dialog';
import { CreateObjectDialog } from './dialogs/create-object-dialog';

/**
 * Main tab container for the ontology editor
 * Provides navigation between Overview, Objects, Actions, Events, and Event Triggers
 */
interface OntologyEditorTabsProps {
  graphData: OntologyGraph;
  onRefresh: () => void;
  activeTab?: string;
  onTabChange?: (tab: string) => void;
  objectUri?: string | null;
  onSelectObjectUri?: (objectUri: string | null) => void;
}

export function OntologyEditorTabs({
  graphData,
  onRefresh,
  activeTab,
  onTabChange,
  objectUri,
  onSelectObjectUri,
}: OntologyEditorTabsProps) {
  const [quickEditObject, setQuickEditObject] = useState<OntologyNode | null>(null);
  const [quickEditAction, setQuickEditAction] = useState<OntologyNode | null>(null);
  const [quickEditEvent, setQuickEditEvent] = useState<OntologyNode | null>(null);
  const [actionDialogOpen, setActionDialogOpen] = useState(false);
  const [objectDialogOpen, setObjectDialogOpen] = useState(false);
  const [eventDialogOpen, setEventDialogOpen] = useState(false);
  const [actionDialogTab, setActionDialogTab] = useState<'basics' | 'input' | 'event'>('basics');

  const overviewGraph = useMemo(() => {
    const allowedLabels = new Set([
      'ObjectModel',
      'Action',
      'Process',
      'Workflow',
      'Signal',
      'Transition',
    ]);
    const nodes = graphData.nodes.filter((node) => allowedLabels.has(node.label));
    const nodeUris = new Set(nodes.map((node) => node.uri));
    const edges = graphData.edges.filter(
      (edge) => nodeUris.has(edge.fromUri) && nodeUris.has(edge.toUri)
    );
    const referenceEdges = buildReferenceEdges(nodes, graphData.edges);
    const edgeKey = new Set(edges.map((edge) => `${edge.fromUri}|${edge.type}|${edge.toUri}`));
    const triggerNodes = graphData.nodes.filter((node) => node.label === 'EventTrigger');
    const triggerUris = new Set(triggerNodes.map((node) => node.uri));
    const listensToByTrigger = new Map<string, string>();
    const invokesByTrigger = new Map<string, string>();
    graphData.edges.forEach((edge) => {
      if (!triggerUris.has(edge.fromUri)) {
        return;
      }
      if (edge.type === 'listensTo') {
        listensToByTrigger.set(edge.fromUri, edge.toUri);
      }
      if (edge.type === 'invokes') {
        invokesByTrigger.set(edge.fromUri, edge.toUri);
      }
    });
    const triggerEdges = Array.from(triggerUris).flatMap((triggerUri) => {
      const eventUri = listensToByTrigger.get(triggerUri);
      const actionUri = invokesByTrigger.get(triggerUri);
      if (!eventUri || !actionUri) {
        return [];
      }
      if (!nodeUris.has(eventUri) || !nodeUris.has(actionUri)) {
        return [];
      }
      return [
        {
          fromUri: eventUri,
          toUri: actionUri,
          type: 'eventTrigger',
        },
      ];
    });
    const combinedEdges = [
      ...edges,
      ...referenceEdges.filter(
        (edge) => !edgeKey.has(`${edge.fromUri}|${edge.type}|${edge.toUri}`)
      ),
      ...triggerEdges.filter(
        (edge) => !edgeKey.has(`${edge.fromUri}|${edge.type}|${edge.toUri}`)
      ),
    ];
    return { nodes, edges: combinedEdges } satisfies OntologyGraph;
  }, [graphData]);

  const handleGraphNodeSelect = (nodeUri: string) => {
    const node = graphData.nodes.find((entry) => entry.uri === nodeUri);
    if (!node) {
      return;
    }

    if (node.label === 'ObjectModel') {
      setQuickEditObject(node);
      setObjectDialogOpen(true);
      return;
    }

    if (['Action', 'Process', 'Workflow'].includes(node.label)) {
      setQuickEditAction(node);
      setActionDialogTab('basics');
      setActionDialogOpen(true);
      return;
    }

    if (node.label === 'Signal' || node.label === 'Transition') {
      const actionUri = graphData.edges.find(
        (edge) => edge.type === 'producesEvent' && edge.toUri === node.uri
      )?.fromUri;
      const actionNode = graphData.nodes.find((entry) => entry.uri === actionUri);
      if (actionNode) {
        setQuickEditAction(actionNode);
        setActionDialogTab('event');
        setActionDialogOpen(true);
        return;
      }
    }

    if (node.label === 'Signal') {
      setQuickEditEvent(node);
      setEventDialogOpen(true);
      return;
    }
  };

  const isControlled = Boolean(activeTab);

  const tabsProps = isControlled
    ? { value: activeTab, onValueChange: onTabChange }
    : { defaultValue: 'overview' };

  return (
    <Tabs {...tabsProps} className="flex flex-col h-full">
      <div className="rounded-2xl border border-border bg-card px-4 py-3 shadow-sm">
        <TabsList className="h-12 bg-transparent">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="objects">Object Models</TabsTrigger>
          <TabsTrigger value="actions">Actions</TabsTrigger>
          <TabsTrigger value="events">Events</TabsTrigger>
          <TabsTrigger value="triggers">Event Triggers</TabsTrigger>
        </TabsList>
      </div>

      <div className="flex-1 overflow-hidden">
        <TabsContent value="overview" className="h-full m-0 mt-4">
          <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
            <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <h2 className="font-display text-lg">Ontology Graph</h2>
                  <p className="text-sm text-muted-foreground">
                    {overviewGraph.nodes.length} nodes, {overviewGraph.edges.length} edges
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
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
                        borderStyle: 'dotted',
                      }}
                    />
                    <span style={{ color: 'var(--graph-edge-label-reference)' }}>Trigger</span>
                  </div>
                </div>
              </div>
              <div className="h-[520px]">
                <OntologyGraphVisualization data={overviewGraph} onNodeSelect={handleGraphNodeSelect} />
              </div>
            </div>
            <div className="grid gap-4">
              <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
                <h3 className="font-display text-base">Quick Create</h3>
                <p className="text-xs text-muted-foreground">
                  Jump straight into the core concepts.
                </p>
                <div className="mt-4">
                  <CreateObjectDialog onObjectCreated={onRefresh} />
                </div>
                <div className="mt-4 space-y-2 text-sm text-muted-foreground">
                  <p>Use the tabs to create object models, signals, and actions with full schema control.</p>
                  <p>Event triggers connect signals to actions and appear in the ecosystem view.</p>
                </div>
              </div>
              <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
                <h3 className="font-display text-base">Design Notes</h3>
                <p className="text-xs text-muted-foreground">
                  Keep the ontology closed and consistent. Properties are validated on save.
                </p>
              </div>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="objects" className="h-full m-0 mt-4">
          <ObjectsTab
            onRefresh={onRefresh}
            selectedObjectUri={objectUri || undefined}
            onSelectObjectUri={onSelectObjectUri}
          />
        </TabsContent>

        <TabsContent value="actions" className="h-full m-0 mt-4">
          <ActionsTab onRefresh={onRefresh} />
        </TabsContent>

        <TabsContent value="events" className="h-full m-0 mt-4">
          <EventsTab onRefresh={onRefresh} />
        </TabsContent>

        <TabsContent value="triggers" className="h-full m-0 mt-4">
          <EventTriggersTab onRefresh={onRefresh} />
        </TabsContent>
      </div>

      <EditObjectDialog
        open={objectDialogOpen}
        onOpenChange={(open) => {
          setObjectDialogOpen(open);
          if (!open) {
            setQuickEditObject(null);
          }
        }}
        object={quickEditObject}
        nodes={graphData.nodes}
        edges={graphData.edges}
        onObjectUpdated={onRefresh}
      />
      <EditActionDialog
        open={actionDialogOpen}
        onOpenChange={(open) => {
          setActionDialogOpen(open);
          if (!open) {
            setQuickEditAction(null);
          }
        }}
        action={quickEditAction}
        nodes={graphData.nodes}
        edges={graphData.edges}
        onActionUpdated={onRefresh}
        defaultTab={actionDialogTab}
      />
      <EditEventDialog
        open={eventDialogOpen}
        onOpenChange={(open) => {
          setEventDialogOpen(open);
          if (!open) {
            setQuickEditEvent(null);
          }
        }}
        event={quickEditEvent}
        nodes={graphData.nodes}
        edges={graphData.edges}
        onEventUpdated={onRefresh}
      />
    </Tabs>
  );
}
