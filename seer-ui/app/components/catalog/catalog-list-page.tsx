"use client";

import {
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
  left_value: string | number | null;
  right_value: string | number | null;
}

const CATALOG_TABLE_CONTAINER_CLASS =
  "max-h-[min(36rem,calc(100vh-20rem))] overflow-auto rounded-2xl border border-border";

const METRIC_HEADERS: Record<CatalogKind, { left: string; right: string }> = {
  objects: { left: "Actions", right: "Events" },
  actions: { left: "Objects", right: "Triggers" },
  events: { left: "Objects", right: "Triggers" },
  triggers: { left: "When Event", right: "Do Action" },
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
      left_value: item.action_count,
      right_value: item.event_count,
    }));
  }
  if (kind === "actions") {
    const shaped = payload as CatalogActionListResponse;
    return shaped.items.map((item) => ({
      catalog_key: item.catalog_key,
      name: item.name,
      description: item.description,
      left_value: item.object_count,
      right_value: item.trigger_count,
    }));
  }
  if (kind === "events") {
    const shaped = payload as CatalogEventListResponse;
    return shaped.items.map((item) => ({
      catalog_key: item.catalog_key,
      name: item.name,
      description: item.description,
      left_value: item.object_count,
      right_value: item.trigger_count,
    }));
  }
  const shaped = payload as CatalogTriggerListResponse;
  return shaped.items.map((item) => ({
    catalog_key: item.catalog_key,
    name: item.name,
    description: item.description,
    left_value: item.when_event,
    right_value: item.do_action,
  }));
}

export function CatalogListPage({ kind }: { kind: CatalogKind }) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search.trim());
  const [rows, setRows] = useState<CatalogListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const loadRows = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const response = await listCatalogByKind(kind, {
        search: deferredSearch,
        limit: 300,
      });
      if (requestId !== requestIdRef.current) {
        return;
      }
      setRows(toRows(kind, response));
      setError(null);
    } catch (cause) {
      if (requestId !== requestIdRef.current) {
        return;
      }
      setRows([]);
      setError(cause instanceof Error ? cause.message : "Failed to load catalog list.");
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, [deferredSearch, kind]);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

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
        <div className="max-w-3xl space-y-2">
          <div className="text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            Catalog
          </div>
          <h1 className="font-display text-3xl">{title}</h1>
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        </div>
      </Card>

      {error ? (
        <Card className="rounded-2xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </Card>
      ) : null}

      <Card className="rounded-2xl border border-border bg-card p-6 shadow-sm">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-1">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Browse {title}
            </p>
            <p className="text-sm text-muted-foreground">
              {loading ? "Loading results..." : `${rows.length} ${title.toLowerCase()} shown`}
            </p>
          </div>
          <div className="w-full max-w-sm space-y-2">
            <label htmlFor="catalog-search" className="text-sm font-medium">
              Search {title}
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
        {loading ? (
          <div className="rounded-2xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
            Loading {title.toLowerCase()}...
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
            No {title.toLowerCase()} match this search.
          </div>
        ) : (
          <TableRoot variant="surface" striped containerClassName={CATALOG_TABLE_CONTAINER_CLASS}>
            <TableHeader className="[&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-card">
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
                  <TableCell>{row.left_value ?? "-"}</TableCell>
                  <TableCell>{row.right_value ?? "-"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </TableRoot>
        )}
      </Card>
    </div>
  );
}
