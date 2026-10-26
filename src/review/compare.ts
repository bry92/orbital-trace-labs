/**
 * Side-by-side comparison of stored runs.
 *
 * Comparison is deliberately conservative: runs are only compared as equivalent
 * when model id AND model version match. Otherwise the differences are displayed
 * and labelled, and the trajectory difference is not computed at all, because two
 * different models cannot produce a meaningful common trajectory.
 */

import type { RunRecord } from "../core/run";
import { fmt } from "../core/units";

export interface Cell {
  display: string;
  numeric: number | null;
  unit: string | null;
  differs: boolean;
}

export interface ComparisonRow {
  field: string;
  cells: Cell[];
  note?: string;
}

export interface PairSeriesDifference {
  runIdA: string;
  runIdB: string;
  maxNormalisedDifference: number | null;
  columnsCompared: number;
  note: string;
}

export interface RunComparison {
  runIds: string[];
  modelIds: string[];
  modelVersions: string[];
  modelsComparable: boolean;
  solverMethods: string[];
  inputRows: ComparisonRow[];
  setupRows: ComparisonRow[];
  metricRows: ComparisonRow[];
  verificationRows: ComparisonRow[];
  seriesDifferences: PairSeriesDifference[];
  warnings: string[];
  comparabilityStatement: string;
}

const BUILD_ZERO = 1e-300;

function cell(display: string, numeric: number | null, unit: string | null, differs: boolean): Cell {
  return { display, numeric, unit, differs };
}

function compareNumeric(values: (number | null)[], tolerance = 0): boolean[] {
  const present = values.filter((v): v is number => v !== null);
  if (present.length < 2) return values.map(() => false);
  const max = Math.max(...present.map((v) => Math.abs(v)));
  return values.map((v) => v !== null && present.some((p) => p !== v && Math.abs(p - v) > tolerance * Math.max(max, BUILD_ZERO)));
}

export function compareRuns(runs: RunRecord[]): RunComparison {
  const warnings: string[] = [];
  const modelIds = Array.from(new Set(runs.map((r) => r.model.id)));
  const modelVersions = Array.from(new Set(runs.map((r) => r.model.version)));
  const solverMethods = Array.from(new Set(runs.map((r) => r.solver.method)));
  const modelsComparable = modelIds.length === 1 && modelVersions.length === 1;

  if (modelIds.length > 1) {
    warnings.push(
      `Runs use different model families (${modelIds.join(", ")}). Their outputs are NOT compared as physically equivalent.`,
    );
  }
  if (modelIds.length === 1 && modelVersions.length > 1) {
    warnings.push(
      `Runs use different versions of ${modelIds[0]} (${modelVersions.join(", ")}). Results are shown side by side but are not treated as equivalent.`,
    );
  }
  if (solverMethods.length > 1) {
    warnings.push(
      `Solver methods differ (${solverMethods.join(", ")}). Any trajectory difference includes numerical error from both methods, not only model differences.`,
    );
  }
  const decimations = Array.from(new Set(runs.map((r) => r.series.decimation.recordedEvery)));
  if (decimations.length > 1) {
    warnings.push(`Stored series use different decimation strides (${decimations.join(", ")}); sampled points are not the same times.`);
  }

  // Inputs, keyed by parameter id.
  const paramIds: string[] = [];
  for (const r of runs) for (const p of r.parameters) if (!paramIds.includes(p.paramId)) paramIds.push(p.paramId);
  const inputRows: ComparisonRow[] = paramIds.map((id) => {
    const values = runs.map((r) => r.parameters.find((p) => p.paramId === id) ?? null);
    const differs = new Set(values.map((p) => (p ? `${p.enteredValue}|${p.enteredUnit}` : "ABSENT"))).size > 1;
    return {
      field: values.find((v) => v !== null)?.label ?? id,
      cells: values.map((p) =>
        p ? cell(`${fmt(p.enteredValue, 10)} ${p.enteredUnitSymbol}`, p.siValue, p.siUnit, differs) : cell("not supplied", null, null, true),
      ),
      note: differs ? "Input differs between runs." : undefined,
    };
  });

  const setupRows: ComparisonRow[] = [
    {
      field: "Model",
      cells: runs.map((r) =>
        cell(`${r.model.id} v${r.model.version}`, null, null, modelIds.length > 1 || modelVersions.length > 1),
      ),
      note: modelsComparable ? undefined : "Model boundaries differ; see warnings.",
    },
    {
      field: "Numerical method",
      cells: runs.map((r) => cell(r.solver.method, null, null, solverMethods.length > 1)),
    },
    {
      field: "Solver settings",
      cells: runs.map((r) => {
        const text = Object.entries(r.solver.settings).map(([k, v]) => `${k}=${v}`).join(", ");
        const differs = new Set(runs.map((x) => JSON.stringify(x.solver.settings))).size > 1;
        return cell(text, null, null, differs);
      }),
    },
    {
      field: "Declared assumptions",
      cells: runs.map((r) => {
        const sets = runs.map((x) => `${x.assumptions.length}|${x.assumptions.join("§")}`);
        return cell(`${r.assumptions.length} assumptions from the model registry`, null, null, new Set(sets).size > 1);
      }),
      note: new Set(runs.map((x) => x.assumptions.join("§"))).size > 1
        ? "Assumption sets differ between these runs; results are not directly equivalent."
        : "Identical assumption sets (same model registry entry).",
    },
    {
      field: "Data origin",
      cells: runs.map((r) => cell(r.dataOrigin, null, null, new Set(runs.map((x) => x.dataOrigin)).size > 1)),
    },
    {
      field: "Execution (UTC)",
      cells: runs.map((r) => cell(r.createdAtUtc, null, null, false)),
    },
    {
      field: "Payload SHA-256",
      cells: runs.map((r) => cell(r.payloadHash ? `${r.payloadHash.slice(0, 16)}…` : "BLOCKED", null, null, false)),
    },
    {
      field: "Evidence flags",
      cells: runs.map((r) => cell(r.evidenceFlags.length ? r.evidenceFlags.join("; ") : "none", null, null, new Set(runs.map((x) => x.evidenceFlags.join(";"))).size > 1)),
    },
  ];

  const metricIds = [
    "finalRadius",
    "finalSpeed",
    "energyInitial",
    "energyFinal",
    "epsEnergy",
    "epsAngularMomentum",
    "semiMajorAxis",
    "eccentricity",
    "period",
    "minRadius",
    "maxRadius",
    "steps",
    "samples",
  ];
  const metricRows: ComparisonRow[] = metricIds
    .filter((id) => runs.some((r) => r.metrics.some((m) => m.id === id)))
    .map((id) => {
      const metrics = runs.map((r) => r.metrics.find((m) => m.id === id) ?? null);
      const numeric = metrics.map((m) => m?.value ?? null);
      const differs = compareNumeric(numeric, 1e-12);
      const unit = metrics.find((m) => m)?.unit ?? null;
      return {
        field: metrics.find((m) => m)?.label ?? id,
        cells: metrics.map((m, i) => cell(m ? (m.value === null ? "NOT REPORTED" : fmt(m.value, 10)) : "—", numeric[i], unit, differs[i])),
        note: differs.some(Boolean) ? "Differs between runs." : undefined,
      };
    });

  const checkIds = Array.from(new Set(runs.flatMap((r) => r.verification.map((c) => c.checkId))));
  const verificationRows: ComparisonRow[] = checkIds.map((id) => {
    const outcomes = runs.map((r) => r.verification.find((c) => c.checkId === id)?.outcome ?? "NOT_TESTED");
    return {
      field: id,
      cells: outcomes.map((o) => cell(o, null, null, new Set(outcomes).size > 1)),
      note: new Set(outcomes).size > 1 ? "Verification outcome differs between runs." : undefined,
    };
  });

  const seriesDifferences: PairSeriesDifference[] = [];
  if (modelsComparable && runs.length >= 2) {
    const base = runs[0];
    for (let i = 1; i < runs.length; i++) {
      const other = runs[i];
      const shared = base.series.columns.filter((c) => other.series.columns.some((o) => o.key === c.key));
      let maxDiff = 0;
      let compared = 0;
      let note = "";
      for (const col of shared) {
        const a = base.series.data[col.key];
        const b = other.series.data[col.key];
        if (!a || !b) continue;
        if (a.length !== b.length || a.length === 0) {
          note = "Stored series have different sample counts or decimation, so trajectories are not compared point by point.";
          continue;
        }
        // Only meaningful when the sampled times themselves coincide.
        if (col.key === "t") {
          const maxTimeGap = Math.max(...a.map((v, k) => Math.abs(v - b[k])));
          if (maxTimeGap > 1e-9 * Math.max(1, Math.abs(a[a.length - 1]))) {
            note = "Sample times do not coincide; no pointwise trajectory difference is reported.";
            continue;
          }
        }
        const scale = Math.max(...a.map(Math.abs), ...b.map(Math.abs), BUILD_ZERO);
        for (let k = 0; k < a.length; k++) maxDiff = Math.max(maxDiff, Math.abs(a[k] - b[k]) / scale);
        compared++;
      }
      seriesDifferences.push({
        runIdA: base.runId,
        runIdB: other.runId,
        maxNormalisedDifference: compared > 0 ? maxDiff : null,
        columnsCompared: compared,
        note:
          note ||
          (compared > 0
            ? `Maximum per-column normalised trajectory difference across ${compared} shared columns (denominator: column maximum magnitude).`
            : "No shared series columns."),
      });
    }
  }

  const comparabilityStatement = modelsComparable
    ? `All compared runs use ${modelIds[0]} v${modelVersions[0]}. Numerical and input differences are displayed; the model boundaries are identical.`
    : "The compared runs do not share one model id/version. Their outputs are displayed for inspection only and are NOT physically equivalent.";

  return {
    runIds: runs.map((r) => r.runId),
    modelIds,
    modelVersions,
    modelsComparable,
    solverMethods,
    inputRows,
    setupRows,
    metricRows,
    verificationRows,
    seriesDifferences,
    warnings,
    comparabilityStatement,
  };
}
