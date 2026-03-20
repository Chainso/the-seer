"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Settings2 } from "lucide-react";

import { CatalogKindTabs } from "@/app/components/catalog/catalog-kind-tabs";
import { ObjectLifecycleWorkspace } from "@/app/components/catalog/object-lifecycle-workspace";
import {
  buildObjectInstanceColumnModel,
  readObjectInstanceFieldValue,
  stringifyObjectInstanceValue,
} from "@/app/components/objects/object-instance-table-model";
import { Badge } from "@/app/components/ui/badge";
import { Card } from "@/app/components/ui/card";
import { Button } from "@/app/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/app/components/ui/dropdown-menu";
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
import { useOntologyDisplay } from "@/app/lib/ontology-display";
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

function humanizeIdentifierToken(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return value;
  }
  const normalizedSource = trimmed.includes(".")
    ? trimmed.split(".").filter(Boolean).slice(-1)[0] || trimmed
    : trimmed;
  const normalized = normalizedSource
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_./-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) {
    return trimmed;
  }
  return normalized
    .split(" ")
    .map((part) => (part ? `${part[0]?.toUpperCase()}${part.slice(1).toLowerCase()}` : part))
    .join(" ");
}

function isMappedDisplayLabel(raw: string, candidate: string): boolean {
  const normalizedCandidate = candidate.trim();
  if (!normalizedCandidate || normalizedCandidate === "—") {
    return false;
  }
  return normalizedCandidate !== raw;
}

function actionStatusLabel(rawStatus: string): string {
  if (!rawStatus) {
    return rawStatus;
  }
  return rawStatus
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase()}${part.slice(1).toLowerCase()}`)
    .join(" ");
}

function actionStatusBadgeClass(status: string): string {
  switch (status) {
    case "running":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "completed":
      return "border-blue-200 bg-blue-50 text-blue-700";
    case "retry_wait":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "failed_terminal":
      return "border-rose-200 bg-rose-50 text-rose-700";
    case "dead_letter":
      return "border-rose-200 bg-rose-100 text-rose-800";
    case "queued":
      return "border-slate-200 bg-slate-50 text-slate-700";
    default:
      return "border-border bg-muted/50 text-muted-foreground";
  }
}

function sortByOccurredAtDesc<T extends { occurred_at: string | null | undefined }>(rows: readonly T[]): T[] {
  return [...rows].sort((left, right) => {
    const leftValue = left.occurred_at ? Date.parse(left.occurred_at) : NaN;
    const rightValue = right.occurred_at ? Date.parse(right.occurred_at) : NaN;

    if (Number.isNaN(rightValue) && Number.isNaN(leftValue)) {
      return 0;
    }
    if (Number.isNaN(rightValue)) {
      return -1;
    }
    if (Number.isNaN(leftValue)) {
      return 1;
    }
    return rightValue - leftValue;
  });
}

const DEFAULT_OBJECT_REFERENCE_COLUMN_COUNT = 3;
const RUNTIME_TABLE_CONTAINER_CLASS =
  "max-h-[min(32rem,calc(100vh-22rem))] overflow-auto rounded-2xl border border-border";

function sortedReferenceColumns(columns: readonly string[]): string[] {
  return [...new Set(columns)].map((column) => column.trim()).filter(Boolean).sort((left, right) => left.localeCompare(right));
}

function RuntimeColumnSettings({
  availableColumns,
  enabledColumns,
  onToggleColumn,
}: {
  availableColumns: string[];
  enabledColumns: string[];
  onToggleColumn: (column: string, enabled: boolean) => void;
}) {
  if (availableColumns.length === 0) {
    return null;
  }

  return (
    <div className="absolute right-2 top-2 z-20">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="outline" size="sm">
            <Settings2 className="h-4 w-4" />
            Settings
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel>Columns</DropdownMenuLabel>
          {availableColumns.map((column) => (
            <DropdownMenuCheckboxItem
              key={column}
              checked={enabledColumns.includes(column)}
              onCheckedChange={(checked) => onToggleColumn(column, checked === true)}
            >
              {humanizeIdentifierToken(column)}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function CatalogObjectRuntimeTable({
  detail,
  payload,
}: {
  detail: CatalogObjectDetailResponse;
  payload: CatalogObjectInstancesResponse;
}) {
  const ontologyDisplay = useOntologyDisplay();
  const selectedModel = useMemo(
    () => ontologyDisplay.resolveObjectModel(detail.object_type_uri),
    [detail.object_type_uri, ontologyDisplay]
  );
  const { keyPartFieldKeys, displayNameFieldKey, stateFieldKeys } = useMemo(
    () =>
      buildObjectInstanceColumnModel({
        rows: payload.instances.map((item) => ({
          object_ref: item.reference,
          object_payload: item.data,
        })),
        objectType: detail.object_type_uri,
        ontologyDisplay,
        selectedModel,
      }),
    [detail.object_type_uri, ontologyDisplay, payload.instances, selectedModel]
  );

  const displayFieldValue = (fieldKey: string, rawValue: unknown) =>
    ontologyDisplay.displayFieldValue(fieldKey, rawValue, {
      objectType: detail.object_type_uri,
      stateLabelByToken: selectedModel?.stateLabelByToken,
    });

  return (
    <TableRoot variant="surface" striped containerClassName={RUNTIME_TABLE_CONTAINER_CLASS}>
      <TableHeader className="[&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-card">
        <TableRow>
          {keyPartFieldKeys.map((fieldKey) => (
            <TableColumnHeaderCell key={fieldKey}>
              {ontologyDisplay.displayFieldLabel(fieldKey, { objectType: detail.object_type_uri })}
            </TableColumnHeaderCell>
          ))}
          {displayNameFieldKey ? (
            <TableColumnHeaderCell>
              {ontologyDisplay.displayFieldLabel(displayNameFieldKey, {
                objectType: detail.object_type_uri,
              })}
            </TableColumnHeaderCell>
          ) : null}
          {stateFieldKeys.map((fieldKey) => (
            <TableColumnHeaderCell key={fieldKey}>
              {ontologyDisplay.displayFieldLabel(fieldKey, { objectType: detail.object_type_uri })}
            </TableColumnHeaderCell>
          ))}
          <TableColumnHeaderCell>Recorded</TableColumnHeaderCell>
        </TableRow>
      </TableHeader>
      <TableBody>
        {payload.instances.map((item) => {
          const shapedItem = { object_ref: item.reference, object_payload: item.data };
          return (
            <TableRow key={item.instance_id}>
              {keyPartFieldKeys.map((fieldKey) => (
                <TableCell key={`${item.instance_id}-${fieldKey}`} className="whitespace-normal">
                  {stringifyObjectInstanceValue(
                    displayFieldValue(fieldKey, readObjectInstanceFieldValue(shapedItem, fieldKey))
                  )}
                </TableCell>
              ))}
              {displayNameFieldKey ? (
                <TableCell className="whitespace-normal break-words">
                  {stringifyObjectInstanceValue(
                    displayFieldValue(
                      displayNameFieldKey,
                      readObjectInstanceFieldValue(shapedItem, displayNameFieldKey)
                    )
                  )}
                </TableCell>
              ) : null}
              {stateFieldKeys.map((fieldKey) => (
                <TableCell key={`${item.instance_id}-${fieldKey}-state`} className="whitespace-normal">
                  {stringifyObjectInstanceValue(
                    displayFieldValue(fieldKey, readObjectInstanceFieldValue(shapedItem, fieldKey))
                  )}
                </TableCell>
              ))}
              <TableCell>{formatDateTime(item.recorded_at)}</TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </TableRoot>
  );
}

function ActionRuntimeTable({ payload }: { payload: CatalogActionRunsResponse }) {
  const objectReferenceColumns = useMemo(
    () => sortedReferenceColumns(payload.object_reference_columns),
    [payload.object_reference_columns]
  );
  const [visibleReferenceColumns, setVisibleReferenceColumns] = useState<string[]>(() =>
    objectReferenceColumns.slice(0, DEFAULT_OBJECT_REFERENCE_COLUMN_COUNT)
  );

  const toggleReferenceColumn = (column: string, enabled: boolean) => {
    if (enabled) {
      setVisibleReferenceColumns((current) => {
        if (current.includes(column)) {
          return current;
        }
        return [...current, column].sort((left, right) => left.localeCompare(right));
      });
      return;
    }
    setVisibleReferenceColumns((current) => current.filter((item) => item !== column));
  };

  return (
    <div className="relative">
      <RuntimeColumnSettings
        availableColumns={objectReferenceColumns}
        enabledColumns={visibleReferenceColumns}
        onToggleColumn={toggleReferenceColumn}
      />
      <TableRoot variant="surface" striped containerClassName={RUNTIME_TABLE_CONTAINER_CLASS}>
        <TableHeader className="[&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-card">
          <TableRow>
            <TableColumnHeaderCell>Status</TableColumnHeaderCell>
            <TableColumnHeaderCell>Submitted</TableColumnHeaderCell>
            <TableColumnHeaderCell>Completed</TableColumnHeaderCell>
            <TableColumnHeaderCell>Attempts</TableColumnHeaderCell>
            {visibleReferenceColumns.map((fieldKey) => (
              <TableColumnHeaderCell key={fieldKey}>
                {humanizeIdentifierToken(fieldKey)}
              </TableColumnHeaderCell>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {payload.runs.map((item) => (
            <TableRow key={item.run_id}>
              <TableCell>
                <Badge variant="outline" className={`rounded-full ${actionStatusBadgeClass(item.status)}`}>
                  {actionStatusLabel(item.status)}
                </Badge>
              </TableCell>
              <TableCell>{formatDateTime(item.submitted_at)}</TableCell>
              <TableCell>{formatDateTime(item.completed_at)}</TableCell>
              <TableCell>{item.attempt_count}</TableCell>
              {visibleReferenceColumns.map((fieldKey) => (
                <TableCell
                  key={`${item.run_id}-${fieldKey}`}
                  className="text-xs text-muted-foreground"
                >
                  {summarizeValue(item.object_references?.[fieldKey])}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </TableRoot>
    </div>
  );
}

function EventRuntimeTable({ payload }: { payload: CatalogEventOccurrencesResponse }) {
  const ontologyDisplay = useOntologyDisplay();
  const objectReferenceColumns = useMemo(
    () => sortedReferenceColumns(payload.object_reference_columns),
    [payload.object_reference_columns]
  );
  const [visibleReferenceColumns, setVisibleReferenceColumns] = useState<string[]>(() =>
    objectReferenceColumns.slice(0, DEFAULT_OBJECT_REFERENCE_COLUMN_COUNT)
  );

  const displaySource = useCallback(
    (rawSource: string | null | undefined): string => {
      const raw = rawSource?.trim();
      if (!raw) {
        return "Source unavailable";
      }
      const conceptLabel = ontologyDisplay.displayConcept(raw);
      if (isMappedDisplayLabel(raw, conceptLabel)) {
        return conceptLabel;
      }
      const eventLabel = ontologyDisplay.displayEventType(raw);
      if (isMappedDisplayLabel(raw, eventLabel)) {
        return eventLabel;
      }
      const objectLabel = ontologyDisplay.displayObjectType(raw);
      if (isMappedDisplayLabel(raw, objectLabel)) {
        return objectLabel;
      }
      return humanizeIdentifierToken(raw);
    },
    [ontologyDisplay]
  );

  const toggleReferenceColumn = (column: string, enabled: boolean) => {
    if (enabled) {
      setVisibleReferenceColumns((current) => {
        if (current.includes(column)) {
          return current;
        }
        return [...current, column].sort((left, right) => left.localeCompare(right));
      });
      return;
    }
    setVisibleReferenceColumns((current) => current.filter((item) => item !== column));
  };

  const occurrences = useMemo(() => sortByOccurredAtDesc(payload.occurrences), [payload.occurrences]);

  return (
    <div className="relative">
      <RuntimeColumnSettings
        availableColumns={objectReferenceColumns}
        enabledColumns={visibleReferenceColumns}
        onToggleColumn={toggleReferenceColumn}
      />
      <TableRoot variant="surface" striped containerClassName={RUNTIME_TABLE_CONTAINER_CLASS}>
        <TableHeader className="[&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-card">
          <TableRow>
            <TableColumnHeaderCell>Occurred</TableColumnHeaderCell>
            <TableColumnHeaderCell>Source</TableColumnHeaderCell>
            <TableColumnHeaderCell>Summary</TableColumnHeaderCell>
            {visibleReferenceColumns.map((fieldKey) => (
              <TableColumnHeaderCell key={fieldKey}>{humanizeIdentifierToken(fieldKey)}</TableColumnHeaderCell>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {occurrences.map((item) => (
            <TableRow key={item.event_id}>
              <TableCell>{formatDateTime(item.occurred_at)}</TableCell>
              <TableCell>{displaySource(item.source)}</TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {summarizeValue(item.payload)}
              </TableCell>
              {visibleReferenceColumns.map((fieldKey) => (
                <TableCell
                  key={`${item.event_id}-${fieldKey}`}
                  className="text-xs text-muted-foreground"
                >
                  {summarizeValue(item.object_references?.[fieldKey])}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </TableRoot>
    </div>
  );
}

function TriggerRuntimeTable({ payload }: { payload: CatalogTriggerFiringsResponse }) {
  const ontologyDisplay = useOntologyDisplay();
  const objectReferenceColumns = useMemo(
    () => sortedReferenceColumns(payload.object_reference_columns),
    [payload.object_reference_columns]
  );
  const [visibleReferenceColumns, setVisibleReferenceColumns] = useState<string[]>(() =>
    objectReferenceColumns.slice(0, DEFAULT_OBJECT_REFERENCE_COLUMN_COUNT)
  );

  const displaySource = useCallback(
    (rawSource: string | null | undefined): string => {
      const raw = rawSource?.trim();
      if (!raw) {
        return "Source unavailable";
      }
      const conceptLabel = ontologyDisplay.displayConcept(raw);
      if (isMappedDisplayLabel(raw, conceptLabel)) {
        return conceptLabel;
      }
      const eventLabel = ontologyDisplay.displayEventType(raw);
      if (isMappedDisplayLabel(raw, eventLabel)) {
        return eventLabel;
      }
      const objectLabel = ontologyDisplay.displayObjectType(raw);
      if (isMappedDisplayLabel(raw, objectLabel)) {
        return objectLabel;
      }
      return humanizeIdentifierToken(raw);
    },
    [ontologyDisplay]
  );

  const toggleReferenceColumn = (column: string, enabled: boolean) => {
    if (enabled) {
      setVisibleReferenceColumns((current) => {
        if (current.includes(column)) {
          return current;
        }
        return [...current, column].sort((left, right) => left.localeCompare(right));
      });
      return;
    }
    setVisibleReferenceColumns((current) => current.filter((item) => item !== column));
  };

  const firings = useMemo(() => sortByOccurredAtDesc(payload.firings), [payload.firings]);

  return (
    <div className="relative">
      <RuntimeColumnSettings
        availableColumns={objectReferenceColumns}
        enabledColumns={visibleReferenceColumns}
        onToggleColumn={toggleReferenceColumn}
      />
      <TableRoot variant="surface" striped containerClassName={RUNTIME_TABLE_CONTAINER_CLASS}>
        <TableHeader className="[&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-card">
          <TableRow>
            <TableColumnHeaderCell>Occurred</TableColumnHeaderCell>
            <TableColumnHeaderCell>Source</TableColumnHeaderCell>
            <TableColumnHeaderCell>Summary</TableColumnHeaderCell>
            {visibleReferenceColumns.map((fieldKey) => (
              <TableColumnHeaderCell key={fieldKey}>{humanizeIdentifierToken(fieldKey)}</TableColumnHeaderCell>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {firings.map((item) => (
            <TableRow key={item.event_id}>
              <TableCell>{formatDateTime(item.occurred_at)}</TableCell>
              <TableCell>{displaySource(item.source)}</TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {summarizeValue(item.payload)}
              </TableCell>
              {visibleReferenceColumns.map((fieldKey) => (
                <TableCell
                  key={`${item.event_id}-${fieldKey}`}
                  className="text-xs text-muted-foreground"
                >
                  {summarizeValue(item.object_references?.[fieldKey])}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </TableRoot>
    </div>
  );
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
  objectDetail,
}: {
  kind: TKind;
  payload: CatalogRuntimeResponseByKind[CatalogKind];
  objectDetail?: CatalogObjectDetailResponse | null;
}) {
  if (kind === "objects" && objectDetail) {
    const shaped = payload as CatalogObjectInstancesResponse;
    return <CatalogObjectRuntimeTable detail={objectDetail} payload={shaped} />;
  }

  if (kind === "actions") {
    const shaped = payload as CatalogActionRunsResponse;
    const settingsKey = `${shaped.catalog_key}-${shaped.object_reference_columns.join("|")}`;
    return <ActionRuntimeTable key={settingsKey} payload={shaped} />;
  }

  if (kind === "events") {
    const shaped = payload as CatalogEventOccurrencesResponse;
    const settingsKey = `${shaped.catalog_key}-${shaped.object_reference_columns.join("|")}`;
    return <EventRuntimeTable key={settingsKey} payload={shaped} />;
  }

  const shaped = payload as CatalogTriggerFiringsResponse;
  const settingsKey = `${shaped.catalog_key}-${shaped.object_reference_columns.join("|")}`;
  return <TriggerRuntimeTable key={settingsKey} payload={shaped} />;
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
  const objectDetail = kind === "objects" ? (detail as CatalogObjectDetailResponse) : null;
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
        <RuntimeTable kind={kind} payload={runtime} objectDetail={objectDetail} />
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
              <div className="flex w-full flex-col gap-1 px-3 py-4 text-left">
                <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Overview</span>
                <p className="text-sm font-semibold leading-tight text-foreground">Summary</p>
              </div>
            </TabsTrigger>
            <TabsTrigger value="lifecycle" variant="rail" className="min-h-[84px] px-1 py-0 transition-colors duration-200">
              <div className="flex w-full flex-col gap-1 px-3 py-4 text-left">
                <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Investigation</span>
                <p className="text-sm font-semibold leading-tight text-foreground">{objectDetail.name} Lifecycle</p>
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
