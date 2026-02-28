'use client';

import { useState } from 'react';
import { Table } from '@/app/components/ui/table';
import { Badge } from '@/app/components/ui/badge';
import { Input } from '@/app/components/ui/input';
import { Button } from '@/app/components/ui/button';
import { Search, Eye, Pencil } from 'lucide-react';
import type { OntologyNode, OntologyEdge } from '@/app/types/ontology';

interface ObjectListProps {
  objects: OntologyNode[];
  edges: OntologyEdge[];
  onViewDetails: (object: OntologyNode) => void;
  onEdit: (object: OntologyNode) => void;
}

export function ObjectList({ objects, edges, onViewDetails, onEdit }: ObjectListProps) {
  const [search, setSearch] = useState('');

  const filteredObjects = objects.filter((obj) => {
    const name = (obj.properties.name as string) || obj.uri;
    const description = (obj.properties.description as string) || '';
    return name.toLowerCase().includes(search.toLowerCase()) ||
           description.toLowerCase().includes(search.toLowerCase());
  });

  const getStateCount = (objectUri: string) => {
    return edges.filter(edge =>
      edge.fromUri === objectUri && edge.type === 'hasPossibleState'
    ).length;
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search object models..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
        <span className="text-sm text-muted-foreground">
          {filteredObjects.length} of {objects.length} object models
        </span>
      </div>

      <div className="border rounded-lg">
        <Table.Root>
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeaderCell>Name</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Description</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>States</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell className="w-[180px]">Actions</Table.ColumnHeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {filteredObjects.length === 0 ? (
              <Table.Row>
                <Table.Cell colSpan={4} className="py-8 text-center text-muted-foreground">
                  {search ? 'No object models match your search' : 'No object models yet'}
                </Table.Cell>
              </Table.Row>
            ) : (
              filteredObjects.map((obj) => {
                const name = (obj.properties.name as string) || obj.uri;
                const description = (obj.properties.description as string) || '';
                const stateCount = getStateCount(obj.uri);

                return (
                  <Table.Row key={obj.uri}>
                    <Table.RowHeaderCell className="font-display">{name}</Table.RowHeaderCell>
                    <Table.Cell className="max-w-md truncate text-sm text-muted-foreground">
                      {description || '-'}
                    </Table.Cell>
                    <Table.Cell>
                      <Badge variant="secondary">{stateCount} states</Badge>
                    </Table.Cell>
                    <Table.Cell>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onViewDetails(obj)}
                        >
                          <Eye className="h-4 w-4 mr-1" />
                          View
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => onEdit(obj)}
                        >
                          <Pencil className="h-3 w-3 mr-1" />
                          Edit
                        </Button>
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
