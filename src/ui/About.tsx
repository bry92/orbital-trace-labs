import {
  APP_CLASSIFICATION,
  APP_NAME,
  APP_RELEASE_LABEL,
  APP_VERSION,
  BUILD_ID,
  CODE_REVISION_NOTE,
  CODE_REVISION_STATUS,
  DISCLAIMER,
  MU_EARTH,
  R_EARTH,
} from "../core/constants";
import { MODELS } from "../models/registry";
import { EVIDENCE_REGISTER, evidenceStatusCounts } from "../evidence/register";
import { Panel, StatusBadge, Callout } from "./components";

export function About() {
  const counts = evidenceStatusCounts();
  return (
    <div className="stack">
      <Panel eyebrow="About" title={`${APP_NAME} — ${APP_RELEASE_LABEL}`} sub={APP_CLASSIFICATION}>
        <Callout title="Permanent disclaimer" tone="warn">
          {DISCLAIMER}
        </Callout>
        <p style={{ marginTop: 12 }}>
          This application is an independent research prototype. It performs real numerical calculations of the models it declares,
          records how every result was produced, and reports what it does not model. It is built around one rule: the application
          must calculate the answer, not display the answer we expect.
        </p>
        <p className="muted">
          It cannot remove orbital debris, control a spacecraft, predict real mission performance, or validate a tether design. No
          comparison with flight data has been carried out. Verification checks confirm that the implementation of the stated
          equations behaves as specified; they do not establish physical validity.
        </p>
        <dl className="meta-grid">
          <div className="meta">
            <dt>Application version</dt>
            <dd className="mono">{APP_VERSION}</dd>
          </div>
          <div className="meta">
            <dt>Build identifier</dt>
            <dd className="mono tiny">{BUILD_ID}</dd>
          </div>
          <div className="meta">
            <dt>Code revision</dt>
            <dd>
              {CODE_REVISION_STATUS} — {CODE_REVISION_NOTE}
            </dd>
          </div>
          <div className="meta">
            <dt>Earth μ</dt>
            <dd className="mono">{MU_EARTH.toExponential(9)} m³/s² (IERS 2010; EV-PHY-001)</dd>
          </div>
          <div className="meta">
            <dt>Earth radius used for interpretation</dt>
            <dd className="mono">{R_EARTH} m (WGS-84; EV-PHY-002)</dd>
          </div>
          <div className="meta">
            <dt>Evidence records</dt>
            <dd>
              {EVIDENCE_REGISTER.length} total · {counts.SOURCE_REPORTED} source-reported · {counts.DERIVED} derived ·{" "}
              {counts.ASSUMED} assumed · {counts.CONFLICT} conflicting · {counts.UNKNOWN} unknown
            </dd>
          </div>
        </dl>
      </Panel>

      <Panel eyebrow="Capability" title="Implemented, documented and blocked">
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Model</th>
                <th>Family</th>
                <th>Status</th>
                <th>What it contains</th>
              </tr>
            </thead>
            <tbody>
              {MODELS.map((m) => (
                <tr key={m.id}>
                  <td>
                    <span className="mono">{m.id}</span> v{m.version}
                  </td>
                  <td className="small muted">{m.family}</td>
                  <td className="shrink">
                    <StatusBadge outcome={m.status} />
                  </td>
                  <td className="small">{m.summary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="small muted" style={{ marginTop: 10 }}>
          No model in this build is flight-qualified, and no model has been validated against mission data. Models that are not
          implemented are not hidden: they appear in the registry with an explicit status and the evidence they would require.
        </p>
      </Panel>

      <div className="grid cols-2">
        <Panel eyebrow="Methods" title="Numerical methods actually used">
          <ul className="list small">
            <li>
              <strong>Classical RK4</strong> — explicit fixed-step Runge–Kutta, order 4. Non-symplectic. Used as the default
              integrator and as the reference for convergence and repeatability checks.
            </li>
            <li>
              <strong>Dormand–Prince 5(4)</strong> — explicit adaptive Runge–Kutta pair with an embedded 4th-order error estimate,
              safety factor 0.9 and exponent −1/5. Used as an independent accuracy cross-check.
            </li>
            <li>
              <strong>Kepler analytic reference</strong> — Newton solution of Kepler's equation in the perifocal frame. Used only to
              test the integrators; it is a separate code path, not the propagation used for results.
            </li>
            <li>
              <strong>Diagnostics</strong> — specific energy, specific angular momentum, classical elements, and normalised
              discrepancies ε_E and ε_h with explicitly documented, nonzero scale values.
            </li>
          </ul>
        </Panel>
        <Panel eyebrow="Methods" title="What is deliberately not implemented">
          <ul className="list small">
            <li>Perturbations: J2 and higher harmonics, drag, third-body gravity, solar radiation pressure, relativity.</li>
            <li>Symplectic or implicit integrators (not implemented; drift is therefore expected and measured).</li>
            <li>State estimation, orbit determination or fitting to tracking data.</li>
            <li>Uncertainty propagation of any kind; uncertainties reported by sources are not propagated.</li>
            <li>Any electrodynamic tether calculation. See the model registry and the tether model's declared missing evidence.</li>
          </ul>
        </Panel>
      </div>

      <div className="grid cols-2">
        <Panel eyebrow="Integrity" title="How results are made traceable">
          <ul className="list small">
            <li>
              Every run has a unique identifier, a UTC timestamp, a model version, a build identifier, the full input list with
              units, solver settings, computed outputs, warnings, assumptions and verification results.
            </li>
            <li>
              A canonical payload hash (SHA-256) covers an explicitly listed set of fields; the hash fields themselves are excluded.
              Export files additionally carry artifact hashes over their exact bytes.
            </li>
            <li>
              Hashing shows integrity, not correctness or authorship. The code revision is reported as UNVERIFIED because no
              version-control revision is bound to the build.
            </li>
            <li>Runs are append-only in local storage; a new calculation never overwrites an earlier result.</li>
            <li>
              Import re-validates schema, units, model and hash, then optionally re-executes the calculation and compares series,
              metrics and verification outcomes with stated tolerances.
            </li>
          </ul>
        </Panel>
        <Panel eyebrow="Runtime" title="Execution environment and dependencies">
          <ul className="list small">
            <li>Single-page browser application: React 19 + TypeScript, bundled with Vite. No backend, no database, no external compute service.</li>
            <li>
              All physics runs in the browser in IEEE-754 double precision. There is no server-side recomputation, so results depend
              on the JavaScript engine's arithmetic.
            </li>
            <li>Persistence uses browser localStorage only. Nothing is transmitted; there are no network calls and no analytics.</li>
            <li>Numerical code is covered by automated tests executed with Vitest against the same modules the interface uses.</li>
            <li>Charts are hand-built SVG rendered directly from the stored series; no illustrative or synthetic curves are drawn.</li>
          </ul>
        </Panel>
      </div>

      <Panel eyebrow="Reproducibility" title="Reproducing a run">
        <ol className="list small">
          <li>Execute an experiment in the Simulation Laboratory (or import an exported JSON run record).</li>
          <li>
            Export all artifacts. The JSON record carries the full payload; the CSV carries the computed series with units in the
            header; the report carries the human-readable technical description; the manifest lists artifact hashes.
          </li>
          <li>Re-import the JSON. The importer validates schema version, units, model and payload hash before accepting it.</li>
          <li>
            Press <strong>Reproduce</strong>. The application re-validates the stored inputs, re-executes the same model, and compares
            series and metrics against the stored values at the documented tolerance (1e-12 same build; 1e-9 cross-build).
          </li>
          <li>
            A different model version is reported as BLOCKED rather than compared: results from different model boundaries are not
            interchangeable.
          </li>
        </ol>
      </Panel>

      <Panel eyebrow="Limitations" title="Known limitations of this build">
        <ul className="list small">
          <li>No perturbation forces, so results are not orbit predictions for a real spacecraft.</li>
          <li>No flight-data comparison; no claim of validation, calibration or digital-twin fidelity.</li>
          <li>Initial conditions are limited to Cartesian states; no covariance, no state uncertainty.</li>
          <li>The reference frame is an idealised inertial frame, not a rigorous J2000/ICRF realisation.</li>
          <li>Earth radius is used as a sphere for surface checks; flattening is not modelled.</li>
          <li>Only one node of execution: browser arithmetic; cross-platform bit-identical results are not guaranteed.</li>
          <li>Storage is local to the browser profile; clearing site data removes stored runs.</li>
        </ul>
      </Panel>
    </div>
  );
}
