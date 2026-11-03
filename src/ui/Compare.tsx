import { useState } from "react";
import type { RunRecord } from "../core/run";
import { compareRuns } from "../review/compare";
import { Panel, Empty, Callout } from "./components";

export function Compare({ runs }: { runs: RunRecord[] }) {
  const [selected, setSelected] = useState<string[]>(() => runs.slice(-2).map((r) => r.runId));

  function toggle(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : prev.length >= 4 ? prev : [...prev, id]));
  }

  const chosen = runs.filter((r) => selected.includes(r.runId));
  const comparison = chosen.length >= 2 ? compareRuns(chosen) : null;

  return (
    <div className="stack">
      <Panel
        eyebrow="Experiment comparison"
        title="Side-by-side run comparison"
        sub="Select two to four stored runs. Runs are compared as physically equivalent only when their model id and version match."
      >
        {runs.length === 0 ? (
          <Empty>No stored runs yet. Execute an experiment in the Simulation Laboratory first.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Select</th>
                  <th>Run</th>
                  <th>Scenario</th>
                  <th>Model</th>
                  <th>Method</th>
                  <th>Executed (UTC)</th>
                  <th>Origin</th>
                </tr>
              </thead>
              <tbody>
                {runs
                  .slice()
                  .reverse()
                  .map((r) => (
                    <tr key={r.runId}>
                      <td className="shrink">
                        <input
                          type="checkbox"
                          aria-label={`Compare run ${r.runId}`}
                          checked={selected.includes(r.runId)}
                          onChange={() => toggle(r.runId)}
                        />
                      </td>
                      <td className="mono tiny">{r.runId}</td>
                      <td>{r.scenarioName}</td>
                      <td className="small">
                        {r.model.id} v{r.model.version}
                      </td>
                      <td className="small">{r.solver.method}</td>
                      <td className="small muted">{r.createdAtUtc.replace("T", " ").slice(0, 19)}</td>
                      <td className="small muted">{r.dataOrigin}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {!comparison ? (
        <Empty>Select at least two runs to compare.</Empty>
      ) : (
        <>
          <Panel eyebrow="Comparability" title="Are these results physically comparable?">
            <div className="callout">{comparison.comparabilityStatement}</div>
            {comparison.warnings.map((w) => (
              <div className="issue warning" key={w}>
                {w}
              </div>
            ))}
            {comparison.seriesDifferences.length > 0 && (
              <div className="grid cols-2" style={{ marginTop: 12 }}>
                {comparison.seriesDifferences.map((d) => (
                  <div className="stat" key={`${d.runIdA}-${d.runIdB}`}>
                    <span className="stat-label">Trajectory difference</span>
                    <span className="stat-value mono">
                      {d.maxNormalisedDifference === null ? "NOT COMPUTED" : d.maxNormalisedDifference.toExponential(4)}
                    </span>
                    <span className="stat-unit">
                      {d.runIdA} vs {d.runIdB}
                    </span>
                    <span className="stat-note">{d.note}</span>
                  </div>
                ))}
              </div>
            )}
            {comparison.warnings.length === 0 && (
              <div className="small muted" style={{ marginTop: 8 }}>
                No comparability warning was raised. Numerical differences still include solver truncation error; the energy and
                angular-momentum rows quantify part of that.
              </div>
            )}
          </Panel>

          <ComparisonTable title="Run setup and provenance" rows={comparison.setupRows} runs={chosen} />
          <ComparisonTable title="Inputs and initial conditions" rows={comparison.inputRows} runs={chosen} />
          <ComparisonTable title="Final state, diagnostics and numerical cost" rows={comparison.metricRows} runs={chosen} />
          <ComparisonTable title="Verification outcomes" rows={comparison.verificationRows} runs={chosen} />

          <Panel eyebrow="Interpretation" title="Reading this comparison">
            <ul className="list small">
              <li>Input rows show the value as entered plus the SI value actually used; a difference in either is highlighted.</li>
              <li>
                Metric rows are the final-state and diagnostic values stored with each run. Differences are marked when they exceed
                1e-12 relative.
              </li>
              <li>
                Energy and angular-momentum discrepancies (ε_E, ε_h) measure numerical invariance, not observational error. Two runs
                can be numerically clean and still physically wrong if the model is wrong.
              </li>
              <li>
                Trajectory differences are only computed when every shared column has the same sample times. Otherwise the cell reads
                NOT COMPUTED with the reason and the columns that were skipped. No interpolation or resampling is applied to force a
                comparison, and a partial comparison is never reported as a whole-trajectory number.
              </li>
              <li>
                Verification rows are model-level outcomes recorded with each run, not per-run measurements: identical outcomes across
                runs of one model version are expected and are not evidence that both runs behaved identically.
              </li>
              <li>
                Different assumptions or model versions are never presented as equivalent. See the Model registry for each model's
                declared boundaries.
              </li>
            </ul>
          </Panel>
        </>
      )}
    </div>
  );
}

function ComparisonTable({
  title,
  rows,
  runs,
}: {
  title: string;
  rows: ReturnType<typeof compareRuns>["metricRows"];
  runs: RunRecord[];
}) {
  if (rows.length === 0) return null;
  return (
    <Panel eyebrow="Comparison" title={title}>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Field</th>
              {runs.map((r) => (
                <th key={r.runId} className="num">
                  {r.runId.slice(-8)}
                </th>
              ))}
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.field}>
                <td>{row.field}</td>
                {row.cells.map((c, i) => (
                  <td key={i} className={`num ${c.differs ? "differs" : ""}`}>
                    {c.display}
                    {c.unit && c.unit !== "1" ? <span className="faint"> {c.unit === "count" ? "" : c.unit}</span> : null}
                  </td>
                ))}
                <td className="small muted">{row.note ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.some((r) => r.cells.some((c) => c.differs)) ? (
        <div className="tiny faint" style={{ marginTop: 6 }}>
          Highlighted cells differ between runs.
        </div>
      ) : null}
      {runs.length > 0 && runs.some((r) => r.verification.length === 0) ? (
        <Callout tone="warn" title="Missing verification">
          At least one run carries no verification results; those cells read NOT_TESTED rather than being assumed to pass.
        </Callout>
      ) : null}
    </Panel>
  );
}
