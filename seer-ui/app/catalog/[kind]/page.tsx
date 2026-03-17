import { Suspense } from "react";
import { redirect } from "next/navigation";

import { CatalogListPage } from "@/app/components/catalog/catalog-list-page";
import { isCatalogKind } from "@/app/lib/catalog-routes";

interface CatalogKindPageProps {
  params: Promise<{ kind: string }>;
}

export default async function CatalogKindPage({ params }: CatalogKindPageProps) {
  const { kind } = await params;
  if (!isCatalogKind(kind)) {
    redirect("/catalog/objects");
  }

  return (
    <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Loading catalog...</div>}>
      <CatalogListPage kind={kind} />
    </Suspense>
  );
}
