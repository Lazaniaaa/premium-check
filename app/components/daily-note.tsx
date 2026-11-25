import type { Report } from "@/lib/report";
import { REPO_URL } from "@/lib/reports-store";

/** The full daily note with its facts. Shown in the journal; the main page links to it. */
export function DailyNote({ report }: { report: Report }) {
  const byId = new Map(report.facts.map((f) => [f.id, f.text]));
  const a = report.author;
  return (
    <div className="card" id={`note-${report.day}`}>
      <div className="muted" style={{ fontSize: 13 }}>
        Daily Premium Report · {report.day} · general note for $1,000 held 12 months
      </div>
      <div style={{ fontSize: 17, fontWeight: 650, margin: "2px 0 6px" }}>{report.note.headline}</div>
      <ul className="notes" style={{ color: "var(--text)", fontSize: 14 }}>
        {report.note.points.map((p, i) => (
          <li key={i}>
            {p.text}{" "}
            {p.facts.map((f) => (
              <span key={f} className="chip" title={byId.get(f)}>
                {f}
              </span>
            ))}
          </li>
        ))}
      </ul>
      <details style={{ marginTop: 8 }}>
        <summary className="muted" style={{ cursor: "pointer", fontSize: 13 }}>
          How this note is made: facts and checks
        </summary>
        <p className="muted" style={{ fontSize: 13 }}>
          Our code computes the facts below from that day&apos;s snapshot.{" "}
          {a.kind === "llm"
            ? report.note.points.some((p) => p.template)
              ? `${a.model} wrote the sentences using {variables} only — it typed no digits or fund tickers — and code inserted every number and name from the facts below (accepted on attempt ${a.attempts}).`
              : `${a.model} turned them into prose; a validator checked every number against the facts each sentence cites (earlier method, before 25 Nov 2026).`
            : `The AI writer was not used (${a.reason}); this is the template version.`}{" "}
          Raw file: <a href={`${REPO_URL}/blob/main/data/reports/${report.day}.json`}>data/reports/{report.day}.json</a>
        </p>
        <ul className="notes">
          {report.facts.map((f) => (
            <li key={f.id}>
              <b>{f.id}</b> {f.text}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
