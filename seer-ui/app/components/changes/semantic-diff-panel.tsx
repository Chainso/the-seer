'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Badge } from '@/app/components/ui/badge';
import { Card } from '@/app/components/ui/card';
import { Input } from '@/app/components/ui/input';
import { Button } from '@/app/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/app/components/ui/select';
import { getSemanticDiffReport } from '@/app/lib/api/changes';
import { getAllPerformanceBudgetSnapshots } from '@/app/lib/performance-budget';
import type {
  BlastRadiusEntry,
  BlastRadiusSeverity,
  CompatibilityClass,
  GovernanceMetric,
  GovernanceMetricStatus,
  SemanticConceptChange,
  SemanticDiffQuery,
  SemanticDiffReport,
  SemanticRelationChange,
} from '@/app/types/changes';
import { GitPullRequest } from 'lucide-react';

const COMPATIBILITY_STYLES: Record<CompatibilityClass, string> = {
  breaking: 'bg-red-100 text-red-700 border-red-200',
  risky: 'bg-amber-100 text-amber-700 border-amber-200',
  additive: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  non_functional: 'bg-slate-100 text-slate-700 border-slate-200',
};

const SEVERITY_STYLES: Record<BlastRadiusSeverity, string> = {
  high: 'bg-red-100 text-red-700 border-red-200',
  medium: 'bg-amber-100 text-amber-700 border-amber-200',
  low: 'bg-emerald-100 text-emerald-700 border-emerald-200',
};

const GOVERNANCE_STATUS_STYLES: Record<GovernanceMetricStatus, string> = {
  healthy: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  warning: 'bg-amber-100 text-amber-700 border-amber-200',
  critical: 'bg-red-100 text-red-700 border-red-200',
};

export function SemanticDiffPanel() {
  const searchParams = useSearchParams();
  const [report, setReport] = useState<SemanticDiffReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [compatibilityFilter, setCompatibilityFilter] = useState<'all' | CompatibilityClass>('all');
  const [severityFilter, setSeverityFilter] = useState<'all' | BlastRadiusSeverity>('all');
  const [teamFilter, setTeamFilter] = useState<'all' | string>('all');
  const [serviceFilter, setServiceFilter] = useState<'all' | string>('all');
  const [selectedId, setSelectedId] = useState<string>('');

  const diffQuery = useMemo<SemanticDiffQuery>(() => {
    const prRaw = searchParams.get('pr');
    const prNumber = prRaw && /^\d+$/.test(prRaw) ? Number(prRaw) : undefined;
    return {
      prNumber,
      baseRef: searchParams.get('baseRef') || undefined,
      headRef: searchParams.get('headRef') || undefined,
      ontologyUri: searchParams.get('ontologyUri') || undefined,
    };
  }, [searchParams]);

  useEffect(() => {
    let active = true;
    getSemanticDiffReport(diffQuery)
      .then((nextReport) => {
        if (!active) return;
        setError(null);
        setReport(nextReport);
        if (nextReport.conceptChanges.length > 0) {
          setSelectedId(nextReport.conceptChanges[0].id);
        }
      })
      .catch(() => {
        if (!active) return;
        setReport(null);
        setError('Unable to load semantic diff report.');
      });
    return () => {
      active = false;
    };
  }, [diffQuery]);

  const loading = !report && !error;

  const filteredConceptChanges = useMemo(() => {
    const q = query.trim().toLowerCase();
    const conceptChanges = report?.conceptChanges || [];
    return conceptChanges.filter((entry) => {
      if (
        compatibilityFilter !== 'all' &&
        entry.compatibility !== compatibilityFilter
      ) {
        return false;
      }
      if (!q) {
        return true;
      }
      const haystack = `${entry.conceptUri} ${entry.conceptLabel} ${entry.summary} ${entry.rationale}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [compatibilityFilter, query, report]);

  const filteredRelationChanges = useMemo(() => {
    const q = query.trim().toLowerCase();
    const relationChanges = report?.relationChanges || [];
    return relationChanges.filter((entry) => {
      if (
        compatibilityFilter !== 'all' &&
        entry.compatibility !== compatibilityFilter
      ) {
        return false;
      }
      if (!q) {
        return true;
      }
      const haystack =
        `${entry.fromUri} ${entry.toUri} ${entry.relationUri} ${entry.summary}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [compatibilityFilter, query, report]);

  const selectedEntry: SemanticConceptChange | null = useMemo(() => {
    return (
      filteredConceptChanges.find((entry) => entry.id === selectedId) ||
      filteredConceptChanges[0] ||
      null
    );
  }, [filteredConceptChanges, selectedId]);

  const summaryCounts = useMemo<Record<CompatibilityClass, number>>(() => {
    const counts: Record<CompatibilityClass, number> = {
      breaking: 0,
      risky: 0,
      additive: 0,
      non_functional: 0,
    };
    filteredConceptChanges.forEach((entry) => {
      counts[entry.compatibility] += 1;
    });
    filteredRelationChanges.forEach((entry) => {
      counts[entry.compatibility] += 1;
    });
    return counts;
  }, [filteredConceptChanges, filteredRelationChanges]);

  const detailRelationChanges: SemanticRelationChange[] = selectedEntry
    ? selectedEntry.relationChanges
    : [];

  const blastRadiusEntries = useMemo(() => report?.blastRadius || [], [report]);
  const teamOptions = useMemo(() => {
    return Array.from(new Set(blastRadiusEntries.map((entry) => entry.ownerTeam))).sort();
  }, [blastRadiusEntries]);
  const serviceOptions = useMemo(() => {
    return Array.from(new Set(blastRadiusEntries.map((entry) => entry.service))).sort();
  }, [blastRadiusEntries]);

  const filteredBlastRadius = useMemo<BlastRadiusEntry[]>(() => {
    return blastRadiusEntries.filter((entry) => {
      if (severityFilter !== 'all' && entry.severity !== severityFilter) {
        return false;
      }
      if (teamFilter !== 'all' && entry.ownerTeam !== teamFilter) {
        return false;
      }
      if (serviceFilter !== 'all' && entry.service !== serviceFilter) {
        return false;
      }
      return true;
    });
  }, [blastRadiusEntries, serviceFilter, severityFilter, teamFilter]);

  const blastRadiusCounts = useMemo<Record<BlastRadiusSeverity, number>>(() => {
    const counts: Record<BlastRadiusSeverity, number> = {
      high: 0,
      medium: 0,
      low: 0,
    };
    filteredBlastRadius.forEach((entry) => {
      counts[entry.severity] += 1;
    });
    return counts;
  }, [filteredBlastRadius]);

  const governanceMetrics: GovernanceMetric[] = report?.governance.metrics || [];
  const performanceBudgets = getAllPerformanceBudgetSnapshots();

  return (
    <div className="space-y-6">
      <Card className="rounded-3xl border border-border bg-card p-8 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">
              Change Intelligence
            </p>
            <h1 className="mt-3 font-display text-3xl">Semantic PR Diff</h1>
            <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
              Review concept and relation deltas with compatibility classes before
              merging ontology repo changes.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="gap-1">
              <GitPullRequest className="h-3.5 w-3.5" />
              {report?.pullRequestRef || 'Local change set'}
            </Badge>
            {report?.source === 'demo' && <Badge variant="secondary">Demo data</Badge>}
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2 text-xs text-muted-foreground">
          {report?.baseRef && <span>base: {report.baseRef}</span>}
          {report?.headRef && <span>head: {report.headRef}</span>}
          <span>
            generated:{' '}
            {report?.generatedAt ? new Date(report.generatedAt).toLocaleString() : '—'}
          </span>
        </div>
      </Card>

      <div className="grid gap-4 md:grid-cols-4">
        {(['breaking', 'risky', 'additive', 'non_functional'] as CompatibilityClass[]).map(
          (key) => (
            <Card key={key} className="rounded-2xl border border-border bg-card p-4 shadow-sm">
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                {key.replace('_', ' ')}
              </p>
              <p className="mt-2 font-display text-2xl">{summaryCounts[key]}</p>
            </Card>
          )
        )}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
        <Card className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          <div className="grid gap-3 md:grid-cols-[1fr_auto]">
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search concept URI, label, or rationale..."
            />
            <Select
              value={compatibilityFilter}
              onValueChange={(value) => setCompatibilityFilter(value as typeof compatibilityFilter)}
            >
              <SelectTrigger className="w-[220px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All classes</SelectItem>
                <SelectItem value="breaking">Breaking</SelectItem>
                <SelectItem value="risky">Risky</SelectItem>
                <SelectItem value="additive">Additive</SelectItem>
                <SelectItem value="non_functional">Non-functional</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="mt-4 space-y-2">
            {loading && (
              <div className="rounded-xl border border-border px-4 py-3 text-sm text-muted-foreground">
                Loading semantic diff entries...
              </div>
            )}
            {!loading && error && (
              <div className="rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                {error}
              </div>
            )}
            {!loading &&
              !error &&
              filteredConceptChanges.map((entry) => (
              <Button
                key={entry.id}
                variant={entry.id === selectedEntry?.id ? 'secondary' : 'ghost'}
                className="h-auto w-full justify-start p-3 text-left"
                onClick={() => setSelectedId(entry.id)}
              >
                <div className="w-full">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{entry.conceptUri}</span>
                    <Badge variant="outline" className={COMPATIBILITY_STYLES[entry.compatibility]}>
                      {entry.compatibility.replace('_', ' ')}
                    </Badge>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span>{entry.nodeLabel}</span>
                    <span>{entry.deltaKind}</span>
                    <span>{entry.summary}</span>
                  </div>
                </div>
              </Button>
            ))}
            {!loading && !error && filteredConceptChanges.length === 0 && (
              <div className="rounded-xl border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
                No semantic diff entries match current filters.
              </div>
            )}
          </div>
        </Card>

        <Card className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          <h2 className="font-display text-lg">Change Detail</h2>
          {!selectedEntry && (
            <p className="mt-3 text-sm text-muted-foreground">Select a semantic diff entry to inspect impact.</p>
          )}
          {selectedEntry && (
            <div className="mt-3 space-y-4">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                  {selectedEntry.conceptLabel}
                </p>
                <p className="font-mono text-sm">{selectedEntry.conceptUri}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline" className={COMPATIBILITY_STYLES[selectedEntry.compatibility]}>
                  {selectedEntry.compatibility.replace('_', ' ')}
                </Badge>
                <Badge variant="outline">{selectedEntry.deltaKind}</Badge>
              </div>
              <div className="rounded-xl border border-border bg-muted/40 p-3 text-sm">
                {selectedEntry.summary}
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Rationale</p>
                <p className="mt-1 text-sm text-muted-foreground">{selectedEntry.rationale}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                  Relation Deltas
                </p>
                <div className="mt-2 space-y-2">
                  {detailRelationChanges.map((change) => (
                    <div key={change.id} className="rounded-lg border border-border px-3 py-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline" className={COMPATIBILITY_STYLES[change.compatibility]}>
                          {change.compatibility.replace('_', ' ')}
                        </Badge>
                        <Badge variant="outline">{change.deltaKind}</Badge>
                        <span className="text-xs text-muted-foreground">{change.relationLabel}</span>
                      </div>
                      <p className="mt-2 text-xs text-muted-foreground">
                        {change.fromUri} → {change.toUri}
                      </p>
                      <p className="mt-1 text-sm">{change.summary}</p>
                    </div>
                  ))}
                  {detailRelationChanges.length === 0 && (
                    <p className="text-xs text-muted-foreground">
                      No relation deltas attached to this concept change.
                    </p>
                  )}
                </div>
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Impacted Concepts</p>
                <div className="mt-2 space-y-2">
                  {selectedEntry.impactedConceptUris.map((uri) => (
                    <Link
                      key={uri}
                      href={`/ontology/overview?conceptUri=${encodeURIComponent(uri)}`}
                      className="block rounded-lg border border-border px-3 py-2 text-xs hover:bg-accent"
                    >
                      {uri}
                    </Link>
                  ))}
                  {selectedEntry.impactedConceptUris.length === 0 && (
                    <p className="text-xs text-muted-foreground">No downstream concept impacts detected.</p>
                  )}
                </div>
              </div>
            </div>
          )}
        </Card>
      </div>

      <Card className="rounded-2xl border border-border bg-card p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-lg">Relation Change Feed</h2>
          <Badge variant="outline">{filteredRelationChanges.length} relation deltas</Badge>
        </div>
        <div className="mt-3 space-y-2">
          {filteredRelationChanges.map((change) => (
            <div key={change.id} className="rounded-xl border border-border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className={COMPATIBILITY_STYLES[change.compatibility]}>
                  {change.compatibility.replace('_', ' ')}
                </Badge>
                <Badge variant="outline">{change.deltaKind}</Badge>
                <span className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                  {change.relationLabel}
                </span>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {change.fromUri} → {change.toUri}
              </p>
              <p className="mt-1 text-sm">{change.summary}</p>
            </div>
          ))}
          {filteredRelationChanges.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No relation-level changes match current filters.
            </p>
          )}
        </div>
      </Card>

      <Card className="rounded-2xl border border-border bg-card p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-lg">Blast Radius and Ownership</h2>
          <Badge variant="outline">{filteredBlastRadius.length} impacted owners</Badge>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          Identify who is affected by semantic changes and why, before merge approval.
        </p>

        <div className="mt-4 grid gap-4 md:grid-cols-3">
          {(['high', 'medium', 'low'] as BlastRadiusSeverity[]).map((severity) => (
            <Card key={severity} className="rounded-xl border border-border bg-muted/20 p-3">
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">{severity}</p>
              <p className="mt-1 font-display text-2xl">{blastRadiusCounts[severity]}</p>
            </Card>
          ))}
        </div>

        <div className="mt-4 grid gap-3 xl:grid-cols-[220px_1fr_1fr]">
          <Select
            value={severityFilter}
            onValueChange={(value) => setSeverityFilter(value as typeof severityFilter)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All severities</SelectItem>
              <SelectItem value="high">High</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="low">Low</SelectItem>
            </SelectContent>
          </Select>

          <Select value={teamFilter} onValueChange={setTeamFilter}>
            <SelectTrigger>
              <SelectValue placeholder="Filter by team" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All teams</SelectItem>
              {teamOptions.map((team) => (
                <SelectItem key={team} value={team}>
                  {team}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={serviceFilter} onValueChange={setServiceFilter}>
            <SelectTrigger>
              <SelectValue placeholder="Filter by service" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All services</SelectItem>
              {serviceOptions.map((service) => (
                <SelectItem key={service} value={service}>
                  {service}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="mt-4 space-y-2">
          {filteredBlastRadius.map((entry) => (
            <div key={entry.id} className="rounded-xl border border-border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className={SEVERITY_STYLES[entry.severity]}>
                  {entry.severity}
                </Badge>
                <Badge variant="outline">{entry.ownerTeam}</Badge>
                <Badge variant="outline">{entry.service}</Badge>
              </div>
              <p className="mt-2 text-sm">{entry.reason}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {entry.conceptUris.map((uri) => (
                  <Link
                    key={`${entry.id}-${uri}`}
                    href={`/ontology/overview?conceptUri=${encodeURIComponent(uri)}`}
                    className="rounded-lg border border-border px-2 py-1 text-xs hover:bg-accent"
                  >
                    {uri}
                  </Link>
                ))}
              </div>
            </div>
          ))}
          {filteredBlastRadius.length === 0 && (
            <p className="text-sm text-muted-foreground">No ownership impacts match current filters.</p>
          )}
        </div>
      </Card>

      <Card className="rounded-2xl border border-border bg-card p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-lg">Governance Scorecard</h2>
            <p className="text-sm text-muted-foreground">
              Quality trend tracking for ontology health in the active domain.
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Overall score</p>
            <p className="font-display text-3xl">{report?.governance.overallScore ?? 0}</p>
            <p className="text-xs text-muted-foreground">Domain: {report?.governance.domain ?? '—'}</p>
          </div>
        </div>

        <div className="mt-4 space-y-3">
          {governanceMetrics.map((metric) => {
            const delta =
              metric.history.length >= 2
                ? metric.history[metric.history.length - 1].value - metric.history[0].value
                : 0;
            const maxHistory = Math.max(1, ...metric.history.map((point) => point.value));

            return (
              <div key={metric.key} className="rounded-xl border border-border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium">{metric.label}</p>
                    <p className="text-xs text-muted-foreground">
                      target {metric.target}
                      {metric.unit === 'percent' ? '%' : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className={GOVERNANCE_STATUS_STYLES[metric.status]}>
                      {metric.status}
                    </Badge>
                    <Badge variant="outline">
                      {metric.value}
                      {metric.unit === 'percent' ? '%' : ''}
                    </Badge>
                    <Badge variant="outline">
                      {delta > 0 ? '+' : ''}
                      {delta}
                      {metric.unit === 'percent' ? '%' : ''}
                    </Badge>
                  </div>
                </div>
                <div className="mt-3 flex items-end gap-1">
                  {metric.history.map((point) => (
                    <div key={`${metric.key}-${point.bucket}`} className="flex flex-1 flex-col items-center gap-1">
                      <div
                        className="w-full rounded-sm bg-primary/20"
                        style={{ height: `${Math.max(6, (point.value / maxHistory) * 44)}px` }}
                      />
                      <span className="text-[10px] text-muted-foreground">{point.bucket}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
          {governanceMetrics.length === 0 && (
            <p className="text-sm text-muted-foreground">No governance metrics available for this diff context.</p>
          )}
        </div>
      </Card>

      <Card className="rounded-2xl border border-border bg-card p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-lg">Performance Budgets</h2>
          <Badge variant="outline">p95 baselines</Badge>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          Tracks explorer, semantic diff, and runtime overlay load timings against target budgets.
        </p>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          {performanceBudgets.map((metric) => (
            <Card key={metric.key} className="rounded-xl border border-border bg-muted/20 p-3">
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">{metric.label}</p>
              <div className="mt-2 flex items-center justify-between">
                <p className="font-display text-2xl">{metric.p95Ms}ms</p>
                <Badge
                  variant="outline"
                  className={
                    metric.withinBudget
                      ? 'border-emerald-200 bg-emerald-100 text-emerald-700'
                      : 'border-red-200 bg-red-100 text-red-700'
                  }
                >
                  budget {metric.budgetMs}ms
                </Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                samples {metric.sampleCount} • avg {metric.avgMs}ms • latest {metric.latestMs ?? 0}ms
              </p>
            </Card>
          ))}
        </div>
      </Card>
    </div>
  );
}
