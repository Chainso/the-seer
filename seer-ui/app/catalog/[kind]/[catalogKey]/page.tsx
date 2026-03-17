import { Suspense } from "react";
import { redirect } from "next/navigation";

import { CatalogDetailPage } from "@/app/components/catalog/catalog-detail-page";
import { isCatalogKind } from "@/app/lib/catalog-routes";

interface CatalogDetailRoutePageProps {
  params: Promise<{ kind: string; catalogKey: string }>;
}

export default async function CatalogDetailRoutePage({ params }: CatalogDetailRoutePageProps) {
  const { kind, catalogKey } = await params;
  if (!isCatalogKind(kind)) {
    redirect("/catalog/objects");
  }

  return (
    <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Loading catalog detail...</div>}>
      <CatalogDetailPage kind={kind} catalogKey={catalogKey} />
    </Suspense>
  );
}
