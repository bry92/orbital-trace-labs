import { useMemo, useState } from "react";
import { EVIDENCE_REGISTER, EVIDENCE_STATUS_ORDER, evidenceStatusCounts, type EvidenceStatus } from "../evidence/register";
import { EvidenceBadge, Panel, Stat } from "./components";

export function Evidence() {
  const [filter, setFilter] = useState<EvidenceStatus | "ALL">("ALL");
  const [query, setQuery] = useState("");
  const counts = evidenceStatusCounts();

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return EVIDENCE_REGISTER.filter((r) => (filter === "ALL" ? true : r.status === filter)).filter((r) =>
      q
        ? [r.id, r.claim, r.sourceTitle, r.interpretation, r.value]
            .filter(Boolean)
            .some((v) => String(v).toLowerCase().includes(q))
        : true,
    );
  }, [filter, query]);

  return (
    <div className="stack">
      <Panel
        eyebrow="Evidence register"
        title="Traceable claim classification"
        sub="Every quantitative claim is classified. Conflicts are preserved as conflicts; unknown values stay unknown. Nothing here is invented or inferred from a diameter, a generic material property or a similar mission."
      >
        <div className="grid cols-3">
          {EVIDENCE_STATUS_ORDER.map((s) => (
            <Stat key={s} label={s.replace("_", " ")} value={String(counts[s])} unit="records" />
          ))}
          <Stat label="Total records" value={String(EVIDENCE_REGISTER.length)} unit="claims tracked" />
        </div>

        <CalloutSummary />

        <div className="row" style={{ marginTop: 14 }}>
          <select aria-label="Filter by status" value={filter} onChange={(e) => setFilter(e.target.value as EvidenceStatus | "ALL")}>
            <option value="ALL">All statuses</option>
            {EVIDENCE_STATUS_ORDER.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <input
            type="text"
            aria-label="Search evidence"
            placeholder="search claim, source or interpretation"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ maxWidth: 380 }}
          />
          <span className="small muted">
            {rows.length} of {EVIDENCE_REGISTER.length} records
          </span>
        </div>

        <div className="stack" style={{ marginTop: 12 }}>
          {rows.map((r) => (
            <div key={r.id} className="panel" style={{ marginTop: 0, padding: "14px 16px" }}>
              <div className="row" style={{ alignItems: "baseline" }}>
                <span className="mono small cyan" style={{ color: "var(--cyan)" }}>
                  {r.id}
                </span>
                <EvidenceBadge status={r.status} />
                <span className="badge neutral">confidence {r.confidence.toLowerCase()}</span>
                {r.value && (
                  <span className="mono small" style={{ color: "var(--text)" }}>
                    {r.value} {r.units ?? ""}
                  </span>
                )}
              </div>
              <div style={{ marginTop: 6, fontWeight: 600 }}>{r.claim}</div>
              <div className="small muted" style={{ marginTop: 4 }}>
                {r.interpretation}
              </div>
              <dl className="meta-grid" style={{ marginTop: 10 }}>
                <div className="meta">
                  <dt>Source</dt>
                  <dd>
                    {r.sourceTitle ? (
                      r.sourceUrl ? (
                        <a href={r.sourceUrl} target="_blank" rel="noreferrer noopener">
                          {r.sourceTitle}
                        </a>
                      ) : (
                        r.sourceTitle
                      )
                    ) : (
                      <span className="faint">no source located</span>
                    )}
                    {r.publisher && <div className="tiny faint">{r.publisher}</div>}
                  </dd>
                </div>
                <div className="meta">
                  <dt>Location in source</dt>
                  <dd>{r.locator ?? <span className="faint">not specified</span>}</dd>
                </div>
                <div className="meta">
                  <dt>Quoted / transcribed evidence</dt>
                  <dd>
                    {r.quote ? (
                      <span style={{ fontStyle: "italic" }}>“{r.quote}”</span>
                    ) : (
                      <span className="faint">no page-verified quotation available</span>
                    )}
                  </dd>
                </div>
                {r.derivation && (
                  <div className="meta">
                    <dt>Derivation</dt>
                    <dd className="mono tiny">{r.derivation}</dd>
                  </div>
                )}
              </dl>
              {r.notes.length > 0 && (
                <ul className="compact small faint" style={{ marginTop: 8 }}>
                  {r.notes.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              )}
              {r.conflictsWith.length > 0 && (
                <div className="issue warning" style={{ marginTop: 8 }}>
                  <strong>Conflict</strong> — unresolved against:{" "}
                  {r.conflictsWith.map((id) => {
                    const other = EVIDENCE_REGISTER.find((x) => x.id === id);
                    return (
                      <span key={id}>
                        {id}
                        {other?.value ? ` (${other.value} ${other.units ?? ""})` : ""}{" "}
                      </span>
                    );
                  })}
                  . No automatic reconciliation is performed.
                </div>
              )}
            </div>
          ))}
          {rows.length === 0 && <div className="empty">No evidence records match this filter.</div>}
        </div>
      </Panel>
    </div>
  );
}

function CalloutSummary() {
  const conflicts = EVIDENCE_REGISTER.filter((r) => r.status === "CONFLICT");
  const unknowns = EVIDENCE_REGISTER.filter((r) => r.status === "UNKNOWN");
  return (
    <div className="grid cols-2" style={{ marginTop: 12 }}>
      <div className="callout warn">
        <span className="title">Open conflicts ({conflicts.length})</span>
        <ul className="compact small">
          {conflicts.map((c) => (
            <li key={c.id}>
              <span className="mono tiny">{c.id}</span> {c.claim}
            </li>
          ))}
        </ul>
      </div>
      <div className="callout danger">
        <span className="title">Unknown values ({unknowns.length})</span>
        <ul className="compact small">
          {unknowns.map((c) => (
            <li key={c.id}>
              <span className="mono tiny">{c.id}</span> {c.claim}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
