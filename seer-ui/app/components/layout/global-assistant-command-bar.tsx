'use client';

import { FormEvent, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Sparkles } from 'lucide-react';

export function GlobalAssistantCommandBar() {
  const router = useRouter();
  const pathname = usePathname();
  const [query, setQuery] = useState('');

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = query.trim();
    const suffix = trimmed ? `?q=${encodeURIComponent(trimmed)}` : '';
    router.push(`/assistant${suffix}`);
  };

  const missionControlHref = query.trim()
    ? `/assistant?q=${encodeURIComponent(query.trim())}`
    : '/assistant';

  return (
    <div className="mb-4 rounded-2xl border border-border bg-card px-4 py-3 shadow-sm">
      <form onSubmit={handleSubmit} className="flex flex-col gap-3 md:flex-row md:items-center">
        <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-muted-foreground">
          <Sparkles className="h-3.5 w-3.5" />
          Assistant
        </div>
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Ask Seer Assistant about ontology changes, runtime signals, or process risk..."
          className="h-10 flex-1"
        />
        <div className="flex items-center gap-2">
          <Button type="submit" size="sm">
            Run
          </Button>
          {pathname !== '/assistant' && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => router.push(missionControlHref)}
            >
              Mission Control
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}
