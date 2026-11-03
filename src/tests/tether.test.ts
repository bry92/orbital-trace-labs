/** Model OTL-TETH-1 tests: libration physics, tension diagnostic, boundaries. */

import { describe, expect, it } from "vitest";
import { MU_EARTH, R_EARTH } from "../core/constants";
import { librationAcceleration, propagateTether, verticalTensionExactN } from "../core/tether";
import { calculateTether, TETHER_PARAMETER_SPECS, TETHER_PRESETS, validateTetherInputs } from "../models/tether";
import { TETHER_CHECKS } from "../verification/tetherChecks";
import { BALANCE_CASES, BALANCE_FRACTIONS } from "../verification/tetherBalance";
import { executeExperiment } from "../engine/execute";
import { reproduceStoredRun } from "../verification/reproducibility";
import type { ParameterInput } from "../core/validation";

const R0 = R_EARTH + 400e3;
const V_CIRC = Math.sqrt(MU_EARTH / R0);
const N0 = Math.sqrt(MU_EARTH / R0 ** 3);

const BASE = {
  mu: MU_EARTH,
  positionM: [R0, 0, 0] as [number, number, number],
  velocityMS: [0, V_CIRC, 0] as [number, number, number],
  satelliteMassKg: 500,
  orbiterMassKg: 500,
  lengthM: 20_000,
  deploymentRateMS: 0,
  theta0Rad: (5 * Math.PI) / 180,
  thetaDot0RadPerS: 0,
  durationS: 3600,
  stepS: 2,
};

function presetInputs(presetId: string): ParameterInput[] {
  const preset = TETHER_PRESETS.find((p) => p.id === presetId)!;
  const applicable = new Set(TETHER_PARAMETER_SPECS.map((s) => s.id));
  return Object.entries(preset.values)
    .filter(([id]) => applicable.has(id))
    .map(([paramId, v]) => ({ paramId, value: v.value, unit: v.unit }));
}

describe("tether libration equation", () => {
  it("has the analytic small-angle period 2π/(√3 n)", () => {
    const librationPeriod = 2 * Math.PI / (Math.sqrt(3) * N0);
    const res = propagateTether({ ...BASE, theta0Rad: (0.5 * Math.PI) / 180, durationS: 4 * librationPeriod, stepS: 1 });
    // Zero crossings, linearly interpolated.
    const crossings: number[] = [];
    for (let i = 1; i < res.series.thetaDeg.length; i++) {
      const a = res.series.thetaDeg[i - 1];
      const b = res.series.thetaDeg[i];
      if (a !== 0 && Math.sign(a) !== Math.sign(b)) {
        crossings.push(res.series.t[i - 1] + (Math.abs(a) / (Math.abs(a) + Math.abs(b))) * (res.series.t[i] - res.series.t[i - 1]));
      }
    }
    const measured = ((crossings[crossings.length - 1] - crossings[0]) / (crossings.length - 1)) * 2;
    console.log(`[TETH] libration period: measured ${measured.toFixed(3)} s, analytic ${librationPeriod.toFixed(3)} s, rel ${(Math.abs(measured - librationPeriod) / librationPeriod).toExponential(3)}`);
    expect(Math.abs(measured - librationPeriod) / librationPeriod).toBeLessThan(0.005);
  });

  it("keeps both vertical equilibria stationary and makes the horizontal one unstable", () => {
    const librationPeriod = 2 * Math.PI / (Math.sqrt(3) * N0);
    const zero = propagateTether({ ...BASE, theta0Rad: 0, durationS: librationPeriod, stepS: 1 });
    const pi = propagateTether({ ...BASE, theta0Rad: Math.PI, durationS: librationPeriod, stepS: 1 });
    const driftZero = Math.max(...zero.series.thetaDeg.map(Math.abs));
    const driftPi = Math.max(...pi.series.thetaDeg.map((v) => Math.abs(v - 180)));
    const horizontal = propagateTether({ ...BASE, theta0Rad: Math.PI / 2 + (0.01 * Math.PI) / 180, durationS: 1200, stepS: 2 });
    const growth = Math.abs(horizontal.final.thetaDeg - 90) / 0.01;
    console.log(`[TETH] equilibrium drift θ=0: ${driftZero.toExponential(3)}°, θ=180°: ${driftPi.toExponential(3)}°; horizontal growth in 1200 s: ${growth.toFixed(2)}× (analytic cosh ${Math.cosh(Math.sqrt(3) * N0 * 1200).toFixed(2)}×)`);
    expect(driftZero).toBeLessThan(1e-9);
    expect(driftPi).toBeLessThan(1e-9);
    expect(growth).toBeGreaterThan(4);
  });

  it("conserves the libration invariant at constant length, and does not under deployment", () => {
    const librationPeriod = 2 * Math.PI / (Math.sqrt(3) * N0);
    const res = propagateTether({ ...BASE, durationS: 4 * librationPeriod, stepS: 2 });
    const K = res.series.thetaDeg.map((thetaDeg, i) => {
      const theta = (thetaDeg * Math.PI) / 180;
      const rate = (res.series.thetaRateDegPerS[i] * Math.PI) / 180;
      return 0.5 * rate ** 2 - 1.5 * res.series.meanMotionRadS[i] ** 2 * Math.cos(theta) ** 2;
    });
    const drift = Math.max(...K.map((k) => Math.abs(k - K[0]) / Math.abs(K[0])));
    const deploying = propagateTether({ ...BASE, deploymentRateMS: 1, durationS: 4 * 3600, stepS: 5 });
    const Kd = deploying.series.thetaDeg.map((thetaDeg, i) => {
      const theta = (thetaDeg * Math.PI) / 180;
      const rate = (deploying.series.thetaRateDegPerS[i] * Math.PI) / 180;
      return 0.5 * rate ** 2 - 1.5 * deploying.series.meanMotionRadS[i] ** 2 * Math.cos(theta) ** 2;
    });
    const deployDrift = Math.abs(Kd[Kd.length - 1] - Kd[0]) / Math.abs(Kd[0]);
    console.log(`[TETH] invariant K drift (constant L): ${drift.toExponential(3)}; with 1 m/s deployment: ${deployDrift.toExponential(3)}`);
    expect(drift).toBeLessThan(1e-8);
    expect(deployDrift).toBeGreaterThan(1e-3);
  });

  it("evaluates the same acceleration as the documented closed form", () => {
    const theta = 0.3;
    const n = 1.1e-3;
    const rate = 0.4;
    const accel = librationAcceleration(theta, n, 0, 0);
    expect(accel).toBeCloseTo(-3 * n ** 2 * Math.sin(theta) * Math.cos(theta), 18);
    const damped = librationAcceleration(theta, n, 0.001, rate);
    expect(damped - accel).toBeCloseTo(-2 * 0.001 * rate, 18);
  });
});

describe("quasi-static tension diagnostic", () => {
  it("agrees with the exact force balance to first order", () => {
    const exact = verticalTensionExactN(MU_EARTH, 500, 500, 20_000, R0);
    const rel = Math.abs(exact.linearisedN - exact.tensionOuterN) / exact.tensionOuterN;
    console.log(
      `[TETH] tension: linear ${exact.linearisedN.toFixed(6)} N, exact outer ${exact.tensionOuterN.toFixed(6)} N, exact inner ${exact.tensionInnerN.toFixed(6)} N, rel diff ${rel.toExponential(3)} (L/r=${(20_000 / R0).toExponential(3)})`,
    );
    expect(rel).toBeLessThan(2 * (20_000 / R0));
    expect(rel).toBeGreaterThan(0); // first-order model is not exact
    expect(exact.linearisedN).toBeGreaterThan(0);
  });

  it("scales as L/r³ and is zero-free", () => {
    const a = verticalTensionExactN(MU_EARTH, 500, 500, 10_000, R0);
    const b = verticalTensionExactN(MU_EARTH, 500, 500, 20_000, R0);
    expect(b.linearisedN / a.linearisedN).toBeCloseTo(2, 9);
    console.log(`[TETH] tension scales linearly with L: T(20 km)/T(10 km) = ${(b.linearisedN / a.linearisedN).toFixed(9)}`);
  });
});

describe("model boundaries", () => {
  it("keeps the centre-of-mass trajectory independent of tether parameters (one-way coupling)", () => {
    const a = propagateTether({ ...BASE, lengthM: 1_000, durationS: 1800, stepS: 2 });
    const b = propagateTether({ ...BASE, lengthM: 40_000, satelliteMassKg: 50, deploymentRateMS: 0.5, durationS: 1800, stepS: 2 });
    let maxDiff = 0;
    for (let i = 0; i < a.series.t.length; i++) maxDiff = Math.max(maxDiff, Math.abs(a.series.x[i] - b.series.x[i]), Math.abs(a.series.y[i] - b.series.y[i]));
    console.log(`[TETH] CM trajectory difference between very different tether configurations: ${maxDiff} m (one-way coupling)`);
    expect(maxDiff).toBe(0);
    // The tether state itself must differ, otherwise the comparison would be vacuous.
    const thetaDiff = Math.max(...a.series.thetaDeg.map((v, i) => Math.abs(v - b.series.thetaDeg[i])));
    expect(thetaDiff).toBeGreaterThan(1e-6);
  });

  it("applies the prescribed length exactly", () => {
    const res = propagateTether({ ...BASE, lengthM: 1000, deploymentRateMS: 1, durationS: 4 * 3600, stepS: 5 });
    let maxDiff = 0;
    for (let i = 0; i < res.series.t.length; i++) {
      maxDiff = Math.max(maxDiff, Math.abs(res.series.lengthM[i] - (1000 + res.series.t[i])));
    }
    console.log(`[TETH] prescribed length deviation: ${maxDiff} m; final L = ${res.final.lengthM} m`);
    expect(maxDiff).toBe(0);
    expect(res.final.lengthM).toBe(1000 + 4 * 3600);
  });

  it("declares unresolved quantities instead of reporting them", () => {
    const v = validateTetherInputs(presetInputs("teth-synthetic-vertical"));
    expect(v.ok).toBe(true);
    const calc = calculateTether(v.si);
    const items = calc.unresolved.map((u) => u.item);
    console.log(`[TETH] unresolved declarations: ${items.length} — ${items.join(" | ")}`);
    expect(items.length).toBeGreaterThanOrEqual(4);
    expect(calc.metrics.find((m) => m.id === "epsEnergyOrbit")?.note).toMatch(/reference orbit/i);
  });

  it("rejects out-of-validity geometry and unsupported retrieval", () => {
    const long = presetInputs("teth-synthetic-vertical").map((p) => (p.paramId === "tetherLength" ? { ...p, value: 5000 } : p));
    const v1 = validateTetherInputs(long);
    expect(v1.ok).toBe(false);
    expect(v1.issues.some((i) => i.code === "OUT_OF_RANGE")).toBe(true);

    const compact = presetInputs("teth-synthetic-vertical").map((p) =>
      p.paramId === "tetherLength" ? { ...p, value: 200 } : p.paramId === "initialPositionX" ? { ...p, value: 300 } : p,
    );
    const v3 = validateTetherInputs(compact);
    expect(v3.ok).toBe(false);
    expect(v3.issues.some((i) => i.code === "OUTSIDE_MODEL_VALIDITY")).toBe(true);

    const negativeRate = presetInputs("teth-synthetic-vertical").map((p) => (p.paramId === "deploymentRate" ? { ...p, value: -0.5 } : p));
    const v2 = validateTetherInputs(negativeRate);
    expect(v2.ok).toBe(false);
    expect(v2.issues.some((i) => i.code === "OUT_OF_RANGE")).toBe(true);
  });

  it("runs every synthetic preset through validation and calculation", () => {
    for (const preset of TETHER_PRESETS) {
      const v = validateTetherInputs(presetInputs(preset.id));
      expect(v.issues.filter((i) => i.severity === "error")).toEqual([]);
      const calc = calculateTether(v.si);
      const thetaMax = calc.metrics.find((m) => m.id === "maxAbsTheta")?.value ?? NaN;
      const tension = calc.metrics.find((m) => m.id === "tensionInitial")?.value ?? NaN;
      const ratio = calc.metrics.find((m) => m.id === "maxLengthOverRadius")?.value ?? NaN;
      console.log(
        `[PRESET] ${preset.id}: L=${v.si.tetherLength} m, rate=${v.si.deploymentRate} m/s, max|θ|=${thetaMax.toFixed(3)}°, T₀=${tension.toFixed(4)} N, max L/r=${ratio.toExponential(2)}, warnings=${calc.warnings.length}`,
      );
      expect(Number.isFinite(thetaMax)).toBe(true);
      expect(tension).toBeGreaterThan(0);
      expect(ratio).toBeLessThan(0.5);
    }
  });
});

/**
 * Checks whose measured result is UNRESOLVED by design, with the reason. Anything not
 * listed here must PASS: a check that quietly changes outcome is a regression, and a check
 * that is added to this list without a reason is an overclaim.
 */
const EXPECTED_UNRESOLVED: Record<string, string> = {
  "OT-TT-018":
    "the balance-budget calibration cannot apply its order sub-criterion to 3 of its 14 configurations " +
    "(two have inconsistent successive orders, one is round-off limited), so the matrix verdict is UNRESOLVED " +
    "rather than PASS",
};

describe("tether verification checks and run records", () => {
  for (const check of TETHER_CHECKS) {
    it(`${check.checkId} ${check.title}`, () => {
      const res = check.run();
      console.log(
        `[CHECK] ${check.checkId} outcome=${res.outcome} measured=${typeof res.measuredValue === "number" ? res.measuredValue.toExponential(6) : String(res.measuredValue)} (${check.measuredUnit}) tolerance=${check.tolerance}\n        evidence: ${res.evidence}`,
      );
      const expected = EXPECTED_UNRESOLVED[check.checkId];
      if (expected) {
        expect(res.outcome, expected).toBe("UNRESOLVED");
        expect(res.evidence).toMatch(/UNRESOLVED/);
      } else {
        expect(res.outcome).toBe("PASS");
      }
    });
  }

  it("keeps measurement counts and configuration counts distinct in the calibration evidence", () => {
    // The number of sampled points is not the number of independent experiments: the
    // evidence must never let a reader read 252 budgeted points as 252 validated cases.
    const check = TETHER_CHECKS.find((c) => c.checkId === "OT-TT-018");
    expect(check).toBeDefined();
    const res = check!.run();
    const budgeted = BALANCE_CASES.length * (4 - 1) * BALANCE_FRACTIONS.length;
    const unbudgeted = BALANCE_CASES.length * BALANCE_FRACTIONS.length;
    expect(res.evidence).toContain(`${budgeted} budgeted`);
    expect(res.evidence).toContain(`${unbudgeted} unbudgeted`);
    expect(res.evidence).toContain(`over ${BALANCE_CASES.length} configurations`);
    expect(res.evidence).toContain(`not ${budgeted} independent experiments`);
    expect(res.evidence).toContain("verdicts on this criterion only");
    // The per-case rows carry the diagnosis, so a reader can see WHY a case is unresolved.
    expect(res.evidence).toMatch(/BC-14 .*ORDER_ROUND_OFF_LIMITED/);
    expect(res.evidence).toMatch(/BC-6 .*ORDER_ESTIMATE_UNRELIABLE/);
  });

  it("records an evidence-informed reconstruction with its assumptions attached", async () => {
    const R = R_EARTH + 296_320;
    const V = Math.sqrt(MU_EARTH / R);
    const inputs: ParameterInput[] = [
      { paramId: "gravitationalParameter", value: MU_EARTH, unit: "m3s2" },
      { paramId: "initialPositionX", value: R / 1000, unit: "km" },
      { paramId: "initialPositionY", value: 0, unit: "km" },
      { paramId: "initialPositionZ", value: 0, unit: "km" },
      { paramId: "initialVelocityX", value: 0, unit: "kmps" },
      { paramId: "initialVelocityY", value: V / 1000, unit: "kmps" },
      { paramId: "initialVelocityZ", value: 0, unit: "kmps" },
      { paramId: "satelliteMass", value: 517, unit: "kg" },
      { paramId: "orbiterMass", value: 500, unit: "kg" },
      { paramId: "tetherLength", value: 19.695, unit: "km" },
      { paramId: "deploymentRate", value: 0, unit: "mps" },
      { paramId: "theta0", value: 0, unit: "deg" },
      { paramId: "thetaDot0", value: 0, unit: "degps" },
      { paramId: "duration", value: 1, unit: "h" },
      { paramId: "stepSeconds", value: 2, unit: "s" },
    ];
    const flags = ["ASSUMED: counterweight mass 500 kg (no source)", "SOURCE_SELECTED: deployed length 19,695 m (EV-TSS1R-002)"];
    const res = await executeExperiment({
      modelId: "OTL-TETH-1",
      method: "RK4",
      scenarioName: "TSS-1R evidence-informed reconstruction (assumed inputs)",
      inputs,
      dataOrigin: "EVIDENCE_INFORMED_RECONSTRUCTION",
      evidenceFlags: flags,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    console.log(`[TETH] reconstruction run: origin=${res.record.dataOrigin}, flags=${res.record.evidenceFlags.length}, T0=${res.record.metrics.find((m) => m.id === "tensionInitial")?.value?.toFixed(4)} N, warnings=${res.record.warnings.length}`);
    expect(res.record.dataOrigin).toBe("EVIDENCE_INFORMED_RECONSTRUCTION");
    expect(res.record.evidenceFlags).toEqual(flags);
    // Source-reported geometry must not trigger an out-of-validity warning.
    expect(res.record.warnings.join(" ")).not.toMatch(/exceeds 0.05/);
  }, 45000);

  it("records a tether run with model-specific verification and reproduces it", async () => {
    const res = await executeExperiment({
      modelId: "OTL-TETH-1",
      method: "RK4",
      scenarioName: "tether provenance case",
      inputs: presetInputs("teth-synthetic-vertical"),
      maxStoredSamples: 1500,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const run = res.record;
    console.log(`[TETH] run ${run.runId}: hash=${run.payloadHash?.slice(0, 16)}…, verification=${run.verification.length} checks (${run.verification.filter((c) => c.outcome === "PASS").length} PASS)`);
    expect(run.model.id).toBe("OTL-TETH-1");
    expect(run.verification).toHaveLength(TETHER_CHECKS.length);
    // No model check may FAIL. Checks whose evidence cannot support a verdict stay
    // UNRESOLVED and are named, so the record distinguishes "passed" from "not decided".
    expect(run.verification.filter((c) => c.outcome === "FAIL")).toHaveLength(0);
    expect(run.verification.filter((c) => c.outcome === "UNRESOLVED").map((c) => c.checkId).sort()).toEqual(
      Object.keys(EXPECTED_UNRESOLVED).sort(),
    );
    expect(run.hashStatus).toBe("COMPUTED");
    expect(run.series.data.thetaDeg.length).toBeGreaterThan(10);

    const repro = await reproduceStoredRun(run);
    console.log(`[TETH] reproduction status=${repro.status} maxDiff=${repro.maxNormalisedSeriesDifference?.toExponential(3)}`);
    expect(repro.status).toBe("PASS");

    // Export must describe the tether-specific columns with their units.
    const { seriesToCsv, technicalReport } = await import("../export/serialize");
    const csv = seriesToCsv(run);
    const lines = csv.trimEnd().split("\n");
    const headerIndex = lines.findIndex((l) => l.startsWith("t [s]"));
    const header = lines[headerIndex].split(",");
    console.log(`[TETH] CSV: ${header.length} columns, ${lines.length - headerIndex - 1} rows; header includes ${header.filter((h) => /theta|tension|length/.test(h)).join(" | ")}`);
    expect(header).toContain("thetaDeg [deg]");
    expect(header).toContain("tensionVerticalN [N]");
    expect(header).toContain("lengthM [m]");
    expect(lines.length - headerIndex - 1).toBe(run.series.data.t.length);
    const numericOk = lines.slice(headerIndex + 1).every((row) => row.split(",").every((v) => Number.isFinite(Number(v))));
    expect(numericOk).toBe(true);
    expect(technicalReport(run)).toContain("OTL-TETH-1");
  }, 45000);
});
