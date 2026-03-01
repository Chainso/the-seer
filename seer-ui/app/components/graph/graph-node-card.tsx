'use client';

import type { ReactNode } from 'react';

import { Card } from '@/app/components/ui/card';

interface GraphNodeCardProps {
  header: ReactNode;
  headerRight?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  footer?: ReactNode;
  bgVar?: string;
  borderVar?: string;
  bgColor?: string;
  borderColor?: string;
  className?: string;
}

export function GraphNodeCard({
  header,
  headerRight,
  title,
  description,
  footer,
  bgVar,
  borderVar,
  bgColor,
  borderColor,
  className,
}: GraphNodeCardProps) {
  return (
    <Card
      className={`min-w-[160px] border-2 px-4 py-1.5 shadow-sm ${className ?? ''}`.trim()}
      style={{
        backgroundColor: bgColor ?? (bgVar ? `var(${bgVar})` : undefined),
        borderColor: borderColor ?? (borderVar ? `var(${borderVar})` : undefined),
      }}
    >
      <div className="flex items-center justify-between gap-2 leading-tight text-[0.65rem] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
        <span>{header}</span>
        {headerRight ? <span>{headerRight}</span> : null}
      </div>
      <div className="mt-0.5 leading-tight text-sm font-display">{title}</div>
      {description ? <div className="mt-0.5 max-w-[190px] truncate leading-tight text-xs text-muted-foreground">{description}</div> : null}
      {footer ? <div className="mt-0.5">{footer}</div> : null}
    </Card>
  );
}
