import { redirect } from "next/navigation";

import { mapLegacyOntologyTabToCatalogKind } from "@/app/lib/catalog-routes";

interface OntologyLegacyTabPageProps {
  params: Promise<{ tab: string }>;
}

export default async function OntologyLegacyTabPage({ params }: OntologyLegacyTabPageProps) {
  const { tab } = await params;
  const catalogKind = mapLegacyOntologyTabToCatalogKind(tab);
  redirect(`/catalog/${catalogKind}`);
}
