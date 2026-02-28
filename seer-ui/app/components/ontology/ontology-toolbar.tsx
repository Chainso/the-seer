'use client';

import { useReactFlow } from '@xyflow/react';
import { Button } from '../ui/button';
import { ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';

export function OntologyToolbar() {
  const { zoomIn, zoomOut, fitView } = useReactFlow();

  return (
    <div className="absolute top-4 right-4 z-10 flex gap-2 rounded-full border border-border bg-card/90 p-2 shadow-sm backdrop-blur">
      <Button
        variant="outline"
        size="icon"
        onClick={() => zoomIn()}
        title="Zoom In"
      >
        <ZoomIn className="h-4 w-4" />
      </Button>
      <Button
        variant="outline"
        size="icon"
        onClick={() => zoomOut()}
        title="Zoom Out"
      >
        <ZoomOut className="h-4 w-4" />
      </Button>
      <Button
        variant="outline"
        size="icon"
        onClick={() => fitView()}
        title="Fit View"
      >
        <Maximize2 className="h-4 w-4" />
      </Button>
    </div>
  );
}
