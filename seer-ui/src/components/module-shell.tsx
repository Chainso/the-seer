import Link from "next/link";

type ModuleShellProps = {
  eyebrow: string;
  title: string;
  summary: string;
  phase: string;
};

export function ModuleShell({ eyebrow, title, summary, phase }: ModuleShellProps) {
  return (
    <main className="module-shell">
      <p className="eyebrow">{eyebrow}</p>
      <h1>{title}</h1>
      <p>{summary}</p>
      <p className="phase">Planned implementation window: {phase}</p>
      <Link href="/" className="back-link">
        Return to module index
      </Link>
    </main>
  );
}
