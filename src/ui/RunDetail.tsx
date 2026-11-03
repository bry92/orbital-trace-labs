import { useState } from "react";
import type { RunRecord, StoredHashCheck } from "../core/run";
import { RESULT_HASH_ID, rehashRecord, verifyStoredHash } from "../core/run";
import { buildArtifacts } from "../export/serialize";
import { fmt } from "../core/units";
import { R_EARTH } from "../core/constants";
import { Panel, StatusBadge, DataOriginBadge, Stat, Callout, Meta } from "./components";
import { LineChart, OrbitPlot } from "./charts";
import { downloadArtifact } from "./download";
import { SUMMARY_DIGITS, headlineMetrics, planCharts, sampleCounts } from "./runPresentation";

function metric(run: RunRecord, id: string): number | null {
  return run.metrics.find((m) => m.id === id)?.value ?? null;
}

export function RunDetail({
  run,
  compact = false,
  onRunUpdated,
}: {
  run: RunRecord;
  compact?: boolean;
  onRunUpdated?: (record: RunRecord) => void;
}) {
  const [hashCheck, setHashCheck] = useState<StoredHashCheck | null>(null);
  const [rehashState, setRehashState] = useState<{ ok: boolean; message: string } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const headline = headlineMetrics(run);
  const charts = planCharts(run);
  const samples = sampleCounts(run);

  const passCount = run.verification.filter((c) => c.outcome === "PASS").length;
  const failCount = run.verification.filter((c) => c.outcome === "FAIL").length;
  const otherCount = run.verification.length - passCount - failCount;

  async function onVerifyHash() {
    setHashCheck(await verifyStoredHash(run));
    setRehashState(null);
  }

  async function onRehash() {
    if (!onRunUpdated) return;
    const updated = await rehashRecord(run);
    setRehashState({
      ok: true,
      message: `Re-hashed under ${RESULT_HASH_ID}: ${updated.payloadHash?.slice(0, 24)}… Recorded results, run id, execution time and build identity were preserved unchanged.`,
    });
    onRunUpdated(updated);
    setHashCheck(await verifyStoredHash(updated));
  }

  async function onExportAll() {
    setExporting(true);
    setExportError(null);
    try {
      const artifacts = await buildArtifacts(run);
      for (const a of artifacts) downloadArtifact(a);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : String(err));
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="stack">
      <Panel
        eyebrow="Computed result"
        title={run.scenarioName}
        sub={
          <span className="row">
            <span className="mono tiny">{run.runId}</span>
            <DataOriginBadge origin={run.dataOrigin} />
            <StatusBadge outcome={run.hashStatus === "COMPUTED" ? "COMPUTED" : "BLOCKED"} />
            <span className="tiny muted">{new Date(run.createdAtUtc).toLocaleString()} UTC</span>
          </span>
        }
        actions={
          <>
            <button className="btn" onClick={onExportAll} disabled={exporting}>
              {exporting ? "Hashing…" : "Export all"}
            </button>
            <button className="btn ghost" onClick={onVerifyHash}>
              Verify payload hash
            </button>
          </>
        }
      >
        {hashCheck && (
          <div
            className={`issue ${hashCheck.scope === "MISMATCH" ? "" : "ok"}`}
            style={{ borderColor: hashCheck.scope === "LEGACY" ? "var(--unresolved)" : undefined }}
          >
            {hashCheck.scope === "RESULT" &&
              "Result-identity hash re-computed and matches the stored digest: the recorded results are unchanged."}
            {hashCheck.scope === "LEGACY" &&
              "Matches the LEGACY pre-repair hash scope. The content is intact — the hash specification changed in this build, which is not tampering. Re-hash to bind the current result-identity scope."}
            {hashCheck.scope === "MISMATCH" &&
              "Matches neither the result-identity scope nor the legacy scope: this record's content has changed since the digest was recorded."}
            <div className="hash">
              result scope&nbsp;{hashCheck.computed.slice(0, 32)}…
              <br />
              legacy scope&nbsp;{hashCheck.legacyComputed.slice(0, 32)}…
              <br />
              stored&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{hashCheck.recorded?.slice(0, 32) ?? "BLOCKED"}…
            </div>
            {hashCheck.scope === "LEGACY" && onRunUpdated && !compact && (
              <div className="row" style={{ marginTop: 8 }}>
                <button className="btn ghost" onClick={onRehash}>
                  Re-hash under current scope
                </button>
                <span className="small muted">
                  Results and provenance are preserved; only the digest scope is rebound.
                </span>
              </div>
            )}
            {rehashState && <div className="small" style={{ marginTop: 8 }}>{rehashState.message}</div>}
          </div>
        )}
        {exportError && <Callout tone="danger" title="Export failed">{exportError}</Callout>}

        <div className="grid cols-4">
          {headline.map((h) => (
            <Stat
              key={h.id}
              label={h.label}
              value={h.value === null ? "NOT REPORTED" : fmt(h.value, SUMMARY_DIGITS)}
              unit={h.notReportedByModel ? `${run.model.id} reports no such quantity` : h.unit}
              note={h.notReportedByModel || h.value === null ? h.note : undefined}
              tone={h.notReportedByModel ? "fail" : undefined}
            />
          ))}
          <Stat
            label="Verification (model-level)"
            value={`${passCount} PASS`}
            unit={`${failCount} FAIL · ${otherCount} other`}
            tone={failCount > 0 ? "fail" : "pass"}
          />
          <Stat label="Integration steps" value={fmt(metric(run, "steps"), SUMMARY_DIGITS)} unit="accepted" />
          <Stat
            label="Stored samples"
            value={fmt(samples.stored, SUMMARY_DIGITS)}
            unit={`of ${fmt(samples.computed, SUMMARY_DIGITS)} computed`}
          />
        </div>

        <h3>Input parameters and units</h3>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Parameter</th>
                <th className="num">Entered</th>
                <th>Unit</th>
                <th className="num">SI value used</th>
                <th>SI unit</th>
                <th>Origin</th>
              </tr>
            </thead>
            <tbody>
              {run.parameters.map((p) => (
                <tr key={p.paramId}>
                  <td>
                    {p.label}
                    <div className="tiny faint mono">{p.paramId}</div>
                  </td>
                  <td className="num">{fmt(p.enteredValue, 12)}</td>
                  <td className="small muted">{p.enteredUnitSymbol}</td>
                  <td className="num">{fmt(p.siValue, 12)}</td>
                  <td className="small muted">{p.siUnit}</td>
                  <td className="small muted">{p.origin.replace("_", " ").toLowerCase()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {!compact && (
          <>
            <h3>Trajectory diagnostics (computed)</h3>
            <div className="grid cols-2">
              {charts
                .filter((c) => c.available)
                .map((c) => (
                  <LineChart
                    key={c.id}
                    x={c.x}
                    series={c.series}
                    xLabel={c.xLabel}
                    yLabel={c.yLabel}
                    logY={c.logY}
                    caption={c.caption}
                  />
                ))}
            </div>
            {charts.some((c) => !c.available) && (
              <div className="issues" style={{ marginTop: 8 }}>
                {charts
                  .filter((c) => !c.available)
                  .map((c) => (
                    <div className="issue warning" key={c.id}>
                      <strong>{c.title}</strong> — {c.unavailableReason}
                    </div>
                  ))}
              </div>
            )}
            <h3>Orbit geometry</h3>
            <div className="grid cols-2">
              <OrbitPlot
                x={run.series.data.x ?? []}
                y={run.series.data.y ?? []}
                earthRadiusM={R_EARTH}
                label="Inertial frame; Earth drawn at WGS-84 equatorial radius."
              />
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Quantity</th>
                      <th className="num">Value</th>
                      <th>Unit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {run.metrics
                      .filter((m) => !["steps", "samples", "stepsRejected"].includes(m.id))
                      .map((m) => (
                        <tr key={m.id}>
                          <td>
                            {m.label}
                            {m.note && <div className="tiny faint">{m.note}</div>}
                          </td>
                          <td className="num">{m.value === null ? "NOT REPORTED" : fmt(m.value, 10)}</td>
                          <td className="small muted">{m.unit}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        <h3>Model-level verification recorded with this run</h3>
        <p className="small muted">
          These checks execute against the calculation engine for {run.model.id} v{run.model.version}. Each measured value is a
          fixture of that check, identical for every run of this model version — it is not measured from this run's trajectory. They
          are recorded here so a stored result carries the check set it was produced under. This run's own computed diagnostics are
          shown above.
        </p>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Check</th>
                <th>Outcome</th>
                <th className="num">Measured</th>
                <th>Unit</th>
                <th>Tolerance</th>
              </tr>
            </thead>
            <tbody>
              {run.verification.map((c) => (
                <tr key={c.checkId}>
                  <td>
                    <span className="mono">{c.checkId}</span> {c.title}
                  </td>
                  <td>
                    <StatusBadge outcome={c.outcome} />
                  </td>
                  <td className="num">{typeof c.measuredValue === "number" ? fmt(c.measuredValue, 6) : String(c.measuredValue)}</td>
                  <td className="small muted">{c.measuredUnit}</td>
                  <td className="small muted">{c.tolerance}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {run.warnings.length > 0 && (
          <>
            <h3>Warnings</h3>
            <div className="issues">
              {run.warnings.map((w, i) => (
                <div key={i} className="issue warning">
                  {w}
                </div>
              ))}
            </div>
          </>
        )}

        {run.unresolved.length > 0 && (
          <>
            <h3>Unresolved quantities</h3>
            <ul className="list">
              {run.unresolved.map((u) => (
                <li key={u.item}>
                  <strong>{u.item}</strong> — {u.reason}
                </li>
              ))}
            </ul>
          </>
        )}

        {run.evidenceFlags.length > 0 && (
          <Callout title="Evidence flags" tone="warn">
            <ul className="compact">
              {run.evidenceFlags.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
            This result uses inputs that are not fully source-verified. It is an evidence-informed reconstruction, not a validated digital twin.
          </Callout>
        )}

        <h3>Provenance</h3>
        <dl className="meta-grid">
          <Meta label="Hash scope">
            {run.hashSpec.id ?? "LEGACY — pre-repair whole-record scope"}
          </Meta>
          <Meta label="Result-identity SHA-256">
            <span className="hash">{run.payloadHash ?? "BLOCKED — hashing unavailable"}</span>
          </Meta>
          <Meta label="Hash status">{run.hashStatus}</Meta>
          <Meta label="Build identifier">
            <span className="mono tiny">{run.app.buildId}</span>
          </Meta>
          <Meta label="Code revision">
            {run.app.codeRevision ?? "none bound"} — <StatusBadge outcome={run.app.codeRevisionStatus} />
          </Meta>
          <Meta label="Application">
            {run.app.name} {run.app.releaseLabel} (v{run.app.version})
          </Meta>
          <Meta label="Model">{run.model.id} v{run.model.version}</Meta>
          <Meta label="Numerical method">{run.solver.method}</Meta>
          <Meta label="Solver settings">
            <span className="mono tiny">
              {Object.entries(run.solver.settings)
                .map(([k, v]) => `${k}=${v}`)
                .join(", ")}
            </span>
          </Meta>
          <Meta label="Series decimation">{run.series.decimation.rule}</Meta>
          <Meta label="Units">
            Internal SI. Parameters retain the unit entered; both are shown in the report.
          </Meta>
        </dl>

        <details className="disclosure">
          <summary>Hash specification and exclusions</summary>
          <p className="small muted">{run.hashSpec.note}</p>
          <div className="small">
            <div>
              <strong>Canonicalisation:</strong> {run.hashSpec.canonicalization}
            </div>
            <div>
              <strong>Included:</strong> <span className="mono tiny">{run.hashSpec.includedFields.join(", ")}</span>
            </div>
            <div>
              <strong>Excluded:</strong> <span className="mono tiny">{run.hashSpec.excludedFields.join(", ")}</span>
            </div>
          </div>
        </details>

        <details className="disclosure">
          <summary>Assumptions carried from the model registry ({run.assumptions.length})</summary>
          <ul className="compact">
            {run.assumptions.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </details>

        <details className="disclosure">
          <summary>Limitations ({run.limitations.length})</summary>
          <ul className="compact">
            {run.limitations.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </details>

        {run.validationIssues.filter((i) => i.severity === "warning").length > 0 && (
          <details className="disclosure">
            <summary>Validation warnings recorded at execution</summary>
            <ul className="compact">
              {run.validationIssues
                .filter((i) => i.severity === "warning")
                .map((i, idx) => (
                  <li key={idx}>
                    <span className="mono tiny">{i.code}</span> {i.message}
                  </li>
                ))}
            </ul>
          </details>
        )}
      </Panel>
    </div>
  );
}
