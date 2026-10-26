import { APP_CLASSIFICATION, APP_RELEASE_LABEL, APP_VERSION, BUILD_ID, CODE_REVISION_NOTE, CODE_REVISION_STATUS, DISCLAIMER } from "../core/constants";
import type { RunRecord } from "../core/run";
import { IMPLEMENTED_MODEL_IDS, MODELS } from "../models/registry";
import { EVIDENCE_REGISTER, evidenceStatusCounts } from "../evidence/register";
import { checkSummary } from "../verification/registry";
import { Panel, Stat, Meta, StatusBadge, Callout, Empty } from "./components";
import { RunDetail } from "./RunDetail";

export function Dashboard({
  runs,
  onOpenLab,
  onOpenVerification,
  onOpenEvidence,
}: {
  runs: RunRecord[];
  onOpenLab: () => void;
  onOpenVerification: () => void;
  onOpenEvidence: () => void;
}) {
  const latest = runs[runs.length - 1] ?? null;
  const counts = evidenceStatusCounts();
  const summary = latest ? checkSummary(latest.verification) : null;
  const implementedModels = MODELS.filter((m) => IMPLEMENTED_MODEL_IDS.includes(m.id));
  const blockedModels = MODELS.filter((m) => m.status === "BLOCKED" || m.status === "NOT_MODELED");

  return (
    <div className="stack">
      <Panel eyebrow="Project status" title="Orbital Trace Labs — research dashboard">
        <p className="section-intro">
          An independent research prototype for two-body orbital mechanics and bounded tether dynamics. It computes every
          displayed number at run time, records how each result was obtained, and reports what the models do not include.
        </p>
        <div className="grid cols-4">
          <Stat label="Application" value={`${APP_RELEASE_LABEL}`} unit={`version ${APP_VERSION}`} />
          <Stat label="Classification" value="Research prototype" unit={APP_CLASSIFICATION} />
          <Stat label="Stored runs" value={String(runs.length)} unit="append-only local records" tone="cyan" />
          <Stat
            label="Evidence records"
            value={String(EVIDENCE_REGISTER.length)}
            unit={`${counts.CONFLICT} conflicts · ${counts.UNKNOWN} unknown`}
          />
        </div>
        <Callout title="Permanent disclaimer" tone="warn">
          {DISCLAIMER}
        </Callout>
        <dl className="meta-grid" style={{ marginTop: 14 }}>
          <Meta label="Models implemented">
            {implementedModels.map((m) => `${m.id} v${m.version}`).join(" · ")}
          </Meta>
          <Meta label="Not executable (declared)">
            {blockedModels.length === 0
              ? "none"
              : blockedModels.map((m) => `${m.id} (${m.status})`).join(" · ")}
          </Meta>
          <Meta label="Build identifier">
            <span className="mono tiny">{BUILD_ID}</span>
          </Meta>
          <Meta label="Code revision">
            {CODE_REVISION_STATUS} — {CODE_REVISION_NOTE}
          </Meta>
        </dl>
      </Panel>

      <div className="grid cols-2">
        <Panel
          eyebrow="Most recent calculation"
          title={latest ? latest.scenarioName : "No calculation recorded"}
          sub={latest ? `${latest.runId} · ${new Date(latest.createdAtUtc).toLocaleString()} UTC` : "Run an experiment to populate the dashboard"}
          actions={
            <>
              <button className="btn" onClick={onOpenLab}>
                Open laboratory
              </button>
              {latest && (
                <button className="btn ghost" onClick={onOpenVerification}>
                  Verification center
                </button>
              )}
            </>
          }
        >
          {latest ? (
            <>
              <div className="grid cols-2">
                <Stat label="Model / solver" value={`${latest.model.id}`} unit={latest.solver.description} />
                <Stat
                  label="Verification at execution"
                  value={summary ? `${summary.PASS} PASS / ${summary.FAIL} FAIL` : "—"}
                  unit={summary ? `${summary.UNRESOLVED + summary.NOT_TESTED + summary.BLOCKED} unresolved or untested` : ""}
                  tone={summary && summary.FAIL > 0 ? "fail" : "pass"}
                />
                <Stat label="Payload integrity" value={latest.hashStatus === "COMPUTED" ? "SHA-256 recorded" : "BLOCKED"} unit={`${latest.payloadHash?.slice(0, 24) ?? "no hash"}…`} />
                <Stat
                  label="Known limitations"
                  value={String(latest.limitations.length)}
                  unit="carried from the model registry"
                />
              </div>
              <div className="issues" style={{ marginTop: 12 }}>
                {latest.verification
                  .filter((c) => c.outcome !== "PASS")
                  .map((c) => (
                    <div key={c.checkId} className={`issue ${c.outcome === "UNRESOLVED" ? "warning" : ""}`}>
                      <span className="mono">{c.checkId}</span> {c.outcome} — {c.title}
                    </div>
                  ))}
                {latest.verification.every((c) => c.outcome === "PASS") && (
                  <div className="issue ok">
                    All {latest.verification.length} checks recorded with this run passed their numerical criteria. This is not a claim of
                    physical validation.
                  </div>
                )}
              </div>
            </>
          ) : (
            <Empty>
              No run has been executed in this browser yet. Verification status is <StatusBadge outcome="NOT_TESTED" /> — the
              dashboard does not display a simulated result in place of a real one.
            </Empty>
          )}
        </Panel>

        <Panel eyebrow="Traceability" title="Evidence and claim status" actions={<button className="btn ghost" onClick={onOpenEvidence}>Open register</button>}>
          <p className="small muted">
            Every quantitative claim is classified. Conflicts are preserved rather than reconciled; unknown values are never
            replaced by generic substitutes.
          </p>
          <div className="grid cols-2">
            {(
              [
                ["SOURCE_REPORTED", "Reported by an identified source"],
                ["DERIVED", "Computed from recorded values"],
                ["ASSUMED", "Explicitly assumed, not evidence"],
                ["CONFLICT", "Sources disagree; unresolved"],
                ["UNKNOWN", "No source located"],
              ] as const
            ).map(([status, label]) => (
              <Stat key={status} label={status} value={String(counts[status])} unit={label} />
            ))}
          </div>
          <Callout title="Open conflicts in this build">
            <ul className="compact">
              {EVIDENCE_REGISTER.filter((r) => r.status === "CONFLICT").map((r) => (
                <li key={r.id}>
                  <span className="mono tiny">{r.id}</span> — {r.claim} ({r.value ?? "value unresolved"})
                </li>
              ))}
            </ul>
          </Callout>
          <Callout title="Unresolved unknowns" tone="warn">
            <ul className="compact">
              {EVIDENCE_REGISTER.filter((r) => r.status === "UNKNOWN").map((r) => (
                <li key={r.id}>
                  <span className="mono tiny">{r.id}</span> — {r.claim}
                </li>
              ))}
            </ul>
          </Callout>
        </Panel>
      </div>

      {latest && <RunDetail run={latest} compact />}
    </div>
  );
}
