"use client";

import { startTransition } from "react";
import { useRouter } from "next/navigation";

import { Tabs, TabsList, TabsTrigger } from "@/app/components/ui/tabs";
import {
  buildCatalogKindHref,
  CATALOG_KIND_LABEL,
  CATALOG_KIND_ORDER,
} from "@/app/lib/catalog-routes";
import type { CatalogKind } from "@/app/types/catalog";

export function CatalogKindTabs({ kind }: { kind: CatalogKind }) {
  const router = useRouter();

  return (
    <Tabs
      value={kind}
      onValueChange={(nextValue) => {
        if (nextValue === kind) {
          return;
        }
        const nextKind = CATALOG_KIND_ORDER.find((value) => value === nextValue);
        if (!nextKind) {
          return;
        }
        startTransition(() => {
          router.push(buildCatalogKindHref(nextKind));
        });
      }}
      className="space-y-5"
    >
      <TabsList variant="rail" className="grid grid-cols-2 gap-0 sm:grid-cols-4">
        {CATALOG_KIND_ORDER.map((itemKind) => (
          <TabsTrigger
            key={itemKind}
            value={itemKind}
            variant="rail"
            className="min-h-[72px] justify-center px-2 py-0"
          >
            <div className="flex w-full flex-col items-center gap-1 py-3 text-center">
              <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Catalog
              </span>
              <p className="text-sm font-semibold">{CATALOG_KIND_LABEL[itemKind]}</p>
            </div>
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
