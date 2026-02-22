import { ModuleShell } from "@/components/module-shell";

export default function OntologyPage() {
  return (
    <ModuleShell
      eyebrow="Module"
      title="Ontology Explorer"
      summary="Read-only ontology graph exploration shell. Phase 1 adds SHACL-backed ingest and explorer interactions."
      phase="MVP Phase 1"
    />
  );
}
