import type { ReactNode } from "react";
import type { CheckOutcome } from "../models/types";
import type { EvidenceStatus } from "../evidence/register";
import type { ValidationIssue } from "../core/validation";

export function StatusBadge({ outcome }: { outcome: CheckOutcome | string }) {
  const map: Record<string, string> = {
    PASS: "pass",
    FAIL: "fail",
    UNRESOLVED: "unresolved",
    NOT_TESTED: "not-tested",
    BLOCKED: "blocked",
    COMPUTED: "info",
    OK: "pass",
  };
  return <span className={`badge ${map[outcome] ?? "neutral"}`}>{outcome}</span>;
}

export function EvidenceBadge({ status }: { status: EvidenceStatus }) {
  return <span className={`badge ${status.toLowerCase().replace(/_/g, "-")}`}>{status}</span>;
}

export function DataOriginBadge({ origin }: { origin: string }) {
  const map: Record<string, { cls: string; label: string }> = {
    LIVE_CALCULATION: { cls: "info", label: "Live calculation" },
    EVIDENCE_INFORMED_RECONSTRUCTION: { cls: "unresolved", label: "Evidence-informed reconstruction" },
    STORED_RUN: { cls: "neutral", label: "Stored run" },
    IMPORTED: { cls: "neutral", label: "Imported run" },
    ILLUSTRATIVE: { cls: "blocked", label: "Illustrative only" },
  };
  const item = map[origin] ?? { cls: "neutral", label: origin };
  return <span className={`badge ${item.cls}`}>{item.label}</span>;
}

export function Panel({
  eyebrow,
  title,
  sub,
  actions,
  children,
  id,
}: {
  eyebrow?: string;
  title?: string;
  sub?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  id?: string;
}) {
  return (
    <section className="panel" id={id}>
      {(title || eyebrow || actions) && (
        <div className="panel-head">
          <div>
            {eyebrow && <div className="panel-eyebrow">{eyebrow}</div>}
            {title && <h2 className="panel-title">{title}</h2>}
            {sub && <div className="panel-sub">{sub}</div>}
          </div>
          {actions && <div className="panel-actions">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({
  label,
  value,
  unit,
  note,
  tone,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  note?: string;
  tone?: "cyan" | "pass" | "fail";
}) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className={`stat-value${tone ? ` ${tone}` : ""}`}>{value}</span>
      {unit && <span className="stat-unit">{unit}</span>}
      {note && <span className="stat-note">{note}</span>}
    </div>
  );
}

export function IssueList({ issues }: { issues: ValidationIssue[] }) {
  if (issues.length === 0) return null;
  return (
    <div className="issues">
      {issues.map((issue, i) => (
        <div key={`${issue.code}-${i}`} className={`issue${issue.severity === "warning" ? " warning" : ""}`}>
          <strong>{issue.code}</strong> — {issue.message}
        </div>
      ))}
    </div>
  );
}

export function Meta({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="meta">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export function Callout({
  title,
  children,
  tone,
}: {
  title?: string;
  children: ReactNode;
  tone?: "warn" | "danger";
}) {
  return (
    <div className={`callout${tone ? ` ${tone}` : ""}`}>
      {title && <span className="title">{title}</span>}
      {children}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}
