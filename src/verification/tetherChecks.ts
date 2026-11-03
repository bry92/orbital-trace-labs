/**
 * Verification checks for model OTL-TETH-1.
 *
 * These checks execute the real tether propagation and the real validation layer.
 * Where an invariant exists (in-plane libration at constant length on a circular
 * orbit), it is derived and measured; where conservation does not apply, the check
 * verifies that the application does not claim it.
 */

import { MU_EARTH, R_EARTH } from "../core/constants";
import { propagateTether, verticalTensionExactN } from "../core/tether";
import type { ParameterInput } from "../core/validation";
import { TETHER_MODEL_ID, TETHER_PARAMETER_SPECS, calculateTether, validateTetherInputs } from "../models/tether";
import {
  ACCEPTANCE as TETHER_CONVERGENCE_ACCEPTANCE,
  DEFAULT_CONVERGENCE_CONFIG,
  runTetherConvergence,
} from "./tetherConvergence";
import {
  analyticInvariantDefect,
  equationAgreement,
  equationTruncationStudy,
  meanMotion,
  REFERENCE_RADIUS_M,
  truncationBound,
} from "./tetherEquation";
import {
  BALANCE_CASES,
  BALANCE_CLASSIFICATION,
  BALANCE_STATUS_MEANING,
  balanceAlong,
  calibrateBalance,
  errorBudget,
  integratePrescribed,
  librationK,
  manufacturedSolution,
  quadratureWithEstimate,
  scaledInvariant,
  trajectoryDifference,
} from "./tetherBalance";
import type { CheckOutcome, VerificationCheckDefinition } from "../models/types";

export const TT_TOLERANCES = {
  librationPeriodRel: 0.01,
  equilibriumDriftRad: 1e-12,
  horizontalGrowthFactor: 4,
  tensionCrossCheck: 0.01,
  lengthPrescriptionAbsM: 1e-9,
  librationInvariantRel: 1e-6,
  /** Round-off band for the closed-form first integral; see OT-TT-015 for the derivation. */
  referenceInvariantRel: 1e-12,
  /** Relative quadrature error allowed on a manufactured solution whose integral is exact. */
  balanceQuadratureRel: 1e-9,
  /** Quadrature must converge at the fourth order expected of Simpson. */
  balanceQuadratureOrderMin: 3.5,
  balanceQuadratureOrderMax: 5.5,
  /** Residual order floor for the balance identity; RK4's residual is fourth order. */
  balanceResidualOrderMin: 3.0,
};

const R0 = R_EARTH + 400e3;
const V_CIRC = Math.sqrt(MU_EARTH / R0);
const M1 = 500;
const M2 = 500;
const L0 = 20_000;

const BASE = {
  mu: MU_EARTH,
  positionM: [R0, 0, 0] as [number, number, number],
  velocityMS: [0, V_CIRC, 0] as [number, number, number],
  satelliteMassKg: M1,
  orbiterMassKg: M2,
  lengthM: L0,
  deploymentRateMS: 0,
  theta0Rad: (5 * Math.PI) / 180,
  thetaDot0RadPerS: 0,
  durationS: 3 * 3600,
  stepS: 2,
};

const N0 = Math.sqrt(MU_EARTH / R0 ** 3);
const LIBRATION_PERIOD = (2 * Math.PI) / (Math.sqrt(3) * N0);

function inputs(overrides: Partial<Record<string, number>> = {}): ParameterInput[] {
  return [
    { paramId: "gravitationalParameter", value: MU_EARTH, unit: "m3s2" },
    { paramId: "initialPositionX", value: R0 / 1000, unit: "km" },
    { paramId: "initialPositionY", value: 0, unit: "km" },
    { paramId: "initialPositionZ", value: 0, unit: "km" },
    { paramId: "initialVelocityX", value: 0, unit: "kmps" },
    { paramId: "initialVelocityY", value: (overrides.vy ?? V_CIRC) / 1000, unit: "kmps" },
    { paramId: "initialVelocityZ", value: 0, unit: "kmps" },
    { paramId: "satelliteMass", value: overrides.m1 ?? M1, unit: "kg" },
    { paramId: "orbiterMass", value: overrides.m2 ?? M2, unit: "kg" },
    { paramId: "tetherLength", value: (overrides.lengthM ?? L0) / 1000, unit: "km" },
    { paramId: "deploymentRate", value: overrides.rate ?? 0, unit: "mps" },
    { paramId: "theta0", value: overrides.thetaDeg ?? 5, unit: "deg" },
    { paramId: "thetaDot0", value: 0, unit: "degps" },
    { paramId: "duration", value: overrides.durationHours ?? 3, unit: "h" },
    { paramId: "stepSeconds", value: overrides.step ?? 2, unit: "s" },
  ];
}

function guard(fn: () => { measuredValue: number | string | null; outcome: CheckOutcome; evidence: string }) {
  try {
    return fn();
  } catch (err) {
    return {
      measuredValue: null,
      outcome: "FAIL" as CheckOutcome,
      evidence: `Check threw instead of returning a measurement: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

function librationEnergy(series: { thetaDeg: number[]; thetaRateDegPerS: number[]; meanMotionRadS: number[] }): number[] {
  return series.thetaDeg.map((thetaDeg, i) => {
    const theta = (thetaDeg * Math.PI) / 180;
    const thetaDot = (series.thetaRateDegPerS[i] * Math.PI) / 180;
    const n = series.meanMotionRadS[i];
    return 0.5 * thetaDot ** 2 - 1.5 * n ** 2 * Math.cos(theta) ** 2;
  });
}

function zeroCrossingPeriod(thetaDeg: number[], t: number[]): number | null {
  const crossings: number[] = [];
  for (let i = 1; i < thetaDeg.length; i++) {
    if (thetaDeg[i] === 0) {
      crossings.push(t[i]);
    } else if (thetaDeg[i - 1] !== 0 && Math.sign(thetaDeg[i]) !== Math.sign(thetaDeg[i - 1])) {
      const frac = Math.abs(thetaDeg[i - 1]) / (Math.abs(thetaDeg[i - 1]) + Math.abs(thetaDeg[i]));
      crossings.push(t[i - 1] + frac * (t[i] - t[i - 1]));
    }
  }
  if (crossings.length < 3) return null;
  // Successive zero crossings are half a libration period apart.
  return ((crossings[crossings.length - 1] - crossings[0]) / (crossings.length - 1)) * 2;
}

function fmtOrder(v: number | null): string {
  return v === null ? "n/a (not computable)" : v.toFixed(3);
}

/** Adequacy is nullable by contract: an unusable estimate has no ratio. */
function fmtAdequacy(v: number | null): string {
  return v === null ? "not computable" : v.toExponential(3);
}

export const TETHER_CHECKS: VerificationCheckDefinition[] = [
  {
    checkId: "OT-TT-001",
    title: "Small-angle in-plane libration period",
    modelId: TETHER_MODEL_ID,
    criterion:
      "For a constant-length tether on a circular orbit, the measured in-plane libration period must equal the analytic value 2π/(√3·n) within the stated relative tolerance.",
    expectedBehavior:
      "Linearising θ'' = −3n² sinθ cosθ about θ = 0 gives θ'' + 3n²θ = 0, so the period is 2π/(√3 n). The measured zero-crossing period should converge to that value as the amplitude goes to zero.",
    measuredUnit: "period (s)",
    tolerance: `relative error ≤ ${(TT_TOLERANCES.librationPeriodRel * 100).toFixed(0)} %`,
    toleranceJustification:
      "At θ₀ = 0.5° the non-linear period correction is of order θ₀²/32 ≈ 2e-6, three orders below the 1 % band. The tolerance therefore accommodates numerical error and crossing interpolation, while still failing a factor-of-√3 mistake in the gravity-gradient coefficient.",
    method:
      "Propagate a 400 km circular orbit with L = 20 km, m₁ = m₂ = 500 kg, θ₀ = 0.5°, fixed length, h = 1 s for four analytic libration periods; measure the mean interval between zero crossings of θ and compare with 2π/(√3 n₀).",
    limitations:
      "Confirms the in-plane gravity-gradient coefficient for a circular orbit. It does not validate the model for eccentric orbits, finite tether mass, or out-of-plane motion.",
    run: () =>
      guard(() => {
        const res = propagateTether({
          ...BASE,
          theta0Rad: (0.5 * Math.PI) / 180,
          durationS: 4 * LIBRATION_PERIOD,
          stepS: 1,
        });
        const measured = zeroCrossingPeriod(res.series.thetaDeg, res.series.t);
        const analytic = LIBRATION_PERIOD;
        if (measured === null) throw new Error("No libration zero crossings found; test cannot be evaluated.");
        const rel = Math.abs(measured - analytic) / analytic;
        return {
          measuredValue: measured,
          outcome: rel <= TT_TOLERANCES.librationPeriodRel ? "PASS" : "FAIL",
          evidence:
            `Measured ${measured.toFixed(3)} s vs analytic ${analytic.toFixed(3)} s (relative difference ${rel.toExponential(3)}) over four libration periods at h = 1 s; n₀ = ${N0.toExponential(6)} rad/s.`,
        };
      }),
  },
  {
    checkId: "OT-TT-002",
    title: "Vertical equilibria are stationary",
    modelId: TETHER_MODEL_ID,
    criterion:
      "Started exactly at θ = 0° and at θ = 180° with zero rate, the integrated libration angle must remain at the equilibrium within the stated absolute tolerance for one libration period.",
    expectedBehavior:
      "sinθ cosθ vanishes at both vertical orientations, so both are equilibria of the implemented equation. Starting exactly at equilibrium must produce no motion beyond round-off.",
    measuredUnit: "max |θ − θ_equilibrium| (rad)",
    tolerance: `≤ ${TT_TOLERANCES.equilibriumDriftRad.toExponential(0)} rad`,
    toleranceJustification:
      "The analytic drift is zero; only floating-point round-off is admissible. The threshold is a round-off bound for double precision over a few thousand steps, not a physical tolerance.",
    method:
      "Two propagations of one libration period at h = 1 s, initialised at θ = 0 and θ = π with zero rate; take the maximum absolute deviation from the initial equilibrium in each.",
    limitations:
      "Confirms the equation's equilibria only. Real tether stability depends on flexibility, out-of-plane motion and disturbances that are NOT modelled.",
    run: () =>
      guard(() => {
        const atZero = propagateTether({
          ...BASE,
          theta0Rad: 0,
          durationS: LIBRATION_PERIOD,
          stepS: 1,
        });
        const atPi = propagateTether({
          ...BASE,
          theta0Rad: Math.PI,
          durationS: LIBRATION_PERIOD,
          stepS: 1,
        });
        const driftZero = Math.max(...atZero.series.thetaDeg.map((v) => Math.abs((v * Math.PI) / 180)));
        const driftPi = Math.max(...atPi.series.thetaDeg.map((v) => Math.abs((v * Math.PI) / 180 - Math.PI)));
        const measured = Math.max(driftZero, driftPi);
        return {
          measuredValue: measured,
          outcome: measured <= TT_TOLERANCES.equilibriumDriftRad ? "PASS" : "FAIL",
          evidence: `θ = 0 drift ${driftZero.toExponential(3)} rad; θ = 180° drift ${driftPi.toExponential(3)} rad over one libration period (${LIBRATION_PERIOD.toFixed(1)} s).`,
        };
      }),
  },
  {
    checkId: "OT-TT-003",
    title: "Horizontal orientation is unstable",
    modelId: TETHER_MODEL_ID,
    criterion:
      "Started at θ = 90° with a small perturbation, the perturbation must grow by at least the stated factor within 1,200 s.",
    expectedBehavior:
      "Linearising about θ = 90° gives δ'' = +3n²δ. With zero initial rate the solution is δ(t) = δ₀·cosh(√3 n t), so over 1,200 s the perturbation must grow by a factor of about 5.3. The measured value must show growth of that order, not decay.",
    measuredUnit: "growth factor (dimensionless)",
    tolerance: `≥ ${TT_TOLERANCES.horizontalGrowthFactor}×`,
    toleranceJustification:
      "The analytic zero-initial-rate growth factor at 1,200 s is cosh(√3·n·1,200 s) ≈ 5.3. A threshold of 4× accepts integration differences and the onset of non-linearity while still distinguishing growth from the decay that a sign error in the gravity-gradient torque would produce.",
    method:
      "Perturb θ by +0.01° from 90°, integrate 1,200 s at h = 2 s, and compute |θ(t) − 90°| / 0.01°.",
    limitations:
      "Demonstrates instability of the planar gravity-gradient equation. It does not predict the eventual tumbling motion of a real flexible tether, which is outside this model.",
    run: () =>
      guard(() => {
        const res = propagateTether({
          ...BASE,
          theta0Rad: Math.PI / 2 + (0.01 * Math.PI) / 180,
          durationS: 1200,
          stepS: 2,
        });
        const initialOffset = Math.abs((0.01 * Math.PI) / 180);
        const finalOffset = Math.abs((res.final.thetaDeg * Math.PI) / 180 - Math.PI / 2);
        const growth = finalOffset / initialOffset;
        const analytic = Math.cosh(Math.sqrt(3) * N0 * 1200);
        return {
          measuredValue: growth,
          outcome: growth >= TT_TOLERANCES.horizontalGrowthFactor ? "PASS" : "FAIL",
          evidence: `Growth ${growth.toFixed(2)}× in 1,200 s; linear prediction δ₀·cosh(√3 n t) = ${analytic.toFixed(2)}×. Final θ = ${res.final.thetaDeg.toFixed(3)}°.`,
        };
      }),
  },
  {
    checkId: "OT-TT-004",
    title: "Quasi-static tension against an exact force balance",
    modelId: TETHER_MODEL_ID,
    criterion:
      "The first-order vertical tension diagnostic 3μ_red μL/r³ must agree with an independent, non-linear radial force balance at both end masses within the documented first-order error band.",
    expectedBehavior:
      "The exact force balance differs from the closed form at O(L/r). For L/r ≈ 3e-3 the relative difference should be well below 1 %, and the two end-mass balances should agree with each other to the same order.",
    measuredUnit: "relative difference (1)",
    tolerance: `≤ 2·(L/r) + 1e-9 ≈ ${(2 * (L0 / R0)).toFixed(4)}`,
    toleranceJustification:
      "The leading correction to the closed form is of order a/r where a is the distance from the centre of mass to an end mass. The band is set to twice L/r, derived from the expansion rather than tuned to the observed value.",
    method:
      "At t = 0 compute T_linear = 3μ_red μL/r³ and the exact balance T = m(n²r_end − μ/r_end²) for each end mass, then compare. The exact expressions are evaluated in core/tether.ts (verticalTensionExactN) and are independent of the propagation.",
    limitations:
      "Tests the first-order diagnostic only, in the vertical configuration. It says nothing about tension during libration, deployment or elasticity.",
    run: () =>
      guard(() => {
        const exact = verticalTensionExactN(MU_EARTH, M1, M2, L0, R0);
        const rel = Math.abs(exact.linearisedN - exact.tensionOuterN) / exact.tensionOuterN;
        const endMismatch = Math.abs(exact.tensionOuterN - exact.tensionInnerN) / exact.tensionOuterN;
        const tolerance = 2 * (L0 / R0) + 1e-9;
        return {
          measuredValue: rel,
          outcome: rel <= tolerance ? "PASS" : "FAIL",
          evidence:
            `T_linear = ${exact.linearisedN.toFixed(6)} N; exact outer = ${exact.tensionOuterN.toFixed(6)} N; exact inner = ${exact.tensionInnerN.toFixed(6)} N; L/r = ${(L0 / R0).toExponential(3)}; end-to-end imbalance ${endMismatch.toExponential(2)}.`,
        };
      }),
  },
  {
    checkId: "OT-TT-005",
    title: "Prescribed length history is applied exactly",
    modelId: TETHER_MODEL_ID,
    criterion:
      "The recorded tether length must equal L₀ + (dL/dt)·t at every sample within the stated absolute tolerance, and must be monotonically non-decreasing for a non-negative rate.",
    expectedBehavior:
      "Length is an input, not a solved state. Any deviation means the prescription is not what was integrated.",
    measuredUnit: "max |L_recorded − L_prescribed| (m)",
    tolerance: `≤ ${TT_TOLERANCES.lengthPrescriptionAbsM.toExponential(0)} m`,
    toleranceJustification:
      "Both values are computed from the same floating-point expression, so the expected difference is zero; the threshold admits only representation-level noise.",
    method:
      "Propagate the deployment preset (L₀ = 1 km, rate = 1 m/s, 4 h, h = 5 s) and compare every recorded length against the prescription.",
    limitations:
      "Confirms the kinematic prescription. It does not test reel dynamics, which are not modelled.",
    run: () =>
      guard(() => {
        const rate = 1;
        const res = propagateTether({
          ...BASE,
          lengthM: 1000,
          deploymentRateMS: rate,
          theta0Rad: (2 * Math.PI) / 180,
          durationS: 4 * 3600,
          stepS: 5,
        });
        let maxDiff = 0;
        let monotonic = true;
        for (let i = 0; i < res.series.t.length; i++) {
          const prescribed = 1000 + rate * res.series.t[i];
          maxDiff = Math.max(maxDiff, Math.abs(res.series.lengthM[i] - prescribed));
          if (i > 0 && res.series.lengthM[i] < res.series.lengthM[i - 1]) monotonic = false;
        }
        return {
          measuredValue: maxDiff,
          outcome: maxDiff <= TT_TOLERANCES.lengthPrescriptionAbsM && monotonic ? "PASS" : "FAIL",
          evidence: `Final length ${res.final.lengthM.toFixed(3)} m (prescribed ${(1000 + rate * 4 * 3600).toFixed(3)} m); monotonic = ${monotonic}; ${res.steps} steps.`,
        };
      }),
  },
  {
    checkId: "OT-TT-006",
    title: "Invalid tether inputs are rejected",
    modelId: TETHER_MODEL_ID,
    criterion:
      "Each listed invalid configuration must be rejected with the expected diagnostic code; the count of correctly rejected cases must equal the total.",
    expectedBehavior:
      "Non-physical masses, lengths, rates or angles, out-of-validity geometry, missing values, unit errors and budget overruns are all rejected. Nothing is coerced.",
    measuredUnit: "cases correctly rejected (count)",
    tolerance: "all cases (equality)",
    toleranceJustification: "Discrete criterion: accepting a single invalid case would break the validation contract.",
    method:
      "Apply each mutation to a valid tether baseline and call validateTetherInputs(), comparing emitted codes with the expected code.",
    limitations: "Covers only the listed cases.",
    run: () =>
      guard(() => {
        type Case = { name: string; mutate: (p: ParameterInput[]) => ParameterInput[]; expect: string };
        const cases: Case[] = [
          { name: "zero payload mass", mutate: (p) => p.map((x) => (x.paramId === "satelliteMass" ? { ...x, value: 0 } : x)), expect: "OUT_OF_RANGE" },
          { name: "negative counterweight mass", mutate: (p) => p.map((x) => (x.paramId === "orbiterMass" ? { ...x, value: -10 } : x)), expect: "OUT_OF_RANGE" },
          { name: "zero tether length", mutate: (p) => p.map((x) => (x.paramId === "tetherLength" ? { ...x, value: 0 } : x)), expect: "OUT_OF_RANGE" },
          { name: "negative deployment rate", mutate: (p) => p.map((x) => (x.paramId === "deploymentRate" ? { ...x, value: -1 } : x)), expect: "OUT_OF_RANGE" },
          { name: "libration angle beyond range", mutate: (p) => p.map((x) => (x.paramId === "theta0" ? { ...x, value: 200 } : x)), expect: "OUT_OF_RANGE" },
          {
            name: "L/r above 0.5 (compact-body geometry)",
            // 200 km tether on a 300 km reference radius: L/r = 0.67.
            mutate: (p) =>
              p.map((x) =>
                x.paramId === "tetherLength"
                  ? { ...x, value: 200 }
                  : x.paramId === "initialPositionX"
                    ? { ...x, value: 300 }
                    : x,
              ),
            expect: "OUTSIDE_MODEL_VALIDITY",
          },
          { name: "missing duration", mutate: (p) => p.filter((x) => x.paramId !== "duration"), expect: "MISSING_PARAMETER" },
          { name: "mass given in metres", mutate: (p) => p.map((x) => (x.paramId === "satelliteMass" ? { ...x, unit: "m" } : x)), expect: "UNIT_MISMATCH" },
          { name: "zero velocity", mutate: (p) => p.map((x) => (x.paramId.startsWith("initialVelocity") ? { ...x, value: 0 } : x)), expect: "DEGENERATE_ORBIT_STATE" },
          {
            name: "step budget exceeded",
            mutate: (p) =>
              p.map((x) => (x.paramId === "stepSeconds" ? { ...x, value: 0.001 } : x.paramId === "duration" ? { ...x, value: 720 } : x)),
            expect: "STEP_BUDGET_EXCEEDED",
          },
        ];
        const results = cases.map((c) => {
          const v = validateTetherInputs(c.mutate(inputs()));
          const codes = v.issues.map((i) => i.code);
          return { name: c.name, got: codes, pass: codes.includes(c.expect) && !v.ok };
        });
        const passed = results.filter((r) => r.pass).length;
        return {
          measuredValue: passed,
          outcome: passed === cases.length ? "PASS" : "FAIL",
          evidence:
            `${passed}/${cases.length} cases rejected with the expected code. ` +
            results.map((r) => `${r.name} → ${r.got.length ? r.got.join("+") : "ACCEPTED"}`).join("; "),
        };
      }),
  },
  {
    checkId: "OT-TT-007",
    title: "Tether run-to-run repeatability",
    modelId: TETHER_MODEL_ID,
    criterion: "Two executions of the identical configuration must produce numerically identical series.",
    expectedBehavior: "Deterministic fixed-step RK4 with identical inputs yields identical floating-point output.",
    measuredUnit: "max absolute difference (m)",
    tolerance: "= 0 exactly",
    toleranceJustification: "Determinism in the same process; any nonzero difference indicates hidden state.",
    method: "Propagate the same tether configuration twice and compare position and angle samples.",
    limitations: "Same-session determinism only.",
    run: () =>
      guard(() => {
        const a = propagateTether(BASE);
        const b = propagateTether(BASE);
        let maxDiff = 0;
        for (let i = 0; i < a.series.t.length; i++) {
          maxDiff = Math.max(
            maxDiff,
            Math.abs(a.series.x[i] - b.series.x[i]),
            Math.abs(a.series.thetaDeg[i] - b.series.thetaDeg[i]),
          );
        }
        return {
          measuredValue: maxDiff,
          outcome: maxDiff === 0 ? "PASS" : "FAIL",
          evidence: `${a.series.t.length} samples compared; identical sample counts = ${a.series.t.length === b.series.t.length}.`,
        };
      }),
  },
  {
    checkId: "OT-TT-008",
    title: "No conservation claim is made for the tether subsystem",
    modelId: TETHER_MODEL_ID,
    criterion:
      "The calculation must declare total-system energy, angular momentum, dynamic deployment and coupled orbital dynamics as unresolved, and must not report a tether-subsystem conservation metric as a result.",
    expectedBehavior:
      "Because length is prescribed and coupling is one-way, conservation of the complete system is not established. The output contract must say so instead of silently presenting orbit invariants as system invariants.",
    measuredUnit: "declared unresolved items (count)",
    tolerance: "≥ 4 declared, with specific items present",
    toleranceJustification:
      "Structural honesty criterion, not a numerical bound. The required items are the four physical claims that this model cannot make.",
    method:
      "Execute the tether calculation with a valid configuration and inspect its unresolved list and metric ids; require entries for total energy, dynamic deployment, coupled dynamics and instantaneous tension, and require that orbit-only invariants are labelled as such.",
    limitations:
      "Verifies the declaration, not the physics. A model can honestly report that it is incomplete.",
    run: () =>
      guard(() => {
        const v = validateTetherInputs(inputs());
        if (!v.ok) throw new Error("Baseline tether configuration failed validation");
        const calc = calculateTether(v.si);
        const items = calc.unresolved.map((u) => u.item);
        const hasEnergy = items.some((i) => /energy/i.test(i));
        const hasDeployment = items.some((i) => /deployment/i.test(i));
        const hasCoupled = items.some((i) => /coupled/i.test(i));
        const hasTension = items.some((i) => /tension/i.test(i));
        const orbitOnlyLabelled = calc.metrics
          .filter((m) => m.id === "epsEnergyOrbit" || m.id === "epsAngularMomentumOrbit")
          .every((m) => /reference orbit|orbit only/i.test(`${m.label} ${m.note ?? ""}`));
        const all = hasEnergy && hasDeployment && hasCoupled && hasTension && orbitOnlyLabelled;
        return {
          measuredValue: items.length,
          outcome: all ? "PASS" : "FAIL",
          evidence:
            `Declared: ${items.join(" | ")}. Orbit-only invariants labelled correctly = ${orbitOnlyLabelled}.`,
        };
      }),
  },
  {
    checkId: "OT-TT-009",
    title: "Libration invariant at constant length",
    modelId: TETHER_MODEL_ID,
    criterion:
      "For constant length on a circular reference orbit, K = ½θ̇² − (3/2)n²cos²θ must be conserved to the stated relative tolerance over four libration periods.",
    expectedBehavior:
      "Multiplying θ'' = −3n² sinθ cosθ by θ̇ gives d/dt[½θ̇² − (3/2)n²cos²θ] = 0 when n is constant. K is an exact invariant of the implemented equation, so drift measures numerical error only.",
    measuredUnit: "max |K(t) − K(0)| / |K(0)| (1)",
    tolerance: `≤ ${TT_TOLERANCES.librationInvariantRel.toExponential(0)}`,
    toleranceJustification:
      "K is exactly invariant in the continuum; RK4 truncation over ~1.3e4 steps at h = 2 s is expected to be many orders below 1e-6. The band is a numerical bound, not a physical one.",
    method:
      "Propagate a 20 km constant-length tether with θ₀ = 5° at h = 2 s for four libration periods; compute K from the recorded θ, θ̇ and n. The same quantity is reported for a prescribed 1 m/s deployment case, where it is not expected to be conserved.",
    limitations:
      "Confirms the implemented in-plane equation for a circular orbit at constant length. It does not extend to eccentric orbits, variable length, distributed mass or out-of-plane motion.",
    run: () =>
      guard(() => {
        const constant = propagateTether({ ...BASE, durationS: 4 * LIBRATION_PERIOD, stepS: 2 });
        const K = librationEnergy(constant.series);
        const k0 = K[0];
        let maxDrift = 0;
        for (const k of K) maxDrift = Math.max(maxDrift, Math.abs(k - k0) / Math.abs(k0));

        const deploying = propagateTether({ ...BASE, deploymentRateMS: 1, durationS: 4 * 3600, stepS: 5 });
        const Kd = librationEnergy(deploying.series);
        const deployDrift = Math.abs(Kd[Kd.length - 1] - Kd[0]) / Math.abs(Kd[0]);

        return {
          measuredValue: maxDrift,
          outcome: maxDrift <= TT_TOLERANCES.librationInvariantRel ? "PASS" : "FAIL",
          evidence:
            `Constant length: max relative K drift ${maxDrift.toExponential(3)} over four libration periods (K₀ = ${k0.toExponential(6)}). ` +
            `With a prescribed 1 m/s deployment the same invariant changes by ${deployDrift.toExponential(3)}, which is why no conservation claim is made.`,
        };
      }),
  },
  {
    checkId: "OT-TT-010",
    title: "Step-refinement convergence, constant-length libration",
    modelId: TETHER_MODEL_ID,
    criterion:
      "Under successive step refinement at fixed physical initial conditions and final time, the isolated tether-integration errors in θ and θ̇ must decrease with observed order ≥ 3.5 and error ratios inside the pre-registered band, using the closed-form elliptic reference.",
    expectedBehavior:
      "Classical RK4 is fourth order, so halving the step should reduce the final-time tether error by about 16 and the measured order should approach 4. The final time is deliberately not an integer number of libration periods, which would hide the leading phase error at the turning point.",
    measuredUnit: "observed order (1) from the two finest refinements",
    tolerance: `≥ ${TETHER_CONVERGENCE_ACCEPTANCE.minOrder}`,
    toleranceJustification:
      "The exact global order is 4. The 3.5 floor admits asymptotic approach and modest round-off contamination while excluding orders 1–3 that would indicate an implementation error. The criterion and the 8–40 ratio band were registered before the measurement was taken.",
    method:
      "Two refinement studies share one code path. TC-1 integrates the production 8-state engine (orbit + libration) and a 2-state tether-only variant with analytic mean motion, at h = 240, 120, 60, 30 s over 2.37 libration periods, and compares against the exact Jacobi-elliptic solution.",
    limitations:
      "Order convergence verifies numerical consistency of the implemented equations under the stated assumptions; it does not validate the physical model, flight behaviour or mission data.",
    run: () =>
      guard(() => {
        const study = runTetherConvergence();
        const c = study.cases.find((x) => x.caseId === "TC-1");
        if (!c) throw new Error("TC-1 missing from the convergence study");
        const finest = c.points[c.points.length - 1];
        return {
          measuredValue: c.observedOrder.isolatedTheta,
          outcome: c.acceptance.status === "PASS" ? "PASS" : c.acceptance.status === "UNRESOLVED" ? "UNRESOLVED" : "FAIL",
          evidence:
            `Steps h = [${c.points.map((p) => p.stepS).join(", ")}] s, ${c.points.map((p) => p.steps).join("/")} steps; ` +
            `isolated θ errors [${c.points.map((p) => p.isolatedThetaErrRad.toExponential(3)).join(", ")}] rad; ` +
            `ratios [${c.points.map((p) => p.isolatedThetaRatio?.toFixed(2) ?? "—").join(", ")}]; ` +
            `orders [${c.points.map((p) => p.isolatedThetaOrder?.toFixed(3) ?? "—").join(", ")}]; ` +
            `isolated θ̇ order ${fmtOrder(c.observedOrder.isolatedThetaRate)}; coupled θ order ${fmtOrder(c.observedOrder.theta)}; ` +
            `finest isolated θ error ${finest.isolatedThetaErrRad.toExponential(3)} rad; empirical reference-error estimate θ ${c.reference.empiricalErrorThetaRad.toExponential(3)} rad, θ̇ ${c.reference.empiricalErrorThetaRateRadPerS.toExponential(3)} rad/s; ` +
            `adequacy θ ${fmtAdequacy(c.reference.adequacyTheta)}, θ̇ ${fmtAdequacy(c.reference.adequacyThetaRate)}; ` +
            `status ${c.acceptance.status}${c.acceptance.reasons.length ? ` — ${c.acceptance.reasons.join(" ")}` : ""}.`,
        };
      }),
  },
  {
    checkId: "OT-TT-011",
    title: "Step-refinement convergence, prescribed deployment",
    modelId: TETHER_MODEL_ID,
    criterion:
      "For a prescribed time-varying length L(t) = L0 + Ldot·t, the isolated tether-integration errors in θ and θ̇ must converge with observed order ≥ 3.5 and error ratios inside the pre-registered band, against a numerical reference that is itself shown adequate.",
    expectedBehavior:
      "The 2(Ldot/L)θ̇ term changes the coefficient in time but not the order of the fixed-step method. No closed-form solution exists for this case, so the reference is adaptive DOPRI5 at rtol 1e-12 on the 2-state equation, cross-checked against two other tolerances and an RK4 Richardson limit; the largest difference per component is the residual.",
    measuredUnit: "observed order (1) from the two finest refinements",
    tolerance: `≥ ${TETHER_CONVERGENCE_ACCEPTANCE.minOrder}, reference adequacy ≥ ${TETHER_CONVERGENCE_ACCEPTANCE.referenceAdequacyRatioMin}`,
    toleranceJustification:
      "Same 3.5 order floor as TC-1. The adequacy ratio is required separately because a numerical reference cannot certify errors smaller than its own residual; the measured ratio is reported with the result.",
    method:
      "TC-2 uses the production 8-state engine and a 2-state tether-only variant at h = 240, 120, 60, 30 s over 6900 s with L0 = 20 km and Ldot = 1 m/s, comparing both against the 2-state adaptive reference; each refinement level also reports the reference-orbit position error separately.",
    limitations:
      "The reference is numerical, not exact. Deployment is prescribed: reel dynamics, actuator torque, elasticity and damping are not modelled, so this does not verify a deployment transient.",
    run: () =>
      guard(() => {
        const study = runTetherConvergence();
        const c = study.cases.find((x) => x.caseId === "TC-2");
        if (!c) throw new Error("TC-2 missing from the convergence study");
        return {
          measuredValue: c.observedOrder.isolatedTheta,
          outcome: c.acceptance.status === "PASS" ? "PASS" : c.acceptance.status === "UNRESOLVED" ? "UNRESOLVED" : "FAIL",
          evidence:
            `Steps h = [${c.points.map((p) => p.stepS).join(", ")}] s; ` +
            `isolated θ errors [${c.points.map((p) => p.isolatedThetaErrRad.toExponential(3)).join(", ")}] rad; ` +
            `ratios [${c.points.map((p) => p.isolatedThetaRatio?.toFixed(2) ?? "—").join(", ")}]; ` +
            `orders [${c.points.map((p) => p.isolatedThetaOrder?.toFixed(3) ?? "—").join(", ")}]; ` +
            `isolated θ̇ order ${fmtOrder(c.observedOrder.isolatedThetaRate)}; empirical reference-error estimate θ ${c.reference.empiricalErrorThetaRad.toExponential(3)} rad, θ̇ ${c.reference.empiricalErrorThetaRateRadPerS.toExponential(3)} rad/s; ` +
            `adequacy θ ${fmtAdequacy(c.reference.adequacyTheta)}, θ̇ ${fmtAdequacy(c.reference.adequacyThetaRate)} (min ${fmtAdequacy(c.reference.adequacyRatioMin)}); ` +
            `status ${c.acceptance.status}${c.acceptance.reasons.length ? ` — ${c.acceptance.reasons.join(" ")}` : ""}.`,
        };
      }),
  },
  {
    checkId: "OT-TT-012",
    title: "Convergence references adequate for the measured errors",
    modelId: TETHER_MODEL_ID,
    criterion:
      "For both convergence cases the EMPIRICAL reference-error estimate must be at least 100 times smaller than the finest isolated tether error, evaluated separately for θ and θ̇, otherwise the observed order is a property of the reference rather than of the method under test.",
    expectedBehavior:
      "Each reference is compared with two other numerical constructions (other tolerances and an RK4 Richardson limit); the largest difference per component sets the estimate, so accidental agreement cannot flatter the reference.",
    measuredUnit:
      "min component adequacy (1) = finest isolated error / empirical reference-error estimate, over θ and θ̇ in both cases",
    tolerance: `≥ ${TETHER_CONVERGENCE_ACCEPTANCE.referenceAdequacyRatioMin}`,
    toleranceJustification:
      "A factor of 100 keeps the reference contribution below 1 % of the finest measured error, so it cannot dominate the fitted order. The threshold was registered with the study configuration.",
    method:
      "For each case compute adequacy_theta = finest isolated θ error / empirical θ estimate and adequacy_theta_dot = finest isolated θ̇ error / empirical θ̇ estimate; each estimate is the maximum observed difference across the listed independent comparisons. Report the minimum of the four ratios.",
    limitations:
      "The quantity compared is an empirical estimate, not a proven bound, so adequacy is the strength of the available evidence: it cannot show that the true reference error is below the stated level. Measurements are at the final time only.",
    run: () =>
      guard(() => {
        const study = runTetherConvergence();
        const rows = study.cases.map((c) => ({
          id: c.caseId,
          theta: c.reference.adequacyTheta,
          thetaRate: c.reference.adequacyThetaRate,
          residualTheta: c.reference.empiricalErrorThetaRad,
          residualRate: c.reference.empiricalErrorThetaRateRadPerS,
        }));
        const ratios = rows.flatMap((r) => [r.theta, r.thetaRate]);
        // A non-computable ratio is reported as -Infinity here only to make the check
        // FAIL: it can never satisfy an adequacy threshold.
        const worst = Math.min(...ratios.map((r) => (r === null ? Number.NEGATIVE_INFINITY : r)));
        return {
          measuredValue: worst,
          outcome: Number.isFinite(worst) && worst >= TETHER_CONVERGENCE_ACCEPTANCE.referenceAdequacyRatioMin ? "PASS" : "FAIL",
          evidence: rows
            .map(
              (r) =>
                `${r.id}: empirical estimate θ ${r.residualTheta.toExponential(3)} rad → adequacy ${fmtAdequacy(r.theta)}; ` +
                `empirical estimate θ̇ ${r.residualRate.toExponential(3)} rad/s → adequacy ${fmtAdequacy(r.thetaRate)}`,
            )
            .join("; "),
        };
      }),
  },
  {
    checkId: "OT-TT-013",
    title: "Reference-error status is stated and not overstated",
    modelId: TETHER_MODEL_ID,
    criterion:
      "The convergence study must label its reference-error quantity as an EMPIRICAL_ESTIMATE, must state that it is not a proven bound, must carry the same status on every case, and must contain no field asserting a rigorous bound or a validated enclosure.",
    expectedBehavior:
      "The strongest claim the available evidence supports is a largest-observed-difference estimate. An application that displayed a bound here would be asserting something it never derived, so the claim itself is checked rather than trusted.",
    measuredUnit: "conditions satisfied (count)",
    tolerance: "all 5 conditions",
    toleranceJustification:
      "Discrete honesty criterion. Each condition corresponds to a specific overclaim that would otherwise be exportable and displayable: an unstated status, a mismatched per-case status, an unqualified wording, or the presence of bound/enclosure language in the measured fields.",
    method:
      "Execute the study; require referenceErrorKind === EMPIRICAL_ESTIMATE on the study and on both cases, require the study statement to deny a proven bound, and require that no case field contains a bound or enclosure claim.",
    limitations:
      "Checks the stated status, not the mathematics. It cannot determine by itself whether an empirical estimate is close to the true error; that remains an open question documented in the study.",
    run: () =>
      guard(() => {
        const study = runTetherConvergence();
        const sameKindEverywhere = study.cases.every((c) => c.reference.errorKind === study.referenceErrorKind);
        const empirical = study.referenceErrorKind === "EMPIRICAL_ESTIMATE";
        const disclaimsBound = /NOT a proven upper bound/i.test(study.referenceErrorStatement);
        const noBoundClaim = study.cases.every((c) => !/is a (proven |rigorous )?bound|validated enclosure/i.test(c.reference.limitations));
        const empiricalFieldsFinite = study.cases.every(
          (c) =>
            Number.isFinite(c.reference.empiricalErrorThetaRad) &&
            Number.isFinite(c.reference.empiricalErrorThetaRateRadPerS) &&
            c.reference.empiricalErrorThetaRad > 0 &&
            c.reference.empiricalErrorThetaRateRadPerS > 0,
        );
        const conditions = [empirical, sameKindEverywhere, disclaimsBound, noBoundClaim, empiricalFieldsFinite];
        const satisfied = conditions.filter(Boolean).length;
        return {
          measuredValue: satisfied,
          outcome: satisfied === conditions.length ? "PASS" : "FAIL",
          evidence:
            `study kind ${study.referenceErrorKind}; case kinds [${study.cases.map((c) => c.reference.errorKind).join(", ")}]; ` +
            `statement ${disclaimsBound ? "explicitly denies" : "does NOT deny"} a proven bound; ` +
            `estimates positive and finite = ${empiricalFieldsFinite}.`,
        };
      }),
  },
  {
    checkId: "OT-TT-014",
    title: "Libration equation agrees with exact point-mass force balance",
    modelId: TETHER_MODEL_ID,
    criterion:
      "At the length used by the convergence study, the whole difference between the implemented theta'' and the exact perpendicular point-mass force balance must equal the analytically derived leading omitted tidal term to within 0.1 %, that difference must fall as (L/r)^2 across a geometric length sequence, and it must lie inside the Taylor remainder bound (15/24)(L/r)^2.",
    expectedBehavior:
      "Projecting the relative acceleration perpendicular to a massless rod eliminates the tension, leaving L theta'' + 2 Ldot theta' = [g(r2) - g(r1)] . e_perp. The leading term of that exact gravity difference reproduces -3 n^2 sin(theta)cos(theta); the residue should be exactly the third-order tidal term derived from the inverse-square field. Matching the residue, not just bounding it, means the equation is the documented truncation of Newtonian gravity rather than merely close to it; an error in any coefficient, sign or term destroys the match.",
    measuredUnit: "|theta''_impl - theta''_exact| / n^2 (1); the explained fraction is in the evidence",
    tolerance: "explained fraction within 1e-3 of 1, fitted order in L/r inside [1.8, 2.2], and |diff|/n^2 ≤ (15/24)(L/r)^2",
    toleranceJustification:
      "The 1e-3 match band is the accuracy expected of the first omitted term alone: the next correction is O((L/r)^2) relative to it, i.e. about 1e-5 at the study's length. The bound and the order range are derived, not fitted: the residue is third order in the length (normalised by 1/L, so second order here), and the Taylor remainder obeys |D^3(mu/r)| <= 15 mu/r^4. All three were fixed before the comparison was run.",
    method:
      "Evaluate Newtonian gravity exactly at both end masses (positions r_cm -/+ (L/2)e, e = cos(theta) r_hat + sin(theta) t_hat) on a circular reference orbit, project onto e_perp, divide by L, and subtract the kinematic 2(Ldot/L)theta_dot term. Compare with the implemented expression at theta = 0.6 rad, theta_dot = 2e-4 rad/s, Ldot = 1 m/s. Then evaluate the exact third directional derivative of r/|r|^3 at the centre of mass, contract it with (L/2)e, and compare the resulting omitted term with the measured difference over L/r from 3e-2 to 3e-4.",
    limitations:
      "No integration is involved, so this checks the equation only: in-plane geometry, massless rigid rod, circular reference orbit, one-way coupling. It says nothing about eccentric orbits, elasticity, out-of-plane motion or flight behaviour, and it cannot detect an error common to both the derivation and the implemented expression.",
    run: () =>
      guard(() => {
        const at = equationAgreement(20_000);
        const bound = truncationBound(at.lengthOverRadius);
        const study = equationTruncationStudy();
        const orders = study.slice(1).map((p) => p.observedOrder);
        const ordersOk = orders.every((o) => o !== null && o > 1.8 && o < 2.2);
        const inside = at.normalisedDifference <= bound;
        const explainsEverywhere = study.every((p) => Math.abs(p.explainedFraction - 1) <= 1e-3);
        // Sensitivity: the relative coefficient error that would still fit inside the band.
        const gg = 3 * at.nRadS * at.nRadS * Math.sin(0.6) * Math.cos(0.6);
        const detectableCoefficientRelative = (bound * at.nRadS * at.nRadS) / gg;
        return {
          measuredValue: at.normalisedDifference,
          outcome: inside && ordersOk && explainsEverywhere ? "PASS" : "FAIL",
          evidence:
            `At L/r = ${at.lengthOverRadius.toExponential(3)}: theta''_impl = ${at.implementedThetaAccel.toExponential(6)} rad/s^2, theta''_exact = ${at.exactThetaAccel.toExponential(6)} rad/s^2, difference ${at.differenceRadPerS2.toExponential(3)}, analytic omitted term ${at.predictedOmittedRadPerS2.toExponential(3)} → explained fraction ${at.explainedFraction.toFixed(6)}; normalised ${at.normalisedDifference.toExponential(3)} vs bound ${bound.toExponential(3)} (${(100 * at.normalisedDifference / bound).toFixed(0)} % of bound). ` +
            `L/r sequence [${study.map((p) => p.lengthOverRadius.toExponential(1)).join(", ")}] gives normalised differences [${study.map((p) => p.normalisedDifference.toExponential(3)).join(", ")}] and fitted orders [${study.map((p) => (p.observedOrder === null ? "—" : p.observedOrder.toFixed(3))).join(", ")}]. ` +
            `Sensitivity: this band would reject a relative error in the gravity-gradient coefficient of ${(100 * detectableCoefficientRelative).toExponential(2)} % or larger.`,
        };
      }),
  },
  {
    checkId: "OT-TT-015",
    title: "Closed-form reference satisfies the equation's first integral",
    modelId: TETHER_MODEL_ID,
    criterion:
      "For constant n and L the quantity K = theta_dot^2/2 - (3/2) n^2 cos^2(theta) is exactly invariant along a solution of the implemented equation; sampled on the Jacobi-elliptic reference over the TC-1 duration, its relative drift must stay below the stated round-off band.",
    expectedBehavior:
      "Multiplying theta'' = -3n^2 sin(theta)cos(theta) by theta_dot gives dK/dt = 0 exactly. A closed form with a wrong amplitude normalisation, a wrong phase or a wrong rate breaks the identity, so this checks the analytic reference against the equation itself rather than against another integrator.",
    measuredUnit: "max |K(t) - K(0)| / |K(0)| (1)",
    tolerance: `≤ ${TT_TOLERANCES.referenceInvariantRel.toExponential(0)}`,
    toleranceJustification:
      "K is exactly conserved in the continuum, so only floating-point evaluation error is admissible: about 2.2e-16 per operation across ~4e3 samples. The band sits four orders above that and still eight orders below the 1e-6 drift produced by a 0.1 % error in the rate alone, so it separates round-off from any realistic formula error.",
    method:
      "Sample the closed-form solution at 4,001 points over 2.37 exact libration periods, evaluate K from the returned (theta, theta_dot) and the same n, and report the largest relative deviation from K(0).",
    limitations:
      "Confirms the closed form is a solution of the constant-length equation. TC-2 has no closed form, so this check does not cover the deployment case.",
    run: () =>
      guard(() => {
        const theta0 = (DEFAULT_CONVERGENCE_CONFIG.theta0ADeg * Math.PI) / 180;
        const d = analyticInvariantDefect(theta0, N0, DEFAULT_CONVERGENCE_CONFIG.durationLibrationPeriods * LIBRATION_PERIOD);
        return {
          measuredValue: d.maxRelativeDrift,
          outcome: d.maxRelativeDrift <= TT_TOLERANCES.referenceInvariantRel ? "PASS" : "FAIL",
          evidence:
            `K(0) = ${d.initialK.toExponential(6)}; max relative drift ${d.maxRelativeDrift.toExponential(3)} at t = ${d.worstTimeS.toFixed(1)} s over ${(DEFAULT_CONVERGENCE_CONFIG.durationLibrationPeriods * LIBRATION_PERIOD).toFixed(1)} s (theta0 = ${DEFAULT_CONVERGENCE_CONFIG.theta0ADeg} deg).`,
        };
      }),
  },
  {
    checkId: "OT-TT-016",
    title: "Balance identity holds on a manufactured exact solution",
    modelId: TETHER_MODEL_ID,
    criterion:
      "For a manufactured exact solution of theta'' + 2 (Ldot/L) theta' + 3 n^2 sin(theta)cos(theta) = 0, an independent composite-Simpson quadrature of 2 (Ldot/L) theta'^2 must reproduce the analytic integral of the identity to a relative error below 1e-9, and must converge at fourth order.",
    expectedBehavior:
      "With theta(t) = theta0 + a t and theta'' = 0 the equation fixes Ldot/L = -3 n^2 sin(theta)cos(theta)/(2a), which integrates to L(t) = L0 exp{(3 n^2/(8 a^2))[cos 2theta(t) - cos 2theta0]}. Along that trajectory K and the integral are known in closed form, so the quadrature can be checked against an exact answer with no ODE integration in the loop. A sign error, a missing factor 2 or a wrong kernel would be O(1) relative, not 1e-9.",
    measuredUnit: "relative quadrature error |Q - J_exact| / |J_exact| (1)",
    tolerance: `≤ ${TT_TOLERANCES.balanceQuadratureRel.toExponential(0)}, quadrature order in [${TT_TOLERANCES.balanceQuadratureOrderMin}, ${TT_TOLERANCES.balanceQuadratureOrderMax}]`,
    toleranceJustification:
      "This is ANALYTIC IDENTITY plus INDEPENDENT QUADRATURE, not a numerical-accuracy claim about the integrator: the exact integral is known, so the only error left is the quadrature rule. 1e-9 sits seven orders above the double-precision floor for this integral (~1e-16 observed) and eight orders below any term error, which would be O(1) relative. The order band is Simpson's own fourth order; the measured values are 3.997-4.324 before it was fixed.",
    method:
      "Sample the manufactured solution at 101, 201 and 401 points over 6,900 s (theta0 = 2 deg, drift 2e-5 rad/s), evaluate the integrand from the analytic (Ldot/L), integrate with composite Simpson, compare with J_exact = (3/2) n^2 [cos^2(theta) - cos^2(theta0)], and estimate the quadrature error by Richardson at half and quarter spacing.",
    limitations:
      "Checks the quadrature and the algebra of the identity on one manufactured family. It does not test the production integrator, and the manufactured L(t) is exponential rather than the linear prescription the model uses.",
    run: () =>
      guard(() => {
        const n = meanMotion(REFERENCE_RADIUS_M);
        const theta0 = (2 * Math.PI) / 180;
        const T = 6900;
        const rows = [101, 201, 401].map((samples) => {
          const m = manufacturedSolution(theta0, 2e-5, n, 20_000, T, samples);
          const h = T / (samples - 1);
          const q = quadratureWithEstimate(
            m.map((p) => 2 * p.logGradient * p.thetaDot ** 2),
            h,
          );
          const exact = m[m.length - 1].exactIntegral;
          return {
            samples,
            relativeError: Math.abs(q.value - exact) / Math.abs(exact),
            richardsonAgreement: Math.abs(q.value - exact) <= 100 * q.richardsonError + 1e-30,
            order: q.observedOrder,
          };
        });
        const worst = Math.max(...rows.map((r) => r.relativeError));
        const ordersOk = rows.every(
          (r) =>
            r.order !== null &&
            r.order >= TT_TOLERANCES.balanceQuadratureOrderMin &&
            r.order <= TT_TOLERANCES.balanceQuadratureOrderMax,
        );
        const richardsonOk = rows.every((r) => r.richardsonAgreement);
        return {
          measuredValue: worst,
          outcome: worst <= TT_TOLERANCES.balanceQuadratureRel && ordersOk && richardsonOk ? "PASS" : "FAIL",
          evidence:
            rows
              .map(
                (r) =>
                  `${r.samples} samples: relative error ${r.relativeError.toExponential(3)}, quadrature order ${r.order === null ? "not computable" : r.order.toFixed(3)}, within 100x Richardson estimate = ${r.richardsonAgreement}`,
              )
              .join("; ") +
            `. Manufactured: theta(t) = theta0 + 2e-5 t, L(t) = L0 exp{(3n^2/(8a^2))[cos2theta(t) - cos2theta0]}; J_exact = (3/2)n^2[cos^2theta - cos^2theta0].`,
        };
      }),
  },
  {
    checkId: "OT-TT-017",
    title: "Variable-length energy-balance identity along refined trajectories",
    modelId: TETHER_MODEL_ID,
    criterion:
      "For the TC-2 configuration the measured balance residual K(t) - K(0) + 2\u222b(Ldot/L)theta'^2 dt must stay inside the error budget at 25 %, 50 %, 75 % and 100 % of the run for h = 60, 30 and 15 s, and its magnitude must fall at least at third order between the two finest adjacent refinements (RK4 residual is fourth order).",
    expectedBehavior:
      "The identity dK/dt = -2 (Ldot/L) theta'^2 follows from the equation for every solution, so a numerical residual can only come from truncation and quadrature. A missing deployment term, a reversed sign, a wrong coefficient or a wrong kernel cannot hide inside a budget that is built from measured trajectory error and measured quadrature error. Because Ldot/L > 0, K must decrease: the final K - K(0) is -1.02e-9 rad^2/s^2 while the integral is +1.02e-9.",
    measuredUnit: "worst |residual| / error budget over reporting times and steps (1)",
    tolerance: `≤ 1, with residual order ≥ ${TT_TOLERANCES.balanceResidualOrderMin}`,
    toleranceJustification:
      "The budget is derived, not fitted: trajectory error is measured by self-convergence against a run at half the step, propagated through the two terms it enters (3 n^2 epsTheta + |theta'| epsTheta' for K; 4 (Ldot/L)|theta'| T epsTheta' for the integral), added to the Richardson quadrature estimate, and multiplied by a declared safety factor of 4 for the linearisation and the fact that a self-convergence difference is an estimate rather than a bound. The 3.0 order floor distinguishes fourth-order truncation from a third-order or lower defect; the coarse pairs are reported but not held to it because h = 60 s is pre-asymptotic (measured order 1.38 there, 3.49 and 3.80 on the finer pairs).",
    method:
      "Integrate the documented equation at constant n = sqrt(mu/r0^3) with an independent fixed-step RK4 at h = 60, 30, 15 and 7.5 s over 6,900 s (theta0 = 2 deg, L0 = 20 km, Ldot = 1 m/s), accumulate 2\u222b(Ldot/L)theta'^2 with the module's own composite Simpson, and compare with K(t) - K(0) at four reporting times per step. The trajectory error for each step is the difference from the next finer run; the quadrature error is the Richardson estimate.",
    limitations:
      "This is CONSISTENCY with the variable-length equation, not validation of the deployment mechanism: the actuator, reel dynamics, elasticity, damping, out-of-plane motion and flight data are separate questions. The identity is evaluated with constant n, whereas the production engine uses n(t) from an integrated orbit; the production right-hand side is tied to the same expression by a separate full-run equivalence test.",
    run: () =>
      guard(() => {
        const n = meanMotion(REFERENCE_RADIUS_M);
        const length0 = DEFAULT_CONVERGENCE_CONFIG.lengthM;
        const rate = DEFAULT_CONVERGENCE_CONFIG.deploymentRateMS;
        const T = DEFAULT_CONVERGENCE_CONFIG.durationBS;
        const theta0 = (DEFAULT_CONVERGENCE_CONFIG.theta0BDeg * Math.PI) / 180;
        const steps = [60, 30, 15, 7.5];
        const runs = steps.map((stepS) =>
          integratePrescribed({
            nRadS: n,
            length0M: length0,
            rateMS: rate,
            theta0Rad: theta0,
            thetaDot0RadPerS: 0,
            durationS: T,
            stepS,
          }),
        );
        const rows = runs.map((r, i) => {
          const points = balanceAlong(r.samples, { nRadS: n, length0M: length0, rateMS: rate });
          const finer = i + 1 < runs.length ? runs[i + 1] : null;
          const eps = finer ? trajectoryDifference(r.samples, finer.samples) : null;
          const budget = eps
            ? errorBudget(r.samples, {
                nRadS: n,
                length0M: length0,
                rateMS: rate,
                epsThetaRad: eps.maxTheta,
                epsThetaDotRadPerS: eps.maxThetaDot,
                quadratureTerm: Math.max(...points.map((p) => p.quadratureError)),
              })
            : null;
          const worstRatio = budget ? Math.max(...points.map((p) => Math.abs(p.residual) / budget.total)) : null;
          return { stepS: r.stepS, points, budget, worstRatio, eps };
        });

        const budgeted = rows.slice(0, 3);
        const insideBudget = budgeted.every((r) => r.worstRatio !== null && r.worstRatio <= 1);
        // Orders between (60->30), (30->15) and (15->7.5): the last two are the asymptotic ones.
        const residuals = rows.map((r) => Math.abs(r.points[3].residual));
        const observed = [1, 2, 3].map((i) =>
          residuals[i] > 0 ? Math.log2(residuals[i - 1] / residuals[i]) : null,
        );
        const asymptotic = observed.slice(1);
        const ordersOk = asymptotic.every((o) => o !== null && o >= TT_TOLERANCES.balanceResidualOrderMin);

        const final = rows[0].points[3];
        const kDrift = scaledInvariant(runs[0].samples[0], n, length0, rate);
        const kFinal = scaledInvariant(runs[0].samples[runs[0].samples.length - 1], n, length0, rate);
        const l4Drift = Math.abs(kFinal - kDrift) / Math.abs(kDrift);

        return {
          measuredValue: Math.max(...budgeted.map((r) => r.worstRatio ?? Number.POSITIVE_INFINITY)),
          outcome: insideBudget && ordersOk ? "PASS" : "FAIL",
          evidence:
            budgeted
              .map(
                (r) =>
                  `h=${r.stepS.toFixed(2)} s: residual at 25/50/75/100 % = [${r.points.map((p) => p.residual.toExponential(2)).join(", ")}], budget ${r.budget!.total.toExponential(2)} (${(100 * (r.worstRatio ?? Number.NaN)).toFixed(2)} % of budget), measured epsTheta ${r.eps!.maxTheta.toExponential(2)}`,
              )
              .join("; ") +
            `; residual orders [${observed.map((o) => (o === null ? "\u2014" : o.toFixed(3))).join(", ")}] (asymptotic ${asymptotic.map((o) => (o === null ? "\u2014" : o.toFixed(3))).join(", ")}). ` +
            `At h = ${rows[0].stepS.toFixed(2)} s: K(0) = ${librationK(theta0, 0, n).toExponential(6)}, Delta K = ${final.deltaK.toExponential(3)}, integral = ${final.integral.toExponential(3)} rad^2/s^2. ` +
            `L^4 K is NOT an invariant of this equation: its relative drift over the same run is ${l4Drift.toFixed(3)}.`,
        };
      }),
  },
  {
    checkId: "OT-TT-018",
    title: "Balance-budget calibration across a case matrix",
    modelId: TETHER_MODEL_ID,
    criterion:
      `Over ${BALANCE_CASES.length} configurations (0.05-60 deg amplitude, 0-5 m/s deployment, linear and nonlinear length histories, zero and nonzero initial rates, 1800-6900 s) and four integration steps, every measured balance residual must lie inside its own error budget at six reporting times, and the residual must fall at least at third order with successive order estimates agreeing within ${BALANCE_CLASSIFICATION.maxOrderSpread} order unit. A case whose budget cannot be justified, whose order is unreliable or round-off limited, or whose order is below the floor is UNRESOLVED; a residual more than ${BALANCE_CLASSIFICATION.failRatio}x its budget is FAIL.`,
    expectedBehavior:
      "A single case cannot show that a budget methodology is conservative. If the budget were derived only from the one configuration that happens to pass, another amplitude, length, deployment history or initial rate could exceed it and the acceptance rule would be misleading. This check reports the residual/budget ratio for every (configuration, step, reporting time), tests whether the order diagnosis is consistent across refinements, and classifies each case, so the budget is tested as a METHOD rather than as a single number. The test set was extended beyond the configurations used to build the criterion, and the extended set changed the verdict: cases BC-6, BC-10 and BC-14 cannot support an order-based conclusion.",
    measuredUnit: "worst |residual| / budget over all configurations, steps and reporting times (1)",
    tolerance: `≤ 1 for every case, with a consistent residual order ≥ ${BALANCE_CLASSIFICATION.minAsymptoticOrder}; otherwise UNRESOLVED except at > ${BALANCE_CLASSIFICATION.failRatio}x budget`,
    toleranceJustification:
      "The budget is the same derived quantity as OT-TT-017 (measured self-convergence propagated through K and the integral, plus the Richardson quadrature estimate, times a declared factor 4). The 1x criterion, the 10x FAIL level and the 1 order-unit consistency allowance were fixed before the matrix was extended, and neither was moved afterwards. FAIL is reserved for the only comparison the estimate's own uncertainty cannot explain; a low or inconsistent order is reported as UNRESOLVED because it is equally consistent with leaving the asymptotic regime, cancellation and round-off. The 1-unit spread allowance is the spacing between adjacent integer orders: an estimate that moves by more than that between refinements has not settled onto a single leading term.",
    method:
      "For each configuration integrate the documented constant-n equation with an independent RK4 at h = 60, 30, 15 and 7.5 s; evaluate K(t) - K(0) + 2\u222b(Ldot/L)theta'^2 at 10, 25, 50, 75, 90 and 100 % of the run; build each step's budget from the difference against the next finer step; compare successive asymptotic order estimates and the finest residual against an estimated round-off floor; classify the case and the matrix. Nonlinear histories are supplied in closed form with their exact Ldot/L, so no length history is differentiated numerically.",
    limitations:
      "The matrix spans the model's own scope only: prescribed length (not dynamically coupled reel dynamics), in-plane motion, constant n and a massless rod. It says nothing about elasticity, out-of-plane motion or the production n(t) coupling, and the finest step of each configuration has no budget of its own. Point counts (budgeted and unbudgeted) are measurements, not independent experiments: each configuration is one initial-value problem. Statuses are verdicts on the numerical acceptance criterion, never on the physics (see BALANCE_STATUS_MEANING).",
    run: () =>
      guard(() => {
        const study = calibrateBalance(meanMotion(REFERENCE_RADIUS_M));
        const failing = study.cases.filter((c) => c.status === "FAIL");
        const unresolved = study.cases.filter((c) => c.status === "UNRESOLVED");
        const orders = study.cases.map((c) => c.minAsymptoticOrder).filter((o): o is number => o !== null);
        const rows = study.cases.map(
          (c) =>
            `${c.caseId} [${c.regime}] ${c.status}/${c.diagnosis}: worst ${c.worstRatio === null ? "not computable" : c.worstRatio.toExponential(2)} of budget` +
            `${c.worstRatioWhere ? ` at h=${c.worstRatioWhere.stepS} s, t=${c.worstRatioWhere.timeS.toFixed(0)} s` : ""}, ` +
            `asymptotic orders ${c.asymptoticOrders.map((o) => (o === null ? "n/a" : o.toFixed(3))).join(", ")} (spread ${c.orderSpread === null ? "n/a" : c.orderSpread.toFixed(3)}), ` +
            `|residual| / |integral| ${c.residualOverIntegral === null ? "n/a" : c.residualOverIntegral.toExponential(2)}, ` +
            `quadrature order ${c.quadratureOrderFinal === null ? "n/a (zero integrand)" : c.quadratureOrderFinal.toFixed(2)}`,
        );
        const l4 = study.cases.map((c) => c.l4Drift);
        return {
          measuredValue: study.worstRatio,
          outcome: study.status,
          evidence:
            `${study.casesPassing}/${study.configurations} configurations PASS, ${study.casesUnresolved} UNRESOLVED, ${study.casesFailing} FAIL. ` +
            `Measurements: ${study.totalBudgetedPoints} budgeted (configuration, step, time) points plus ${study.totalUnbudgetedPoints} unbudgeted finest-step residuals over ${study.configurations} configurations; ` +
            `these are samples of ${study.configurations} initial-value problems, not ${study.totalBudgetedPoints} independent experiments. ` +
            `Worst ratio ${study.worstRatio === null ? "not computable" : study.worstRatio.toExponential(2)} (${study.worstCaseId ?? "n/a"}), i.e. the closest case is still ${study.worstRatio === null ? "n/a" : (1 / study.worstRatio).toFixed(0)}x inside its budget. ` +
            `Reliable-order range ${orders.length ? `${Math.min(...orders).toFixed(3)} to ${Math.max(...orders).toFixed(3)}` : "n/a"}; ` +
            `L^4 K drifts by ${Math.min(...l4).toExponential(1)} to ${Math.max(...l4).toExponential(1)} relative, so it is an invariant of none of these cases. ` +
            rows.join(" | ") +
            (failing.length || unresolved.length
              ? `. Not passing: ${[...failing, ...unresolved].map((c) => `${c.caseId} ${c.status}/${c.diagnosis} — ${c.reasons.join(" ")}`).join(" ")}`
              : ".") +
            ` Statuses are verdicts on this criterion only. ${BALANCE_STATUS_MEANING}`,
        };
      }),
  },
];

// Parameter-spec import kept adjacent to the checks so that the rejection cases are
// demonstrably applied to the same specification the Laboratory uses.
export const TETHER_CHECK_PARAM_COUNT = TETHER_PARAMETER_SPECS.length;
