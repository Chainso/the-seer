"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { CatalogKindTabs } from "@/app/components/catalog/catalog-kind-tabs";
import { ObjectLifecycleWorkspace } from "@/app/components/catalog/object-lifecycle-workspace";
import { Badge } from "@/app/components/ui/badge";
import { Card } from "@/app/components/ui/card";
import {
  TableBody,
  TableCell,
  TableColumnHeaderCell,
  TableHeader,
  TableRoot,
  TableRow,
} from "@/app/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/app/components/ui/tabs";
import { getCatalogDetailByKind, getCatalogRuntimeByKind } from "@/app/lib/api/catalog";
import { buildCatalogDetailHref, buildCatalogKindHref, CATALOG_KIND_LABEL } from "@/app/lib/catalog-routes";
import type {
  CatalogActionDetailResponse,
  CatalogActionRunsResponse,
  CatalogDetailResponseByKind,
  CatalogEventDetailResponse,
  CatalogEventOccurrencesResponse,
  CatalogKind,
  CatalogObjectDetailResponse,
  CatalogObjectInstancesResponse,
  CatalogRuntimeResponseByKind,
  CatalogTriggerDetailResponse,
  CatalogTriggerFiringsResponse,
} from "@/app/types/catalog";

function formatDateTime(value: string | null): string {
  if (!value) {
    return "-";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) {
    return "-";
  }
  return parsed.toLocaleString();
}

function summarizeValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "-";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    const serialized = JSON.stringify(value);
    if (!serialized) {
      return "-";
    }
    return serialized.length > 120 ? `${serialized.slice(0, 117)}...` : serialized;
  } catch {
    return String(value);
  }
}

function runtimeTitle(kind: CatalogKind): string {
  if (kind === "objects") {
    return "Instances";
  }
  if (kind === "actions") {
    return "Recent Runs";
  }
  if (kind === "events") {
    return "Recent Occurrences";
  }
  return "Recent Firings";
}

type RelatedSection = {
  title: string;
  targetKind: CatalogKind;
  links: { catalog_key: string; name: string }[];
};

function relatedSections<TKind extends CatalogKind>(
  kind: TKind,
  detail: CatalogDetailResponseByKind[CatalogKind]
): RelatedSection[] {
  if (kind === "objects") {
    const shaped = detail as CatalogObjectDetailResponse;
    return [
      { title: "Actions", targetKind: "actions", links: shaped.actions },
      { title: "Events", targetKind: "events", links: shaped.events },
      { title: "Triggers", targetKind: "triggers", links: shaped.triggers },
    ];
  }
  if (kind === "actions") {
    const shaped = detail as CatalogActionDetailResponse;
    return [
      { title: "Objects", targetKind: "objects", links: shaped.objects },
      { title: "Events", targetKind: "events", links: shaped.events },
      { title: "Triggers", targetKind: "triggers", links: shaped.triggers },
    ];
  }
  if (kind === "events") {
    const shaped = detail as CatalogEventDetailResponse;
    return [
      { title: "Objects", targetKind: "objects", links: shaped.objects },
      { title: "Actions", targetKind: "actions", links: shaped.actions },
      { title: "Triggers", targetKind: "triggers", links: shaped.triggers },
    ];
  }
  const shaped = detail as CatalogTriggerDetailResponse;
  return [
    { title: "Events", targetKind: "events", links: shaped.events },
    { title: "Actions", targetKind: "actions", links: shaped.actions },
    { title: "Objects", targetKind: "objects", links: shaped.objects },
  ];
}

function RuntimeTable<TKind extends CatalogKind>({
  kind,
  payload,
}: {
  kind: TKind;
  payload: CatalogRuntimeResponseByKind[CatalogKind];
}) {
  if (kind === "objects") {
    const shaped = payload as CatalogObjectInstancesResponse;
    return (
      <TableRoot variant="surface" striped>
        <TableHeader>
          <TableRow>
            <TableColumnHeaderCell>Recorded</TableColumnHeaderCell>
            <TableColumnHeaderCell>Reference</TableColumnHeaderCell>
            <TableColumnHeaderCell>Snapshot</TableColumnHeaderCell>
          </TableRow>
        </TableHeader>
        <TableBody>
          {shaped.instances.map((item) => (
            <TableRow key={item.instance_id}>
              <TableCell>{formatDateTime(item.recorded_at)}</TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {summarizeValue(item.reference)}
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">{summarizeValue(item.data)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </TableRoot>
    );
  }

  if (kind === "actions") {
    const shaped = payload as CatalogActionRunsResponse;
    return (
      <TableRoot variant="surface" striped>
        <TableHeader>
          <TableRow>
            <TableColumnHeaderCell>Status</TableColumnHeaderCell>
            <TableColumnHeaderCell>Submitted</TableColumnHeaderCell>
            <TableColumnHeaderCell>Completed</TableColumnHeaderCell>
            <TableColumnHeaderCell>Attempts</TableColumnHeaderCell>
          </TableRow>
        </TableHeader>
        <TableBody>
          {shaped.runs.map((item) => (
            <TableRow key={item.run_id}>
              <TableCell>
                <Badge variant="outline" className="rounded-full">
                  {item.status}
                </Badge>
              </TableCell>
              <TableCell>{formatDateTime(item.submitted_at)}</TableCell>
              <TableCell>{formatDateTime(item.completed_at)}</TableCell>
              <TableCell>{item.attempt_count}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </TableRoot>
    );
  }

  if (kind === "events") {
    const shaped = payload as CatalogEventOccurrencesResponse;
    return (
      <TableRoot variant="surface" striped>
        <TableHeader>
          <TableRow>
            <TableColumnHeaderCell>Occurred</TableColumnHeaderCell>
            <TableColumnHeaderCell>Source</TableColumnHeaderCell>
            <TableColumnHeaderCell>Summary</TableColumnHeaderCell>
          </TableRow>
        </TableHeader>
        <TableBody>
          {shaped.occurrences.map((item) => (
            <TableRow key={item.event_id}>
              <TableCell>{formatDateTime(item.occurred_at)}</TableCell>
              <TableCell>{item.source}</TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {summarizeValue(item.payload)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </TableRoot>
    );
  }

  const shaped = payload as CatalogTriggerFiringsResponse;
  return (
    <TableRoot variant="surface" striped>
      <TableHeader>
        <TableRow>
          <TableColumnHeaderCell>Occurred</TableColumnHeaderCell>
          <TableColumnHeaderCell>Source</TableColumnHeaderCell>
          <TableColumnHeaderCell>Summary</TableColumnHeaderCell>
        </TableRow>
      </TableHeader>
      <TableBody>
        {shaped.firings.map((item) => (
          <TableRow key={item.event_id}>
            <TableCell>{formatDateTime(item.occurred_at)}</TableCell>
            <TableCell>{item.source}</TableCell>
            <TableCell className="text-xs text-muted-foreground">{summarizeValue(item.payload)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </TableRoot>
  );
}

function DetailSummaryLayout({
  kind,
  detail,
  runtime,
  sections,
}: {
  kind: CatalogKind;
  detail: CatalogDetailResponseByKind[CatalogKind];
  runtime: CatalogRuntimeResponseByKind[CatalogKind];
  sections: RelatedSection[];
}) {
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(20rem,0.9fr)_minmax(0,1.3fr)]">
      <Card className="rounded-2xl border border-border bg-card p-6 shadow-sm">
        <div className="space-y-5">
          <div className="space-y-2">
            <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Documentation
            </h2>
            <p className="text-sm text-muted-foreground">
              {detail.documentation || "No documentation provided."}
            </p>
          </div>

          {sections.map((section) => (
            <div key={section.title} className="space-y-2">
              <h3 className="text-sm font-semibold">{section.title}</h3>
              {section.links.length === 0 ? (
                <p className="text-sm text-muted-foreground">No related {section.title.toLowerCase()}.</p>
              ) : (
                <ul className="space-y-1">
                  {section.links.map((link) => (
                    <li key={`${section.targetKind}-${link.catalog_key}`}>
                      <Link
                        href={buildCatalogDetailHref(section.targetKind, link.catalog_key)}
                        className="text-sm text-foreground underline-offset-2 hover:underline"
                      >
                        {link.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      </Card>

      <Card className="rounded-2xl border border-border bg-card p-6 shadow-sm">
        <div className="mb-4">
          <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            {runtimeTitle(kind)}
          </h2>
        </div>
        <RuntimeTable kind={kind} payload={runtime} />
      </Card>
    </div>
  );
}

export function CatalogDetailPage({
  kind,
  catalogKey,
}: {
  kind: CatalogKind;
  catalogKey: string;
}) {
  const [detail, setDetail] = useState<CatalogDetailResponseByKind[CatalogKind] | null>(null);
  const [runtime, setRuntime] = useState<CatalogRuntimeResponseByKind[CatalogKind] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [objectViewTab, setObjectViewTab] = useState<"summary" | "lifecycle">("summary");

  useEffect(() => {
    let active = true;
    setLoading(true);

    const runtimeOptions =
      kind === "objects"
        ? { page: 0, size: 50 }
        : kind === "actions"
          ? { page: 1, size: 20 }
          : { limit: 200 };

    Promise.all([
      getCatalogDetailByKind(kind, catalogKey),
      getCatalogRuntimeByKind(kind, catalogKey, runtimeOptions),
    ])
      .then(([detailResponse, runtimeResponse]) => {
        if (!active) {
          return;
        }
        setDetail(detailResponse);
        setRuntime(runtimeResponse);
        setError(null);
      })
      .catch((cause) => {
        if (!active) {
          return;
        }
        setDetail(null);
        setRuntime(null);
        setError(cause instanceof Error ? cause.message : "Failed to load catalog detail.");
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [catalogKey, kind]);

  useEffect(() => {
    setObjectViewTab("summary");
  }, [catalogKey, kind]);

  const sections = useMemo(() => {
    if (!detail) {
      return [];
    }
    return relatedSections(kind, detail);
  }, [detail, kind]);

  const objectDetail = useMemo(() => {
    if (kind === "objects" && detail) {
      return detail as CatalogObjectDetailResponse;
    }
    return null;
  }, [detail, kind]);

  return (
    <div className="space-y-6" data-catalog-detail-page={kind}>
      <CatalogKindTabs kind={kind} />

      <Card className="rounded-2xl border border-border bg-card p-6 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <Badge variant="outline" className="rounded-full">
            {CATALOG_KIND_LABEL[kind].slice(0, -1)}
          </Badge>
          <Link href={buildCatalogKindHref(kind)} className="text-xs text-muted-foreground underline-offset-2 hover:underline">
            Back to {CATALOG_KIND_LABEL[kind]}
          </Link>
        </div>
        <h1 className="mt-3 font-display text-3xl">{detail?.name || "Loading..."}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {detail?.description || "No description provided."}
        </p>
      </Card>

      {error ? (
        <Card className="rounded-2xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </Card>
      ) : null}

      {loading || !detail || !runtime ? (
        <Card className="rounded-2xl border border-border bg-card p-8 text-sm text-muted-foreground">
          Loading detail...
        </Card>
      ) : kind === "objects" && objectDetail ? (
        <Tabs
          value={objectViewTab}
          onValueChange={(nextValue) => {
            if (nextValue === "summary" || nextValue === "lifecycle") {
              setObjectViewTab(nextValue);
            }
          }}
          className="space-y-5"
        >
          <TabsList variant="rail" className="grid grid-cols-2 gap-0">
            <TabsTrigger value="summary" variant="rail" className="min-h-[84px] px-1 py-0 transition-colors duration-200">
              <div className="flex w-full flex-col gap-1 px-3 pb-4 pt-3 text-left">
                <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Overview</span>
                <p className="text-sm font-semibold leading-tight text-foreground">Summary</p>
                <p className="hidden text-xs leading-5 text-muted-foreground md:block">
                  Read documentation, review related catalog concepts, and inspect runtime instances.
                </p>
              </div>
            </TabsTrigger>
            <TabsTrigger value="lifecycle" variant="rail" className="min-h-[84px] px-1 py-0 transition-colors duration-200">
              <div className="flex w-full flex-col gap-1 px-3 pb-4 pt-3 text-left">
                <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Investigation</span>
                <p className="text-sm font-semibold leading-tight text-foreground">{objectDetail.name} Lifecycle</p>
                <p className="hidden text-xs leading-5 text-muted-foreground md:block">
                  Explore lifecycle flow and compare findings across scoped runtime patterns.
                </p>
              </div>
            </TabsTrigger>
          </TabsList>
          <TabsContent value="summary" className="space-y-4">
            <DetailSummaryLayout kind={kind} detail={objectDetail} runtime={runtime} sections={sections} />
          </TabsContent>
          <TabsContent value="lifecycle" className="space-y-4">
            <ObjectLifecycleWorkspace
              objectName={objectDetail.name}
              objectType={objectDetail.object_type_uri}
              isActive={objectViewTab === "lifecycle"}
            />
          </TabsContent>
        </Tabs>
      ) : (
        <DetailSummaryLayout kind={kind} detail={detail} runtime={runtime} sections={sections} />
      )}
    </div>
  );
}
