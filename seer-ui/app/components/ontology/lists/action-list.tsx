'use client';

import { useState } from 'react';
import { Table } from '@/app/components/ui/table';
import { Badge } from '@/app/components/ui/badge';
import { Input } from '@/app/components/ui/input';
import { Button } from '@/app/components/ui/button';
import { Search, Pencil } from 'lucide-react';
import type { OntologyNode } from '@/app/types/ontology';

interface ActionListProps {
  actions: OntologyNode[];
  onEdit: (action: OntologyNode) => void;
}

export function ActionList({ actions, onEdit }: ActionListProps) {
  const [search, setSearch] = useState('');

  const filteredActions = actions.filter((action) => {
    const name = (action.properties.name as string) || action.uri;
    const description = (action.properties.description as string) || '';
    return name.toLowerCase().includes(search.toLowerCase()) ||
           description.toLowerCase().includes(search.toLowerCase()) ||
           action.label.toLowerCase().includes(search.toLowerCase());
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search actions..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
        <span className="text-sm text-muted-foreground">
          {filteredActions.length} of {actions.length} actions
        </span>
      </div>

      <div className="border rounded-lg">
        <Table.Root>
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeaderCell>Name</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Type</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Description</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>URI</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell className="w-[120px]">Actions</Table.ColumnHeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {filteredActions.length === 0 ? (
              <Table.Row>
                <Table.Cell colSpan={5} className="py-8 text-center text-muted-foreground">
                  {search ? 'No actions match your search' : 'No actions yet'}
                </Table.Cell>
              </Table.Row>
            ) : (
              filteredActions.map((action) => {
                const name = (action.properties.name as string) || action.uri;
                const description = (action.properties.description as string) || '';
                return (
                  <Table.Row key={action.uri}>
                    <Table.RowHeaderCell className="font-display">{name}</Table.RowHeaderCell>
                    <Table.Cell>
                      <Badge variant="outline">
                        {action.label}
                      </Badge>
                    </Table.Cell>
                    <Table.Cell className="max-w-md truncate text-sm text-muted-foreground">
                      {description}
                    </Table.Cell>
                    <Table.Cell className="font-mono text-sm text-muted-foreground">
                      {action.uri}
                    </Table.Cell>
                    <Table.Cell>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onEdit(action)}
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
