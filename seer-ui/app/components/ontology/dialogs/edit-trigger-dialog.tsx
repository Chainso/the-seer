'use client';

import { useEffect, useState } from 'react';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/app/components/ui/tabs';
import { updateEventTriggerDefinition } from '@/app/lib/api/ontology';
import type { OntologyEdge, OntologyNode } from '@/app/types/ontology';
import { mapTriggerDefinition } from '@/app/lib/ontology-helpers';
import { SearchableSelect } from '@/app/components/ui/searchable-select';

interface EditTriggerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: OntologyNode | null;
  nodes: OntologyNode[];
  edges: OntologyEdge[];
  onTriggerUpdated: () => void;
}

export function EditTriggerDialog({
  open,
  onOpenChange,
  trigger,
  nodes,
  edges,
  onTriggerUpdated,
}: EditTriggerDialogProps) {
  const [eventUri, setEventUri] = useState('');
  const [actionUri, setActionUri] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !trigger) {
      return;
    }

    const definition = mapTriggerDefinition(trigger.uri, nodes, edges);
    setName(definition.name);
    setDescription(definition.description || '');
    setEventUri(definition.listensToUri);
    setActionUri(definition.invokesUri);
    setError(null);
  }, [open, trigger, nodes, edges]);

  const events = nodes.filter((node) => ['Signal', 'Transition'].includes(node.label));
  const actions = nodes.filter((node) => ['Action', 'Process', 'Workflow'].includes(node.label));
  const eventGroups = [
    {
      label: 'Signals',
      options: events
        .filter((event) => event.label === 'Signal')
        .map((event) => ({
          value: event.uri,
          label: (event.properties.name as string) || event.uri,
          description: 'Signal',
        })),
    },
    {
      label: 'Transitions',
      options: events
        .filter((event) => event.label === 'Transition')
        .map((event) => ({
          value: event.uri,
          label: (event.properties.name as string) || event.uri,
          description: 'Transition',
        })),
    },
  ].filter((group) => group.options.length > 0);

  const actionGroups = [
    {
      label: 'Actions',
      options: actions
        .filter((action) => action.label === 'Action')
        .map((action) => ({
          value: action.uri,
          label: (action.properties.name as string) || action.uri,
          description: 'Action',
        })),
    },
    {
      label: 'Processes',
      options: actions
        .filter((action) => action.label === 'Process')
        .map((action) => ({
          value: action.uri,
          label: (action.properties.name as string) || action.uri,
          description: 'Process',
        })),
    },
    {
      label: 'Workflows',
      options: actions
        .filter((action) => action.label === 'Workflow')
        .map((action) => ({
          value: action.uri,
          label: (action.properties.name as string) || action.uri,
          description: 'Workflow',
        })),
    },
  ].filter((group) => group.options.length > 0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!trigger) {
      return;
    }

    if (!name.trim()) {
      setError('Name is required');
      return;
    }

    if (!eventUri) {
      setError('Event is required');
      return;
    }

    if (!actionUri) {
      setError('Action is required');
      return;
    }

    try {
      setLoading(true);
      setError(null);

      await updateEventTriggerDefinition(trigger.uri, {
        name: name.trim(),
        description: description.trim() || undefined,
        listensToUri: eventUri,
        invokesUri: actionUri,
      });

      onOpenChange(false);
      onTriggerUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update trigger');
    } finally {
      setLoading(false);
    }
  };

  const nodeMap = new Map(nodes.map((node) => [node.uri, node]));
  const eventNode = nodeMap.get(eventUri);
  const actionNode = nodeMap.get(actionUri);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] max-h-[85vh] overflow-y-auto">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle className="font-display text-xl">Edit Event Trigger</DialogTitle>
            <DialogDescription>
              Update the event-to-action mapping.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4 grid gap-3 rounded-2xl border border-border bg-muted/40 p-4 text-sm">
            <div>
              <h4 className="font-display text-base">Dependencies</h4>
              <p className="text-xs text-muted-foreground">
                This trigger connects an event to an action.
              </p>
            </div>
            <div className="grid gap-2 text-sm">
              <p>
                <span className="text-muted-foreground">When Event:</span>{' '}
                {(eventNode?.properties.name as string) || eventNode?.uri || 'Select an event'}
              </p>
              <p>
                <span className="text-muted-foreground">Invokes Action:</span>{' '}
                {(actionNode?.properties.name as string) || actionNode?.uri || 'Select an action'}
              </p>
            </div>
          </div>
          <Tabs defaultValue="basics" className="mt-4">
            <TabsList className="h-10">
              <TabsTrigger value="basics">Basics</TabsTrigger>
              <TabsTrigger value="mapping">Mapping</TabsTrigger>
            </TabsList>
            <TabsContent value="basics" className="mt-4 space-y-4">
              <div className="grid gap-2">
                <Label htmlFor="trigger-name">Trigger Name *</Label>
                <Input
                  id="trigger-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="OnOrderReceived"
                  disabled={loading}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="trigger-description">Description</Label>
                <Input
                  id="trigger-description"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="Dispatch process-order when order-received arrives."
                  disabled={loading}
                />
              </div>
            </TabsContent>
            <TabsContent value="mapping" className="mt-4 space-y-4">
              <div className="grid gap-2">
                <Label htmlFor="event">When Event *</Label>
                <SearchableSelect
                  value={eventUri}
                  onValueChange={setEventUri}
                  groups={eventGroups}
                  placeholder="Select an event..."
                  searchPlaceholder="Search events..."
                  disabled={loading}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="action">Trigger Action *</Label>
                <SearchableSelect
                  value={actionUri}
                  onValueChange={setActionUri}
                  groups={actionGroups}
                  placeholder="Select an action..."
                  searchPlaceholder="Search actions..."
                  disabled={loading}
                />
              </div>
              <div className="rounded-lg bg-muted p-3 text-sm">
                <p className="text-muted-foreground">
                  <strong>Relationship:</strong> When the selected event occurs, it will trigger the selected action to be executed.
                </p>
              </div>
            </TabsContent>
          </Tabs>
          {error && (
            <p className="text-sm text-destructive mt-4">{error}</p>
          )}
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
    </Dialog>
  );
}
