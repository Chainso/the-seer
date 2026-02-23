export type OntologyCurrent = {
  release_id: string | null;
  current_graph_iri: string | null;
  meta_graph_iri: string;
  updated_at: string | null;
};

export type OntologyConceptSummary = {
  iri: string;
  label: string;
  category: string;
};

export type OntologyConceptDetail = {
  iri: string;
  label: string;
  category: string;
  comment: string | null;
  outgoing_relations: string[];
  incoming_relations: string[];
};

export type OntologySparqlQueryResponse = {
  query_type: "SELECT" | "ASK";
  bindings: Array<Record<string, string>>;
  ask_result: boolean | null;
  graphs: string[];
};

export type CopilotAnswer = {
  mode: "direct_answer" | "tool_call";
  answer: string;
  evidence: Array<{
    concept_iri: string;
    query: string;
  }>;
  current_release_id: string | null;
  tool_call: {
    tool: "sparql_read_only_query";
    query: string;
  } | null;
  tool_result: {
    tool: "sparql_read_only_query";
    query: string;
    query_type: "SELECT" | "ASK" | null;
    variables: string[];
    rows: Array<Record<string, string>>;
    ask_result: boolean | null;
    row_count: number;
    truncated: boolean;
    graphs: string[];
    error: string | null;
  } | null;
};

export type CopilotConversationMessage = {
  role: "user" | "assistant";
  content: string;
};

const DEFAULT_BACKEND_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

async function getJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${DEFAULT_BACKEND_URL}${path}`, {
    cache: "no-store",
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`HTTP ${response.status}: ${body || "Request failed"}`);
  }
  return (await response.json()) as T;
}

export function fetchOntologyCurrent(): Promise<OntologyCurrent> {
  return getJson<OntologyCurrent>("/api/v1/ontology/current");
}

export function fetchOntologyConcepts(search: string): Promise<OntologyConceptSummary[]> {
  const params = new URLSearchParams({ search, limit: "50" });
  return getJson<OntologyConceptSummary[]>(`/api/v1/ontology/concepts?${params.toString()}`);
}

export function fetchOntologyConceptDetail(iri: string): Promise<OntologyConceptDetail> {
  const params = new URLSearchParams({ iri });
  return getJson<OntologyConceptDetail>(`/api/v1/ontology/concept-detail?${params.toString()}`);
}

export function runOntologyReadOnlyQuery(query: string): Promise<OntologySparqlQueryResponse> {
  return getJson<OntologySparqlQueryResponse>("/api/v1/ontology/query", {
    method: "POST",
    body: JSON.stringify({ query }),
  });
}

export function askOntologyCopilot(
  question: string,
  conversation: CopilotConversationMessage[]
): Promise<CopilotAnswer> {
  return getJson<CopilotAnswer>("/api/v1/ontology/copilot", {
    method: "POST",
    body: JSON.stringify({ question, conversation }),
  });
}
