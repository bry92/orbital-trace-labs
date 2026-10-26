import { useMemo, useState } from "react";
import { UNITS } from "../core/units";
import type { InputOrigin, RunRecord } from "../core/run";
import type { ParameterInput } from "../core/validation";
import {
  TWO_BODY_MODEL_ID,
  TWO_BODY_PRESETS,
  validateTwoBodyInputs,
  type ScenarioPreset,
  type TwoBodySolverMethod,
} from "../models/twoBody";
import { TETHER_PRESETS, validateTetherInputs } from "../models/tether";
import { getModel, IMPLEMENTED_MODEL_IDS, MODELS, parameterSpecsFor } from "../models/registry";
import { executeExperiment } from "../engine/execute";
import { parseImportedRun, type ImportResult } from "../export/importRun";
import { reproduceStoredRun, type ReproductionResult } from "../verification/reproducibility";
import { Panel, IssueList, StatusBadge, Callout, Empty } from "./components";
import { RunDetail } from "./RunDetail";

type FieldState = { value: string; unit: string; origin: InputOrigin };

const PRESETS_BY_MODEL: Record<string, ScenarioPreset[]> = {
  "OTL-2BP": TWO_BODY_PRESETS,
  "OTL-TETH-1": TETHER_PRESETS,
};

const GROUPS_BY_MODEL: Record<string, { title: string; ids: string[] }[]> = {
  "OTL-2BP": [
    { title: "Central body", ids: ["gravitationalParameter"] },
    {
      title: "Initial state (inertial, t = 0)",
      ids: ["initialPositionX", "initialPositionY", "initialPositionZ", "initialVelocityX", "initialVelocityY", "initialVelocityZ"],
    },
    { title: "Propagation", ids: ["duration"] },
    { title: "Integrator", ids: ["stepSeconds", "relTolerance", "absTolerance", "initialStepSeconds", "maxStepSeconds"] },
  ],
  "OTL-TETH-1": [
    { title: "Central body", ids: ["gravitationalParameter"] },
    {
      title: "Reference orbit — centre of mass (inertial, t = 0)",
      ids: ["initialPositionX", "initialPositionY", "initialPositionZ", "initialVelocityX", "initialVelocityY", "initialVelocityZ"],
    },
    { title: "Tether and end masses", ids: ["satelliteMass", "orbiterMass", "tetherLength", "deploymentRate"] },
    { title: "Libration initial condition", ids: ["theta0", "thetaDot0"] },
    { title: "Propagation and integrator", ids: ["duration", "stepSeconds"] },
  ],
};

function fieldsForPreset(preset: ScenarioPreset): Record<string, FieldState> {
  const out: Record<string, FieldState> = {};
  for (const [id, v] of Object.entries(preset.values)) {
    out[id] = { value: String(v.value), unit: v.unit, origin: "PRESET_DEFAULT" };
  }
  return out;
}

export function Laboratory({
  runs,
  selectedRunId,
  onSelectRun,
  onRunCreated,
}: {
  runs: RunRecord[];
  selectedRunId: string | null;
  onSelectRun: (id: string) => void;
  onRunCreated: (run: RunRecord) => void;
}) {
  const [modelId, setModelId] = useState<string>(TWO_BODY_MODEL_ID);
  const initialPreset = PRESETS_BY_MODEL[TWO_BODY_MODEL_ID][0];
  const [presetId, setPresetId] = useState(initialPreset.id);
  const [method, setMethod] = useState<TwoBodySolverMethod>(initialPreset.method);
  const [fields, setFields] = useState<Record<string, FieldState>>(() => fieldsForPreset(initialPreset));
  const [scenarioName, setScenarioName] = useState(initialPreset.name);
  const [busy, setBusy] = useState(false);
  const [ranMs, setRanMs] = useState<number | null>(null);
  const [importState, setImportState] = useState<ImportResult | null>(null);
  const [executionError, setExecutionError] = useState<string | null>(null);
  const [repro, setRepro] = useState<ReproductionResult | null>(null);
  const [reproBusy, setReproBusy] = useState(false);

  const presets = PRESETS_BY_MODEL[modelId] ?? [];
  const model = getModel(modelId);
  const specs = useMemo(() => parameterSpecsFor(modelId, method), [modelId, method]);
  const groups = GROUPS_BY_MODEL[modelId] ?? [];

  const inputs: ParameterInput[] = specs
    .filter((s) => fields[s.id] !== undefined)
    .map((s) => ({ paramId: s.id, value: fields[s.id].value, unit: fields[s.id].unit }));

  const validationKey = inputs.map((i) => `${i.paramId}:${i.value}:${i.unit}`).join("|");
  const validation = useMemo(
    () =>
      modelId === TWO_BODY_MODEL_ID
        ? validateTwoBodyInputs(inputs, method)
        : validateTetherInputs(inputs),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [modelId, method, validationKey],
  );

  function selectModel(id: string) {
    const preset = PRESETS_BY_MODEL[id]?.[0];
    if (!preset) return;
    setModelId(id);
    setPresetId(preset.id);
    setMethod(preset.method);
    setFields(fieldsForPreset(preset));
    setScenarioName(preset.name);
    setExecutionError(null);
  }

  function loadPreset(id: string) {
    const preset = presets.find((p) => p.id === id);
    if (!preset) return;
    setPresetId(id);
    setMethod(preset.method);
    setFields(fieldsForPreset(preset));
    setScenarioName(preset.name);
    setExecutionError(null);
  }

  function update(id: string, patch: Partial<FieldState>) {
    setFields((prev) => ({
      ...prev,
      [id]: { ...(prev[id] ?? { value: "", unit: "m", origin: "USER_EDITED" }), ...patch, origin: "USER_EDITED" },
    }));
  }

  async function run() {
    setBusy(true);
    setRanMs(null);
    setExecutionError(null);
    const started = performance.now();
    try {
      const origins = Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v.origin]));
      const res = await executeExperiment({
        modelId,
        method: modelId === TWO_BODY_MODEL_ID ? method : "RK4",
        scenarioName: scenarioName.trim() || "(unnamed scenario)",
        inputs,
        inputOrigins: origins as Record<string, InputOrigin>,
      });
      setRanMs(performance.now() - started);
      if (res.ok) onRunCreated(res.record);
      else setExecutionError(res.issues.map((i) => `${i.code}: ${i.message}`).join("\n"));
    } finally {
      setBusy(false);
    }
  }

  async function onImport(file: File) {
    const text = await file.text();
    const res = await parseImportedRun(text);
    setImportState(res);
    if (res.ok && res.record) onRunCreated(res.record);
  }

  async function onReproduce() {
    const run = runs.find((r) => r.runId === selectedRunId);
    if (!run) return;
    setReproBusy(true);
    try {
      setRepro(await reproduceStoredRun(run));
    } finally {
      setReproBusy(false);
    }
  }

  const selected = runs.find((r) => r.runId === selectedRunId) ?? null;

  return (
    <div className="stack">
      <Panel
        eyebrow="Simulation laboratory"
        title="Create and execute an experiment"
        sub="Inputs are validated against the selected model before execution; nothing is silently defaulted, and invalid physics is rejected rather than computed."
      >
        <div className="grid cols-3">
          <div className="field">
            <label htmlFor="model">Physical model</label>
            <select id="model" value={modelId} onChange={(e) => selectModel(e.target.value)}>
              {MODELS.filter((m) => IMPLEMENTED_MODEL_IDS.includes(m.id)).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.id} — {m.name}
                </option>
              ))}
            </select>
            <span className="hint">{model?.family.replace("_", " ")} · version {model?.version}</span>
          </div>
          <div className="field">
            <label htmlFor="preset">Scenario preset</label>
            <select id="preset" value={presetId} onChange={(e) => loadPreset(e.target.value)}>
              {presets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <span className="hint">{presets.find((p) => p.id === presetId)?.description}</span>
          </div>
          <div className="field">
            <label htmlFor="scenario">Scenario name</label>
            <input id="scenario" type="text" value={scenarioName} onChange={(e) => setScenarioName(e.target.value)} />
            <span className="hint">Stored in the run record and every export.</span>
          </div>
          {modelId === TWO_BODY_MODEL_ID ? (
            <div className="field">
              <label htmlFor="method">Numerical method</label>
              <select id="method" value={method} onChange={(e) => setMethod(e.target.value as TwoBodySolverMethod)}>
                <option value="RK4">Classical RK4 (fixed step, order 4)</option>
                <option value="DOPRI5">Dormand–Prince 5(4) (adaptive)</option>
              </select>
              <span className="hint">Both are non-symplectic; drift is measured, not assumed.</span>
            </div>
          ) : (
            <div className="field">
              <label>Numerical method</label>
              <div className="input-group">
                <input type="text" value="RK4 fixed step (8-state)" readOnly aria-readonly="true" />
              </div>
              <span className="hint">The tether model has a fixed-step RK4 solver; no adaptive option is implemented.</span>
            </div>
          )}
        </div>

        {groups.map((group) => {
          const groupSpecs = group.ids
            .map((id) => specs.find((s) => s.id === id))
            .filter((s): s is NonNullable<typeof s> => Boolean(s));
          if (groupSpecs.length === 0) return null;
          return (
            <div key={group.title}>
              <h3>{group.title}</h3>
              <div className="grid cols-3">
                {groupSpecs.map((spec) => {
                  const field = fields[spec.id] ?? { value: "", unit: spec.unit, origin: "USER_EDITED" as InputOrigin };
                  const issue = validation.issues.find(
                    (i) => i.paramId === spec.id && i.severity === "error" && fields[spec.id] !== undefined,
                  );
                  const unitOptions = Object.values(UNITS).filter((u) => u.quantity === spec.quantity);
                  return (
                    <div className="field" key={spec.id}>
                      <label htmlFor={spec.id}>
                        {spec.label} {spec.required && <span className="faint">required</span>}
                      </label>
                      <div className="input-group">
                        <input
                          id={spec.id}
                          type="text"
                          inputMode="decimal"
                          className={issue ? "invalid" : undefined}
                          value={field.value}
                          onChange={(e) => update(spec.id, { value: e.target.value })}
                          aria-invalid={Boolean(issue)}
                          aria-describedby={`${spec.id}-hint`}
                        />
                        <select
                          aria-label={`${spec.label} unit`}
                          value={field.unit}
                          onChange={(e) => update(spec.id, { unit: e.target.value })}
                        >
                          {unitOptions.map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.symbol}
                            </option>
                          ))}
                        </select>
                      </div>
                      <span className="hint" id={`${spec.id}-hint`}>
                        {spec.description}
                      </span>
                      <span className="hint faint">origin: {field.origin.replace("_", " ").toLowerCase()}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}

        <IssueList issues={validation.issues} />
        {validation.extraWarnings.map((w) => (
          <div className="issue warning" key={w}>
            {w}
          </div>
        ))}
        {executionError && (
          <Callout title="Execution rejected" tone="danger">
            <pre className="small" style={{ whiteSpace: "pre-wrap", margin: 0 }}>{executionError}</pre>
          </Callout>
        )}

        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn primary" onClick={run} disabled={busy || !validation.ok}>
            {busy ? "Executing…" : "Execute calculation"}
          </button>
          <span className="small muted">
            {validation.ok
              ? "Inputs valid. Execution appends a new immutable run record with a payload hash."
              : "Execution blocked: fix the errors above. Invalid physics is never coerced."}
          </span>
          {ranMs !== null && <span className="mono tiny faint">{ranMs.toFixed(0)} ms</span>}
        </div>
      </Panel>

      <div className="grid cols-2">
        <Panel
          eyebrow="Reproducibility"
          title="Import a saved experiment and re-run it"
          sub="Schema, units, model version and payload hash are validated before any comparison."
        >
          <input
            type="file"
            accept="application/json,.json"
            aria-label="Import experiment JSON"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onImport(f);
              e.currentTarget.value = "";
            }}
          />
          {importState && (
            <>
              <div className={`issue ${importState.ok ? "ok" : ""}`}>
                {importState.ok ? "Import accepted." : "Import rejected."} Payload hash: {importState.hash.status}
              </div>
              {importState.errors.map((e) => (
                <div className="issue" key={e}>
                  {e}
                </div>
              ))}
              {importState.warnings.map((w) => (
                <div className="issue warning" key={w}>
                  {w}
                </div>
              ))}
            </>
          )}
          <div className="row" style={{ marginTop: 12 }}>
            <select
              aria-label="Select stored run"
              value={selectedRunId ?? ""}
              onChange={(e) => onSelectRun(e.target.value)}
              style={{ maxWidth: 420 }}
            >
              <option value="">— select a stored run —</option>
              {runs
                .slice()
                .reverse()
                .map((r) => (
                  <option key={r.runId} value={r.runId}>
                    {r.runId} · {r.scenarioName}
                  </option>
                ))}
            </select>
            <button className="btn" onClick={onReproduce} disabled={!selectedRunId || reproBusy}>
              {reproBusy ? "Re-running…" : "Reproduce"}
            </button>
          </div>

          {repro && (
            <div style={{ marginTop: 12 }}>
              <div className="row">
                <StatusBadge outcome={repro.status} />
                <span className="small muted">
                  tolerance {repro.tolerance.toExponential(1)}
                  {repro.maxNormalisedSeriesDifference !== null &&
                    ` · max normalised series difference ${repro.maxNormalisedSeriesDifference.toExponential(3)}`}
                </span>
              </div>
              <div className="table-wrap">
                <table className="data">
                  <tbody>
                    {repro.steps.map((s) => (
                      <tr key={s.name}>
                        <td style={{ width: "26%" }}>{s.name}</td>
                        <td className="shrink">
                          <StatusBadge outcome={s.outcome} />
                        </td>
                        <td className="small">{s.detail}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ul className="list small" style={{ marginTop: 8 }}>
                {repro.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </div>
          )}
        </Panel>

        <Panel eyebrow="Model scope" title="What this calculation does and does not include">
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Effect</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {(model?.effects ?? []).map((e) => (
                  <tr key={e.effect}>
                    <td>
                      {e.effect}
                      {e.note && <div className="tiny faint">{e.note}</div>}
                    </td>
                    <td className="shrink">
                      <span
                        className={`badge ${e.status === "MODELED" ? "pass" : e.status === "APPROXIMATE" ? "unresolved" : "not-tested"}`}
                      >
                        {e.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="tiny faint" style={{ marginTop: 8 }}>
            Verifying the solver does not validate these omissions. See the Models registry for the full statement.
          </div>
        </Panel>
      </div>

      {selected ? (
        <RunDetail run={selected} />
      ) : (
        <Empty>No run selected. Execute an experiment or select a stored run to inspect its computed outputs.</Empty>
      )}
    </div>
  );
}
