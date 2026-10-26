import { MODELS } from "../models/registry";
import { EDT_REQUIRED_INPUTS } from "../models/notImplemented";
import { Panel, StatusBadge } from "./components";

export function Registry() {
  return (
    <div className="stack">
      <Panel eyebrow="Model and assumption registry" title="Declared models, equations and exclusions">
        <p className="section-intro">
          Each model declares its governing equations, reference frame, conventions, assumptions, excluded effects, numerical
          method, validity limits and failure modes. Equations are flagged as implemented <em>only</em> when shipped code
          evaluates them. Documented-but-unimplemented equations are kept separate and are never presented as model capability.
        </p>
        <div className="grid cols-3">
          {MODELS.map((m) => (
            <div className="stat" key={m.id}>
              <span className="stat-label">{m.family}</span>
              <span className="stat-value mono">{m.id}</span>
              <span className="stat-unit">v{m.version}</span>
              <StatusBadge outcome={m.status} />
              <span className="stat-note">{m.name}</span>
            </div>
          ))}
        </div>
      </Panel>

      {MODELS.map((m) => (
        <Panel
          key={m.id}
          eyebrow={`${m.family} · ${m.id} · v${m.version}`}
          title={m.name}
          sub={m.summary}
          actions={<StatusBadge outcome={m.status} />}
        >
          {m.statusRationale && <div className="callout warn">{m.statusRationale}</div>}
          <dl className="meta-grid">
            <div className="meta">
              <dt>Reference frame</dt>
              <dd>{m.referenceFrame}</dd>
            </div>
            <div className="meta">
              <dt>Coordinate conventions</dt>
              <dd>{m.coordinateConventions}</dd>
            </div>
            <div className="meta">
              <dt>Units</dt>
              <dd>{m.unitConventions}</dd>
            </div>
            <div className="meta">
              <dt>Initial conditions</dt>
              <dd>{m.initialConditionDefinition}</dd>
            </div>
            <div className="meta">
              <dt>Mass representation</dt>
              <dd>{m.massRepresentation}</dd>
            </div>
            <div className="meta">
              <dt>Numerical method</dt>
              <dd>{m.numericalMethod}</dd>
            </div>
          </dl>

          <h3>Governing equations</h3>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Equation</th>
                  <th>In code</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {m.governingEquations.map((e) => (
                  <tr key={e.id}>
                    <td className="mono small">{e.id}</td>
                    <td>
                      <div className="equation">{e.statement}</div>
                    </td>
                    <td className="shrink">
                      <StatusBadge outcome={e.implementedInCode ? "PASS" : "NOT_TESTED"} />
                      <div className="tiny faint">{e.implementedInCode ? "implemented" : "documented only"}</div>
                    </td>
                    <td className="small muted">{e.note ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3>Physical effects</h3>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Effect</th>
                  <th>Status</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {m.effects.map((e) => (
                  <tr key={e.effect}>
                    <td>{e.effect}</td>
                    <td className="shrink">
                      <span
                        className={`badge ${e.status === "MODELED" ? "pass" : e.status === "APPROXIMATE" ? "unresolved" : "not-tested"}`}
                      >
                        {e.status}
                      </span>
                    </td>
                    <td className="small muted">{e.note ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid cols-2">
            <div>
              <h3>Assumptions</h3>
              <ul className="list small">
                {m.assumptions.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
              <h3>Solver settings</h3>
              <ul className="list small">
                {m.solverSettings.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </div>
            <div>
              <h3>Validity limits</h3>
              <ul className="list small">
                {m.validityLimits.map((v) => (
                  <li key={v}>{v}</li>
                ))}
              </ul>
              <h3>Known failure modes</h3>
              <ul className="list small">
                {m.knownFailureModes.map((v) => (
                  <li key={v}>{v}</li>
                ))}
              </ul>
            </div>
          </div>

          <div className="grid cols-2">
            <div>
              <h3>Limitations</h3>
              <ul className="list small">
                {m.limitations.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
              <h3>Out of scope</h3>
              <ul className="list small">
                {m.outOfScope.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            </div>
            <div>
              <h3>Input specification</h3>
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Parameter</th>
                      <th>Quantity</th>
                      <th>Display unit</th>
                      <th>Bounds</th>
                    </tr>
                  </thead>
                  <tbody>
                    {m.parameterSpecs.map((p) => (
                      <tr key={p.id}>
                        <td>
                          {p.label}
                          <div className="tiny faint mono">{p.id}</div>
                        </td>
                        <td className="small muted">{p.quantity}</td>
                        <td className="small muted">{p.unit}</td>
                        <td className="small muted">
                          {p.min !== undefined || p.max !== undefined
                            ? `${p.exclusiveMin ? ">" : "≥"} ${p.min ?? "−∞"} … ${p.max ?? "∞"}`
                            : "unbounded"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {m.status === "BLOCKED" && m.id === "OTL-EDT-1" && (
            <>
              <h3>Required inputs and evidence before implementation</h3>
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Required input / model</th>
                      <th>Status</th>
                      <th>Note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {EDT_REQUIRED_INPUTS.map((r) => (
                      <tr key={r.id}>
                        <td>
                          <span className="mono tiny">{r.id}</span>
                          <div>{r.description}</div>
                        </td>
                        <td className="shrink">
                          <span className="badge blocked">{r.status}</span>
                        </td>
                        <td className="small muted">{r.note}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="callout danger" style={{ marginTop: 10 }}>
                Electrodynamic calculations are BLOCKED, not omitted. No thrust, current, voltage or disposal performance is computed
                anywhere in this build, and the electrodynamic tether is not treated as a mechanical tether with an extra force term.
              </div>
            </>
          )}

          <h3>Verification checks registered for this model</h3>
          <div className="row">
            {m.verificationCheckIds.length === 0 ? (
              <span className="badge not-tested">none — model not executable</span>
            ) : (
              m.verificationCheckIds.map((id) => (
                <span className="badge info" key={id}>
                  {id}
                </span>
              ))
            )}
          </div>

          {m.verificationRequirements && m.verificationRequirements.length > 0 && (
            <>
              <h3>Verification requirements — not yet met</h3>
              <ul className="list small">
                {m.verificationRequirements.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </>
          )}

          <h3>References</h3>
          <ul className="list small">
            {m.references.map((r) => (
              <li key={r.label}>
                {r.url ? (
                  <a href={r.url} target="_blank" rel="noreferrer noopener">
                    {r.label}
                  </a>
                ) : (
                  r.label
                )}
                {r.note && <span className="faint"> — {r.note}</span>}
              </li>
            ))}
          </ul>
        </Panel>
      ))}
    </div>
  );
}
