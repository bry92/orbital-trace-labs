/**
 * Verification checks for model OTL-2BP.
 *
 * Every check executes the real calculation engine (or the real validation
 * layer) and measures a value. No check compares hard-coded expected output
 * against hard-coded actual output.
 *
 * Tolerances are numerical criteria. Passing them does not establish physical
 * validity; that distinction is stated in the Verification Center.
 */

import { MU_EARTH } from "../core/constants";
import {
  keplerPropagate,
  propagateTwoBody,
  relativeErrorVsKepler,
  stateFromElements,
  type TimeSeries,
} from "../core/twobody";
import { norm, sub } from "../core/vec";
import type { ParameterInput } from "../core/validation";
import { calculateTwoBody, validateTwoBodyInputs } from "../models/twoBody";
import type { CheckOutcome, VerificationCheckDefinition } from "../models/types";

/** Numerical thresholds, with the justification reported alongside each check. */
export const TB_TOLERANCES = {
  circularRadiusRel: 1e-8,
  eccentricKeplerRel: 1e-6,
  energyEps: 1e-8,
  angularMomentumEps: 1e-10,
  convergenceOrderMin: 3.5,
  dopri5KeplerRel: 1e-7,
};

const LEO_RADIUS = 6378137 + 400e3;
const LEO_STATE = stateFromElements(MU_EARTH, LEO_RADIUS, 0, 0, 0, 0, 0);
const ECC_A = 24500e3;
const ECC_E = 0.73;
const ECC_STATE = stateFromElements(MU_EARTH, ECC_A, ECC_E, 0, 0, 0, 0);

function leoPeriod(): number {
  return 2 * Math.PI * Math.sqrt(LEO_RADIUS ** 3 / MU_EARTH);
}

function propagate(
  position: [number, number, number],
  velocity: [number, number, number],
  durationS: number,
  stepS: number,
): { series: TimeSeries; maxEpsE: number; maxEpsH: number } {
  const res = propagateTwoBody({
    mu: MU_EARTH,
    positionM: position,
    velocityMS: velocity,
    durationS,
    solver: { method: "RK4", stepS },
  });
  return { series: res.series, maxEpsE: res.maxEpsEnergy, maxEpsH: res.maxEpsAngularMomentum };
}

function guard(fn: () => { measuredValue: number | string | null; outcome: CheckOutcome; evidence: string }) {
  try {
    return fn();
  } catch (err) {
    return {
      measuredValue: null,
      outcome: "FAIL" as CheckOutcome,
      evidence: `Check threw an exception instead of returning a measurement: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export const TWO_BODY_CHECKS: VerificationCheckDefinition[] = [
  {
    checkId: "OT-TB-001",
    title: "Circular-orbit radius invariance",
    modelId: "OTL-2BP",
    criterion:
      "For a circular two-body orbit the radius is constant in the exact solution, so max |r(t)/r₀ − 1| over one period must be below the stated tolerance.",
    expectedBehavior:
      "A correct integrator reproduces r(t) = r₀ within truncation error; the measured value should shrink as h shrinks (see OT-TB-005).",
    measuredUnit: "relative radial deviation (1)",
    tolerance: `≤ ${TB_TOLERANCES.circularRadiusRel.toExponential(1)}`,
    toleranceJustification:
      "Analytic radial deviation is exactly zero, so any residual is pure truncation error. The threshold sits roughly two orders of magnitude above the accumulated RK4 local-error estimate for 556 steps at h = 10 s ((n·h)⁵ per step, n = 1.13e-3 s⁻¹), leaving margin for round-off while still failing a broken integrator.",
    method:
      "Initialise a 400 km circular equatorial state with v = √(μ/r) at h = 10 s, propagate exactly one revolution, and take the maximum relative radial deviation over all samples.",
    limitations:
      "Tests the integrator on a circular orbit only. Elliptic geometry is covered by OT-TB-002 and long-term drift is not bounded by one period.",
    run: () =>
      guard(() => {
        const period = leoPeriod();
        const { series } = propagate(LEO_STATE.positionM, LEO_STATE.velocityMS, period, 10);
        const r0 = Math.hypot(...LEO_STATE.positionM);
        let maxDev = 0;
        for (const r of series.radius) maxDev = Math.max(maxDev, Math.abs(r / r0 - 1));
        return {
          measuredValue: maxDev,
          outcome: maxDev <= TB_TOLERANCES.circularRadiusRel ? "PASS" : "FAIL",
          evidence: `One revolution of ${(period / 60).toFixed(2)} min at h = 10 s (${Math.ceil(period / 10)} steps); r₀ = ${r0.toFixed(1)} m.`,
        };
      }),
  },
  {
    checkId: "OT-TB-002",
    title: "Eccentric-orbit regression against an analytic Kepler solution",
    modelId: "OTL-2BP",
    criterion:
      "max |r_num(t) − r_kepler(t)| / r₀ over one period of a GTO-like a = 24,500 km, e = 0.73 orbit must stay below tolerance.",
    expectedBehavior:
      "The integrated trajectory follows the conic that Kepler's equation predicts, including perigee passage where acceleration is largest.",
    measuredUnit: "relative position error (1)",
    tolerance: `≤ ${TB_TOLERANCES.eccentricKeplerRel.toExponential(1)}`,
    toleranceJustification:
      "The reference is analytic (Newton solution of Kepler's equation), not another integration, so the tolerance is dominated by RK4 truncation error at h = 10 s across a strongly eccentric orbit. The threshold is an order-of-magnitude envelope on that error, not a physical accuracy claim.",
    method:
      "Build the initial state from elements a = 24,500 km, e = 0.73 with stateFromElements; integrate with RK4 at h = 10 s for one period; compare every sample with keplerPropagate() at the same time.",
    limitations:
      "The analytic reference assumes the same two-body equations; agreement cannot detect a shared modelling error, only an implementation or integration error.",
    run: () =>
      guard(() => {
        const a = ECC_A;
        const period = 2 * Math.PI * Math.sqrt(a ** 3 / MU_EARTH);
        const { series } = propagate(ECC_STATE.positionM, ECC_STATE.velocityMS, period, 10);
        const r0 = Math.hypot(...ECC_STATE.positionM);
        const err = relativeErrorVsKepler(MU_EARTH, ECC_STATE.positionM, ECC_STATE.velocityMS, series);
        return {
          measuredValue: err.maxPositionRelError,
          outcome:
            Number.isFinite(err.maxPositionRelError) && err.maxPositionRelError <= TB_TOLERANCES.eccentricKeplerRel
              ? "PASS"
              : "FAIL",
          evidence:
            `a = 24,500 km, e = 0.73, period = ${(period / 60).toFixed(2)} min, ` +
            `max relative velocity error ${err.maxVelocityRelError.toExponential(3)}, r₀ = ${r0.toExponential(6)} m.`,
        };
      }),
  },
  {
    checkId: "OT-TB-003",
    title: "Energy conservation (measured, not assumed)",
    modelId: "OTL-2BP",
    criterion:
      "max ε_E over three revolutions of the 400 km circular orbit must be ≤ the tolerance, with ε_E = |E(t) − E(0)| / max(|E(0)|, μ/|r₀|).",
    expectedBehavior:
      "For a central inverse-square force, specific energy is a first integral. A non-symplectic RK4 scheme will drift slightly; the drift must stay negligible at the documented step.",
    measuredUnit: "normalised energy discrepancy (1)",
    tolerance: `≤ ${TB_TOLERANCES.energyEps.toExponential(1)}`,
    toleranceJustification:
      "RK4 global energy error grows approximately as (n·h)⁴ over one period; at h = 10 s this predicts order 1e-10. The threshold is ~2 orders above that prediction and still ~8 orders below the specific energy magnitude, so it detects a wrong force model or a broken integrator.",
    method:
      "Propagate three revolutions at h = 10 s with RK4 and take max ε_E across all samples. Denominators are reported in the run record.",
    limitations:
      "Energy conservation is necessary but not sufficient for a correct trajectory: a wrong central force with the same symmetry could conserve energy. Tests the numerical scheme, not physical validity.",
    run: () =>
      guard(() => {
        const { maxEpsE } = propagate(LEO_STATE.positionM, LEO_STATE.velocityMS, 3 * leoPeriod(), 10);
        return {
          measuredValue: maxEpsE,
          outcome: Number.isFinite(maxEpsE) && maxEpsE <= TB_TOLERANCES.energyEps ? "PASS" : "FAIL",
          evidence: `Three revolutions (${((3 * leoPeriod()) / 3600).toFixed(3)} h) at h = 10 s; E(0) = ${(
            0.5 * Math.hypot(...LEO_STATE.velocityMS) ** 2 -
            MU_EARTH / LEO_RADIUS
          ).toFixed(6)} J/kg.`,
        };
      }),
  },
  {
    checkId: "OT-TB-004",
    title: "Angular-momentum conservation (measured, not assumed)",
    modelId: "OTL-2BP",
    criterion:
      "max ε_h over three revolutions of the 400 km circular orbit must be ≤ the tolerance, with ε_h = ||h(t)| − |h(0)|| / max(|h(0)|, |r₀||v₀|).",
    expectedBehavior:
      "Central forces exert no torque, so |h| is a first integral. A correct RK4 propagation preserves it to truncation level.",
    measuredUnit: "normalised angular-momentum discrepancy (1)",
    tolerance: `≤ ${TB_TOLERANCES.angularMomentumEps.toExponential(1)}`,
    toleranceJustification:
      "For this exactly circular case |h| = |r||v| is conserved to the same order as the radius itself, so the same (n·h)⁴ analysis applies. The threshold is set an order of magnitude looser than the energy threshold because |h| is reconstructed from both r and v and accumulates both error contributions.",
    method: "Propagate three revolutions at h = 10 s with RK4 and take max ε_h across samples.",
    limitations:
      "A central-force integrator that conserves h can still have the wrong orbit shape; this check is complementary to OT-TB-001/002, not a substitute.",
    run: () =>
      guard(() => {
        const { maxEpsH } = propagate(LEO_STATE.positionM, LEO_STATE.velocityMS, 3 * leoPeriod(), 10);
        return {
          measuredValue: maxEpsH,
          outcome: Number.isFinite(maxEpsH) && maxEpsH <= TB_TOLERANCES.angularMomentumEps ? "PASS" : "FAIL",
          evidence: `Three revolutions at h = 10 s; |h(0)| = ${(
            LEO_RADIUS * Math.hypot(...LEO_STATE.velocityMS)
          ).toExponential(6)} m²/s.`,
        };
      }),
  },
  {
    checkId: "OT-TB-005",
    title: "Step-refinement convergence order",
    modelId: "OTL-2BP",
    criterion:
      "Halving the RK4 step must reduce the final-time position error by approximately 2⁴ = 16; the observed order p = log₂(e(h)/e(h/2)) must be ≥ the stated threshold for the two finest refinements.",
    expectedBehavior:
      "Classical RK4 has global order 4, so the measured convergence order should approach 4 as h → 0. A method with a coding error typically shows a different slope.",
    measuredUnit: "observed order p (dimensionless)",
    tolerance: `≥ ${TB_TOLERANCES.convergenceOrderMin}`,
    toleranceJustification:
      "The exact value is 4. Allowing p ≥ 3.5 accommodates the approach to the asymptotic regime and round-off contamination at the finest step, while still excluding orders 1–3 that would indicate an implementation error.",
    method:
      "Propagate one eccentric-orbit period (a = 24,500 km, e = 0.73) at h = 80, 40, 20, 10 s; compute final-time relative position error against the analytic Kepler solution; fit p between successive steps.",
    limitations:
      "Measures convergence to the analytic solution of the same equations. It does not demonstrate that the physical model is adequate, and at still smaller steps round-off would flatten the slope (not tested here).",
    run: () =>
      guard(() => {
        const a = ECC_A;
        const period = 2 * Math.PI * Math.sqrt(a ** 3 / MU_EARTH);
        const steps = [80, 40, 20, 10];
        const errors: number[] = [];
        const r0Mag = norm(ECC_STATE.positionM);
        for (const h of steps) {
          const res = propagateTwoBody({
            mu: MU_EARTH,
            positionM: ECC_STATE.positionM,
            velocityMS: ECC_STATE.velocityMS,
            durationS: period,
            solver: { method: "RK4", stepS: h },
          });
          const s = res.series;
          const i = s.t.length - 1;
          const ref = keplerPropagate(MU_EARTH, ECC_STATE.positionM, ECC_STATE.velocityMS, s.t[i]);
          if (!ref) throw new Error("Analytic Kepler reference unavailable for the convergence case");
          const dPos = norm(sub([s.x[i], s.y[i], s.z[i]], ref.positionM));
          errors.push(dPos / r0Mag);
        }
        const orders: number[] = [];
        for (let k = 1; k < errors.length; k++) {
          orders.push(Math.log2(errors[k - 1] / errors[k]));
        }
        const measured = Math.min(orders[orders.length - 1], orders[orders.length - 2]);
        return {
          measuredValue: measured,
          outcome: Number.isFinite(measured) && measured >= TB_TOLERANCES.convergenceOrderMin ? "PASS" : "FAIL",
          evidence:
            `Steps h = [${steps.join(", ")}] s → final-time relative errors ` +
            `[${errors.map((v) => v.toExponential(3)).join(", ")}]; successive orders ` +
            `[${orders.map((v) => v.toFixed(3)).join(", ")}].`,
        };
      }),
  },
  {
    checkId: "OT-TB-006",
    title: "Invalid and unsupported input rejection",
    modelId: "OTL-2BP",
    criterion:
      "Each of a documented set of invalid inputs must be rejected by the validation layer with the expected diagnostic code; the measured count of correctly rejected cases must equal the total.",
    expectedBehavior:
      "Invalid physics, missing values, wrong units and unknown fields produce errors. No case is coerced or silently defaulted.",
    measuredUnit: "cases correctly rejected (count)",
    tolerance: "all cases (equality)",
    toleranceJustification:
      "This is a discrete criterion: a single silently accepted invalid input would mean the validation layer does not enforce its own contract, so no tolerance band is appropriate.",
    method:
      "Call validateTwoBodyInputs() for each case with the listed mutation applied to a valid 400 km circular baseline and compare the emitted codes with the expected code.",
    limitations:
      "Covers the cases listed here only; it cannot prove that no other invalid input is accepted.",
    run: () =>
      guard(() => {
        const valid: ParameterInput[] = [
          { paramId: "gravitationalParameter", value: MU_EARTH, unit: "m3s2" },
          { paramId: "initialPositionX", value: LEO_STATE.positionM[0] / 1000, unit: "km" },
          { paramId: "initialPositionY", value: LEO_STATE.positionM[1] / 1000, unit: "km" },
          { paramId: "initialPositionZ", value: LEO_STATE.positionM[2] / 1000, unit: "km" },
          { paramId: "initialVelocityX", value: LEO_STATE.velocityMS[0] / 1000, unit: "kmps" },
          { paramId: "initialVelocityY", value: LEO_STATE.velocityMS[1] / 1000, unit: "kmps" },
          { paramId: "initialVelocityZ", value: LEO_STATE.velocityMS[2] / 1000, unit: "kmps" },
          { paramId: "duration", value: 5, unit: "h" },
          { paramId: "stepSeconds", value: 10, unit: "s" },
        ];
        type Case = { name: string; mutate: (p: ParameterInput[]) => ParameterInput[]; expect: string };
        const cases: Case[] = [
          { name: "missing duration", mutate: (p) => p.filter((x) => x.paramId !== "duration"), expect: "MISSING_PARAMETER" },
          {
            name: "zero position vector",
            mutate: (p) =>
              p.map((x) =>
                x.paramId.startsWith("initialPosition") ? { ...x, value: 0 } : x,
              ),
            expect: "SINGULAR_GEOMETRY",
          },
          {
            name: "zero velocity vector",
            mutate: (p) => p.map((x) => (x.paramId.startsWith("initialVelocity") ? { ...x, value: 0 } : x)),
            expect: "DEGENERATE_ANGULAR_MOMENTUM_NORMALIZATION",
          },
          {
            name: "negative duration",
            mutate: (p) => p.map((x) => (x.paramId === "duration" ? { ...x, value: -1 } : x)),
            expect: "OUT_OF_RANGE",
          },
          {
            name: "zero step size",
            mutate: (p) => p.map((x) => (x.paramId === "stepSeconds" ? { ...x, value: 0 } : x)),
            expect: "OUT_OF_RANGE",
          },
          {
            name: "position supplied in seconds",
            mutate: (p) => p.map((x) => (x.paramId === "initialPositionX" ? { ...x, unit: "s" } : x)),
            expect: "UNIT_MISMATCH",
          },
          {
            name: "unknown parameter",
            mutate: (p) => [...p, { paramId: "warpFactor", value: 9, unit: "none" }],
            expect: "UNKNOWN_PARAMETER",
          },
          {
            name: "step budget exceeded",
            mutate: (p) =>
              p.map((x) => (x.paramId === "stepSeconds" ? { ...x, value: 0.01 } : x)),
            expect: "STEP_BUDGET_EXCEEDED",
          },
          {
            name: "non-numeric value",
            mutate: (p) => p.map((x) => (x.paramId === "initialPositionY" ? { ...x, value: "abc" } : x)),
            expect: "NOT_FINITE",
          },
        ];
        const results = cases.map((c) => {
          const v = validateTwoBodyInputs(c.mutate(valid), "RK4");
          const codes = v.issues.map((i) => i.code);
          return { name: c.name, expected: c.expect, got: codes, pass: codes.includes(c.expect) && !v.ok };
        });
        const passed = results.filter((r) => r.pass).length;
        return {
          measuredValue: passed,
          outcome: passed === cases.length ? "PASS" : "FAIL",
          evidence:
            `${passed}/${cases.length} cases rejected with the expected code. ` +
            results
              .map((r) => `${r.name} → ${r.got.length ? r.got.join("+") : "ACCEPTED"}`)
              .join("; "),
        };
      }),
  },
  {
    checkId: "OT-TB-007",
    title: "Run-to-run repeatability",
    modelId: "OTL-2BP",
    criterion:
      "Two independent executions of the identical configuration must produce numerically identical series (maximum absolute difference exactly 0).",
    expectedBehavior:
      "The computation is deterministic: same inputs, same method, same settings, same binary results. Any divergence indicates hidden state or nondeterminism.",
    measuredUnit: "max |Δr| between runs (m)",
    tolerance: "= 0 exactly",
    toleranceJustification:
      "Floating-point arithmetic in the same process on the same values is deterministic. Any nonzero difference would indicate state leakage, and a tolerance band would hide it.",
    method: "Call calculateTwoBody() twice with the same validated SI inputs and compare every sample of position and energy.",
    limitations:
      "Repeatability within one browser session does not test reproducibility across machines or JavaScript engines, which is addressed separately by the export/import reproduction check.",
    run: () =>
      guard(() => {
        const si = {
          gravitationalParameter: MU_EARTH,
          initialPositionX: LEO_STATE.positionM[0],
          initialPositionY: LEO_STATE.positionM[1],
          initialPositionZ: LEO_STATE.positionM[2],
          initialVelocityX: LEO_STATE.velocityMS[0],
          initialVelocityY: LEO_STATE.velocityMS[1],
          initialVelocityZ: LEO_STATE.velocityMS[2],
          duration: 2 * leoPeriod(),
          stepSeconds: 10,
        };
        const a = calculateTwoBody(si, "RK4");
        const b = calculateTwoBody(si, "RK4");
        let maxDiff = 0;
        for (const key of ["x", "y", "z", "energy"]) {
          const sa = a.series[key];
          const sb = b.series[key];
          if (sa.length !== sb.length) maxDiff = Infinity;
          for (let i = 0; i < Math.min(sa.length, sb.length); i++) {
            maxDiff = Math.max(maxDiff, Math.abs(sa[i] - sb[i]));
          }
        }
        return {
          measuredValue: maxDiff,
          outcome: maxDiff === 0 ? "PASS" : "FAIL",
          evidence: `Two runs of ${a.series.t.length} samples over two revolutions; ${a.series.t.length === b.series.t.length ? "identical sample counts" : "SAMPLE COUNT MISMATCH"}.`,
        };
      }),
  },
  {
    checkId: "OT-TB-008",
    title: "Adaptive-solver accuracy (DOPRI5) against the analytic reference",
    modelId: "OTL-2BP",
    criterion:
      "At relTol = 1e-11, the adaptive Dormand–Prince solution over one eccentric-orbit period must stay within tolerance of the analytic Kepler solution.",
    expectedBehavior:
      "The embedded error estimate and step controller keep the local error near tolerance, so the global error is small and the accepted step count is far lower than a fixed 1 s RK4 grid.",
    measuredUnit: "max relative position error vs analytic solution (1)",
    tolerance: `≤ ${TB_TOLERANCES.dopri5KeplerRel.toExponential(1)}`,
    toleranceJustification:
      "The requested relative tolerance is 1e-11; global error accumulates from local error, so 1e-8 (three decades of margin) is a reasonable acceptance band that still fails a broken controller.",
    method:
      "Integrate a = 24,500 km, e = 0.73 for one period with DOPRI5 (relTol 1e-11, absTol 1e-13, h0 = 10 s, hmax = 120 s); compare every accepted sample against keplerPropagate().",
    limitations:
      "Adaptive step sizes differ from the RK4 grid, so this is a cross-method comparison against an analytic reference, not a direct step-by-step diff.",
    run: () =>
      guard(() => {
        const a = ECC_A;
        const period = 2 * Math.PI * Math.sqrt(a ** 3 / MU_EARTH);
        const res = propagateTwoBody({
          mu: MU_EARTH,
          positionM: ECC_STATE.positionM,
          velocityMS: ECC_STATE.velocityMS,
          durationS: period,
          solver: { method: "DOPRI5", relTol: 1e-11, absTol: 1e-13, initialStepS: 10, maxStepS: 120 },
        });
        const err = relativeErrorVsKepler(MU_EARTH, ECC_STATE.positionM, ECC_STATE.velocityMS, res.series);
        return {
          measuredValue: err.maxPositionRelError,
          outcome:
            Number.isFinite(err.maxPositionRelError) && err.maxPositionRelError <= TB_TOLERANCES.dopri5KeplerRel
              ? "PASS"
              : "FAIL",
          evidence:
            `${res.steps} accepted / ${res.rejectedSteps} rejected steps vs ` +
            `${Math.ceil(period / 10)} fixed RK4 steps; max ε_E = ${res.maxEpsEnergy.toExponential(3)}.`,
        };
      }),
  },
  {
    checkId: "OT-TB-009",
    title: "Open-orbit reporting (no fabricated period)",
    modelId: "OTL-2BP",
    criterion:
      "For a hyperbolic initial state (speed = 1.2 × local escape speed), the reported orbital period must be null and the state must be classified as open.",
    expectedBehavior:
      "An open orbit has no period. The application must report the absence of the quantity instead of extrapolating a number.",
    measuredUnit: "reported period (s), null expected",
    tolerance: "period must be null",
    toleranceJustification:
      "This is a logical criterion about reporting honesty, not a numerical tolerance.",
    method:
      "Build a radial-outward state at 400 km altitude with |v| = 1.2√(2μ/r), execute calculateTwoBody(), and inspect the returned period metric and unresolved list.",
    limitations:
      "Only verifies the reporting path for one hyperbolic configuration.",
    run: () =>
      guard(() => {
        const r = LEO_RADIUS;
        const vEsc = Math.sqrt((2 * MU_EARTH) / r);
        const si = {
          gravitationalParameter: MU_EARTH,
          initialPositionX: r,
          initialPositionY: 0,
          initialPositionZ: 0,
          initialVelocityX: 0,
          initialVelocityY: 1.2 * vEsc,
          initialVelocityZ: 0,
          duration: 3600,
          stepSeconds: 5,
        };
        const res = calculateTwoBody(si, "RK4");
        const periodMetric = res.metrics.find((m) => m.id === "period");
        const declaredUnresolved = res.unresolved.some((u) => u.item === "Orbital period T");
        const ok = periodMetric?.value === null && declaredUnresolved;
        return {
          measuredValue: periodMetric?.value === null ? "null" : String(periodMetric?.value),
          outcome: ok ? "PASS" : "FAIL",
          evidence: `Speed = 1.2 × escape (${(1.2 * vEsc).toFixed(1)} m/s); period metric = ${periodMetric?.value === null ? "null" : String(periodMetric?.value)}; unresolved entry ${declaredUnresolved ? "present" : "MISSING"}.`,
        };
      }),
  },
];
