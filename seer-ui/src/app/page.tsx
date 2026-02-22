import Link from "next/link";

import { getBackendHealth } from "@/lib/backend-health";

const moduleCards = [
  {
    href: "/ontology",
    title: "Ontology Explorer",
    summary: "Read-only semantic graph browsing and concept inspection.",
    phase: "Phase 1",
  },
  {
    href: "/ingestion",
    title: "Ingestion Monitor",
    summary: "Operational visibility for event and object history ingestion.",
    phase: "Phase 2",
  },
  {
    href: "/process",
    title: "Process Explorer",
    summary: "Object-centric process model and trace drill-down workspace.",
    phase: "Phase 3",
  },
  {
    href: "/root-cause",
    title: "Root-Cause Lab",
    summary: "Outcome-oriented hypothesis ranking and evidence review.",
    phase: "Phase 4",
  },
  {
    href: "/insights",
    title: "Insights Dashboard",
    summary: "Cross-workflow summaries and AI-assisted narrative output.",
    phase: "Phase 5",
  },
];

export default async function Home() {
  const health = await getBackendHealth();

  return (
    <main className="home-shell">
      <section className="hero">
        <p className="eyebrow">Phase 0 Foundation</p>
        <h1>Seer module shell and runtime wiring</h1>
        <p>
          This baseline UI maps the MVP module routes and verifies backend reachability through
          the canonical health endpoint.
        </p>
      </section>

      <section className="health-panel">
        <h2>Backend Connectivity</h2>
        {health.data ? (
          <>
            <p className={`status ${health.data.status}`}>
              {health.data.service} is {health.data.status}
            </p>
            <ul>
              <li>
                Fuseki: {health.data.dependencies.fuseki.host}:{health.data.dependencies.fuseki.port} (
                {health.data.dependencies.fuseki.reachable ? "reachable" : "unreachable"})
              </li>
              <li>
                ClickHouse: {health.data.dependencies.clickhouse.host}:
                {health.data.dependencies.clickhouse.port} (
                {health.data.dependencies.clickhouse.reachable ? "reachable" : "unreachable"})
              </li>
            </ul>
          </>
        ) : (
          <p className="status degraded">
            Unable to reach backend health endpoint
            {health.httpStatus ? ` (HTTP ${health.httpStatus})` : ""}: {health.error}
          </p>
        )}
      </section>

      <section className="module-grid" aria-label="Seer MVP Modules">
        {moduleCards.map((module) => (
          <article key={module.href}>
            <p className="eyebrow">{module.phase}</p>
            <h2>{module.title}</h2>
            <p>{module.summary}</p>
            <Link href={module.href}>Open module shell</Link>
          </article>
        ))}
      </section>
    </main>
  );
}
