import { useState } from "react";
import type { RunRecord } from "../core/run";
import { verifyStoredHash } from "../core/run";
import { buildArtifacts } from "../export/serialize";
import { fmt } from "../core/units";
import { R_EARTH } from "../core/constants";
import { Panel, StatusBadge, DataOriginBadge, Stat, Callout, Meta } from "./components";
import { LineChart, OrbitPlot } from "./charts";
import { downloadArtifact } from "./download";

function metric(run: RunRecord, id: string): number | null {
  return run.metrics.find((m) => m.id === id)?.value ?? null;
}

export function RunDetail({ run, compact = false }: { run: RunRecord; compact?: boolean }) {
  const [hashCheck, setHashCheck] = useState<{ ok: boolean; computed: string | null } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const t = run.series.data.t ?? [];
  const minutes = t.map((v) => v / 60);
  const radiusKm = (run.series.data.radius ?? []).map((v) => v / 1000);
  const speedKms = (run.series.data.speed ?? []).map((v) => v / 1000);
  const epsE = run.series.data.epsEnergy ?? [];
  const epsH = run.series.data.epsAngularMomentum ?? [];
  const energy = run.series.data.energy ?? [];

  const passCount = run.verification.filter((c) => c.outcome === "PASS").length;
  const failCount = run.verification.filter((c) => c.outcome === "FAIL").length;
  const otherCount = run.verification.length - passCount - failCount;

  async function onVerifyHash() {
    const res = await verifyStoredHash(run);
    setHashCheck({ ok: res.ok, computed: res.computed });
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
          <div className={`issue ${hashCheck.ok ? "ok" : ""}`}>
            {hashCheck.ok
              ? "Payload hash re-computed and matches the stored hash."
              : "Payload hash DOES NOT match: this record has been altered or corrupted."}
            <div className="hash">
              computed {hashCheck.computed?.slice(0, 32)}…
              <br />
              stored&nbsp;&nbsp;&nbsp;&nbsp;{run.payloadHash?.slice(0, 32) ?? "BLOCKED"}…
            </div>
          </div>
        )}
        {exportError && <Callout tone="danger" title="Export failed">{exportError}</Callout>}

        <div className="grid cols-4">
          <Stat
            label="Final radius"
            value={fmt(metric(run, "finalRadius"), 8)}
            unit="m"
            note={`initial ${fmt(metric(run, "initialRadius"), 6)} m`}
          />
          <Stat label="Final speed" value={fmt(metric(run, "finalSpeed"), 8)} unit="m/s" />
          <Stat
            label="ε_E (max)"
            value={fmt(metric(run, "epsEnergy"), 4)}
            unit="normalised energy discrepancy"
            tone={(metric(run, "epsEnergy") ?? 1) <= 1e-8 ? "pass" : "fail"}
          />
          <Stat
            label="ε_h (max)"
            value={fmt(metric(run, "epsAngularMomentum"), 4)}
            unit="normalised angular-momentum discrepancy"
            tone={(metric(run, "epsAngularMomentum") ?? 1) <= 1e-10 ? "pass" : "fail"}
          />
          <Stat
            label="Osculating period"
            value={metric(run, "period") === null ? "NOT REPORTED" : fmt(metric(run, "period"), 8)}
            unit={metric(run, "period") === null ? "open orbit" : "s"}
          />
          <Stat label="Verification" value={`${passCount} PASS`} unit={`${failCount} FAIL · ${otherCount} other`} tone={failCount > 0 ? "fail" : "pass"} />
          <Stat label="Integration steps" value={fmt(metric(run, "steps"), 8)} unit="accepted" />
          <Stat label="Stored samples" value={fmt(metric(run, "samples"), 8)} unit={`of ${run.series.decimation.originalSampleCount} computed`} />
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
              <LineChart
                x={minutes}
                series={[{ values: radiusKm, label: "|r| radius" }]}
                xLabel="time (min)"
                yLabel="radius (km)"
              />
              <LineChart
                x={minutes}
                series={[{ values: speedKms, label: "|v| speed" }]}
                xLabel="time (min)"
                yLabel="speed (km/s)"
              />
              <LineChart
                x={minutes}
                series={[
                  { values: epsE, label: "ε_E energy" },
                  { values: epsH, label: "ε_h angular momentum", variant: "secondary" },
                ]}
                xLabel="time (min)"
                yLabel="normalised discrepancy"
                logY
                caption="Numerical invariants of the propagated trajectory (not physical measurement error)."
              />
              <LineChart
                x={minutes}
                series={[{ values: energy.map((v) => v / 1e6), label: "E specific energy" }]}
                xLabel="time (min)"
                yLabel="specific energy (MJ/kg)"
              />
            </div>
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

        <h3>Verification recorded with this run</h3>
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
          <Meta label="Payload SHA-256">
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
