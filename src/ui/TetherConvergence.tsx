import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import {
  ACCEPTANCE,
  clearConvergenceCache,
  runTetherConvergence,
  type ConvergenceCase,
  type ConvergenceStudy,
} from "../verification/tetherConvergence";
import {
  buildConvergenceArtifact,
  convergenceArtifactFile,
  parseConvergenceArtifact,
  type ConvergenceArtifact,
  type ConvergenceImportResult,
} from "../export/convergenceArtifact";
import { downloadArtifact } from "./download";
import { Callout, Meta, Panel, Stat, StatusBadge } from "./components";

function exp(v: number | null | undefined, digits = 3): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return v.toExponential(digits);
}

function fmtOrder(v: number | null | undefined): string {
  return v === null || v === undefined || !Number.isFinite(v) ? "n/a" : v.toFixed(3);
}

function CaseBlock({ studyCase }: { studyCase: ConvergenceCase }) {
  const c = studyCase;
  const finest = c.points[c.points.length - 1];
  return (
    <>
      <h3>
        {c.caseId} · {c.title} <StatusBadge outcome={c.acceptance.status} />
      </h3>
      <p className="section-intro">{c.description}</p>
      <div className="grid cols-4" style={{ marginBottom: 12 }}>
        <Stat label="Observed order, isolated θ" value={fmtOrder(c.observedOrder.isolatedTheta)} unit="two finest refinements" />
        <Stat label="Observed order, isolated θ̇" value={fmtOrder(c.observedOrder.isolatedThetaRate)} unit="two finest refinements" />
        <Stat label="Observed order, as-executed θ" value={fmtOrder(c.observedOrder.theta)} unit="coupled reference orbit" />
        <Stat
          label="Finest tether error"
          value={exp(finest.isolatedThetaErrRad)}
          unit="rad, isolated θ"
          note={"empirical reference-error estimate θ " + exp(c.reference.empiricalErrorThetaRad) + " rad (not a bound)"}
        />
      </div>

      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th className="num">h (s)</th>
              <th className="num">steps</th>
              <th className="num">isolated θ err (rad)</th>
              <th className="num">ratio</th>
              <th className="num">order</th>
              <th className="num">isolated θ̇ err (rad/s)</th>
              <th className="num">ratio</th>
              <th className="num">order</th>
              <th className="num">as-executed θ err (rad)</th>
              <th className="num">ratio</th>
              <th className="num">order</th>
              <th className="num">orbit pos. err / r₀</th>
            </tr>
          </thead>
          <tbody>
            {c.points.map((p) => (
              <tr key={p.stepS}>
                <td className="num">{p.stepS}</td>
                <td className="num">{p.steps}</td>
                <td className="num">{exp(p.isolatedThetaErrRad)}</td>
                <td className="num">{p.isolatedThetaRatio?.toFixed(2) ?? "—"}</td>
                <td className="num">{p.isolatedThetaOrder?.toFixed(3) ?? "—"}</td>
                <td className="num">{exp(p.isolatedThetaRateErrRadPerS)}</td>
                <td className="num">{p.isolatedThetaRateRatio?.toFixed(2) ?? "—"}</td>
                <td className="num">{p.isolatedThetaRateOrder?.toFixed(3) ?? "—"}</td>
                <td className="num">{exp(p.thetaErrRad)}</td>
                <td className="num">{p.thetaRatio?.toFixed(2) ?? "—"}</td>
                <td className="num">{p.thetaOrder?.toFixed(3) ?? "—"}</td>
                <td className="num">{exp(p.orbitPositionErrRel, 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <details className="disclosure" open>
        <summary>acceptance, reference, inputs and limitations</summary>
        <dl className="meta-grid">
          <Meta label="Equation integrated">{c.equation}</Meta>
          <Meta label="Solver">{c.solver.settings}</Meta>
          <Meta label="Duration">
            {c.durationS.toFixed(3)} s · length {c.parameters.lengthM} m →{" "}
            {(c.parameters.lengthM + c.parameters.deploymentRateMS * c.durationS).toFixed(0)} m · deployment rate{" "}
            {c.parameters.deploymentRateMS} m/s
          </Meta>
          <Meta label="Initial conditions (SI)">
            r₀ = {c.initialConditions.radiusM.toExponential(6)} m, v₀ = {c.initialConditions.speedMS.toFixed(3)} m/s, θ₀ ={" "}
            {c.initialConditions.theta0Rad.toFixed(6)} rad, θ̇₀ = {c.initialConditions.thetaDot0RadPerS} rad/s
          </Meta>
          <Meta label="Reference kind">
            <span className="mono">{c.reference.kind}</span> — {c.reference.method}
          </Meta>
          <Meta label="Empirical reference-error estimate">
            <span className="mono">{c.reference.errorKind}</span> — θ {exp(c.reference.empiricalErrorThetaRad)} rad; θ̇{" "}
            {exp(c.reference.empiricalErrorThetaRateRadPerS)} rad/s. Estimate = largest observed difference across the independent
            comparisons below, per component. This is <strong>not</strong> a proven upper bound on the true reference error.{" "}
            {c.reference.validation}
          </Meta>
          <Meta label="Reference adequacy (exact metric)">
            <span style={{ overflowWrap: "anywhere" }}>
              adequacy = (finest isolated error for this component) ÷ (empirical reference-error estimate for the same component). Measured: θ{" "}
              {exp(c.reference.adequacyTheta)}×, θ̇ {exp(c.reference.adequacyThetaRate)}×; minimum {exp(c.reference.adequacyRatioMin)}×.
              Required ≥ {ACCEPTANCE.referenceAdequacyRatioMin}× for each component. The denominator is an estimate, so this ratio shows the
              evidence is much finer than the measurement — it does not guarantee the true reference error is below that level.
            </span>
          </Meta>
          <Meta label="Estimate covers / does not cover">
            {c.reference.covers.join(" ")} <strong>Does not cover:</strong> {c.reference.doesNotCover.join(" ")}
          </Meta>
          <Meta label="Independent reference comparisons">
            {c.reference.estimates
              .map(
                (e) =>
                  e.label + " → Δθ " + exp(e.thetaDifferenceRad) + " rad, Δθ̇ " + exp(e.thetaRateDifferenceRadPerS) + " rad/s",
              )
              .join(" | ")}
          </Meta>
          <Meta label="Acceptance criterion">{c.acceptance.criterion}</Meta>
          <Meta label="Tolerance">{c.acceptance.tolerance}</Meta>
          <Meta label="Why this tolerance">{c.acceptance.justification}</Meta>
          <Meta label="Measured orbit-error order">{fmtOrder(c.orbitErrorOrder)} (reported separately, not used as evidence for the tether state)</Meta>
          {c.acceptance.reasons.length > 0 && <Meta label="Unmet conditions">{c.acceptance.reasons.join(" ")}</Meta>}
          <Meta label="Assumptions">{c.assumptions.join(" ")}</Meta>
          <Meta label="Limitations">{c.limitations}</Meta>
          <Meta label="Notes">{c.notes.join(" ")}</Meta>
        </dl>
      </details>
    </>
  );
}

export function TetherConvergencePanel() {
  const [study, setStudy] = useState<ConvergenceStudy | null>(null);
  const [artifact, setArtifact] = useState<ConvergenceArtifact | null>(null);
  const [busy, setBusy] = useState(false);
  const [importState, setImportState] = useState<ConvergenceImportResult | null>(null);

  const build = useMemo(
    () => async (force: boolean) => {
      if (force) clearConvergenceCache();
      const s = runTetherConvergence(undefined, force);
      setStudy(s);
      setArtifact(await buildConvergenceArtifact(s));
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (cancelled) return;
      await build(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [build]);

  async function onRerun() {
    setBusy(true);
    try {
      await build(true);
    } finally {
      setBusy(false);
    }
  }

  async function onDownload() {
    if (artifact) downloadArtifact(await convergenceArtifactFile(artifact));
  }

  async function onImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setImportState(null);
    if (!file) return;
    setImportState(await parseConvergenceArtifact(await file.text()));
  }

  return (
    <Panel
      eyebrow="Tether convergence study"
      title="Step-refinement convergence of the tether equations"
      sub="Two cases, four refinement levels each, fixed initial conditions and final time. Every number here was produced by executing the engine in this browser session, including the reference solutions."
      actions={
        <>
          <button className="btn" onClick={onRerun} disabled={busy}>
            {busy ? "Executing…" : "Re-run study"}
          </button>
          <button className="btn ghost" onClick={onDownload} disabled={!artifact}>
            Export hashed JSON
          </button>
        </>
      }
    >
      <Callout title="What this study does and does not show" tone="warn">
        Order convergence shows that the implemented equations are solved consistently as the step is refined. It does not validate the
        physical model, and no flight data is compared. Deployment is <strong>prescribed</strong>; gravity-gradient tension is an
        approximate diagnostic; orbital coupling is one-way. Full spacecraft–tether mechanics and total-system conservation are not
        established here.
      </Callout>

      {!study || !artifact ? (
        <div className="empty" style={{ marginTop: 12 }}>Executing convergence study…</div>
      ) : (
        <>
          <div className="grid cols-4" style={{ margin: "12px 0" }}>
            <Stat
              label="Overall status"
              value={<StatusBadge outcome={study.overallStatus} />}
              unit={`${study.cases.length} cases`}
            />
            <Stat
              label="Order floor"
              value={fmtOrder(Math.min(...study.cases.map((c) => c.observedOrder.isolatedTheta ?? Number.NEGATIVE_INFINITY)))}
              unit={"isolated θ, required ≥ " + ACCEPTANCE.minOrder}
            />
            <Stat
              label="Reference adequacy (min)"
              value={exp(
                Math.min(
                  ...study.cases.map((c) => c.reference.adequacyRatioMin ?? Number.NEGATIVE_INFINITY),
                ),
                2,
              )}
              unit={"finest isolated error / empirical estimate, per component; required ≥ " + ACCEPTANCE.referenceAdequacyRatioMin}
            />
            <Stat
              label="Reference error status"
              value={study.referenceErrorKind}
              note="empirical estimate — not a proven bound or enclosure"
            />
            <Stat label="Generated (UTC)" value={study.generatedAtUtc.slice(0, 19).replace("T", " ")} unit="this session" />
          </div>

          <div className="stack" style={{ marginBottom: 12 }}>
            {study.cases.map((c) => (
              <CaseBlock key={c.caseId} studyCase={c} />
            ))}
          </div>

          <dl className="meta-grid">
            <Meta label="Order estimator">{study.orderEstimator}</Meta>
            <Meta label="Study schema">{study.schemaVersion}</Meta>
            <Meta label="Model">{`${study.model.id} v${study.model.version}`}</Meta>
            <Meta label="Round-off floor">{study.roundOffFloorRel.toExponential(0)} relative error; below this a case is reported UNRESOLVED rather than PASS</Meta>
            <Meta label="Reference-error status">
              <span className="mono">{study.referenceErrorKind}</span> — {study.referenceErrorStatement}
            </Meta>
            <Meta label="Study limitations">{study.limitations.join(" ")}</Meta>
          </dl>

          <div className="table-wrap" style={{ marginTop: 10 }}>
            <table className="data">
              <thead>
                <tr>
                  <th>Export artifact</th>
                  <th>Payload SHA-256</th>
                  <th className="num">Bytes</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    <span className="mono">{artifact.schemaVersion}</span>
                    <div className="tiny faint">
                      Hash covers the canonicalised measured results and method/model identity only. Export time, execution time and
                      build id are recorded but excluded, so re-exporting identical results yields the same digest. Integrity
                      evidence, not correctness.
                    </div>
                  </td>
                  <td className="mono tiny">{artifact.payloadHash}</td>
                  <td className="num">{artifact.payloadBytes}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="row" style={{ marginTop: 12, alignItems: "center", gap: 12 }}>
            <label className="small muted" htmlFor="convergence-import">
              Import &amp; verify an exported artifact
            </label>
            <input
              id="convergence-import"
              type="file"
              accept="application/json,.json"
              className="small"
              onChange={onImport}
            />
          </div>

          {importState && (
            <div style={{ marginTop: 8 }}>
              {importState.ok ? (
                <div className="row" style={{ alignItems: "center" }}>
                  <StatusBadge outcome={importState.digestMatches ? "PASS" : "FAIL"} />
                  <span className="small">
                    {importState.digestMatches
                      ? "Payload hash recomputed in this browser matches the file."
                      : "Payload hash does NOT match the file contents: the results were modified after export."}
                  </span>
                </div>
              ) : (
                <div className="issues">
                  <div className="issue warning">
                    <strong>{importState.code}</strong> — {importState.errors.join(" ")}
                  </div>
                </div>
              )}
              {importState.ok && (
                <dl className="meta-grid">
                  <Meta label="Imported model">
                    {importState.artifact.study.model.id} v{importState.artifact.study.model.version} | study schema{" "}
                    {importState.artifact.study.schemaVersion}
                  </Meta>
                  <Meta label="Imported statuses">
                    {importState.artifact.study.cases
                      .map((c) => c.caseId + ": " + c.acceptance.status)
                      .join(", ") + " | overall " + importState.artifact.study.overallStatus}
                  </Meta>
                  <Meta label="Imported reference-error status">
                    <span className="mono">{importState.artifact.study.referenceErrorKind}</span> — an intact file is integrity
                    evidence only; it does not establish physical validity.
                  </Meta>
                  <Meta label="Hash comparison">
                    recorded {importState.recorded.slice(0, 16)}… | recomputed {importState.computed.slice(0, 16)}…
                  </Meta>
                  <Meta label="File timestamps (not hashed)">
                    exported {importState.artifact.generatedAtUtc} | executed {importState.artifact.study.generatedAtUtc} | build{" "}
                    {importState.artifact.app.buildId}
                  </Meta>
                </dl>
              )}
            </div>
          )}
        </>
      )}
    </Panel>
  );
}
