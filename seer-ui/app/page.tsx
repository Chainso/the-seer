import { Card } from './components/ui/card';
import Link from 'next/link';
import { Network, Activity, Database, ArrowUpRight } from 'lucide-react';

export default function Home() {
  return (
    <div className="space-y-8">
      <div className="rounded-3xl border border-border bg-card p-8 shadow-sm">
        <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">Seer Platform</p>
        <h1 className="mt-3 font-display text-4xl">Command Center</h1>
        <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
          Orchestrate your business ontology, inspect active processes, and trace the state of every object in motion.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <Link href="/ontology/overview">
          <Card className="group h-full cursor-pointer rounded-2xl border border-border bg-card p-6 shadow-sm transition-transform hover:-translate-y-1">
            <div className="flex items-center justify-between">
              <Network className="h-10 w-10 text-primary" />
              <ArrowUpRight className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-primary" />
            </div>
            <h2 className="mt-6 font-display text-xl">Ontology Explorer</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Navigate your ontology graph, inspect concept contracts, and validate relationships before code changes.
            </p>
          </Card>
        </Link>

        <Link href="/inspector">
          <Card className="group h-full cursor-pointer rounded-2xl border border-border bg-card p-6 shadow-sm transition-transform hover:-translate-y-1">
            <div className="flex items-center justify-between">
              <Activity className="h-10 w-10 text-emerald-600" />
              <ArrowUpRight className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-primary" />
            </div>
            <h2 className="mt-6 font-display text-xl">Process Inspector</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Track live workflows, timelines, and action execution across the platform.
            </p>
          </Card>
        </Link>

        <Link href="/object-store">
          <Card className="group h-full cursor-pointer rounded-2xl border border-border bg-card p-6 shadow-sm transition-transform hover:-translate-y-1">
            <div className="flex items-center justify-between">
              <Database className="h-10 w-10 text-amber-600" />
              <ArrowUpRight className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-primary" />
            </div>
            <h2 className="mt-6 font-display text-xl">Object Store</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Review object instances, their current states, and historical transitions.
            </p>
          </Card>
        </Link>
      </div>
    </div>
  );
}
