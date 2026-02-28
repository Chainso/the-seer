'use client';

import { useState, useEffect } from 'react';
import { TriggerList } from '../lists/trigger-list';
import { CreateTriggerDialog } from '../dialogs/create-trigger-dialog';
import { EditTriggerDialog } from '../dialogs/edit-trigger-dialog';
import { getOntologyGraph } from '@/app/lib/api/ontology';
import { Loader2 } from 'lucide-react';
import type { OntologyEdge, OntologyNode } from '@/app/types/ontology';

interface EventTriggersTabProps {
  onRefresh?: () => void;
}

export function EventTriggersTab({ onRefresh }: EventTriggersTabProps) {
  const [triggers, setTriggers] = useState<OntologyNode[]>([]);
  const [nodes, setNodes] = useState<OntologyNode[]>([]);
  const [edges, setEdges] = useState<OntologyEdge[]>([]);
  const [editOpen, setEditOpen] = useState(false);
  const [editTrigger, setEditTrigger] = useState<OntologyNode | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadTriggers = async () => {
    try {
      setLoading(true);
      setError(null);
      const graph = await getOntologyGraph();

      const triggerNodes = graph.nodes.filter((node) => node.label === 'EventTrigger');
      setTriggers(triggerNodes);
      setNodes(graph.nodes);
      setEdges(graph.edges);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load triggers');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTriggers();
  }, []);

  const handleChange = () => {
    loadTriggers();
    onRefresh?.();
  };

  const handleEdit = (trigger: OntologyNode) => {
    setEditTrigger(trigger);
    setEditOpen(true);
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-2">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Loading event triggers...</p>
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
          <h2 className="font-display text-lg">Event Triggers</h2>
          <p className="text-sm text-muted-foreground">
            Bind signals and transitions to actions with a closed, validated trigger.
          </p>
        </div>
        <CreateTriggerDialog onTriggerCreated={handleChange} />
      </div>
      <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <TriggerList triggers={triggers} nodes={nodes} edges={edges} onEdit={handleEdit} />
      </div>
      <EditTriggerDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        trigger={editTrigger}
        nodes={nodes}
        edges={edges}
        onTriggerUpdated={handleChange}
      />
    </div>
  );
}
