'use client';

import { useState, useEffect } from 'react';
import { ActionList } from '../lists/action-list';
import { CreateActionDialog } from '../dialogs/create-action-dialog';
import { EditActionDialog } from '../dialogs/edit-action-dialog';
import { getOntologyGraph } from '@/app/lib/api/ontology';
import { Loader2 } from 'lucide-react';
import type { OntologyEdge, OntologyNode } from '@/app/types/ontology';

interface ActionsTabProps {
  onRefresh?: () => void;
}

export function ActionsTab({ onRefresh }: ActionsTabProps) {
  const [actions, setActions] = useState<OntologyNode[]>([]);
  const [nodes, setNodes] = useState<OntologyNode[]>([]);
  const [edges, setEdges] = useState<OntologyEdge[]>([]);
  const [editOpen, setEditOpen] = useState(false);
  const [editAction, setEditAction] = useState<OntologyNode | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadActions = async () => {
    try {
      setLoading(true);
      setError(null);
      const graph = await getOntologyGraph();
      const data = graph.nodes.filter((node) =>
        ['Action', 'Process', 'Workflow'].includes(node.label)
      );
      setActions(data);
      setNodes(graph.nodes);
      setEdges(graph.edges);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load actions');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadActions();
  }, []);

  const handleChange = () => {
    loadActions();
    onRefresh?.();
  };

  const handleEdit = (action: OntologyNode) => {
    setEditAction(action);
    setEditOpen(true);
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-2">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Loading actions...</p>
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
          <h2 className="font-display text-lg">Actions</h2>
          <p className="text-sm text-muted-foreground">
            Define processes and workflows with explicit input and produced-event schemas.
          </p>
        </div>
        <CreateActionDialog onActionCreated={handleChange} />
      </div>
      <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <ActionList actions={actions} onEdit={handleEdit} />
      </div>
      <EditActionDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        action={editAction}
        nodes={nodes}
        edges={edges}
        onActionUpdated={handleChange}
      />
    </div>
  );
}
