import { Fragment, useEffect, useState } from "react";
import type { RunRecord } from "../core/run";
import { sha256Hex } from "../core/canonical";
import { canonicalize } from "../core/canonical";
import type { VerificationCheckResult } from "../models/types";
import { runAllChecks, checkSummary } from "../verification/registry";
import { reproduceStoredRun, type ReproductionResult } from "../verification/reproducibility";
import { Panel, StatusBadge, Stat, Callout } from "./components";
import { TetherConvergencePanel } from "./TetherConvergence";

interface PlatformCheck {
  id: string;
  title: string;
  criterion: string;
  measured: string;
  outcome: "PASS" | "FAIL" | "NOT_TESTED" | "BLOCKED";
  note: string;
}

const SHA_ABC = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

export function VerificationCenter({ runs, selectedRunId }: { runs: RunRecord[]; selectedRunId: string | null }) {
  const [results, setResults] = useState<VerificationCheckResult[] | null>(null);
  const [platform, setPlatform] = useState<PlatformCheck[]>([]);
  const [repro, setRepro] = useState<ReproductionResult | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const id = window.setTimeout(async () => {
      const executed = runAllChecks();
      const digestOk = (await sha256Hex("abc")) === SHA_ABC;
      const orderInvariant =
        canonicalize({ b: 1, a: [1, 2, { d: 4, c: 3 }] }) === canonicalize({ a: [1, 2, { c: 3, d: 4 }], b: 1 });
      if (cancelled) return;
      setResults(executed);
      setPlatform([
        {
          id: "OT-PF-001",
          title: "SHA-256 implementation known-answer test",
          criterion: "SHA-256 of the ASCII string \"abc\" equals the published NIST test vector.",
          measured: digestOk ? SHA_ABC.slice(0, 24) + "…" : "mismatch",
          outcome: digestOk ? "PASS" : "FAIL",
          note: "Validates the hashing primitive only. It says nothing about the scientific payload.",
        },
        {
          id: "OT-PF-002",
          title: "Canonical serialisation key-order invariance",
          criterion: "Two objects with identical content but different key insertion order canonicalise to the same string.",
          measured: orderInvariant ? "identical canonical strings" : "different canonical strings",
          outcome: orderInvariant ? "PASS" : "FAIL",
          note: "Required for payload hashes to be reproducible by an independent implementation.",
        },
        {
          id: "OT-PF-003",
          title: "Reproducibility of a stored run (import → re-run → compare)",
          criterion:
            "A stored run is re-executed from its stored inputs and must match the stored series and metrics within the documented tolerance, with a valid payload hash.",
          measured: repro ? `${repro.status}${repro.maxNormalisedSeriesDifference !== null ? `, max diff ${repro.maxNormalisedSeriesDifference.toExponential(3)}` : ""}` : "not executed",
          outcome: repro ? (repro.status === "PASS" ? "PASS" : repro.status === "FAIL" ? "FAIL" : "BLOCKED") : "NOT_TESTED",
          note: repro
            ? `Tolerance ${repro.tolerance.toExponential(1)}. Run ${repro.reproducedRunId ?? "—"}.`
            : "Select a stored run in the Simulation Laboratory or Comparison view and press Reproduce; the result is shown here and there.",
        },
      ]);
    }, 30);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [repro]);

  // The summary covers every check displayed on this page: model checks and platform
  // checks. Counting only the model checks previously reported 0 NOT_TESTED while the
  // platform table visibly showed one, and omitted the platform rows from the total.
  const summary = results ? checkSummary([...results, ...platform]) : null;
  // One check's detail panel is open at a time, and it renders as a full-width row: the
  // evidence is long, and the first column is a few characters wide.
  const [detailId, setDetailId] = useState<string | null>(null);
  const selected = runs.find((r) => r.runId === selectedRunId) ?? runs[runs.length - 1] ?? null;

  async function onReproduce() {
    if (!selected) return;
    setBusy(true);
    try {
      setRepro(await reproduceStoredRun(selected));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <Panel
        eyebrow="Verification center"
        title="Measured checks against the live calculation engine"
        sub="Every value below is produced by executing the engine in this browser session. No expected-output strings are reported as results."
        actions={
          <>
            <button className="btn" onClick={() => setResults(runAllChecks())} disabled={!results}>
              Re-run model checks
            </button>
            <button className="btn ghost" onClick={onReproduce} disabled={!selected || busy}>
              {busy ? "Re-running…" : "Reproduce selected run"}
            </button>
          </>
        }
      >
        <Callout title="What a PASS means here" tone="warn">
          A PASS means the implementation met a stated numerical criterion on this machine. It is <strong>not</strong> evidence of
          physical validity, flight qualification or agreement with real mission data. No comparison with flight data has been
          performed in this build.
        </Callout>

        {summary && (
          <div className="grid cols-4" style={{ marginTop: 12 }}>
            <Stat label="PASS" value={String(summary.PASS)} unit="checks met criterion" tone="pass" />
            <Stat label="FAIL" value={String(summary.FAIL)} unit="checks violated criterion" tone={summary.FAIL ? "fail" : undefined} />
            <Stat label="UNRESOLVED" value={String(summary.UNRESOLVED)} unit="result not classified" />
            <Stat
              label="NOT_TESTED / BLOCKED"
              value={String(summary.NOT_TESTED + summary.BLOCKED)}
              unit="not executed here"
              note={`${summary.TOTAL} checks in total`}
            />
          </div>
        )}

        {summary && results && (
          <div className="tiny faint" style={{ marginTop: 6 }}>
            Counts cover every check on this page: {results.length} model checks + {platform.length} platform checks = {summary.TOTAL}
            {" total"}
            {summary.INVALID > 0 ? " (" + summary.INVALID + " with an unrecognised outcome)" : ""}.
          </div>
        )}

        {!results ? (
          <div className="empty" style={{ marginTop: 14 }}>
            Executing verification checks…
          </div>
        ) : (
          <div className="table-wrap" style={{ marginTop: 14 }}>
            <table className="data">
              <thead>
                <tr>
                  <th>Check</th>
                  <th>Outcome</th>
                  <th className="num">Measured</th>
                  <th>Unit</th>
                  <th>Tolerance</th>
                  <th className="num">Time</th>
                </tr>
              </thead>
              <tbody>
                {results.map((c) => (
                  <Fragment key={c.checkId}>
                    <tr>
                      <td>
                        <span className="mono">{c.checkId}</span>
                        <div>{c.title}</div>
                        <button
                          type="button"
                          className="disclosure-toggle"
                          aria-expanded={detailId === c.checkId}
                          onClick={() => setDetailId(detailId === c.checkId ? null : c.checkId)}
                        >
                          {detailId === c.checkId ? "▾" : "▸"} criterion, method, evidence and limits
                        </button>
                      </td>
                      <td className="shrink">
                        <StatusBadge outcome={c.outcome} />
                      </td>
                      <td className="num">{typeof c.measuredValue === "number" ? c.measuredValue.toExponential(6) : String(c.measuredValue)}</td>
                      <td className="small muted">{c.measuredUnit}</td>
                      <td className="small muted">{c.tolerance}</td>
                      <td className="num small muted">{c.durationMs !== undefined ? `${c.durationMs.toFixed(0)} ms` : "—"}</td>
                    </tr>
                    {detailId === c.checkId && (
                      <tr className="disclosure-row">
                        <td colSpan={6}>
                          <dl className="meta-grid">
                            <div className="meta">
                              <dt>Criterion</dt>
                              <dd>{c.criterion}</dd>
                            </div>
                            <div className="meta">
                              <dt>Expected behaviour</dt>
                              <dd>{c.expectedBehavior}</dd>
                            </div>
                            <div className="meta">
                              <dt>Calculation method</dt>
                              <dd>{c.method}</dd>
                            </div>
                            <div className="meta">
                              <dt>Tolerance justification</dt>
                              <dd>{c.toleranceJustification}</dd>
                            </div>
                            <div className="meta meta-wide">
                              <dt>Measured value / evidence</dt>
                              <dd>{c.evidence}</dd>
                            </div>
                            <div className="meta meta-wide">
                              <dt>Limitations</dt>
                              <dd>{c.limitations}</dd>
                            </div>
                          </dl>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <TetherConvergencePanel />

      <Panel eyebrow="Platform integrity" title="Provenance and reproducibility checks">
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Check</th>
                <th>Outcome</th>
                <th>Measured</th>
                <th>Criterion</th>
              </tr>
            </thead>
            <tbody>
              {platform.map((p) => (
                <tr key={p.id}>
                  <td>
                    <span className="mono">{p.id}</span>
                    <div>{p.title}</div>
                    <div className="tiny faint">{p.note}</div>
                  </td>
                  <td className="shrink">
                    <StatusBadge outcome={p.outcome} />
                  </td>
                  <td className="mono tiny">{p.measured}</td>
                  <td className="small muted">{p.criterion}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {repro && (
          <div style={{ marginTop: 12 }}>
            <div className="row">
              <StatusBadge outcome={repro.status} />
              <span className="small muted">
                {selected?.runId} · tolerance {repro.tolerance.toExponential(1)} · series difference{" "}
                {repro.maxNormalisedSeriesDifference?.toExponential(3) ?? "n/a"}
              </span>
            </div>
            <div className="table-wrap">
              <table className="data">
                <tbody>
                  {repro.steps.map((s) => (
                    <tr key={s.name}>
                      <td style={{ width: "24%" }}>{s.name}</td>
                      <td className="shrink">
                        <StatusBadge outcome={s.outcome} />
                      </td>
                      <td className="small">{s.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <Callout title="Integrity is not correctness" tone="warn">
          Hash matching and reproduction show that a payload is intact and that the same code path reproduces it. Neither shows that
          the model is physically adequate. Code revision status is <strong>UNVERIFIED</strong>: no version-control revision is bound
          to this build.
        </Callout>
      </Panel>
    </div>
  );
}
