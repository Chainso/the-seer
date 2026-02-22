"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

import { AiResponsePanel } from "@/components/ai-response-panel";
import { RunStatePill, RunState } from "@/components/run-state-pill";
import {
  AiOntologyQuestionResponse,
  askAiOntologyQuestion,
} from "@/lib/backend-ai";
import {
  OntologyConceptDetail,
  OntologyConceptSummary,
  OntologyCurrent,
  fetchOntologyConceptDetail,
  fetchOntologyConcepts,
  fetchOntologyCurrent,
} from "@/lib/backend-ontology";

type ChatMessage = {
  role: "user" | "assistant";
  text: string;
  ai?: AiOntologyQuestionResponse;
};

export function OntologyWorkbench() {
  const [current, setCurrent] = useState<OntologyCurrent | null>(null);
  const [concepts, setConcepts] = useState<OntologyConceptSummary[]>([]);
  const [selectedIri, setSelectedIri] = useState<string>("");
  const [detail, setDetail] = useState<OntologyConceptDetail | null>(null);
  const [search, setSearch] = useState("");
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadingConcepts, setLoadingConcepts] = useState(true);
  const [copilotRunState, setCopilotRunState] = useState<RunState>("completed");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    fetchOntologyCurrent()
      .then((data) => {
        if (mounted) {
          setCurrent(data);
        }
      })
      .catch((err: Error) => {
        if (mounted) {
          setError(err.message);
        }
      });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    fetchOntologyConcepts(search)
      .then((data) => {
        if (!mounted) return;
        setConcepts(data);
        setSelectedIri((existing) =>
          data.length > 0 && !data.some((concept) => concept.iri === existing)
            ? data[0].iri
            : existing
        );
      })
      .catch((err: Error) => {
        if (mounted) {
          setConcepts([]);
          setError(err.message);
        }
      })
      .finally(() => {
        if (mounted) {
          setLoadingConcepts(false);
        }
      });
    return () => {
      mounted = false;
    };
  }, [search]);

  useEffect(() => {
    if (!selectedIri) {
      return;
    }

    let mounted = true;
    fetchOntologyConceptDetail(selectedIri)
      .then((data) => {
        if (mounted) {
          setDetail(data);
        }
      })
      .catch((err: Error) => {
        if (mounted) {
          setError(err.message);
        }
      });
    return () => {
      mounted = false;
    };
  }, [selectedIri]);

  const isReady = useMemo(() => Boolean(current?.release_id), [current]);

  async function onAsk(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedQuestion = question.trim();
    if (!trimmedQuestion) {
      return;
    }

    const conversation = messages
      .filter((message) => message.role === "user" || message.role === "assistant")
      .map((message) => ({
        role: message.role,
        content: message.text,
      }));

    setMessages((existing) => [...existing, { role: "user", text: trimmedQuestion }]);
    setQuestion("");
    setCopilotRunState("queued");
    await Promise.resolve();
    setCopilotRunState("running");

    try {
      const answer = await askAiOntologyQuestion({
        question: trimmedQuestion,
        conversation,
      });
      setMessages((existing) => [
        ...existing,
        {
          role: "assistant",
          text: answer.summary,
          ai: answer,
        },
      ]);
      setCopilotRunState("completed");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setMessages((existing) => [
        ...existing,
        { role: "assistant", text: `Copilot error: ${message}` },
      ]);
      setCopilotRunState("error");
    }
  }

  return (
    <main className="ontology-shell">
      <section className="ontology-header">
        <p className="eyebrow">MVP Phase 5</p>
        <h1>Ontology Explorer and Copilot</h1>
        <p>
          Read-only ontology exploration backed by SHACL-validated release graphs. AI responses use
          the shared gateway contract and module-scoped read-only tool permissions.
        </p>
        <p className={`status ${isReady ? "ok" : "degraded"}`}>
          {isReady
            ? `Current release: ${current?.release_id}`
            : "No current ontology release available"}
        </p>
      </section>

      <section className="ontology-grid" aria-label="Ontology explorer workspace">
        <article className="explorer-panel">
          <header>
            <h2>Explorer</h2>
            <p>Search concepts and inspect graph-linked relationships.</p>
          </header>
          <label htmlFor="concept-search" className="field-label">
            Search concepts
          </label>
          <input
            id="concept-search"
            type="text"
            value={search}
            placeholder="Try Ticket, Transition, ObjectModel..."
            onChange={(event) => {
              setLoadingConcepts(true);
              setError(null);
              setSearch(event.target.value);
            }}
          />
          {loadingConcepts ? <p>Loading concepts...</p> : null}
          {error ? <p className="status degraded">{error}</p> : null}

          <ul className="concept-list">
            {concepts.map((concept) => (
              <li key={concept.iri}>
                <button
                  type="button"
                  className={concept.iri === selectedIri ? "selected" : ""}
                  onClick={() => {
                    setDetail(null);
                    setSelectedIri(concept.iri);
                  }}
                >
                  <span>{concept.label}</span>
                  <small>{concept.category}</small>
                </button>
              </li>
            ))}
          </ul>
        </article>

        <article className="detail-panel">
          <header>
            <h2>Concept Detail</h2>
            <p>URI-backed detail from backend SPARQL tools.</p>
          </header>
          {selectedIri && (!detail || detail.iri !== selectedIri) ? <p>Loading detail...</p> : null}
          {detail && detail.iri === selectedIri ? (
            <div className="detail-content">
              <p className="detail-title">{detail.label}</p>
              <p className="detail-category">{detail.category}</p>
              <p className="detail-iri">{detail.iri}</p>
              <p>{detail.comment ?? "No comment available."}</p>
              <div>
                <p className="field-label">Outgoing predicates</p>
                <p>{detail.outgoing_relations.slice(0, 8).join(", ") || "None"}</p>
              </div>
              <div>
                <p className="field-label">Incoming predicates</p>
                <p>{detail.incoming_relations.slice(0, 8).join(", ") || "None"}</p>
              </div>
            </div>
          ) : (
            <p>Select a concept to inspect details.</p>
          )}
        </article>

        <article className="copilot-panel">
          <header>
            <h2>Ontology Copilot</h2>
            <p>Read-only AI gateway over ontology tools.</p>
          </header>
          <RunStatePill state={copilotRunState} label={`Copilot ${copilotRunState}`} />
          <div className="chat-log" aria-live="polite">
            {messages.length === 0 ? (
              <p className="chat-empty">Ask about ontology concepts, states, or transitions.</p>
            ) : (
              messages.map((message, index) => (
                <div key={`${message.role}-${index}`} className={`chat-message ${message.role}`}>
                  <p>{message.text}</p>
                  {message.ai ? (
                    <AiResponsePanel
                      title="Copilot Evidence"
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
          <form onSubmit={onAsk} className="chat-form">
            <label htmlFor="copilot-question" className="field-label">
              Ask copilot
            </label>
            <textarea
              id="copilot-question"
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              rows={3}
              placeholder="What does Ticket transition from New to Triaged mean?"
            />
            <button type="submit" disabled={copilotRunState === "running"}>
              {copilotRunState === "running" ? "Answering..." : "Send question"}
            </button>
          </form>
        </article>
      </section>
    </main>
  );
}
