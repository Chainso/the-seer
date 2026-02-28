'use client';

import { useState, useEffect } from 'react';
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
import { Plus } from 'lucide-react';
import { createEventTrigger, getNodesByLabel } from '@/app/lib/api/ontology';
import type { OntologyNode } from '@/app/types/ontology';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/app/components/ui/tabs';
import { SearchableSelect } from '@/app/components/ui/searchable-select';

interface CreateTriggerDialogProps {
  onTriggerCreated: () => void;
}

const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

export function CreateTriggerDialog({ onTriggerCreated }: CreateTriggerDialogProps) {
  const [open, setOpen] = useState(false);
  const [eventUri, setEventUri] = useState('');
  const [actionUri, setActionUri] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [events, setEvents] = useState<OntologyNode[]>([]);
  const [actions, setActions] = useState<OntologyNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load events and actions when dialog opens
  useEffect(() => {
    if (open) {
      Promise.all([
        getNodesByLabel(['Signal', 'Transition']),
        getNodesByLabel(['Action', 'Process', 'Workflow']),
      ]).then(([eventsData, actionsData]) => {
        setEvents(eventsData);
        setActions(actionsData);
      });
    }
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

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

      await createEventTrigger({
        uri: slugify(name),
        name: name.trim(),
        description: description.trim() || undefined,
        listensToUri: eventUri,
        invokesUri: actionUri,
      });

      // Reset form
      setEventUri('');
      setActionUri('');
      setName('');
      setDescription('');
      setOpen(false);

      // Notify parent to refresh
      onTriggerCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create trigger');
    } finally {
      setLoading(false);
    }
  };

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

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="h-4 w-4 mr-2" />
          New Trigger
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px] max-h-[85vh] overflow-y-auto">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle className="font-display text-xl">Create Event Trigger</DialogTitle>
            <DialogDescription>
              Link an event to an action. When the event occurs, the action will be triggered.
            </DialogDescription>
          </DialogHeader>
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
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={loading}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? 'Creating...' : 'Create Trigger'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
