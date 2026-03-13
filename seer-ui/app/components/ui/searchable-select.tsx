'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import { cn } from '@/app/lib/utils';
import { Input } from '@/app/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/app/components/ui/dropdown-menu';

export interface SearchableSelectOption {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
}

export interface SearchableSelectGroup {
  label: string;
  options: SearchableSelectOption[];
}

interface SearchableSelectProps {
  value: string;
  onValueChange: (value: string) => void;
  groups: SearchableSelectGroup[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  disabled?: boolean;
  className?: string;
  triggerId?: string;
}

export function SearchableSelect({
  value,
  onValueChange,
  groups,
  placeholder = 'Select...',
  searchPlaceholder = 'Search...',
  emptyMessage = 'No matches found.',
  disabled,
  className,
  triggerId,
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [triggerWidth, setTriggerWidth] = useState<number | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const flatOptions = useMemo(
    () => groups.flatMap((group) => group.options),
    [groups]
  );
  const selectedOption = flatOptions.find((option) => option.value === value);

  const filteredGroups = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) {
      return groups.filter((group) => group.options.length > 0);
    }
    return groups
      .map((group) => ({
        ...group,
        options: group.options.filter((option) => {
          const label = option.label.toLowerCase();
          const description = option.description?.toLowerCase() ?? '';
          return label.includes(query) || description.includes(query);
        }),
      }))
      .filter((group) => group.options.length > 0);
  }, [groups, search]);

  const handleSelect = (nextValue: string) => {
    onValueChange(nextValue);
    setOpen(false);
    setSearch('');
  };

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      setSearch('');
    }
  };

  useEffect(() => {
    const node = triggerRef.current;
    if (!node) {
      return;
    }

    const updateWidth = () => {
      setTriggerWidth(node.offsetWidth || null);
    };

    updateWidth();

    const observer = new ResizeObserver(() => {
      updateWidth();
    });
    observer.observe(node);

    return () => {
      observer.disconnect();
    };
  }, []);

  return (
    <DropdownMenu open={open} onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger asChild>
        <button
          ref={triggerRef}
          id={triggerId}
          type="button"
          className={cn(
            "border-input data-[placeholder]:text-muted-foreground [&_svg:not([class*='text-'])]:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:bg-input/30 dark:hover:bg-input/50 flex h-9 w-full items-center justify-between gap-2 rounded-md border bg-transparent px-3 py-2 text-sm whitespace-nowrap shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50",
            className
          )}
          disabled={disabled}
        >
          <span className={cn('truncate', !selectedOption && 'text-muted-foreground')}>
            {selectedOption?.label ?? placeholder}
          </span>
          <ChevronDown className="h-4 w-4 opacity-60" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="min-w-[8rem] p-0"
        style={triggerWidth ? { minWidth: `${triggerWidth}px` } : undefined}
      >
        <div className="border-b border-border p-2">
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={searchPlaceholder}
            className="h-8"
            autoFocus
          />
        </div>
        <div className="max-h-64 overflow-y-auto p-2">
          {filteredGroups.length === 0 ? (
            <div className="px-2 py-3 text-sm text-muted-foreground">{emptyMessage}</div>
          ) : (
            filteredGroups.map((group, groupIndex) => (
              <div key={`${group.label}-${groupIndex}`} className="space-y-1">
                <DropdownMenuLabel className="text-[0.6rem] uppercase tracking-[0.2em] text-muted-foreground">
                  {group.label}
                </DropdownMenuLabel>
                {group.options.map((option) => {
                  const isSelected = option.value === value;
                  return (
                    <DropdownMenuItem
                      key={option.value}
                      onSelect={() => handleSelect(option.value)}
                      disabled={option.disabled}
                      className="gap-2"
                    >
                      <Check
                        className={cn(
                          'h-3.5 w-3.5 text-primary',
                          isSelected ? 'opacity-100' : 'opacity-0'
                        )}
                      />
                      <div className="flex flex-col">
                        <span className={cn(isSelected && 'font-semibold')}>
                          {option.label}
                        </span>
                        {option.description && (
                          <span className="text-xs text-muted-foreground">{option.description}</span>
                        )}
                      </div>
                    </DropdownMenuItem>
                  );
                })}
                {groupIndex < filteredGroups.length - 1 && <DropdownMenuSeparator />}
              </div>
            ))
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
