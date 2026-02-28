'use client';

import { useState } from 'react';
import { Table } from '@/app/components/ui/table';
import { Badge } from '@/app/components/ui/badge';
import { Input } from '@/app/components/ui/input';
import { Search, Pencil } from 'lucide-react';
import type { OntologyEdge, OntologyNode } from '@/app/types/ontology';
import { Button } from '@/app/components/ui/button';

interface EventListProps {
  events: OntologyNode[];
  nodes: OntologyNode[];
  edges: OntologyEdge[];
  onEdit: (event: OntologyNode) => void;
  onOpenAction?: (action: OntologyNode) => void;
  onOpenObject?: (object: OntologyNode) => void;
}

const EVENT_TYPE_COLORS: Record<string, string> = {
  Signal: 'bg-blue-100 text-blue-700 border-blue-200',
  Transition: 'bg-emerald-100 text-emerald-700 border-emerald-200',
};

export function EventList({
  events,
  nodes,
  edges,
  onEdit,
  onOpenAction,
  onOpenObject,
}: EventListProps) {
  const [search, setSearch] = useState('');

  const nodeMap = new Map(nodes.map((node) => [node.uri, node]));

  const filteredEvents = events.filter((event) => {
    const name = (event.properties.name as string) || event.uri;
    return name.toLowerCase().includes(search.toLowerCase()) ||
           event.label.toLowerCase().includes(search.toLowerCase());
  });

  const findProducingAction = (eventUri: string) => {
    const actionUri = edges.find(
      (edge) => edge.type === 'producesEvent' && edge.toUri === eventUri
    )?.fromUri;
    return actionUri ? nodeMap.get(actionUri) : undefined;
  };

  const findObjectForTransition = (transitionUri: string) => {
    const objectUri = edges.find(
      (edge) => edge.type === 'transitionOf' && edge.fromUri === transitionUri
    )?.toUri;
    return objectUri ? nodeMap.get(objectUri) : undefined;
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search events..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
        <span className="text-sm text-muted-foreground">
          {filteredEvents.length} of {events.length} events
        </span>
      </div>

      <div className="border rounded-lg">
        <Table.Root>
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeaderCell>Name</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Type</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Managed In</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>URI</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell className="w-[120px]">Actions</Table.ColumnHeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {filteredEvents.length === 0 ? (
              <Table.Row>
                <Table.Cell colSpan={5} className="py-8 text-center text-muted-foreground">
                  {search ? 'No events match your search' : 'No events yet'}
                </Table.Cell>
              </Table.Row>
            ) : (
              filteredEvents.map((event) => {
                const name = (event.properties.name as string) || event.uri;
                const actionNode = findProducingAction(event.uri);
                const objectNode = event.label === 'Transition' ? findObjectForTransition(event.uri) : undefined;
                const managedLabel = (() => {
                  if (event.label === 'Transition') {
                    const objectName = (objectNode?.properties.name as string) || objectNode?.uri || 'Unknown';
                    const actionName = (actionNode?.properties.name as string) || actionNode?.uri || 'Unknown';
                    return actionNode ? `Object: ${objectName} · Action: ${actionName}` : `Object: ${objectName}`;
                  }
                  if (actionNode) {
                    return `Action: ${(actionNode.properties.name as string) || actionNode.uri}`;
                  }
                  return 'Signals';
                })();

                return (
                  <Table.Row key={event.uri}>
                    <Table.RowHeaderCell className="font-display">{name}</Table.RowHeaderCell>
                    <Table.Cell>
                      <Badge variant="outline" className={EVENT_TYPE_COLORS[event.label] || ''}>
                        {event.label}
                      </Badge>
                    </Table.Cell>
                    <Table.Cell className="text-sm text-muted-foreground">
                      {managedLabel}
                    </Table.Cell>
                    <Table.Cell className="font-mono text-sm text-muted-foreground">
                      {event.uri}
                    </Table.Cell>
                    <Table.Cell>
                      <div className="flex items-center gap-2">
                        {event.label === 'Signal' && !actionNode && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => onEdit(event)}
                          >
                            <Pencil className="h-3 w-3 mr-1" />
                            Edit
                          </Button>
                        )}
                        {actionNode && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => onOpenAction?.(actionNode)}
                          >
                            Open Action
                          </Button>
                        )}
                        {event.label === 'Transition' && objectNode && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => onOpenObject?.(objectNode)}
                          >
                            Open Object
                          </Button>
                        )}
                        {event.label !== 'Signal' && !actionNode && !objectNode && (
                          <span className="text-xs text-muted-foreground">Managed elsewhere</span>
                        )}
                      </div>
                    </Table.Cell>
                  </Table.Row>
                );
              })
            )}
          </Table.Body>
        </Table.Root>
      </div>
    </div>
  );
}
