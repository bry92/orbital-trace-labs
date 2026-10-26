/**
 * Isolated historical reconstruction workspace (NASA TSS-1 and TSS-1R).
 *
 * Design rules enforced here:
 *  - Sourced values are selected explicitly and carry their evidence identifier.
 *  - Conflicting values are offered as alternatives; whichever is chosen is flagged.
 *  - Unknown values are left EMPTY and block execution until the researcher supplies
 *    an explicit assumption and attests to it. No placeholder mass is inserted.
 *  - The resulting run is labelled EVIDENCE_INFORMED_RECONSTRUCTION and is never
 *    presented as a validated digital twin or compared with flight data.
 */

import { useMemo, useState } from "react";
import { MU_EARTH, R_EARTH } from "../core/constants";
import type { RunRecord } from "../core/run";
import type { ParameterInput } from "../core/validation";
import { evidenceById } from "../evidence/register";
import { executeExperiment } from "../engine/execute";
import { TETHER_MODEL_ID } from "../models/tether";
import { Panel, EvidenceBadge, Callout, Empty, Stat } from "./components";
import { RunDetail } from "./RunDetail";

interface Option {
  id: string;
  label: string;
  value: number;
  evidenceId: string;
}

interface MissionCase {
  id: string;
  name: string;
  year: string;
  summary: string;
  lengths: Option[];
  masses: Option[];
  altitudes: Option[];
  outcome: string[];
}

const MISSIONS: MissionCase[] = [
  {
    id: "tss-1r",
    name: "TSS-1R (STS-75)",
    year: "1996",
    summary:
      "Re-flight of the Tethered Satellite System. The tether broke during deployment after electrical arcing; the deployed length at failure is source-reported at 19,695 m against a planned 20,700 m.",
    lengths: [
      { id: "deployed", label: "Deployed length at tether break", value: 19_695, evidenceId: "EV-TSS1R-002" },
      { id: "planned", label: "Planned On-Station I length", value: 20_700, evidenceId: "EV-TSS1R-001" },
    ],
    masses: [
      { id: "m517", label: "Satellite mass 517 kg", value: 517, evidenceId: "EV-TSS1R-005" },
      { id: "m518", label: "Satellite mass 518 kg (conflicting report)", value: 518, evidenceId: "EV-TSS1R-006" },
    ],
    altitudes: [{ id: "alt296", label: "296.32 km (160 nmi, NASA/ESA)", value: 296_320, evidenceId: "EV-TSS1R-010" }],
    outcome: [
      "Tether broke within the Satellite Deployment Boom (EV-TSS1R-003).",
      "Initiating insulation damage cause is UNKNOWN (EV-TSS1R-004).",
      "Measured Lorentz thrust is UNKNOWN (EV-TSS1R-013), so no electrodynamic benchmark exists.",
      "Tether linear density is UNKNOWN (EV-TSS1R-009) and is not substituted.",
    ],
  },
  {
    id: "tss-1",
    name: "TSS-1 (STS-46)",
    year: "1992",
    summary:
      "First Tethered Satellite System mission. Deployment stopped at a few hundred metres because of a deployer hardware fault; the mission did not reach its planned 20 km separation.",
    lengths: [
      { id: "deployed", label: "Maximum deployed length (NASA 256 m)", value: 256, evidenceId: "EV-TSS1-002" },
      { id: "conflict", label: "Alternative report 262.1 m (conflict)", value: 262.1, evidenceId: "EV-TSS1-003" },
      { id: "planned", label: "Planned deployment", value: 20_000, evidenceId: "EV-TSS1-001" },
    ],
    masses: [
      { id: "m518", label: "Satellite mass 518 kg", value: 518, evidenceId: "EV-TSS1-005" },
      { id: "m515", label: "Satellite mass 515 kg (conflicting report)", value: 515, evidenceId: "EV-TSS1-006" },
    ],
    altitudes: [
      { id: "alt426", label: "425.96 km (230 nmi, NASA)", value: 425_960, evidenceId: "EV-TSS1-009" },
      { id: "alt296", label: "296 km (secondary report, conflict)", value: 296_000, evidenceId: "EV-TSS1-010" },
    ],
    outcome: [
      "Deployment stopped at 256 m (NASA) due to bolt/level-wind interference (EV-TSS1-004).",
      "Two conflicting deployed lengths are preserved (EV-TSS1-002 / EV-TSS1-003).",
      "Two conflicting orbit altitudes are preserved (EV-TSS1-009 / EV-TSS1-010).",
      "Tether mass and orbiter-side effective mass are UNKNOWN (EV-TSS1-011 / EV-TSS1-012).",
    ],
  },
];

export function Reconstruction({
  runs,
  onRunCreated,
}: {
  runs: RunRecord[];
  onRunCreated: (run: RunRecord) => void;
}) {
  const [missionId, setMissionId] = useState("tss-1r");
  const mission = MISSIONS.find((m) => m.id === missionId)!;
  const [lengthId, setLengthId] = useState("deployed");
  const [massId, setMassId] = useState("m517");
  const [altitudeId, setAltitudeId] = useState("alt296");
  const [counterweightMass, setCounterweightMass] = useState("");
  const [theta0, setTheta0] = useState("");
  const [deploymentRate, setDeploymentRate] = useState("");
  const [durationHours, setDurationHours] = useState("2");
  const [stepSeconds, setStepSeconds] = useState("2");
  const [attested, setAttested] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRun, setLastRun] = useState<RunRecord | null>(null);
  const [blocked, setBlocked] = useState(false);

  function switchMission(id: string) {
    const m = MISSIONS.find((x) => x.id === id)!;
    setMissionId(id);
    setLengthId(m.lengths[0].id);
    setMassId(m.masses[0].id);
    setAltitudeId(m.altitudes[0].id);
    setCounterweightMass("");
    setTheta0("");
    setDeploymentRate("");
    setAttested(false);
    setLastRun(null);
    setError(null);
    setBlocked(false);
  }

  const length = mission.lengths.find((l) => l.id === lengthId) ?? mission.lengths[0];
  const mass = mission.masses.find((m) => m.id === massId) ?? mission.masses[0];
  const altitude = mission.altitudes.find((a) => a.id === altitudeId) ?? mission.altitudes[0];

  const evidenceFor = (option: Option) => evidenceById[option.evidenceId];
  const conflictSelected =
    evidenceFor(length)?.status === "CONFLICT" ||
    evidenceFor(mass)?.status === "CONFLICT" ||
    evidenceFor(altitude)?.status === "CONFLICT";

  const counterweight = Number(counterweightMass);
  const counterweightValid = counterweightMass.trim() !== "" && Number.isFinite(counterweight) && counterweight > 0;
  const theta = Number(theta0);
  const thetaValid = theta0.trim() !== "" && Number.isFinite(theta) && Math.abs(theta) <= 180;
  const rate = Number(deploymentRate);
  const rateValid = deploymentRate.trim() !== "" && Number.isFinite(rate) && rate >= 0 && rate <= 100;
  const duration = Number(durationHours);
  const durationValid = Number.isFinite(duration) && duration > 0 && duration <= 720;
  const step = Number(stepSeconds);
  const stepValid = Number.isFinite(step) && step > 0 && step <= 1e5;

  const ready = counterweightValid && thetaValid && rateValid && durationValid && stepValid && attested;

  const radiusM = R_EARTH + altitude.value;
  const vCirc = Math.sqrt(MU_EARTH / radiusM);

  const evidenceFlags = useMemo(() => {
    const flags: string[] = [];
    flags.push(`SOURCE_SELECTED: ${length.label} = ${length.value} m (${length.evidenceId}).`);
    flags.push(`SOURCE_SELECTED: satellite mass ${mass.value} kg (${mass.evidenceId}).`);
    flags.push(`SOURCE_SELECTED: altitude ${altitude.value} m (${altitude.evidenceId}).`);
    if (conflictSelected) {
      flags.push(
        "CONFLICT_SELECTED: at least one selected parameter is reported differently by other sources; the alternative values are preserved in the evidence register and were not reconciled.",
      );
    }
    flags.push(
      `ASSUMED: counterweight (orbiter-side) effective mass = ${counterweightValid ? `${counterweight} kg` : "NOT SUPPLIED"} — no source value exists (EV-TSS1-012 / EV-ASM-001).`,
    );
    flags.push(
      `ASSUMED: initial in-plane libration angle = ${thetaValid ? `${theta} deg` : "NOT SUPPLIED"} — not source-reported for this configuration.`,
    );
    flags.push(
      `ASSUMED: initial libration rate = 0 deg/s — not source-reported; held at zero as an explicit assumption.`,
    );
    flags.push(
      `ASSUMED: prescribed deployment rate = ${rateValid ? `${rate} m/s` : "NOT SUPPLIED"} — no source-reported rate is available; the model treats length history as an input.`,
    );
    flags.push(
      `DERIVED: circular reference orbit constructed from the selected altitude; speed = sqrt(mu/r) = ${vCirc.toFixed(3)} m/s (EV-PHY-001, EV-DER-004).`,
    );
    flags.push(
      "ANALYSIS_CHOICE: propagation duration and integration step are analysis settings, not historical data.",
    );
    flags.push(
      "MODEL_BOUNDARY: tether is massless and rigid; tether mass/linear density is UNKNOWN (EV-TSS1-011 / EV-TSS1R-009) and is not required by, or substituted into, this model.",
    );
    flags.push(
      "MODEL_BOUNDARY: prescribed length, one-way coupling, planar libration only. Dynamically calculated deployment and coupled orbital dynamics are NOT_MODELED.",
    );
    return flags;
  }, [length, mass, altitude, conflictSelected, counterweight, counterweightValid, theta, thetaValid, rate, rateValid, vCirc]);

  async function runReconstruction() {
    if (!ready) {
      setBlocked(true);
      return;
    }
    setBusy(true);
    setError(null);
    setBlocked(false);
    try {
      const inputs: ParameterInput[] = [
        { paramId: "gravitationalParameter", value: MU_EARTH, unit: "m3s2" },
        { paramId: "initialPositionX", value: radiusM / 1000, unit: "km" },
        { paramId: "initialPositionY", value: 0, unit: "km" },
        { paramId: "initialPositionZ", value: 0, unit: "km" },
        { paramId: "initialVelocityX", value: 0, unit: "kmps" },
        { paramId: "initialVelocityY", value: vCirc / 1000, unit: "kmps" },
        { paramId: "initialVelocityZ", value: 0, unit: "kmps" },
        { paramId: "satelliteMass", value: mass.value, unit: "kg" },
        { paramId: "orbiterMass", value: counterweight, unit: "kg" },
        { paramId: "tetherLength", value: length.value / 1000, unit: "km" },
        { paramId: "deploymentRate", value: rate, unit: "mps" },
        { paramId: "theta0", value: theta, unit: "deg" },
        { paramId: "thetaDot0", value: 0, unit: "degps" },
        { paramId: "duration", value: duration, unit: "h" },
        { paramId: "stepSeconds", value: step, unit: "s" },
      ];
      const origins = Object.fromEntries(
        inputs.map((i) => [
          i.paramId,
          ["satelliteMass", "tetherLength", "initialPositionX", "initialPositionY", "initialPositionZ", "initialVelocityX", "initialVelocityY", "initialVelocityZ"].includes(i.paramId)
            ? "PRESET_DEFAULT"
            : "USER_EDITED",
        ]),
      ) as Record<string, "PRESET_DEFAULT" | "USER_EDITED">;

      const res = await executeExperiment({
        modelId: TETHER_MODEL_ID,
        method: "RK4",
        scenarioName: `${mission.name} — evidence-informed reconstruction (assumed inputs)`,
        inputs,
        inputOrigins: origins,
        dataOrigin: "EVIDENCE_INFORMED_RECONSTRUCTION",
        evidenceFlags,
      });
      if (res.ok) {
        setLastRun(res.record);
        onRunCreated(res.record);
      } else {
        setError(res.issues.map((i) => `${i.code}: ${i.message}`).join("\n"));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <Panel
        eyebrow="Historical reconstruction workspace"
        title="NASA Tethered Satellite System — evidence-informed reconstruction"
        sub="Isolated workspace. Parameters come from the evidence register or from explicit researcher assumptions. Nothing here is a validated digital twin, and no comparison with flight data has been performed."
      >
        <Callout title="Scope rule" tone="warn">
          A reconstruction is an evidence-informed model, not automatically a validated digital twin. Conflicting mission values are
          preserved as conflicts. Missing values stay UNKNOWN until the researcher supplies an explicit, flagged assumption.
        </Callout>

        <div className="grid cols-2" style={{ marginTop: 12 }}>
          {MISSIONS.map((m) => (
            <button
              key={m.id}
              className={`btn ${missionId === m.id ? "primary" : "ghost"}`}
              onClick={() => switchMission(m.id)}
              aria-pressed={missionId === m.id}
              style={{ justifyContent: "flex-start", textAlign: "left" }}
            >
              {m.name} · {m.year}
            </button>
          ))}
        </div>

        <h3>Mission record</h3>
        <p className="small muted">{mission.summary}</p>
        <ul className="list small">
          {mission.outcome.map((o) => (
            <li key={o}>{o}</li>
          ))}
        </ul>
      </Panel>

      <Panel eyebrow="Parameters" title="Select source-reported values and declare assumptions">
        <div className="grid cols-3">
          <div className="field">
            <label htmlFor="rec-length">Tether length</label>
            <select id="rec-length" value={lengthId} onChange={(e) => setLengthId(e.target.value)}>
              {mission.lengths.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label} — {l.value} m
                </option>
              ))}
            </select>
            <span className="row" style={{ marginTop: 4 }}>
              <EvidenceBadge status={evidenceFor(length)?.status ?? "UNKNOWN"} />
              <span className="mono tiny faint">{length.evidenceId}</span>
            </span>
          </div>

          <div className="field">
            <label htmlFor="rec-mass">Satellite mass</label>
            <select id="rec-mass" value={massId} onChange={(e) => setMassId(e.target.value)}>
              {mission.masses.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
            <span className="row" style={{ marginTop: 4 }}>
              <EvidenceBadge status={evidenceFor(mass)?.status ?? "UNKNOWN"} />
              <span className="mono tiny faint">{mass.evidenceId}</span>
            </span>
          </div>

          <div className="field">
            <label htmlFor="rec-alt">Orbital altitude</label>
            <select id="rec-alt" value={altitudeId} onChange={(e) => setAltitudeId(e.target.value)}>
              {mission.altitudes.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
            <span className="row" style={{ marginTop: 4 }}>
              <EvidenceBadge status={evidenceFor(altitude)?.status ?? "UNKNOWN"} />
              <span className="mono tiny faint">{altitude.evidenceId}</span>
            </span>
          </div>

          <div className="field">
            <label htmlFor="rec-cw">Counterweight effective mass (ASSUMED)</label>
            <div className="input-group">
              <input
                id="rec-cw"
                type="text"
                inputMode="decimal"
                placeholder="enter an assumed value — not source-reported"
                className={counterweightMass.trim() !== "" && !counterweightValid ? "invalid" : undefined}
                value={counterweightMass}
                onChange={(e) => setCounterweightMass(e.target.value)}
              />
              <select aria-label="counterweight mass unit" value="kg" disabled>
                <option value="kg">kg</option>
              </select>
            </div>
            <span className="hint">
              UNKNOWN in the evidence register (EV-TSS1-012). A two-end-mass model cannot run without it, so it stays BLOCKED until
              you supply an assumption.
            </span>
          </div>

          <div className="field">
            <label htmlFor="rec-theta">Initial libration angle (ASSUMED)</label>
            <div className="input-group">
              <input
                id="rec-theta"
                type="text"
                inputMode="decimal"
                placeholder="enter an assumed value in degrees"
                className={theta0.trim() !== "" && !thetaValid ? "invalid" : undefined}
                value={theta0}
                onChange={(e) => setTheta0(e.target.value)}
              />
              <select aria-label="libration angle unit" value="deg" disabled>
                <option value="deg">deg</option>
              </select>
            </div>
            <span className="hint">Not source-reported. No default is preselected.</span>
          </div>

          <div className="field">
            <label htmlFor="rec-rate">Prescribed deployment rate (ASSUMED)</label>
            <div className="input-group">
              <input
                id="rec-rate"
                type="text"
                inputMode="decimal"
                placeholder="enter an assumed value in m/s (0 = fixed length)"
                className={deploymentRate.trim() !== "" && !rateValid ? "invalid" : undefined}
                value={deploymentRate}
                onChange={(e) => setDeploymentRate(e.target.value)}
              />
              <select aria-label="deployment rate unit" value="mps" disabled>
                <option value="mps">m/s</option>
              </select>
            </div>
            <span className="hint">No source-reported deployment rate is available; length history is an input to this model.</span>
          </div>

          <div className="field">
            <label htmlFor="rec-duration">Propagation duration (analysis choice)</label>
            <div className="input-group">
              <input id="rec-duration" type="text" inputMode="decimal" value={durationHours} onChange={(e) => setDurationHours(e.target.value)} />
              <select aria-label="duration unit" value="h" disabled>
                <option value="h">h</option>
              </select>
            </div>
            <span className="hint">Analysis setting, not historical data.</span>
          </div>

          <div className="field">
            <label htmlFor="rec-step">Integration step (analysis choice)</label>
            <div className="input-group">
              <input id="rec-step" type="text" inputMode="decimal" value={stepSeconds} onChange={(e) => setStepSeconds(e.target.value)} />
              <select aria-label="step unit" value="s" disabled>
                <option value="s">s</option>
              </select>
            </div>
            <span className="hint">Fixed-step RK4; convergence must be demonstrated for the chosen step.</span>
          </div>

          <div className="field">
            <label>Derived reference orbit (not an input)</label>
            <div className="stat">
              <span className="stat-label">Circular radius</span>
              <span className="stat-value mono">{(radiusM / 1000).toFixed(3)} km</span>
              <span className="stat-unit">speed {vCirc.toFixed(3)} m/s · r = R_E + altitude</span>
              <span className="stat-note">Derived from the selected altitude option (EV-DER-004).</span>
            </div>
          </div>
        </div>

        <div className="issues" style={{ marginTop: 12 }}>
          {!counterweightValid && (
            <div className="issue warning">
              <strong>BLOCKED</strong> — counterweight effective mass is UNKNOWN in the register and has not been assumed. Enter a
              value yourself to proceed; the application will not invent one.
            </div>
          )}
          {!thetaValid && (
            <div className="issue warning">
              <strong>BLOCKED</strong> — initial libration angle is not source-reported. Enter an explicit assumption.
            </div>
          )}
          {!rateValid && (
            <div className="issue warning">
              <strong>BLOCKED</strong> — prescribed deployment rate has no sourced value. Enter an explicit assumption (0 for a
              fixed-length case).
            </div>
          )}
          {conflictSelected && (
            <div className="issue warning">
              <strong>CONFLICT SELECTED</strong> — a chosen parameter is reported differently by another source. The run will be
              flagged; the alternative value is preserved, not reconciled.
            </div>
          )}
          {blocked && <div className="issue">Execution refused: required assumptions or attestation are missing.</div>}
        </div>

        <label className="check" style={{ marginTop: 10 }}>
          <input type="checkbox" checked={attested} onChange={(e) => setAttested(e.target.checked)} />
          I have entered the values above myself, I understand which are assumptions rather than evidence, and I will not present the
          result as a validated reconstruction.
        </label>

        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn primary" onClick={runReconstruction} disabled={busy || !ready}>
            {busy ? "Executing…" : ready ? "Execute reconstruction" : "Blocked — assumptions required"}
          </button>
          <span className="small muted">
            Run is recorded as <span className="mono">EVIDENCE_INFORMED_RECONSTRUCTION</span> with every assumption in its evidence
            flags.
          </span>
        </div>

        {error && (
          <Callout title="Execution failed" tone="danger">
            <pre className="small" style={{ whiteSpace: "pre-wrap", margin: 0 }}>{error}</pre>
          </Callout>
        )}
      </Panel>

      <Panel eyebrow="Evidence flags for this reconstruction" title="Exactly what the run will declare">
        <div className="grid cols-2">
          <Stat label="Sourced parameters" value="3" unit="length, mass, altitude — all selected explicitly" />
          <Stat label="Assumed parameters" value="4" unit="counterweight mass, angle, angle rate, deployment rate" />
          <Stat
            label="Conflicts preserved"
            value={conflictSelected ? "selected" : "alternative available"}
            unit="see evidence register"
          />
          <Stat label="Model" value="OTL-TETH-1" unit="prescribed length · planar · one-way coupling" />
        </div>
        <ul className="list small" style={{ marginTop: 10 }}>
          {evidenceFlags.map((f) => (
            <li key={f}>
              <span className="mono tiny">{f.split(":")[0]}</span> {f.split(":").slice(1).join(":")}
            </li>
          ))}
        </ul>
      </Panel>

      {lastRun ? (
        <RunDetail run={lastRun} />
      ) : (
        <Empty>
          No reconstruction recorded in this session. Until one is executed, this workspace makes no claim about TSS-1 or TSS-1R
          behaviour.
        </Empty>
      )}

      <Panel eyebrow="Stored reconstructions" title="Session history">
        {runs.filter((r) => r.dataOrigin === "EVIDENCE_INFORMED_RECONSTRUCTION").length === 0 ? (
          <Empty>No evidence-informed reconstructions stored yet.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Run</th>
                  <th>Scenario</th>
                  <th>Executed (UTC)</th>
                  <th>Hash</th>
                  <th>Evidence flags</th>
                </tr>
              </thead>
              <tbody>
                {runs
                  .filter((r) => r.dataOrigin === "EVIDENCE_INFORMED_RECONSTRUCTION")
                  .map((r) => (
                    <tr key={r.runId}>
                      <td className="mono tiny">{r.runId}</td>
                      <td>{r.scenarioName}</td>
                      <td className="small muted">{r.createdAtUtc.replace("T", " ").slice(0, 19)}</td>
                      <td className="mono tiny">{r.payloadHash?.slice(0, 12) ?? "BLOCKED"}…</td>
                      <td className="small">{r.evidenceFlags.length}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
