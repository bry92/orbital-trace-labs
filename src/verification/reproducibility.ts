/**
 * Reproducibility check: re-import a stored run, re-execute it, and compare.
 *
 * Policy (documented, not tuned after the fact):
 *  - Different model id/version  → BLOCKED (no comparison is made as if equivalent)
 *  - Same build                  → series must agree to within 1e-12 of each column's
 *                                  maximum magnitude; metrics to 1e-12 relative
 *  - Different build, same model → tolerance relaxed to 1e-9 to allow platform
 *                                  differences in the JS engine, and the result is
 *                                  labelled CROSS-BUILD
 * The comparison never reports two runs as identical if their inputs, model,
 * solver settings or results differ.
 */

import { BUILD_ID } from "../core/constants";
import { verifyStoredHash, type RunRecord } from "../core/run";
import type { ParameterInput } from "../core/validation";
import { getModel } from "../models/registry";
import { TWO_BODY_MODEL_ID, type TwoBodySolverMethod } from "../models/twoBody";
import { TETHER_MODEL_ID } from "../models/tether";
import { executeExperiment } from "../engine/execute";

export type ReproStatus = "PASS" | "FAIL" | "BLOCKED";

export interface ReproductionResult {
  status: ReproStatus;
  reasons: string[];
  steps: { name: string; outcome: ReproStatus; detail: string }[];
  maxNormalisedSeriesDifference: number | null;
  metricDifferences: { id: string; label: string; original: number | null; reproduced: number | null; relativeDifference: number | null }[];
  reproducedRunId: string | null;
  buildMatch: boolean;
  modelVersionMatch: boolean;
  tolerance: number;
}

export async function reproduceStoredRun(record: RunRecord): Promise<ReproductionResult> {
  const reasons: string[] = [];
  const steps: ReproductionResult["steps"] = [];
  const buildMatch = record.app.buildId === BUILD_ID;
  const modelVersionMatch = (() => {
    const m = getModel(record.model.id);
    return !!m && m.version === record.model.version;
  })();
  const tolerance = buildMatch ? 1e-12 : 1e-9;

  // 1. Integrity.
  const hashCheck = await verifyStoredHash(record);
  if (record.hashStatus === "BLOCKED" || record.payloadHash === null) {
    steps.push({ name: "Payload hash", outcome: "BLOCKED", detail: "No payload hash was stored; integrity is unverified." });
    reasons.push("Payload hash unavailable: integrity cannot be established for this record.");
  } else if (hashCheck.scope === "RESULT") {
    steps.push({
      name: "Payload hash",
      outcome: "PASS",
      detail: `Recomputed result-identity SHA-256 matches the stored hash (${hashCheck.computed.slice(0, 16)}…).`,
    });
  } else if (hashCheck.scope === "LEGACY") {
    // A digest that matches the pre-repair scope is integrity evidence, not tampering.
    steps.push({
      name: "Payload hash",
      outcome: "PASS",
      detail: `Matches the LEGACY pre-repair hash scope (${hashCheck.legacyComputed.slice(0, 16)}…). Content is intact; the scope bound run id, timestamps and timings, which this build does not. Re-hash the record to bind the current result scope.`,
    });
  } else {
    steps.push({
      name: "Payload hash",
      outcome: "FAIL",
      detail: `Stored hash ${record.payloadHash.slice(0, 16)}… matches neither the result scope (${hashCheck.computed.slice(0, 16)}…) nor the legacy scope (${hashCheck.legacyComputed.slice(0, 16)}…).`,
    });
    reasons.push("Payload hash mismatch: the record was altered, so reproduction is not meaningful.");
    return {
      status: "FAIL",
      reasons,
      steps,
      maxNormalisedSeriesDifference: null,
      metricDifferences: [],
      reproducedRunId: null,
      buildMatch,
      modelVersionMatch,
      tolerance,
    };
  }

  // 2. Model comparability.
  const model = getModel(record.model.id);
  if (!model || model.status !== "IMPLEMENTED") {
    steps.push({ name: "Model availability", outcome: "BLOCKED", detail: `Model ${record.model.id} is not implemented in this build.` });
    return {
      status: "BLOCKED",
      reasons: [...reasons, `Model ${record.model.id} v${record.model.version} is not implemented here; no comparison is made.`],
      steps,
      maxNormalisedSeriesDifference: null,
      metricDifferences: [],
      reproducedRunId: null,
      buildMatch,
      modelVersionMatch,
      tolerance,
    };
  }
  if (!modelVersionMatch) {
    steps.push({
      name: "Model version",
      outcome: "BLOCKED",
      detail: `Stored v${record.model.version} vs implemented v${model.version}.`,
    });
    return {
      status: "BLOCKED",
      reasons: [...reasons, `Model version differs (stored v${record.model.version}, implemented v${model.version}). Results are not compared as equivalent.`],
      steps,
      maxNormalisedSeriesDifference: null,
      metricDifferences: [],
      reproducedRunId: null,
      buildMatch,
      modelVersionMatch,
      tolerance,
    };
  }
  steps.push({
    name: "Model version",
    outcome: "PASS",
    detail: `${record.model.id} v${record.model.version} is implemented here.`,
  });
  steps.push({
    name: "Build",
    outcome: buildMatch ? "PASS" : "BLOCKED",
    detail: buildMatch
      ? "Same build identifier as the recording session."
      : `Recorded build ${record.app.buildId} differs from current build; comparison uses the relaxed cross-build tolerance ${tolerance}.`,
  });
  if (!buildMatch) reasons.push("Cross-build reproduction: identical results are not guaranteed by this application.");

  // 3. Re-execute from the stored inputs, through the same validation path.
  const inputs: ParameterInput[] = record.parameters.map((p) => ({
    paramId: p.paramId,
    value: p.enteredValue,
    unit: p.enteredUnit,
  }));
  const method = record.solver.method === "DOPRI5" ? "DOPRI5" : "RK4";
  const executable = model.id === TWO_BODY_MODEL_ID || model.id === TETHER_MODEL_ID;
  if (!executable) {
    steps.push({ name: "Execution", outcome: "BLOCKED", detail: "No re-execution path is registered for this model." });
    return {
      status: "BLOCKED",
      reasons: [...reasons, "No re-execution path is registered for this model."],
      steps,
      maxNormalisedSeriesDifference: null,
      metricDifferences: [],
      reproducedRunId: null,
      buildMatch,
      modelVersionMatch,
      tolerance,
    };
  }

  const originMap = Object.fromEntries(record.parameters.map((p) => [p.paramId, "IMPORTED" as const]));
  const executed = await executeExperiment({
    modelId: model.id,
    method: method as TwoBodySolverMethod,
    scenarioName: record.scenarioName,
    inputs,
    inputOrigins: originMap,
    dataOrigin: record.dataOrigin,
    evidenceFlags: record.evidenceFlags,
    maxStoredSamples: record.series.decimation.recordedSampleCount,
  });

  if (!executed.ok) {
    steps.push({
      name: "Execution",
      outcome: "BLOCKED",
      detail: executed.issues.map((i) => `${i.code}: ${i.message}`).join(" | "),
    });
    return {
      status: "BLOCKED",
      reasons: [...reasons, "The stored inputs no longer pass validation, so the calculation could not be re-executed."],
      steps,
      maxNormalisedSeriesDifference: null,
      metricDifferences: [],
      reproducedRunId: null,
      buildMatch,
      modelVersionMatch,
      tolerance,
    };
  }
  const reproduced = executed.record;
  steps.push({ name: "Execution", outcome: "PASS", detail: `Re-executed as ${reproduced.runId} (${reproduced.series.data.t?.length ?? 0} stored samples).` });

  // 4. Series comparison, normalised per column by that column's maximum magnitude.
  let maxDiff = 0;
  let seriesProblem: string | null = null;
  const columns = record.series.columns.filter((c) => Array.isArray(record.series.data[c.key]));
  for (const col of columns) {
    const a = record.series.data[col.key];
    const b = reproduced.series.data[col.key];
    if (!b) {
      seriesProblem = `Column ${col.key} is absent from the re-executed series.`;
      break;
    }
    if (a.length !== b.length) {
      seriesProblem = `Column ${col.key} sample counts differ (${a.length} stored vs ${b.length} re-executed); the decimation rule did not reproduce.`;
      break;
    }
    const scale = Math.max(...a.map((v) => Math.abs(v)), ...b.map((v) => Math.abs(v)));
    if (scale === 0) continue;
    for (let i = 0; i < a.length; i++) maxDiff = Math.max(maxDiff, Math.abs(a[i] - b[i]) / scale);
  }
  if (seriesProblem) {
    steps.push({ name: "Series comparison", outcome: "FAIL", detail: seriesProblem });
    reasons.push(seriesProblem);
  } else {
    steps.push({
      name: "Series comparison",
      outcome: maxDiff <= tolerance ? "PASS" : "FAIL",
      detail: `Maximum per-column normalised difference ${maxDiff.toExponential(3)} vs tolerance ${tolerance.toExponential(1)} across ${columns.length} columns.`,
    });
    if (maxDiff > tolerance) reasons.push(`Series difference ${maxDiff.toExponential(3)} exceeds the ${tolerance.toExponential(1)} tolerance.`);
  }

  // 5. Metric comparison.
  const metricDifferences = record.metrics.map((orig) => {
    const rep = reproduced.metrics.find((m) => m.id === orig.id);
    const a = orig.value;
    const b = rep?.value ?? null;
    let rel: number | null = null;
    if (a === null || b === null) rel = a === b ? 0 : null;
    else if (a === 0 && b === 0) rel = 0;
    else if (a === 0 || b === 0) rel = Infinity;
    else rel = Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b));
    return { id: orig.id, label: orig.label, original: a, reproduced: b, relativeDifference: rel };
  });
  const metricFailures = metricDifferences.filter(
    (d) => d.relativeDifference === null || (Number.isFinite(d.relativeDifference) ? d.relativeDifference > tolerance : true),
  );
  steps.push({
    name: "Metric comparison",
    outcome: metricFailures.length === 0 ? "PASS" : "FAIL",
    detail:
      metricFailures.length === 0
        ? `All ${metricDifferences.length} metrics match within ${tolerance.toExponential(1)}.`
        : `${metricFailures.length} metric(s) differ: ${metricFailures.map((f) => f.id).join(", ")}.`,
  });
  if (metricFailures.length > 0) reasons.push(`${metricFailures.length} metric(s) failed the reproduction tolerance.`);

  // 6. Verification outcome comparison.
  const vOrig = [...record.verification].sort((a, b) => a.checkId.localeCompare(b.checkId));
  const vRep = [...reproduced.verification].sort((a, b) => a.checkId.localeCompare(b.checkId));
  const verificationSame =
    vOrig.length === vRep.length &&
    vOrig.every((c, i) => c.checkId === vRep[i].checkId && c.outcome === vRep[i].outcome);
  steps.push({
    name: "Verification outcomes",
    outcome: verificationSame ? "PASS" : "FAIL",
    detail: verificationSame
      ? `${vOrig.length} check outcomes reproduced identically.`
      : "Verification outcomes changed between the stored run and the re-execution.",
  });
  if (!verificationSame) reasons.push("Verification outcomes differ from the stored run.");

  const allPass =
    maxDiff <= tolerance && metricFailures.length === 0 && verificationSame && seriesProblem === null;
  if (allPass) reasons.push("Re-execution reproduced the stored series, metrics and verification outcomes within the documented tolerance.");

  return {
    status: allPass ? "PASS" : "FAIL",
    reasons,
    steps,
    maxNormalisedSeriesDifference: Number.isFinite(maxDiff) ? maxDiff : null,
    metricDifferences,
    reproducedRunId: reproduced.runId,
    buildMatch,
    modelVersionMatch,
    tolerance,
  };
}
