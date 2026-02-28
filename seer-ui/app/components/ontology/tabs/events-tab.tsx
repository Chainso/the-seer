'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { EventList } from '../lists/event-list';
import { CreateEventDialog } from '../dialogs/create-event-dialog';
import { EditEventDialog } from '../dialogs/edit-event-dialog';
import { EditActionDialog } from '../dialogs/edit-action-dialog';
import { getOntologyGraph } from '@/app/lib/api/ontology';
import { Loader2 } from 'lucide-react';
import type { OntologyEdge, OntologyNode } from '@/app/types/ontology';

interface EventsTabProps {
  onRefresh?: () => void;
}

export function EventsTab({ onRefresh }: EventsTabProps) {
  const [events, setEvents] = useState<OntologyNode[]>([]);
  const [nodes, setNodes] = useState<OntologyNode[]>([]);
  const [edges, setEdges] = useState<OntologyEdge[]>([]);
  const [editOpen, setEditOpen] = useState(false);
  const [editEvent, setEditEvent] = useState<OntologyNode | null>(null);
  const [editActionOpen, setEditActionOpen] = useState(false);
  const [editAction, setEditAction] = useState<OntologyNode | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const loadEvents = async () => {
    try {
      setLoading(true);
      setError(null);
      const graph = await getOntologyGraph();
      const data = graph.nodes.filter((node) => ['Signal', 'Transition'].includes(node.label));
      setEvents(data);
      setNodes(graph.nodes);
      setEdges(graph.edges);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load events');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadEvents();
  }, []);

  const handleChange = () => {
    loadEvents();
    onRefresh?.();
  };

  const handleEdit = (event: OntologyNode) => {
    setEditEvent(event);
    setEditOpen(true);
  };

  const handleOpenAction = (action: OntologyNode) => {
    setEditAction(action);
    setEditActionOpen(true);
  };

  const handleOpenObject = (object: OntologyNode) => {
    router.push(`/ontology/objects?object=${encodeURIComponent(object.uri)}`);
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-2">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Loading events...</p>
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

  return (
    <div className="flex flex-col gap-4 h-full">
      <div className="flex items-center justify-between rounded-2xl border border-border bg-card p-4 shadow-sm">
        <div>
          <h2 className="font-display text-lg">Events</h2>
          <p className="text-sm text-muted-foreground">
            Signals and transitions are first-class events. Signals are edited directly; produced events are edited from their action.
          </p>
        </div>
        <CreateEventDialog onEventCreated={handleChange} />
      </div>
      <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <EventList
          events={events}
          nodes={nodes}
          edges={edges}
          onEdit={handleEdit}
          onOpenAction={handleOpenAction}
          onOpenObject={handleOpenObject}
        />
      </div>
      <EditEventDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        event={editEvent}
        nodes={nodes}
        edges={edges}
        onEventUpdated={handleChange}
      />
      <EditActionDialog
        open={editActionOpen}
        onOpenChange={setEditActionOpen}
        action={editAction}
        nodes={nodes}
        edges={edges}
        onActionUpdated={handleChange}
        defaultTab="event"
      />
    </div>
  );
}
