import { AiEvidenceItem } from "@/lib/backend-ai";

type AiResponsePanelProps = {
  title: string;
  summary: string;
  evidence: AiEvidenceItem[];
  caveats: string[];
  nextActions: string[];
};

export function AiResponsePanel({
  title,
  summary,
  evidence,
  caveats,
  nextActions,
}: AiResponsePanelProps) {
  return (
    <section className="assist-block" aria-label={title}>
      <h3>{title}</h3>
      <p>{summary}</p>

      {evidence.length > 0 ? (
        <div>
          <p className="field-label">Evidence</p>
          <ul>
            {evidence.map((item) => (
              <li key={`${item.label}-${item.detail}`}>
                <strong>{item.label}:</strong> {item.detail}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {caveats.length > 0 ? (
        <div>
          <p className="field-label">Caveats</p>
          <ul>
            {caveats.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {nextActions.length > 0 ? (
        <div>
          <p className="field-label">Next Actions</p>
          <ul>
            {nextActions.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
