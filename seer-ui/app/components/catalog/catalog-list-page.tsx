"use client";

import { startTransition, useDeferredValue, useEffect, useMemo, useState } from "react";
import { ArrowRight, Search } from "lucide-react";
import { useRouter } from "next/navigation";

import { CatalogKindTabs } from "@/app/components/catalog/catalog-kind-tabs";
import { Card } from "@/app/components/ui/card";
import { Input } from "@/app/components/ui/input";
import {
  TableBody,
  TableCell,
  TableColumnHeaderCell,
  TableHeader,
  TableRoot,
  TableRow,
} from "@/app/components/ui/table";
import { listCatalogByKind } from "@/app/lib/api/catalog";
import { buildCatalogDetailHref, CATALOG_KIND_LABEL } from "@/app/lib/catalog-routes";
import type {
  CatalogActionListResponse,
  CatalogEventListResponse,
  CatalogKind,
  CatalogListResponseByKind,
  CatalogObjectListResponse,
  CatalogTriggerListResponse,
} from "@/app/types/catalog";

interface CatalogListRow {
  catalog_key: string;
  name: string;
  description: string | null;
  left_metric: number;
  right_metric: number;
}

const METRIC_HEADERS: Record<CatalogKind, { left: string; right: string }> = {
  objects: { left: "Actions", right: "Events" },
  actions: { left: "Objects", right: "Triggers" },
  events: { left: "Objects", right: "Triggers" },
  triggers: { left: "Events", right: "Actions" },
};

function toRows(
  kind: CatalogKind,
  payload: CatalogListResponseByKind[CatalogKind]
): CatalogListRow[] {
  if (kind === "objects") {
    const shaped = payload as CatalogObjectListResponse;
    return shaped.items.map((item) => ({
      catalog_key: item.catalog_key,
      name: item.name,
      description: item.description,
      left_metric: item.action_count,
      right_metric: item.event_count,
    }));
  }
  if (kind === "actions") {
    const shaped = payload as CatalogActionListResponse;
    return shaped.items.map((item) => ({
      catalog_key: item.catalog_key,
      name: item.name,
      description: item.description,
      left_metric: item.object_count,
      right_metric: item.trigger_count,
    }));
  }
  if (kind === "events") {
    const shaped = payload as CatalogEventListResponse;
    return shaped.items.map((item) => ({
      catalog_key: item.catalog_key,
      name: item.name,
      description: item.description,
      left_metric: item.object_count,
      right_metric: item.trigger_count,
    }));
  }
  const shaped = payload as CatalogTriggerListResponse;
  return shaped.items.map((item) => ({
    catalog_key: item.catalog_key,
    name: item.name,
    description: item.description,
    left_metric: item.event_count,
    right_metric: item.action_count,
  }));
}

export function CatalogListPage({ kind }: { kind: CatalogKind }) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search.trim());
  const [rows, setRows] = useState<CatalogListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    listCatalogByKind(kind, { search: deferredSearch, limit: 300 })
      .then((response) => {
        if (!active) {
          return;
        }
        setRows(toRows(kind, response));
        setError(null);
      })
      .catch((cause) => {
        if (!active) {
          return;
        }
        setRows([]);
        setError(cause instanceof Error ? cause.message : "Failed to load catalog list.");
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [deferredSearch, kind]);

  const headers = METRIC_HEADERS[kind];
  const title = CATALOG_KIND_LABEL[kind];

  const subtitle = useMemo(() => {
    if (kind === "objects") {
      return "Browse business objects, what they do, and what events they produce.";
    }
    if (kind === "actions") {
      return "Inspect executable actions and where they connect in the catalog.";
    }
    if (kind === "events") {
      return "Review business events and their related objects and automations.";
    }
    return "Review triggers and the event-to-action automations they represent.";
  }, [kind]);

  return (
    <div className="space-y-6" data-catalog-list-page={kind}>
      <CatalogKindTabs kind={kind} />

      <Card className="rounded-2xl border border-border bg-card p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl space-y-2">
            <div className="text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              Catalog
            </div>
            <h1 className="font-display text-3xl">{title}</h1>
            <p className="text-sm text-muted-foreground">{subtitle}</p>
          </div>
          <div className="w-full max-w-sm space-y-2">
            <label htmlFor="catalog-search" className="text-sm font-medium">
              Search
            </label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="catalog-search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={`Search ${title.toLowerCase()}...`}
                className="pl-9"
              />
            </div>
          </div>
        </div>
      </Card>

      {error ? (
        <Card className="rounded-2xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </Card>
      ) : null}

      <Card className="rounded-2xl border border-border bg-card p-6 shadow-sm">
        {loading ? (
          <div className="rounded-2xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
            Loading {title.toLowerCase()}...
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
            No {title.toLowerCase()} match this search.
          </div>
        ) : (
          <TableRoot variant="surface" striped>
            <TableHeader>
              <TableRow>
                <TableColumnHeaderCell>Name</TableColumnHeaderCell>
                <TableColumnHeaderCell>Description</TableColumnHeaderCell>
                <TableColumnHeaderCell>{headers.left}</TableColumnHeaderCell>
                <TableColumnHeaderCell>{headers.right}</TableColumnHeaderCell>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow
                  key={row.catalog_key}
                  className="cursor-pointer"
                  onClick={() => {
                    startTransition(() => {
                      router.push(buildCatalogDetailHref(kind, row.catalog_key));
                    });
                  }}
                >
                  <TableCell>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{row.name}</span>
                      <ArrowRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {row.description || "No description provided."}
                  </TableCell>
                  <TableCell>{row.left_metric}</TableCell>
                  <TableCell>{row.right_metric}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </TableRoot>
        )}
      </Card>
    </div>
  );
}
