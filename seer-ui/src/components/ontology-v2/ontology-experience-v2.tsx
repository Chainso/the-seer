"use client";

import { FormEvent, KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { AiResponsePanel } from "@/components/ai-response-panel";
import { RunState, RunStatePill } from "@/components/run-state-pill";
import {
  DEFAULT_RELATION_SCOPE_FILTERS,
  ONTOLOGY_TAB_META,
  ONTOLOGY_TABS,
  OntologyExplorerTab,
  OntologyNeighborhoodGraphViewModel,
  OntologyRelationScope,
  OntologyRelationScopeFilters,
  adaptOntologyConceptRelations,
  adaptOntologyNeighborhoodGraph,
  buildOntologyNeighborhoodQuery,
  buildOntologyTabCounts,
  filterOntologyConceptsForTab,
  normalizeOntologyTab,
} from "@/lib/adapters/ontology-v2-adapter";
import { AiOntologyQuestionResponse, askAiOntologyQuestion } from "@/lib/backend-ai";
import {
  OntologyConceptDetail,
  OntologyConceptSummary,
  OntologyCurrent,
  OntologySparqlQueryResponse,
  fetchOntologyConceptDetail,
  fetchOntologyConcepts,
  fetchOntologyCurrent,
  runOntologyReadOnlyQuery,
} from "@/lib/backend-ontology";

import styles from "./ontology-experience-v2.module.css";

const NEIGHBORHOOD_QUERY_ROWS = 180;
const EDGE_BUDGET_OPTIONS = [16, 32, 48, 80, 120];
const COPILOT_STORAGE_KEY = "seer_ontology_v2_threads";
const COPILOT_ACTIVE_THREAD_KEY = "seer_ontology_v2_active_thread_id";

type CopilotMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  at: string;
  ai?: AiOntologyQuestionResponse;
};

type CopilotThread = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: CopilotMessage[];
};

function makeThreadId(): string {
  return `ontology-thread-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function makeCopilotMessageId(role: CopilotMessage["role"]): string {
  return `copilot-${role}-${makeThreadId()}`;
}

function createEmptyThread(title = "New thread"): CopilotThread {
  const now = new Date().toISOString();
  return {
    id: makeThreadId(),
    title,
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
}

function buildThreadTitle(prompt: string): string {
  const compact = prompt.trim().replace(/\s+/g, " ");
  if (!compact) {
    return "New thread";
  }
  return compact.length <= 56 ? compact : `${compact.slice(0, 56)}...`;
}

function formatLocalTimestamp(value: string): string {
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function parseStoredThreads(raw: string | null): CopilotThread[] {
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as CopilotThread[];
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter((thread) => thread && typeof thread.id === "string" && Array.isArray(thread.messages))
      .map((thread): CopilotThread => ({
        id: thread.id,
        title: typeof thread.title === "string" ? thread.title : "Conversation",
        createdAt: thread.createdAt || new Date().toISOString(),
        updatedAt: thread.updatedAt || thread.createdAt || new Date().toISOString(),
        messages: thread.messages
          .filter((message) => message && typeof message.id === "string")
          .map((message): CopilotMessage => ({
            id: message.id,
            role: message.role === "assistant" ? "assistant" : "user",
            text: typeof message.text === "string" ? message.text : "",
            at: message.at || new Date().toISOString(),
            ai: message.ai,
          })),
      }))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  } catch {
    return [];
  }
}

function applyThreadMessageUpdate(
  threads: CopilotThread[],
  threadId: string,
  updater: (messages: CopilotMessage[]) => CopilotMessage[],
  titleSeed?: string
): CopilotThread[] {
  const updated = threads.map((thread) => {
    if (thread.id !== threadId) {
      return thread;
    }
    const nextMessages = updater(thread.messages).slice(-120);
    const nextTitle =
      thread.title === "New thread" && titleSeed ? buildThreadTitle(titleSeed) : thread.title;
    return {
      ...thread,
      title: nextTitle,
      updatedAt: new Date().toISOString(),
      messages: nextMessages,
    };
  });
  return updated.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function edgeScopeLabel(scope: OntologyRelationScope): string {
  if (scope === "lifecycle") {
    return "Lifecycle";
  }
  if (scope === "automation") {
    return "Automation";
  }
  if (scope === "reference") {
    return "Reference";
  }
  return "Structure";
}

function tabScopeHint(tab: OntologyExplorerTab): string {
  if (tab === "objects") {
    return "Object-state semantics";
  }
  if (tab === "actions") {
    return "Action contracts";
  }
  if (tab === "events") {
    return "Signal and transition semantics";
  }
  if (tab === "triggers") {
    return "Automation links";
  }
  return "Cross-domain overview";
}

export function OntologyExperienceV2() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const urlTab = normalizeOntologyTab(searchParams.get("tab"));
  const urlConcept = searchParams.get("concept") ?? "";
  const activeTab = urlTab;
  const selectedIri = urlConcept;

  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [edgeBudget, setEdgeBudget] = useState(EDGE_BUDGET_OPTIONS[2]);
  const [scopeFilters, setScopeFilters] = useState<OntologyRelationScopeFilters>(() => ({
    ...DEFAULT_RELATION_SCOPE_FILTERS,
  }));

  const [currentState, setCurrentState] = useState<{
    loading: boolean;
    data: OntologyCurrent | null;
    error: string | null;
  }>({
    loading: true,
    data: null,
    error: null,
  });
  const [conceptState, setConceptState] = useState<{
    searchKey: string | null;
    data: OntologyConceptSummary[];
    error: string | null;
  }>({
    searchKey: null,
    data: [],
    error: null,
  });
  const [detailState, setDetailState] = useState<{
    conceptIri: string | null;
    detail: OntologyConceptDetail | null;
    neighborhood: OntologySparqlQueryResponse | null;
    error: string | null;
  }>({
    conceptIri: null,
    detail: null,
    neighborhood: null,
    error: null,
  });

  const replaceRoute = useCallback(
    (nextTab: OntologyExplorerTab, nextConcept: string): void => {
      const next = new URLSearchParams(searchParams.toString());
      const currentTab = searchParams.get("tab") ?? "";
      const currentConcept = searchParams.get("concept") ?? "";
      if (currentTab === nextTab && currentConcept === nextConcept) {
        return;
      }
      next.set("tab", nextTab);
      if (nextConcept) {
        next.set("concept", nextConcept);
      } else {
        next.delete("concept");
      }
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  function selectTab(tab: OntologyExplorerTab): void {
    replaceRoute(tab, selectedIri);
  }

  function selectConcept(iri: string): void {
    replaceRoute(activeTab, iri);
  }

  useEffect(() => {
    const currentTab = searchParams.get("tab");
    if (currentTab && currentTab === activeTab) {
      return;
    }
    replaceRoute(activeTab, selectedIri);
  }, [activeTab, replaceRoute, searchParams, selectedIri]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      setDebouncedSearch(searchInput.trim());
    }, 220);
    return () => clearTimeout(timeout);
  }, [searchInput]);

  useEffect(() => {
    let canceled = false;
    fetchOntologyCurrent()
      .then((response) => {
        if (!canceled) {
          setCurrentState({
            loading: false,
            data: response,
            error: null,
          });
        }
      })
      .catch((error: Error) => {
        if (!canceled) {
          setCurrentState({
            loading: false,
            data: null,
            error: error.message,
          });
        }
      });
    return () => {
      canceled = true;
    };
  }, []);

  useEffect(() => {
    let canceled = false;
    fetchOntologyConcepts(debouncedSearch)
      .then((response) => {
        if (canceled) {
          return;
        }
        setConceptState({
          searchKey: debouncedSearch,
          data: response,
          error: null,
        });
        if (!selectedIri && response.length > 0) {
          replaceRoute(activeTab, response[0].iri);
        }
      })
      .catch((error: Error) => {
        if (!canceled) {
          setConceptState({
            searchKey: debouncedSearch,
            data: [],
            error: error.message,
          });
        }
      });
    return () => {
      canceled = true;
    };
  }, [activeTab, debouncedSearch, replaceRoute, selectedIri]);

  const detailQueryState = (() => {
    if (!selectedIri) {
      return {
        query: null,
        error: null,
      };
    }
    try {
      return {
        query: buildOntologyNeighborhoodQuery(selectedIri, NEIGHBORHOOD_QUERY_ROWS),
        error: null,
      };
    } catch (error) {
      return {
        query: null,
        error: error instanceof Error ? error.message : "Invalid concept IRI.",
      };
    }
  })();

  useEffect(() => {
    if (!selectedIri || !detailQueryState.query) {
      return;
    }

    let canceled = false;

    Promise.all([
      fetchOntologyConceptDetail(selectedIri),
      runOntologyReadOnlyQuery(detailQueryState.query),
    ])
      .then(([detailResponse, neighborhoodResponse]) => {
        if (!canceled) {
          setDetailState({
            conceptIri: selectedIri,
            detail: detailResponse,
            neighborhood: neighborhoodResponse,
            error: null,
          });
        }
      })
      .catch((error: Error) => {
        if (!canceled) {
          setDetailState({
            conceptIri: selectedIri,
            detail: null,
            neighborhood: null,
            error: error.message,
          });
        }
      });

    return () => {
      canceled = true;
    };
  }, [detailQueryState.query, selectedIri]);

  const current = currentState.data;
  const concepts = conceptState.data;
  const detail = detailState.conceptIri === selectedIri ? detailState.detail : null;
  const neighborhood =
    detailState.conceptIri === selectedIri ? detailState.neighborhood : null;
  const loadingCurrent = currentState.loading;
  const loadingConcepts = conceptState.searchKey !== debouncedSearch;
  const loadingDetail = Boolean(selectedIri && detailQueryState.query && detailState.conceptIri !== selectedIri);
  const explorerError =
    (selectedIri ? detailQueryState.error : null) ??
    (detailState.conceptIri === selectedIri ? detailState.error : null) ??
    (conceptState.searchKey === debouncedSearch ? conceptState.error : null) ??
    currentState.error;

  const tabCounts = useMemo(() => buildOntologyTabCounts(concepts), [concepts]);
  const tabConcepts = filterOntologyConceptsForTab(concepts, activeTab);

  const focusConcept = (() => {
    if (!selectedIri) {
      return null;
    }
    if (detail && detail.iri === selectedIri) {
      return {
        iri: detail.iri,
        label: detail.label,
        category: detail.category,
      };
    }
    const fallback = concepts.find((concept) => concept.iri === selectedIri);
    if (fallback) {
      return fallback;
    }
    return {
      iri: selectedIri,
      label: selectedIri,
      category: "Concept",
    };
  })();

  const relationView = (() => {
    if (!detail || detail.iri !== selectedIri) {
      return null;
    }
    return adaptOntologyConceptRelations(detail);
  })();

  const graphViewModel = (() => {
    if (!focusConcept) {
      return null;
    }
    return adaptOntologyNeighborhoodGraph({
      focus: focusConcept,
      concepts,
      queryResponse: neighborhood,
      tab: activeTab,
      scopeFilters,
      maxEdges: edgeBudget,
    });
  })();

  const activeTabMeta = ONTOLOGY_TAB_META[activeTab];
  const isReady = Boolean(current?.release_id);
  const selectedInCurrentTab = tabConcepts.some((concept) => concept.iri === selectedIri);

  function toggleScope(scope: OntologyRelationScope): void {
    setScopeFilters((existing) => ({
      ...existing,
      [scope]: !existing[scope],
    }));
  }

  return (
    <main className={styles.shell}>
      <section className={styles.headerCard}>
        <div className={styles.headerLead}>
          <p className="eyebrow">Phase B • Ontology Experience v2</p>
          <h1>Ontology Explorer and Copilot</h1>
          <p>
            Graph-first ontology exploration with bounded neighborhood rendering, tabbed domain
            views, and deep-linkable concept context. This experience is read-only by design.
          </p>
        </div>
        <div className={styles.headerStatus}>
          <p className={`status ${isReady ? "ok" : "degraded"}`}>
            {isReady
              ? `Current release: ${current?.release_id}`
              : "No current ontology release is available"}
          </p>
          <p className={styles.readOnlyBadge}>Read-only enforced: no create, edit, delete, publish actions.</p>
          <p className={styles.releaseMeta}>
            {loadingCurrent
              ? "Checking release status..."
              : `Graph: ${current?.current_graph_iri ?? "none"} · Updated ${current?.updated_at ? formatLocalTimestamp(current.updated_at) : "unknown"}`}
          </p>
        </div>
      </section>

      <section className={styles.workspace} aria-label="Ontology v2 workspace">
        <article className={styles.explorerPanel}>
          <header className={styles.panelHeader}>
            <h2>Explorer</h2>
            <p>{activeTabMeta.summary}</p>
          </header>

          <nav className={styles.tabStrip} aria-label="Ontology tabs">
            {ONTOLOGY_TABS.map((tab) => {
              const meta = ONTOLOGY_TAB_META[tab];
              const isActive = tab === activeTab;
              return (
                <button
                  key={tab}
                  type="button"
                  className={`${styles.tabButton} ${isActive ? styles.tabButtonActive : ""}`}
                  aria-current={isActive ? "page" : undefined}
                  onClick={() => selectTab(tab)}
                >
                  <span>{meta.title}</span>
                  <small>{tabCounts[tab]}</small>
                </button>
              );
            })}
          </nav>

          <label htmlFor="ontology-v2-search" className="field-label">
            Search concepts
          </label>
          <input
            id="ontology-v2-search"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Search by concept label"
          />
          <p className={styles.searchMeta}>
            {loadingConcepts ? "Refreshing concept index..." : `${tabConcepts.length} concepts in this tab`}
          </p>

          {explorerError ? (
            <p role="alert" className="status degraded">
              {explorerError}
            </p>
          ) : null}

          {!selectedInCurrentTab && selectedIri ? (
            <p className={styles.selectionHint}>
              Selected concept is outside this tab filter. Switch tabs or pick a concept below.
            </p>
          ) : null}

          <ul className={styles.conceptList} aria-label={`${activeTabMeta.title} concepts`}>
            {tabConcepts.map((concept) => {
              const isActive = concept.iri === selectedIri;
              return (
                <li key={concept.iri}>
                  <button
                    type="button"
                    className={`${styles.conceptButton} ${isActive ? styles.conceptButtonActive : ""}`}
                    onClick={() => selectConcept(concept.iri)}
                  >
                    <span className={styles.conceptTitle}>{concept.label}</span>
                    <span className={styles.conceptCategory}>{concept.category}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </article>

        <article className={styles.graphPanel}>
          <header className={styles.panelHeader}>
            <h2>Graph Window</h2>
            <p>
              {tabScopeHint(activeTab)} · Bounded one-hop view around a selected concept using
              canonical read-only ontology contracts.
            </p>
          </header>

          <div className={styles.graphControls}>
            <label htmlFor="graph-budget" className={styles.controlLabel}>
              Edge budget
            </label>
            <select
              id="graph-budget"
              value={edgeBudget}
              onChange={(event) => setEdgeBudget(Number(event.target.value))}
            >
              {EDGE_BUDGET_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option} edges
                </option>
              ))}
            </select>
            <div className={styles.scopeFilters} role="group" aria-label="Relationship scope filters">
              {(Object.keys(scopeFilters) as OntologyRelationScope[]).map((scope) => (
                <label key={scope} className={styles.scopeToggle}>
                  <input
                    type="checkbox"
                    checked={scopeFilters[scope]}
                    onChange={() => toggleScope(scope)}
                  />
                  {edgeScopeLabel(scope)}
                </label>
              ))}
            </div>
          </div>

          <OntologyNeighborhoodGraph
            graph={graphViewModel}
            selectedIri={selectedIri}
            loading={loadingDetail}
            onSelectConcept={selectConcept}
          />

          <div className={styles.detailPane}>
            <h3>Concept Detail</h3>
            {loadingDetail ? <p>Loading concept details...</p> : null}
            {detail && detail.iri === selectedIri ? (
              <>
                <p className={styles.detailTitle}>{detail.label}</p>
                <p className={styles.detailMeta}>
                  {detail.category} · <code>{detail.iri}</code>
                </p>
                <p>{detail.comment || "No description is available for this concept."}</p>
                <div className={styles.relationColumns}>
                  <section>
                    <p className="field-label">Outgoing predicates</p>
                    {relationView?.outgoing.length ? (
                      <ul className={styles.relationList}>
                        {relationView.outgoing.slice(0, 12).map((relation) => (
                          <li key={relation.iri}>
                            <span>{relation.label}</span>
                            <small>{edgeScopeLabel(relation.scope)}</small>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p>None</p>
                    )}
                  </section>
                  <section>
                    <p className="field-label">Incoming predicates</p>
                    {relationView?.incoming.length ? (
                      <ul className={styles.relationList}>
                        {relationView.incoming.slice(0, 12).map((relation) => (
                          <li key={relation.iri}>
                            <span>{relation.label}</span>
                            <small>{edgeScopeLabel(relation.scope)}</small>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p>None</p>
                    )}
                  </section>
                </div>
              </>
            ) : (
              <p>Select a concept to inspect relation detail.</p>
            )}
          </div>
        </article>

        <OntologyCopilotPanel selectedConcept={focusConcept} />
      </section>
    </main>
  );
}

function OntologyNeighborhoodGraph(props: {
  graph: OntologyNeighborhoodGraphViewModel | null;
  selectedIri: string;
  loading: boolean;
  onSelectConcept: (iri: string) => void;
}) {
  const { graph, selectedIri, loading, onSelectConcept } = props;

  const layout = useMemo(() => {
    if (!graph || graph.nodes.length === 0) {
      return null;
    }
    const width = 760;
    const height = 420;
    const centerX = width / 2;
    const centerY = height / 2;
    const focus = graph.nodes.find((node) => node.is_focus);
    if (!focus) {
      return null;
    }

    const positions = new Map<string, { x: number; y: number }>();
    positions.set(focus.iri, { x: centerX, y: centerY });

    const neighbors = graph.nodes.filter((node) => !node.is_focus);
    const radius = Math.min(180 + Math.max(neighbors.length - 10, 0) * 5, 250);
    neighbors.forEach((node, index) => {
      const angle = (-Math.PI / 2) + (Math.PI * 2 * index) / Math.max(neighbors.length, 1);
      positions.set(node.iri, {
        x: centerX + radius * Math.cos(angle),
        y: centerY + radius * Math.sin(angle),
      });
    });

    return {
      width,
      height,
      positions,
    };
  }, [graph]);

  if (!graph) {
    return <p className={styles.graphEmpty}>Select a concept to render a bounded graph neighborhood.</p>;
  }

  if (loading) {
    return <p className={styles.graphEmpty}>Loading graph neighborhood...</p>;
  }

  if (!layout || graph.nodes.length === 0) {
    return <p className={styles.graphEmpty}>No neighborhood edges were available for this selection.</p>;
  }

  return (
    <section className={styles.graphStage} aria-label="Ontology neighborhood graph">
      <svg
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        role="img"
        aria-label="Radial graph of selected ontology concept"
      >
        <defs>
          <marker id="arrow-structure" markerWidth="8" markerHeight="8" refX="6.5" refY="4" orient="auto">
            <path d="M0,0 L8,4 L0,8 Z" className={styles.arrowStructure} />
          </marker>
          <marker id="arrow-lifecycle" markerWidth="8" markerHeight="8" refX="6.5" refY="4" orient="auto">
            <path d="M0,0 L8,4 L0,8 Z" className={styles.arrowLifecycle} />
          </marker>
          <marker id="arrow-automation" markerWidth="8" markerHeight="8" refX="6.5" refY="4" orient="auto">
            <path d="M0,0 L8,4 L0,8 Z" className={styles.arrowAutomation} />
          </marker>
          <marker id="arrow-reference" markerWidth="8" markerHeight="8" refX="6.5" refY="4" orient="auto">
            <path d="M0,0 L8,4 L0,8 Z" className={styles.arrowReference} />
          </marker>
        </defs>

        {graph.edges.map((edge) => {
          const source = layout.positions.get(edge.source_iri);
          const target = layout.positions.get(edge.target_iri);
          if (!source || !target) {
            return null;
          }
          const markerId = `url(#arrow-${edge.scope})`;
          const label =
            edge.predicates.length > 1
              ? `${edge.primary_predicate} +${edge.predicates.length - 1}`
              : edge.primary_predicate;
          const midX = (source.x + target.x) / 2;
          const midY = (source.y + target.y) / 2;
          return (
            <g key={edge.id}>
              <line
                x1={source.x}
                y1={source.y}
                x2={target.x}
                y2={target.y}
                markerEnd={markerId}
                className={edgeClassName(edge.scope)}
              />
              <text x={midX} y={midY} className={styles.edgeLabel}>
                {label}
              </text>
            </g>
          );
        })}

        {graph.nodes.map((node) => {
          const point = layout.positions.get(node.iri);
          if (!point) {
            return null;
          }
          const radius = node.is_focus ? 34 : 20;
          const isSelected = node.iri === selectedIri;
          return (
            <g
              key={node.iri}
              role="button"
              tabIndex={0}
              aria-label={`${node.label} (${node.category})`}
              onClick={() => onSelectConcept(node.iri)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelectConcept(node.iri);
                }
              }}
            >
              <circle
                cx={point.x}
                cy={point.y}
                r={radius}
                className={`${nodeClassName(node.category)} ${isSelected ? styles.nodeSelected : ""}`}
              />
              <text x={point.x} y={point.y} textAnchor="middle" dominantBaseline="middle" className={styles.nodeLabel}>
                {node.label.length > 18 ? `${node.label.slice(0, 16)}...` : node.label}
              </text>
            </g>
          );
        })}
      </svg>

      <div className={styles.graphLegend}>
        <p>
          Showing {graph.edges.length} / {graph.total_edges} edges
          {graph.truncated ? " (bounded)" : ""}.
        </p>
      </div>

      <ul className={styles.neighborList} aria-label="Neighbor concepts">
        {graph.nodes
          .filter((node) => !node.is_focus)
          .map((node) => (
            <li key={node.iri}>
              <button type="button" onClick={() => onSelectConcept(node.iri)}>
                <span>{node.label}</span>
                <small>
                  {node.category} · degree {node.degree}
                </small>
              </button>
            </li>
          ))}
      </ul>
    </section>
  );
}

function edgeClassName(scope: OntologyRelationScope): string {
  if (scope === "lifecycle") {
    return styles.edgeLifecycle;
  }
  if (scope === "automation") {
    return styles.edgeAutomation;
  }
  if (scope === "reference") {
    return styles.edgeReference;
  }
  return styles.edgeStructure;
}

function nodeClassName(category: string): string {
  const normalized = category.toLowerCase();
  if (normalized.includes("object") || normalized.includes("state")) {
    return styles.nodeObject;
  }
  if (normalized.includes("action") || normalized.includes("process") || normalized.includes("workflow")) {
    return styles.nodeAction;
  }
  if (normalized.includes("signal") || normalized.includes("transition")) {
    return styles.nodeEvent;
  }
  return styles.nodeGeneric;
}

function OntologyCopilotPanel({ selectedConcept }: { selectedConcept: OntologyConceptSummary | null }) {
  const [threads, setThreads] = useState<CopilotThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState("");
  const [composer, setComposer] = useState("");
  const [runState, setRunState] = useState<RunState>("completed");
  const [error, setError] = useState<string | null>(null);
  const [storageLoaded, setStorageLoaded] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    let canceled = false;
    const storedThreads = parseStoredThreads(localStorage.getItem(COPILOT_STORAGE_KEY));
    const initialThreads = storedThreads.length > 0 ? storedThreads : [createEmptyThread()];
    const storedActiveId = localStorage.getItem(COPILOT_ACTIVE_THREAD_KEY);
    const activeId =
      storedActiveId && initialThreads.some((thread) => thread.id === storedActiveId)
        ? storedActiveId
        : initialThreads[0]?.id ?? "";
    Promise.resolve().then(() => {
      if (canceled) {
        return;
      }
      setThreads(initialThreads);
      setActiveThreadId(activeId);
      setStorageLoaded(true);
    });
    return () => {
      canceled = true;
    };
  }, []);

  useEffect(() => {
    if (!storageLoaded) {
      return;
    }
    localStorage.setItem(COPILOT_STORAGE_KEY, JSON.stringify(threads));
  }, [storageLoaded, threads]);

  useEffect(() => {
    if (!storageLoaded || !activeThreadId) {
      return;
    }
    localStorage.setItem(COPILOT_ACTIVE_THREAD_KEY, activeThreadId);
  }, [activeThreadId, storageLoaded]);

  const activeThread = useMemo(
    () => threads.find((thread) => thread.id === activeThreadId) ?? null,
    [activeThreadId, threads]
  );

  const quickPrompts = useMemo(() => {
    const conceptLabel = selectedConcept?.label ?? "this concept";
    return [
      `Explain ${conceptLabel} in business terms.`,
      `What transitions depend on ${conceptLabel}?`,
      `Which signals are most related to ${conceptLabel}?`,
    ];
  }, [selectedConcept]);

  function updateThreadMessages(
    threadId: string,
    updater: (messages: CopilotMessage[]) => CopilotMessage[],
    titleSeed?: string
  ): void {
    setThreads((existing) => applyThreadMessageUpdate(existing, threadId, updater, titleSeed));
  }

  function createThread(): void {
    const thread = createEmptyThread();
    setThreads((existing) => [thread, ...existing]);
    setActiveThreadId(thread.id);
    setComposer("");
    setError(null);
    textareaRef.current?.focus();
  }

  async function askQuestion(promptOverride?: string): Promise<void> {
    const prompt = (promptOverride ?? composer).trim();
    if (!prompt || !activeThread) {
      return;
    }

    const targetThreadId = activeThread.id;
    const userMessage: CopilotMessage = {
      id: makeCopilotMessageId("user"),
      role: "user",
      text: prompt,
      at: new Date().toISOString(),
    };

    const conversation = [...activeThread.messages, userMessage].map((message) => ({
      role: message.role,
      content: message.text,
    }));

    updateThreadMessages(targetThreadId, (messages) => [...messages, userMessage], prompt);
    setComposer("");
    setError(null);
    setRunState("queued");
    await Promise.resolve();
    setRunState("running");

    try {
      const answer = await askAiOntologyQuestion({
        question: prompt,
        conversation,
      });
      const assistantMessage: CopilotMessage = {
        id: makeCopilotMessageId("assistant"),
        role: "assistant",
        text: answer.summary,
        at: new Date().toISOString(),
        ai: answer,
      };
      updateThreadMessages(targetThreadId, (messages) => [...messages, assistantMessage]);
      setRunState("completed");
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : "Copilot request failed.";
      const assistantMessage: CopilotMessage = {
        id: makeCopilotMessageId("assistant"),
        role: "assistant",
        text: `Copilot error: ${message}`,
        at: new Date().toISOString(),
      };
      updateThreadMessages(targetThreadId, (messages) => [...messages, assistantMessage]);
      setError(message);
      setRunState("error");
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void askQuestion();
  }

  function onComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (runState !== "running") {
        void askQuestion();
      }
    }
  }

  return (
    <article className={styles.copilotPanel}>
      <header className={styles.panelHeader}>
        <h2>Copilot Mission Control</h2>
        <p>
          Threaded ontology conversations via <code>/api/v1/ai/ontology/question</code>.
        </p>
      </header>

      <div className={styles.copilotToolbar}>
        <RunStatePill state={runState} label={`Copilot ${runState}`} />
        <button type="button" onClick={createThread} className={styles.newThreadButton}>
          New thread
        </button>
      </div>

      {error ? (
        <p className="status degraded" role="alert">
          {error}
        </p>
      ) : null}

      <div className={styles.copilotWorkspace}>
        <nav className={styles.threadRail} aria-label="Copilot threads">
          {storageLoaded ? (
            threads.map((thread) => {
              const isActive = thread.id === activeThreadId;
              return (
                <button
                  key={thread.id}
                  type="button"
                  className={`${styles.threadButton} ${isActive ? styles.threadButtonActive : ""}`}
                  onClick={() => setActiveThreadId(thread.id)}
                >
                  <span>{thread.title}</span>
                  <small>
                    {thread.messages.length} messages · {formatLocalTimestamp(thread.updatedAt)}
                  </small>
                </button>
              );
            })
          ) : (
            <p>Loading threads...</p>
          )}
        </nav>

        <div className={styles.chatColumn}>
          <div className={styles.quickPromptRow}>
            {quickPrompts.map((prompt) => (
              <button
                key={prompt}
                type="button"
                onClick={() => void askQuestion(prompt)}
                disabled={runState === "running"}
              >
                {prompt}
              </button>
            ))}
          </div>

          <div className={styles.chatLog} aria-live="polite">
            {!activeThread || activeThread.messages.length === 0 ? (
              <p className={styles.chatEmpty}>Ask about concept semantics, lifecycle, or trigger dependencies.</p>
            ) : (
              activeThread.messages.map((message) => (
                <div
                  key={message.id}
                  className={`${styles.chatMessage} ${message.role === "user" ? styles.chatUser : styles.chatAssistant}`}
                >
                  <header>
                    <strong>{message.role === "user" ? "You" : "Copilot"}</strong>
                    <small>{formatLocalTimestamp(message.at)}</small>
                  </header>
                  <p>{message.text}</p>
                  {message.ai ? (
                    <AiResponsePanel
                      title="Evidence"
                      summary={message.ai.summary}
                      evidence={message.ai.evidence}
                      caveats={message.ai.caveats}
                      nextActions={message.ai.next_actions}
                    />
                  ) : null}
                </div>
              ))
            )}
          </div>

          <form onSubmit={onSubmit} className={styles.composer}>
            <label htmlFor="ontology-copilot-composer" className="field-label">
              Ask copilot
            </label>
            <textarea
              ref={textareaRef}
              id="ontology-copilot-composer"
              rows={4}
              value={composer}
              onChange={(event) => setComposer(event.target.value)}
              onKeyDown={onComposerKeyDown}
              placeholder="Enter to send, Shift+Enter for newline."
            />
            <button type="submit" disabled={runState === "running" || !composer.trim()}>
              {runState === "running" ? "Answering..." : "Send question"}
            </button>
          </form>
        </div>
      </div>
    </article>
  );
}
