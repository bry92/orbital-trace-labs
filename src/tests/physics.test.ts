/**
 * Physics engine tests. These execute the real integrators and the real two-body
 * solver; no expected output is hard-coded as a string.
 */

import { describe, expect, it } from "vitest";
import { MU_EARTH, R_EARTH } from "../core/constants";
import { IntegrationError, integrateDOPRI5, integrateRK4, rk4Step } from "../core/integrators";
import {
  computeElements,
  keplerPropagate,
  propagateTwoBody,
  relativeErrorVsKepler,
  specificAngularMomentum,
  specificEnergy,
  stateFromElements,
} from "../core/twobody";
import { cross, dot, norm, sub, type Vec3 } from "../core/vec";

const LEO_R = R_EARTH + 400e3;
const LEO_PERIOD = 2 * Math.PI * Math.sqrt(LEO_R ** 3 / MU_EARTH);
const LEO = stateFromElements(MU_EARTH, LEO_R, 0, 0, 0, 0, 0);
const ECC_A = 24500e3; // GTO-like: perigee 6615 km (above the surface), apogee 42,385 km
const ECC_E = 0.73;
const ECC = stateFromElements(MU_EARTH, ECC_A, ECC_E, 0, 0, 0, 0);
const ECC_PERIOD = 2 * Math.PI * Math.sqrt(ECC_A ** 3 / MU_EARTH);

describe("RK4 integrator", () => {
  it("integrates y' = -y with the expected order-5 local error", () => {
    const h = 0.1;
    const y1 = rk4Step((_t, y, out) => { out[0] = -y[0]; }, 0, new Float64Array([1]), h);
    const exact = Math.exp(-h);
    const localError = Math.abs(y1[0] - exact);
    console.log(`[RK4] y'=-y, h=0.1: error=${localError.toExponential(3)} (O(h^5) reference ${(h ** 5 / 120).toExponential(3)})`);
    expect(localError).toBeLessThan(1e-6);
    // Fourth-order global behaviour: halving h must cut the error by ~16.
    const yHalf = rk4Step((_t, y, out) => { out[0] = -y[0]; }, 0, new Float64Array([1]), h / 2);
    const errHalf = Math.abs(yHalf[0] - Math.exp(-h / 2));
    const order = Math.log2(localError / errHalf);
    console.log(`[RK4] observed local order for y'=-y: ${order.toFixed(3)}`);
    expect(order).toBeGreaterThan(4.5);
  });

  it("integrates to the exact requested duration with a clipped final step", () => {
    const duration = 1.0;
    const res = integrateRK4((_t, _y, out) => { out[0] = 1; }, new Float64Array([0]), duration, {
      stepS: 0.3,
      maxSteps: 100,
    });
    expect(res.finalTime).toBeCloseTo(duration, 14);
    expect(res.steps).toBe(4);
  });

  it("rejects a non-positive step instead of substituting a default", () => {
    expect(() =>
      integrateRK4((_t, _y, out) => { out[0] = 0; }, new Float64Array([0]), 1, { stepS: 0, maxSteps: 10 }),
    ).toThrow(IntegrationError);
  });

  it("enforces the step budget", () => {
    expect(() =>
      integrateRK4((_t, _y, out) => { out[0] = 0; }, new Float64Array([0]), 100, {
        stepS: 0.1,
        maxSteps: 10,
      }),
    ).toThrow(/step/i);
  });
});

describe("Dormand–Prince 5(4) integrator", () => {
  it("meets the requested tolerance on a problem with a known solution", () => {
    // y' = -y, y(0)=1 -> e^-t
    let finalY = NaN;
    const res = integrateDOPRI5(
      (_t, y, out) => { out[0] = -y[0]; },
      new Float64Array([1]),
      10,
      {
        relTol: 1e-11,
        absTol: 1e-13,
        initialStepS: 0.01,
        maxStepS: 1,
        minStepS: 1e-12,
        maxSteps: 100000,
        onSample: (_t, y) => { finalY = y[0]; },
      },
    );
    const exact = Math.exp(-10);
    const relErr = Math.abs(finalY - exact) / exact;
    console.log(`[DOPRI5] y'=-y to t=10: rel error ${relErr.toExponential(3)}, ${res.accepted} accepted / ${res.rejected} rejected steps`);
    // relTol bounds the LOCAL error of each step; global error over t=10 accumulates above it.
    expect(relErr).toBeLessThan(1e-8);
  });

  it("raises an error when the tolerance cannot be reached within the step floor", () => {
    expect(() =>
      integrateDOPRI5((_t, y, out) => { out[0] = -1e6 * y[0]; }, new Float64Array([1]), 1, {
        relTol: 1e-14,
        absTol: 1e-14,
        initialStepS: 1,
        maxStepS: 1,
        minStepS: 1e-3,
        maxSteps: 1000,
      }),
    ).toThrow(IntegrationError);
  });
});

describe("two-body dynamics", () => {
  it("computes the circular-orbit period from the analytic relation", () => {
    const vCirc = Math.sqrt(MU_EARTH / LEO_R);
    const el = computeElements(MU_EARTH, LEO.positionM, LEO.velocityMS);
    console.log(
      `[2BP] LEO r0=${LEO_R.toFixed(1)} m, v_circ=${vCirc.toFixed(4)} m/s, computed a=${el.semiMajorAxisM?.toFixed(3)} m, e=${el.eccentricity.toExponential(3)}, T=${el.periodS?.toFixed(3)} s`,
    );
    expect(el.semiMajorAxisM).toBeCloseTo(LEO_R, 3);
    expect(el.eccentricity).toBeLessThan(1e-12);
    expect(el.periodS).toBeCloseTo(LEO_PERIOD, 6);
  });

  it("keeps radius and speed constant on a circular orbit and reports drift", () => {
    const res = propagateTwoBody({
      mu: MU_EARTH,
      positionM: LEO.positionM,
      velocityMS: LEO.velocityMS,
      durationS: LEO_PERIOD,
      solver: { method: "RK4", stepS: 10 },
    });
    const r0 = norm(LEO.positionM);
    let maxRadial = 0;
    let maxSpeedDev = 0;
    for (let i = 0; i < res.series.t.length; i++) {
      maxRadial = Math.max(maxRadial, Math.abs(res.series.radius[i] / r0 - 1));
      maxSpeedDev = Math.max(maxSpeedDev, Math.abs(res.series.speed[i] / norm(LEO.velocityMS) - 1));
    }
    console.log(
      `[2BP] circular 1 rev, h=10s: max radial dev ${maxRadial.toExponential(3)}, max speed dev ${maxSpeedDev.toExponential(3)}, reached t=${res.series.t.at(-1)?.toFixed(3)} s, steps=${res.steps}`,
    );
    expect(res.steps).toBe(Math.ceil(LEO_PERIOD / 10));
    expect(maxRadial).toBeLessThan(1e-8);
  });

  it("matches an independent Kepler solution on an eccentric orbit", () => {
    const res = propagateTwoBody({
      mu: MU_EARTH,
      positionM: ECC.positionM,
      velocityMS: ECC.velocityMS,
      durationS: ECC_PERIOD,
      solver: { method: "RK4", stepS: 5 },
    });
    const err = relativeErrorVsKepler(MU_EARTH, ECC.positionM, ECC.velocityMS, res.series);
    console.log(
      `[2BP] eccentric a=24500 km e=0.73, 1 rev, h=5s: max rel position error ${err.maxPositionRelError.toExponential(3)}, max rel velocity error ${err.maxVelocityRelError.toExponential(3)}`,
    );
    expect(err.maxPositionRelError).toBeLessThan(1e-7);
  });

  it("returns to the initial state after exactly one period", () => {
    const res = propagateTwoBody({
      mu: MU_EARTH,
      positionM: ECC.positionM,
      velocityMS: ECC.velocityMS,
      durationS: ECC_PERIOD,
      solver: { method: "RK4", stepS: 2 },
    });
    const last = res.series.t.length - 1;
    const dPos = norm(
      sub([res.series.x[last], res.series.y[last], res.series.z[last]], ECC.positionM),
    );
    console.log(`[2BP] period closure (e=0.73, h=2s): |Δr| = ${dPos.toExponential(3)} m`);
    expect(dPos).toBeLessThan(0.5);
  });

  it("round-trips state <-> classical elements", () => {
    const a = 12000e3;
    const e = 0.35;
    const inc = (47 * Math.PI) / 180;
    const raan = (130 * Math.PI) / 180;
    const argp = (70 * Math.PI) / 180;
    const nu = (210 * Math.PI) / 180;
    const st = stateFromElements(MU_EARTH, a, e, inc, raan, argp, nu);
    const el = computeElements(MU_EARTH, st.positionM, st.velocityMS);
    console.log(
      `[2BP] element round-trip: a err ${Math.abs(el.semiMajorAxisM! - a).toExponential(3)} m, e err ${Math.abs(el.eccentricity - e).toExponential(3)}, i err ${Math.abs(el.inclinationRad - inc).toExponential(3)} rad, RAAN err ${Math.abs(el.raanRad - raan).toExponential(3)} rad, omega err ${Math.abs(el.argPeriapsisRad - argp).toExponential(3)} rad, nu err ${Math.abs(el.trueAnomalyRad - nu).toExponential(3)} rad`,
    );
    expect(el.semiMajorAxisM!).toBeCloseTo(a, 3);
    expect(el.eccentricity).toBeCloseTo(e, 12);
    expect(el.inclinationRad).toBeCloseTo(inc, 12);
    expect(el.raanRad).toBeCloseTo(raan, 10);
    expect(el.argPeriapsisRad).toBeCloseTo(argp, 10);
    expect(el.trueAnomalyRad).toBeCloseTo(nu, 10);
  });

  it("closes the analytic Kepler reference on itself", () => {
    const ref0 = keplerPropagate(MU_EARTH, ECC.positionM, ECC.velocityMS, 0);
    expect(ref0).not.toBeNull();
    const startErr = norm(sub(ref0!.positionM, ECC.positionM));
    const refT = keplerPropagate(MU_EARTH, ECC.positionM, ECC.velocityMS, ECC_PERIOD);
    const closureErr = norm(sub(refT!.positionM, ECC.positionM));
    console.log(
      `[2BP] Kepler reference: t=0 offset ${startErr.toExponential(3)} m, period closure ${closureErr.toExponential(3)} m`,
    );
    expect(startErr).toBeLessThan(1e-3);
    expect(closureErr).toBeLessThan(1e-3);
  });

  it("reports no period for a hyperbolic state", () => {
    const vEsc = Math.sqrt((2 * MU_EARTH) / LEO_R);
    const el = computeElements(MU_EARTH, [LEO_R, 0, 0], [0, 1.2 * vEsc, 0]);
    console.log(`[2BP] hyperbolic: regime=${el.regime}, a=${el.semiMajorAxisM?.toExponential(4)} m, period=${String(el.periodS)}`);
    expect(el.isClosed).toBe(false);
    expect(el.periodS).toBeNull();
    expect(el.eccentricity).toBeGreaterThan(1);
  });

  it("rejects a zero-velocity state rather than re-normalising", () => {
    expect(() =>
      propagateTwoBody({
        mu: MU_EARTH,
        positionM: [LEO_R, 0, 0],
        velocityMS: [0, 0, 0],
        durationS: 100,
        solver: { method: "RK4", stepS: 10 },
      }),
    ).toThrow(/angular-momentum scale/i);
  });

  it("conserves energy and angular momentum to the measured level", () => {
    const res = propagateTwoBody({
      mu: MU_EARTH,
      positionM: ECC.positionM,
      velocityMS: ECC.velocityMS,
      durationS: 3 * ECC_PERIOD,
      solver: { method: "RK4", stepS: 10 },
    });
    console.log(
      `[2BP] eccentric 3 rev: ε_E=${res.maxEpsEnergy.toExponential(3)}, ε_h=${res.maxEpsAngularMomentum.toExponential(3)}, |ΔE|max=${res.maxAbsEnergyDriftJPerKg.toExponential(3)} J/kg`,
    );
    // Not zero by construction: measured drift at h=10 shows the scheme is not symplectic.
    expect(res.maxEpsEnergy).toBeGreaterThan(0);
    expect(res.maxEpsEnergy).toBeLessThan(1e-8);
    expect(res.maxEpsAngularMomentum).toBeLessThan(1e-10);
  });

  it("preserves the angular-momentum direction", () => {
    const res = propagateTwoBody({
      mu: MU_EARTH,
      positionM: ECC.positionM,
      velocityMS: ECC.velocityMS,
      durationS: 2 * ECC_PERIOD,
      solver: { method: "RK4", stepS: 5 },
    });
    const h0 = cross(ECC.positionM, ECC.velocityMS);
    let maxAngle = 0;
    for (let i = 0; i < res.series.t.length; i++) {
      const hi = cross(
        [res.series.x[i], res.series.y[i], res.series.z[i]],
        [res.series.vx[i], res.series.vy[i], res.series.vz[i]],
      );
      const cosAng = dot(hi, h0) / (norm(hi) * norm(h0));
      maxAngle = Math.max(maxAngle, Math.acos(Math.min(1, Math.max(-1, cosAng))));
    }
    console.log(`[2BP] max angular-momentum direction change: ${maxAngle.toExponential(3)} rad`);
    expect(maxAngle).toBeLessThan(1e-9);
  });

  it("measures fourth-order convergence under step refinement", () => {
    const errors: number[] = [];
    const steps = [80, 40, 20, 10, 5];
    for (const h of steps) {
      const res = propagateTwoBody({
        mu: MU_EARTH,
        positionM: ECC.positionM,
        velocityMS: ECC.velocityMS,
        durationS: ECC_PERIOD,
        solver: { method: "RK4", stepS: h },
      });
      const i = res.series.t.length - 1;
      const ref = keplerPropagate(MU_EARTH, ECC.positionM, ECC.velocityMS, res.series.t[i])!;
      const d = norm(sub([res.series.x[i], res.series.y[i], res.series.z[i]], ref.positionM));
      errors.push(d / norm(ECC.positionM));
    }
    const orders = errors.slice(1).map((e, k) => Math.log2(errors[k] / e));
    console.log(
      `[CONV] h=[${steps.join(",")}] errors=[${errors.map((v) => v.toExponential(3)).join(", ")}] orders=[${orders.map((v) => v.toFixed(3)).join(", ")}]`,
    );
    expect(orders[orders.length - 1]).toBeGreaterThan(3.5);
    expect(orders[orders.length - 2]).toBeGreaterThan(3.5);
  });

  it("measures adaptive-solver error against the analytic solution", () => {
    const res = propagateTwoBody({
      mu: MU_EARTH,
      positionM: ECC.positionM,
      velocityMS: ECC.velocityMS,
      durationS: ECC_PERIOD,
      solver: { method: "DOPRI5", relTol: 1e-11, absTol: 1e-13, initialStepS: 10, maxStepS: 120 },
    });
    const err = relativeErrorVsKepler(MU_EARTH, ECC.positionM, ECC.velocityMS, res.series);
    console.log(
      `[DOPRI5-2BP] 1 eccentric rev: max rel position error ${err.maxPositionRelError.toExponential(3)}, ${res.steps} accepted / ${res.rejectedSteps} rejected, ε_E=${res.maxEpsEnergy.toExponential(3)}`,
    );
    expect(err.maxPositionRelError).toBeLessThan(1e-8);
    expect(res.steps).toBeLessThan(ECC_PERIOD / 10);
  });

  it("is exactly repeatable", () => {
    const cfg = {
      mu: MU_EARTH,
      positionM: ECC.positionM,
      velocityMS: ECC.velocityMS,
      durationS: ECC_PERIOD,
      solver: { method: "RK4" as const, stepS: 10 },
    };
    const a = propagateTwoBody(cfg);
    const b = propagateTwoBody(cfg);
    let maxDiff = 0;
    for (let i = 0; i < a.series.x.length; i++) {
      maxDiff = Math.max(maxDiff, Math.abs(a.series.x[i] - b.series.x[i]), Math.abs(b.series.energy[i] - a.series.energy[i]));
    }
    console.log(`[REPEAT] max |Δ| between identical runs: ${maxDiff}`);
    expect(maxDiff).toBe(0);
  });

  it("responds correctly when a valid input changes (Kepler scaling)", () => {
    const r1 = 7000e3;
    const r2 = 14_000e3;
    const a = propagateTwoBody({
      mu: MU_EARTH,
      positionM: [r1, 0, 0],
      velocityMS: [0, Math.sqrt(MU_EARTH / r1), 0],
      durationS: 2 * Math.PI * Math.sqrt(r1 ** 3 / MU_EARTH),
      solver: { method: "RK4", stepS: 10 },
    });
    const b = propagateTwoBody({
      mu: MU_EARTH,
      positionM: [r2, 0, 0],
      velocityMS: [0, Math.sqrt(MU_EARTH / r2), 0],
      durationS: 2 * Math.PI * Math.sqrt(r1 ** 3 / MU_EARTH),
      solver: { method: "RK4", stepS: 10 },
    });
    const periodA = a.final.elements.periodS!;
    const periodB = b.final.elements.periodS!;
    const periodRatio = periodB / periodA;
    const speedRatio = b.final.speedMS / a.final.speedMS;
    const analyticPeriodRatio = (r2 / r1) ** 1.5;
    const analyticSpeedRatio = Math.sqrt(r1 / r2);
    console.log(
      `[SCALING] r doubled: period ratio ${periodRatio.toFixed(12)} (analytic ${analyticPeriodRatio.toFixed(12)}), speed ratio ${speedRatio.toFixed(12)} (analytic ${analyticSpeedRatio.toFixed(12)})`,
    );
    expect(periodRatio).toBeCloseTo(analyticPeriodRatio, 9);
    // The integrated speed carries the same truncation drift as the radius (~5e-12 here),
    // so the scaling law is checked to 1e-10, not to machine precision.
    expect(speedRatio).toBeCloseTo(analyticSpeedRatio, 10);
  });

  it("keeps specific energy and |h| consistent with their definitions", () => {
    const r: Vec3 = [7100e3, -1200e3, 400e3];
    const v: Vec3 = [1200, 7300, 300];
    const E = specificEnergy(MU_EARTH, r, v);
    const h = specificAngularMomentum(r, v);
    const el = computeElements(MU_EARTH, r, v);
    // Vis-viva check: E should equal -mu/(2a)
    console.log(
      `[2BP] vis-viva: E=${E.toFixed(3)} J/kg, -mu/2a=${(-MU_EARTH / (2 * el.semiMajorAxisM!)).toFixed(3)} J/kg, |h|=${h.toFixed(3)} m²/s, sqrt(mu a (1-e²))=${Math.sqrt(MU_EARTH * el.semiMajorAxisM! * (1 - el.eccentricity ** 2)).toFixed(3)}`,
    );
    expect(E).toBeCloseTo(-MU_EARTH / (2 * el.semiMajorAxisM!), 6);
    expect(h).toBeCloseTo(Math.sqrt(MU_EARTH * el.semiMajorAxisM! * (1 - el.eccentricity ** 2)), 3);
  });
});
