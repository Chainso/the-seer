'use client';

import { useState } from 'react';
import { Table } from '@/app/components/ui/table';
import { Input } from '@/app/components/ui/input';
import { Search, ArrowRight, Pencil } from 'lucide-react';
import { Button } from '@/app/components/ui/button';
import type { OntologyEdge, OntologyNode } from '@/app/types/ontology';

interface TriggerListProps {
  triggers: OntologyNode[];
  nodes: OntologyNode[];
  edges: OntologyEdge[];
  onEdit: (trigger: OntologyNode) => void;
}

export function TriggerList({ triggers, nodes, edges, onEdit }: TriggerListProps) {
  const [search, setSearch] = useState('');

  // Create lookup for node details
  const nodeMap = new Map(nodes.map(n => [n.uri, n]));
  const edgeMap = new Map(edges.map(edge => [`${edge.fromUri}-${edge.type}`, edge.toUri]));

  const filteredTriggers = triggers.filter((trigger) => {
    const eventUri = edgeMap.get(`${trigger.uri}-listensTo`);
    const actionUri = edgeMap.get(`${trigger.uri}-invokes`);
    const eventNode = eventUri ? nodeMap.get(eventUri) : undefined;
    const actionNode = actionUri ? nodeMap.get(actionUri) : undefined;
    const eventName = (eventNode?.properties.name as string) || eventUri || '';
    const actionName = (actionNode?.properties.name as string) || actionUri || '';

    return eventName.toLowerCase().includes(search.toLowerCase()) ||
           actionName.toLowerCase().includes(search.toLowerCase());
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search triggers..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
        <span className="text-sm text-muted-foreground">
          {filteredTriggers.length} of {triggers.length} triggers
        </span>
      </div>

      <div className="border rounded-lg">
        <Table.Root>
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeaderCell>Event</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell className="w-[50px]">
                <span className="sr-only">Direction</span>
              </Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Action</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell className="w-[160px]">Trigger</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell className="w-[120px]">Actions</Table.ColumnHeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {filteredTriggers.length === 0 ? (
              <Table.Row>
                <Table.Cell colSpan={5} className="py-8 text-center text-muted-foreground">
                  {search ? 'No triggers match your search' : 'No event triggers yet'}
                </Table.Cell>
              </Table.Row>
            ) : (
              filteredTriggers.map((trigger) => {
                const eventUri = edgeMap.get(`${trigger.uri}-listensTo`);
                const actionUri = edgeMap.get(`${trigger.uri}-invokes`);
                const eventNode = eventUri ? nodeMap.get(eventUri) : undefined;
                const actionNode = actionUri ? nodeMap.get(actionUri) : undefined;
                const eventName = (eventNode?.properties.name as string) || eventUri || 'Unknown event';
                const actionName = (actionNode?.properties.name as string) || actionUri || 'Unknown action';

                return (
                  <Table.Row key={trigger.uri}>
                    <Table.RowHeaderCell>
                      <div className="flex flex-col">
                        <span className="font-display">{eventName}</span>
                        <span className="text-xs text-muted-foreground">{eventNode?.label || 'Event'}</span>
                      </div>
                    </Table.RowHeaderCell>
                    <Table.Cell className="text-center">
                      <ArrowRight className="h-4 w-4 text-muted-foreground" />
                    </Table.Cell>
                    <Table.Cell>
                      <div className="flex flex-col">
                        <span className="font-display">{actionName}</span>
                        <span className="text-xs text-muted-foreground">{actionNode?.label || 'Action'}</span>
                      </div>
                    </Table.Cell>
                    <Table.Cell>
                      <div className="flex flex-col">
                        <span className="font-display">{(trigger.properties.name as string) || trigger.uri}</span>
                        <span className="text-xs text-muted-foreground">EventTrigger</span>
                      </div>
                    </Table.Cell>
                    <Table.Cell>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onEdit(trigger)}
                      >
                        <Pencil className="h-3 w-3 mr-1" />
                        Edit
                      </Button>
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
