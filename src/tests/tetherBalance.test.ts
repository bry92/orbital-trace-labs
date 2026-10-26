/**
 * Tests of the variable-length energy-balance identity.
 *
 * Categories, kept explicit because they are not interchangeable:
 *   ANALYTIC IDENTITY          - dK/dt = -2 (Ldot/L) theta'^2 follows from the equation.
 *   INDEPENDENT NUMERICAL CHECK- a separate quadrature and a separate integrator confirm it.
 *   EMPIRICAL COMPARISON       - a measured residual is compared with a measured budget.
 *
 * The identity is a statement about the equation. It does not validate the deployment
 * mechanism, and none of these tests claims that it does.
 */

import { describe, expect, it } from "vitest";
import {
  BALANCE_CASES,
  BALANCE_CLASSIFICATION,
  BALANCE_FRACTIONS,
  BALANCE_STATUS_MEANING,
  balanceAlong,
  balanceIntegrand,
  calibrateBalance,
  classifyBalanceCase,
  compositeSimpson,
  errorBudget,
  exponentialLength,
  integratePrescribed,
  lengthHistoryOf,
  linearLength,
  quadraticLength,
  sinusoidalLength,
  librationK,
  logLengthGradient,
  manufacturedSolution,
  quadratureWithEstimate,
  scaledInvariant,
  trajectoryDifference,
  type LibrationSample,
} from "../verification/tetherBalance";
import { implementedThetaAccel, meanMotion, REFERENCE_RADIUS_M } from "../verification/tetherEquation";
import { DEFAULT_CONVERGENCE_CONFIG } from "../verification/tetherConvergence";
import { MU_EARTH } from "../core/constants";
import { propagateTether } from "../core/tether";

const N0 = meanMotion(REFERENCE_RADIUS_M);
const L0 = DEFAULT_CONVERGENCE_CONFIG.lengthM;
const RATE = DEFAULT_CONVERGENCE_CONFIG.deploymentRateMS;
const T = DEFAULT_CONVERGENCE_CONFIG.durationBS;
const THETA0 = (DEFAULT_CONVERGENCE_CONFIG.theta0BDeg * Math.PI) / 180;

/** Mutated RHS: used only to show that the identity detects wrong equations. */
function integrateMutated(stepS: number, rhsExtra: "none" | "missing" | "flipped" | "coefficient"): LibrationSample[] {
  const steps = Math.round(T / stepS);
  const h = T / steps;
  const f = (t: number, theta: number, w: number): [number, number] => {
    const gg = -3 * N0 * N0 * Math.sin(theta) * Math.cos(theta);
    const deployment = (2 * RATE) / (L0 + RATE * t) * w;
    const accel =
      rhsExtra === "missing"
        ? gg
        : rhsExtra === "flipped"
          ? gg + deployment
          : rhsExtra === "coefficient"
            ? -3.05 * N0 * N0 * Math.sin(theta) * Math.cos(theta) - deployment
            : gg - deployment;
    return [w, accel];
  };
  let theta = THETA0;
  let w = 0;
  const out: LibrationSample[] = [{ t: 0, theta, thetaDot: w }];
  for (let i = 0; i < steps; i++) {
    const t = i * h;
    const k1 = f(t, theta, w);
    const k2 = f(t + h / 2, theta + (h / 2) * k1[0], w + (h / 2) * k1[1]);
    const k3 = f(t + h / 2, theta + (h / 2) * k2[0], w + (h / 2) * k2[1]);
    const k4 = f(t + h, theta + h * k3[0], w + h * k3[1]);
    theta += (h / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]);
    w += (h / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]);
    out.push({ t: (i + 1) * h, theta, thetaDot: w });
  }
  return out;
}

const honest = average(60);

function average(stepS: number): LibrationSample[] {
  return integratePrescribed({
    nRadS: N0,
    length0M: L0,
    rateMS: RATE,
    theta0Rad: THETA0,
    thetaDot0RadPerS: 0,
    durationS: T,
    stepS,
  }).samples;
}

describe("the identity itself (analytic)", () => {
  it("dK/dt equals -2 (Ldot/L) theta'^2 along the manufactured exact solution", () => {
    // Independent of the quadrature: differentiate K numerically at a point and compare
    // with the analytic right-hand side. This is the algebra, checked numerically.
    const n = N0;
    const a = 2e-5;
    const m = manufacturedSolution(THETA0, a, n, L0, T, 401);
    const h = T / 400;
    const dK = (i: number): number =>
      (librationK(m[i + 1].theta, m[i + 1].thetaDot, n) - librationK(m[i - 1].theta, m[i - 1].thetaDot, n)) / (2 * h);
    for (const i of [100, 200, 300]) {
      const analytic = -2 * m[i].logGradient * m[i].thetaDot ** 2;
      const numeric = dK(i);
      expect(Math.abs(analytic - numeric) / Math.abs(analytic)).toBeLessThan(1e-6);
    }
  });

  it("reduces to conservation at constant length", () => {
    const a = 2e-5;
    const n = N0;
    // With L constant the identity forces dK/dt = 0. The manufactured family with
    // Ldot = 0 requires a = 0 in the derivation, so check the statement directly on the
    // constant-length trajectory instead.
    const run = integratePrescribed({
      nRadS: n,
      length0M: L0,
      rateMS: 0,
      theta0Rad: THETA0,
      thetaDot0RadPerS: 0,
      durationS: T,
      stepS: 30,
    });
    const points = balanceAlong(run.samples, { nRadS: n, length0M: L0, rateMS: 0 });
    const k0 = librationK(THETA0, 0, n);
    for (const p of points) {
      expect(p.integral).toBe(0);
      expect(Math.abs(p.residual) / Math.abs(k0)).toBeLessThan(1e-9);
    }
    void a;
  });

  it("refutes L^4 K as an invariant", () => {
    // Multiplying the identity by L^4 does not give conservation; the drift is O(1).
    const first = honest[0];
    const last = honest[honest.length - 1];
    const a = scaledInvariant(first, N0, L0, RATE);
    const b = scaledInvariant(last, N0, L0, RATE);
    expect(Math.abs(b - a) / Math.abs(a)).toBeGreaterThan(1);
    // While K itself changes by only the accumulated integral, ~5e-4 of K(0).
    const driftK = Math.abs(librationK(last.theta, last.thetaDot, N0) - librationK(first.theta, first.thetaDot, N0));
    expect(driftK / Math.abs(librationK(first.theta, first.thetaDot, N0))).toBeLessThan(1e-2);
  });
});

describe("quadrature (independent of the RHS)", () => {
  it("is exact for cubics, including the 3/8 fallback for odd interval counts", () => {
    const cubic = (x: number): number => 2 * x ** 3 - 3 * x ** 2 + x - 5;
    const exact = 0.5 * 2 ** 4 - 2 ** 3 + 0.5 * 2 ** 2 - 10 - 0; // antiderivative on [0,2]
    for (const intervals of [4, 5, 7, 10]) {
      const h = 2 / intervals;
      const values = Array.from({ length: intervals + 1 }, (_, i) => cubic(i * h));
      expect(Math.abs(compositeSimpson(values, h) - exact)).toBeLessThan(1e-12);
    }
  });

  it("reproduces a known integral to its Richardson estimate", () => {
    const samples = manufacturedSolution(THETA0, 2e-5, N0, L0, T, 201);
    const h = T / 200;
    const q = quadratureWithEstimate(
      samples.map((p) => 2 * p.logGradient * p.thetaDot ** 2),
      h,
    );
    const exact = samples[samples.length - 1].exactIntegral;
    expect(Math.abs(q.value - exact) / Math.abs(exact)).toBeLessThan(1e-9);
    expect(Math.abs(q.value - exact)).toBeLessThan(100 * q.richardsonError + 1e-30);
    expect(q.observedOrder).not.toBeNull();
    expect(q.observedOrder as number).toBeGreaterThan(3.5);
  });
});

describe("balance along the prescribed-deployment trajectory (independent check)", () => {
  it("holds at four reporting times with a measured error budget", () => {
    const n = N0;
    const runs = [60, 30, 15].map((stepS) =>
      integratePrescribed({
        nRadS: n,
        length0M: L0,
        rateMS: RATE,
        theta0Rad: THETA0,
        thetaDot0RadPerS: 0,
        durationS: T,
        stepS,
      }),
    );
    const fine = integratePrescribed({
      nRadS: n,
      length0M: L0,
      rateMS: RATE,
      theta0Rad: THETA0,
      thetaDot0RadPerS: 0,
      durationS: T,
      stepS: 7.5,
    });
    const residuals: number[] = [];
    runs.forEach((run, i) => {
      const points = balanceAlong(run.samples, { nRadS: n, length0M: L0, rateMS: RATE });
      const eps = trajectoryDifference(run.samples, i + 1 < runs.length ? runs[i + 1].samples : fine.samples);
      const budget = errorBudget(run.samples, {
        nRadS: n,
        length0M: L0,
        rateMS: RATE,
        epsThetaRad: eps.maxTheta,
        epsThetaDotRadPerS: eps.maxThetaDot,
        quadratureTerm: Math.max(...points.map((p) => p.quadratureError)),
      });
      for (const p of points) {
        expect(Math.abs(p.residual)).toBeLessThanOrEqual(budget.total);
        // K must decrease under deployment, by exactly the accumulated integral.
        expect(p.deltaK).toBeLessThan(0);
        expect(p.integral).toBeGreaterThan(0);
      }
      residuals.push(Math.abs(points[points.length - 1].residual));
    });
    // Fourth-order method, fourth-order residual. The 60 -> 30 s pair is pre-asymptotic
    // (measured order 1.38), so only the two finer pairs are held to the floor; all three
    // are reported by the runtime check.
    for (let i = 2; i < residuals.length; i++) {
      const order = Math.log2(residuals[i - 1] / residuals[i]);
      expect(order).toBeGreaterThan(3);
    }
  });

  it("stays far below its budget on the finest budgeted step", () => {
    const n = N0;
    const run = integratePrescribed({
      nRadS: n,
      length0M: L0,
      rateMS: RATE,
      theta0Rad: THETA0,
      thetaDot0RadPerS: 0,
      durationS: T,
      stepS: 15,
    });
    const finer = integratePrescribed({
      nRadS: n,
      length0M: L0,
      rateMS: RATE,
      theta0Rad: THETA0,
      thetaDot0RadPerS: 0,
      durationS: T,
      stepS: 7.5,
    });
    const points = balanceAlong(run.samples, { nRadS: n, length0M: L0, rateMS: RATE });
    const eps = trajectoryDifference(run.samples, finer.samples);
    const budget = errorBudget(run.samples, {
      nRadS: n,
      length0M: L0,
      rateMS: RATE,
      epsThetaRad: eps.maxTheta,
      epsThetaDotRadPerS: eps.maxThetaDot,
      quadratureTerm: Math.max(...points.map((p) => p.quadratureError)),
    });
    for (const p of points) {
      expect(Math.abs(p.residual)).toBeLessThan(budget.total / 10);
    }
  });
});

describe("mutations the identity must reject", () => {
  it("detects a missing, reversed or rescaled deployment term", () => {
    const pointsOf = (samples: LibrationSample[]) =>
      balanceAlong(samples, { nRadS: N0, length0M: L0, rateMS: RATE, fractions: [1] })[0];
    const baseRun = integratePrescribed({
      nRadS: N0,
      length0M: L0,
      rateMS: RATE,
      theta0Rad: THETA0,
      thetaDot0RadPerS: 0,
      durationS: T,
      stepS: 30,
    });
    const base = pointsOf(baseRun.samples);
    const fines = integratePrescribed({
      nRadS: N0,
      length0M: L0,
      rateMS: RATE,
      theta0Rad: THETA0,
      thetaDot0RadPerS: 0,
      durationS: T,
      stepS: 15,
    });
    const eps = trajectoryDifference(baseRun.samples, fines.samples);
    const budget = errorBudget(baseRun.samples, {
      nRadS: N0,
      length0M: L0,
      rateMS: RATE,
      epsThetaRad: eps.maxTheta,
      epsThetaDotRadPerS: eps.maxThetaDot,
      quadratureTerm: base.quadratureError,
    });
    const truthful = Math.abs(base.residual);
    expect(truthful).toBeLessThanOrEqual(budget.total);

    for (const mutation of ["missing", "flipped", "coefficient"] as const) {
      const residual = Math.abs(pointsOf(integrateMutated(30, mutation)).residual);
      expect(residual).toBeGreaterThan(budget.total * 10);
    }
  });

  it("detects a sign error in the kernel, which the correct run must not show", () => {
    const point = balanceAlong(honest, { nRadS: N0, length0M: L0, rateMS: RATE, fractions: [1] })[0];
    // Correct sign: residual = deltaK + Q is tiny. Reversed kernel: deltaK - Q.
    expect(Math.abs(point.residual)).toBeLessThan(Math.abs(point.integral) * 1e-4);
    const flipped = Math.abs(point.deltaK - point.integral);
    expect(flipped).toBeGreaterThan(Math.abs(point.integral) * 1.9);
  });
});

describe("production right-hand side equals the documented equation", () => {
  it("reproduces the production variable-length run to round-off", () => {
    // The identity above is checked with constant n and a prescribed L(t). This test ties
    // that expression to the production 8-state path, which integrates the orbit and uses
    // n(t) = sqrt(mu/|r|^3). Any difference in the deployment term would grow over the
    // full 6,900 s run rather than cancel.
    const stepS = 30;
    const res = propagateTether({
      mu: MU_EARTH,
      positionM: [REFERENCE_RADIUS_M, 0, 0],
      velocityMS: [0, Math.sqrt(MU_EARTH / REFERENCE_RADIUS_M), 0],
      satelliteMassKg: 500,
      orbiterMassKg: 500,
      lengthM: L0,
      deploymentRateMS: RATE,
      theta0Rad: THETA0,
      thetaDot0RadPerS: 0,
      durationS: T,
      stepS,
    });
    const steps = Math.round(T / stepS);
    const h = T / steps;
    const f = (t: number, y: number[]): number[] => {
      const r2 = y[0] ** 2 + y[1] ** 2 + y[2] ** 2;
      const r = Math.sqrt(r2);
      const n = Math.sqrt(MU_EARTH / (r2 * r));
      const k = -MU_EARTH / (r2 * r);
      return [y[3], y[4], y[5], k * y[0], k * y[1], k * y[2], y[7], implementedThetaAccel(y[6], y[7], L0 + RATE * t, RATE, n)];
    };
    let y = [REFERENCE_RADIUS_M, 0, 0, 0, Math.sqrt(MU_EARTH / REFERENCE_RADIUS_M), 0, THETA0, 0];
    let t = 0;
    for (let i = 0; i < steps; i++) {
      const k1 = f(t, y);
      const k2 = f(t + h / 2, y.map((v, j) => v + (h / 2) * k1[j]));
      const k3 = f(t + h / 2, y.map((v, j) => v + (h / 2) * k2[j]));
      const k4 = f(t + h, y.map((v, j) => v + h * k3[j]));
      y = y.map((v, j) => v + (h / 6) * (k1[j] + 2 * k2[j] + 2 * k3[j] + k4[j]));
      t += h;
    }
    const prodTheta = (res.series.thetaDeg[res.series.thetaDeg.length - 1] * Math.PI) / 180;
    const prodRate = (res.series.thetaRateDegPerS[res.series.thetaRateDegPerS.length - 1] * Math.PI) / 180;
    expect(Math.abs(prodTheta - y[6])).toBeLessThan(1e-14);
    expect(Math.abs(prodRate - y[7])).toBeLessThan(1e-16);
    expect(res.steps).toBe(steps);
  });

  it("does not transfer the constant-n identity to an orbit-coupled eccentric run", () => {
    // Negative control for the scope boundary. The identity is a statement about the
    // documented equation with constant n. The production engine integrates the orbit and
    // uses n(t) = sqrt(mu/|r|^3), which coincides with the reference n only on a circular
    // orbit. On an eccentric orbit the same balance check must fail by orders of magnitude,
    // which is exactly why the calibration is not applied to the coupled trajectory.
    const e = 0.05;
    const vPerigee = Math.sqrt((MU_EARTH / REFERENCE_RADIUS_M) * (1 + e));
    const res = propagateTether({
      mu: MU_EARTH,
      positionM: [REFERENCE_RADIUS_M, 0, 0],
      velocityMS: [0, vPerigee, 0],
      satelliteMassKg: 500,
      orbiterMassKg: 500,
      lengthM: L0,
      deploymentRateMS: RATE,
      theta0Rad: THETA0,
      thetaDot0RadPerS: 0,
      durationS: T,
      stepS: 30,
    });
    const nMin = Math.min(...res.series.meanMotionRadS);
    const nMax = Math.max(...res.series.meanMotionRadS);
    expect(nMax / nMin).toBeGreaterThan(1.1); // the orbit is genuinely eccentric
    const samples = res.series.t.map((t, i) => ({
      t,
      theta: (res.series.thetaDeg[i] * Math.PI) / 180,
      thetaDot: (res.series.thetaRateDegPerS[i] * Math.PI) / 180,
    }));
    const p = balanceAlong(samples, { nRadS: N0, length0M: L0, rateMS: RATE, fractions: [1] })[0];
    const relative = Math.abs(p.residual) / Math.abs(p.integral);
    // Six orders above the ~1e-9 relative residual the identical check achieves on the
    // prescribed constant-n equation (see the two tests above).
    expect(relative).toBeGreaterThan(1e-3);
  });
});

describe("input validation", () => {
  it("refuses non-physical or malformed inputs instead of repairing them", () => {
    expect(() => logLengthGradient(T, L0, -L0 / T - 1)).toThrow(/not positive/);
    expect(() => compositeSimpson([1, 2], 1)).toThrow(/at least 3 samples/);
    expect(() => balanceAlong([{ t: 0, theta: 0, thetaDot: 0 }], { nRadS: N0, length0M: L0, rateMS: RATE })).toThrow(
      /at least five samples/,
    );
    const nonUniform = honest.slice(0, 6).map((s, i) => ({ ...s, t: s.t + (i > 2 ? 1 : 0) }));
    expect(() => balanceAlong(nonUniform, { nRadS: N0, length0M: L0, rateMS: RATE })).toThrow(/uniformly spaced/);
    expect(() => trajectoryDifference(honest.slice(0, 5), honest.slice(0, 6))).toThrow(/integer refinement/);
    expect(() => manufacturedSolution(THETA0, 0, N0, L0, T, 101)).toThrow(/nonzero angular drift/);
    expect(() => manufacturedSolution(THETA0, 2e-5, N0, L0, T, 100)).toThrow(/odd sample count/);
    expect(balanceIntegrand(1e-4, 100, L0, RATE)).toBeCloseTo(2 * (RATE / (L0 + RATE * 100)) * 1e-8, 20);
  });
});

describe("calibration matrix", () => {
  const n = N0;

  /** Classifier input with all fields filled, so each test varies one thing. */
  const cls = (over: Partial<Parameters<typeof classifyBalanceCase>[0]> = {}) =>
    classifyBalanceCase({
      worstRatio: 1e-4,
      minAsymptoticOrder: 4,
      asymptoticOrders: [4, 4.05],
      residualOverIntegral: 1e-9,
      finestResidual: 1e-24,
      roundOffFloor: 1e-26,
      budgetComputable: true,
      ...over,
    });

  it("classifies each outcome from the measured ratio, with declared thresholds", () => {
    expect(cls({ worstRatio: null, budgetComputable: false }).diagnosis).toBe("BUDGET_NOT_COMPUTABLE");
    expect(cls({ worstRatio: null, budgetComputable: false }).status).toBe("UNRESOLVED");
    expect(cls().status).toBe("PASS");
    // Between 1x and 10x: the evidence cannot separate an estimate limitation from a defect.
    expect(cls({ worstRatio: 3 }).status).toBe("UNRESOLVED");
    expect(cls({ worstRatio: 3 }).diagnosis).toBe("BUDGET_EXCEEDED_WITHIN_10X");
    // Beyond 10x: not attributable to the estimate's own uncertainty.
    expect(cls({ worstRatio: 20 }).status).toBe("FAIL");
    expect(cls({ worstRatio: 20 }).diagnosis).toBe("BUDGET_EXCEEDED_BEYOND_10X");
    expect(cls({ worstRatio: 0 }).diagnosis).toBe("INVALID_RATIO");
    expect(cls({ worstRatio: Number.NaN }).status).toBe("UNRESOLVED");
    expect(cls({ worstRatio: Number.POSITIVE_INFINITY }).status).toBe("UNRESOLVED");
    expect(cls({ worstRatio: -1 }).status).toBe("UNRESOLVED");
    expect(cls({ minAsymptoticOrder: null, asymptoticOrders: [] }).diagnosis).toBe("ORDER_NOT_COMPUTABLE");
    // A low order is no longer a FAIL: it is consistent with leaving the asymptotic
    // regime, with cancellation or with round-off, so it cannot demonstrate a defect.
    expect(cls({ minAsymptoticOrder: 2.2, asymptoticOrders: [2.2, 2.3] }).status).toBe("UNRESOLVED");
    expect(cls({ minAsymptoticOrder: 2.2, asymptoticOrders: [2.2, 2.3] }).diagnosis).toBe("ORDER_BELOW_FLOOR");
    expect(cls({ minAsymptoticOrder: 1.2, asymptoticOrders: [1.2, 1.25] }).status).not.toBe("FAIL");
  });

  it("holds each threshold at the boundary, from both sides", () => {
    // Ratio boundary at the caution level (1x).
    expect(cls({ worstRatio: 1 - 1e-6 }).status).toBe("PASS");
    expect(cls({ worstRatio: 1 + 1e-6 }).status).toBe("UNRESOLVED");
    expect(cls({ worstRatio: 1 + 1e-6 }).diagnosis).toBe("BUDGET_EXCEEDED_WITHIN_10X");
    // Ratio boundary at the failure level (10x).
    expect(cls({ worstRatio: 10 - 1e-6 }).status).toBe("UNRESOLVED");
    // Exactly at 10x is still within the 10x level, so it is unresolved, not failed.
    expect(cls({ worstRatio: 10 }).status).toBe("UNRESOLVED");
    expect(cls({ worstRatio: 10 + 1e-6 }).status).toBe("FAIL");
    // Order floor (3).
    expect(cls({ minAsymptoticOrder: 3 - 1e-6, asymptoticOrders: [3 - 1e-6, 3.0] }).diagnosis).toBe(
      "ORDER_BELOW_FLOOR",
    );
    expect(cls({ minAsymptoticOrder: 3, asymptoticOrders: [3, 3.0] }).status).toBe("PASS");
    // Order-spread boundary (1 unit).
    expect(cls({ minAsymptoticOrder: 3.5, asymptoticOrders: [3.5, 4.499] }).status).toBe("PASS");
    expect(cls({ minAsymptoticOrder: 3.5, asymptoticOrders: [3.5, 4.501] }).diagnosis).toBe(
      "ORDER_ESTIMATE_UNRELIABLE",
    );
    // Resolution boundary: residual equal to the balance it should be negligible against.
    expect(cls({ residualOverIntegral: 1 - 1e-6 }).status).toBe("PASS");
    expect(cls({ residualOverIntegral: 1 + 1e-6 }).diagnosis).toBe("BALANCE_BELOW_RESOLUTION");
    // Resolution is not applied when the integral is zero (constant length).
    expect(cls({ residualOverIntegral: null }).status).toBe("PASS");
  });

  it("treats a residual exactly at the round-off floor as round-off limited, not as evidence", () => {
    const atFloor = cls({
      asymptoticOrders: [3.2, 5.9],
      minAsymptoticOrder: 3.2,
      finestResidual: 1e-25,
      roundOffFloor: 1e-25,
    });
    expect(atFloor.diagnosis).toBe("ORDER_ROUND_OFF_LIMITED");
    expect(atFloor.status).toBe("UNRESOLVED");
    const aboveFloor = cls({
      asymptoticOrders: [3.2, 5.9],
      minAsymptoticOrder: 3.2,
      finestResidual: 1.01e-25,
      roundOffFloor: 1e-25,
    });
    expect(aboveFloor.diagnosis).toBe("ORDER_ESTIMATE_UNRELIABLE");
  });

  it("does not classify a non-computable budget or order as PASS or FAIL", () => {
    const noBudget = cls({ worstRatio: null, budgetComputable: false, finestResidual: 1e-30 });
    expect(noBudget.status).toBe("UNRESOLVED");
    expect(noBudget.status).not.toBe("PASS");
    const noOrder = cls({ minAsymptoticOrder: null, asymptoticOrders: [null, null] });
    expect(noOrder.status).toBe("UNRESOLVED");
    expect(noOrder.status).not.toBe("FAIL");
  });

  it("separates 'no order to measure' from 'orders that disagree'", () => {
    const disagree = cls({ asymptoticOrders: [3.2, 5.9], minAsymptoticOrder: 3.2 });
    expect(disagree.status).toBe("UNRESOLVED");
    expect(disagree.diagnosis).toBe("ORDER_ESTIMATE_UNRELIABLE");
    // Same disagreement, but the residual has reached the round-off floor: the sequence
    // is resolving nothing, which is a different statement about the evidence.
    const limited = cls({
      asymptoticOrders: [3.2, 5.9],
      minAsymptoticOrder: 3.2,
      finestResidual: 1e-26,
      roundOffFloor: 1e-25,
    });
    expect(limited.diagnosis).toBe("ORDER_ROUND_OFF_LIMITED");
    expect(limited.reasons.join(" ")).toMatch(/round-off floor/);
    // A single order estimate cannot establish consistency.
    expect(cls({ asymptoticOrders: [4] }).diagnosis).toBe("ORDER_ESTIMATE_UNRELIABLE");
  });

  it("can only report FAIL from the budget comparison, never from the order alone", () => {
    // Exhaustive over a grid of orders with a reliable spread: no order yields FAIL.
    for (let order = 0; order <= 8; order += 0.25) {
      const v = cls({ minAsymptoticOrder: order, asymptoticOrders: [order, order] });
      expect(v.status).not.toBe("FAIL");
    }
    // And the status vocabulary is documented as a criterion verdict, not a physics one.
    expect(BALANCE_STATUS_MEANING).toMatch(/not to the physics/);
    expect(BALANCE_STATUS_MEANING).toMatch(/does not establish that the documented equation or the model is wrong/);
  });

  it("keeps the budget conservative across every configuration in the matrix", () => {
    const study = calibrateBalance(n);
    expect(study.cases).toHaveLength(BALANCE_CASES.length);
    expect(study.configurations).toBe(BALANCE_CASES.length);
    // Counts are measurements, not independent experiments: every configuration is one
    // initial-value problem, sampled at several steps and times.
    expect(study.totalBudgetedPoints).toBe(BALANCE_CASES.length * 3 * BALANCE_FRACTIONS.length);
    expect(study.totalUnbudgetedPoints).toBe(BALANCE_CASES.length * BALANCE_FRACTIONS.length);
    expect(study.casesPassing + study.casesUnresolved + study.casesFailing).toBe(BALANCE_CASES.length);
    // No case violates the criterion, but the matrix is not a blanket PASS: cases whose
    // order estimate is not trustworthy are UNRESOLVED by the rule.
    expect(study.casesFailing).toBe(0);
    expect(study.status).toBe("UNRESOLVED");
    expect(study.casesUnresolved).toBeGreaterThan(0);
    for (const c of study.cases) {
      expect(c.worstRatio).not.toBeNull();
      expect(c.worstRatio as number).toBeLessThanOrEqual(1);
      // Four steps, but only three of them can be budgeted: a budget needs a finer run.
      expect(c.budgetedPoints).toBe((c.steps.length - 1) * BALANCE_FRACTIONS.length);
      expect(c.unbudgetedPoints).toBe(BALANCE_FRACTIONS.length);
      expect(c.points.length).toBe(c.steps.length * BALANCE_FRACTIONS.length);
      expect(c.points.filter((p) => p.budget !== null).length).toBe(c.budgetedPoints);
      expect(c.unbudgetedResiduals.length).toBe(c.unbudgetedPoints);
      expect(c.roundOffFloor).toBeGreaterThan(0);
      // Every residual is inside its budget, at intermediate times as well as at the end.
      for (const p of c.points) {
        if (p.budget === null) continue;
        expect(Math.abs(p.residual)).toBeLessThanOrEqual(p.budget);
        expect(p.timeS).toBeGreaterThan(0);
      }
      // Statuses and diagnoses agree with each other.
      if (c.status === "PASS") expect(c.diagnosis).toBe("CRITERION_MET");
      else expect(c.diagnosis).not.toBe("CRITERION_MET");
      expect(c.reasons.length).toBeGreaterThan(0);
    }
    const byId = new Map(study.cases.map((c) => [c.caseId, c]));
    // Regression: BC-6 previously passed on an order statistic of 5.521. The second
    // asymptotic pair gives 7.942, a spread of 2.421, so no single order is established
    // and the case must not be reported as a pass.
    const bc6 = byId.get("BC-6")!;
    expect(bc6.orderSpread as number).toBeGreaterThan(BALANCE_CLASSIFICATION.maxOrderSpread);
    expect(bc6.status).toBe("UNRESOLVED");
    expect(bc6.diagnosis).toBe("ORDER_ESTIMATE_UNRELIABLE");
    // BC-14 is round-off limited: the residual reaches the floor before the order settles.
    const bc14 = byId.get("BC-14")!;
    expect(bc14.diagnosis).toBe("ORDER_ROUND_OFF_LIMITED");
    expect(Math.abs(bc14.unbudgetedResiduals[bc14.unbudgetedResiduals.length - 1].residual)).toBeLessThanOrEqual(
      bc14.roundOffFloor,
    );
    // The nonlinear-history and nonzero-rate cases are in the matrix and are measured.
    for (const id of ["BC-9", "BC-10", "BC-11", "BC-12", "BC-13"]) {
      const c = byId.get(id)!;
      expect(c.budgetedPoints).toBe(3 * BALANCE_FRACTIONS.length);
      expect(c.worstRatio).not.toBeNull();
    }
    // The matrix covers amplitudes far from the reference case, not just one point.
    expect(Math.max(...BALANCE_CASES.map((c) => c.theta0Deg))).toBeGreaterThanOrEqual(30);
    expect(Math.min(...BALANCE_CASES.map((c) => c.rateMS))).toBe(0);
    expect(Math.max(...BALANCE_CASES.map((c) => c.rateMS))).toBeGreaterThanOrEqual(5);
  });

  it("reports FAIL when the matrix is given a wrong equation", () => {
    // Inject a 1.7 % coefficient error (3 -> 3.05) through the documented hook.
    const defective: typeof integratePrescribed = (opts) => {
      const honestRun = integratePrescribed(opts);
      // Re-integrate with the mutated coefficient, preserving the requested grid.
      const steps = honestRun.steps;
      const h = opts.durationS / steps;
      const f = (t: number, theta: number, w: number): [number, number] => [
        w,
        -3.05 * opts.nRadS * opts.nRadS * Math.sin(theta) * Math.cos(theta) -
          (2 * opts.rateMS) / (opts.length0M + opts.rateMS * t) * w,
      ];
      let theta = opts.theta0Rad;
      let w = opts.thetaDot0RadPerS;
      const samples: LibrationSample[] = [{ t: 0, theta, thetaDot: w }];
      for (let i = 0; i < steps; i++) {
        const t = i * h;
        const k1 = f(t, theta, w);
        const k2 = f(t + h / 2, theta + (h / 2) * k1[0], w + (h / 2) * k1[1]);
        const k3 = f(t + h / 2, theta + (h / 2) * k2[0], w + (h / 2) * k2[1]);
        const k4 = f(t + h, theta + h * k3[0], w + h * k3[1]);
        theta += (h / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]);
        w += (h / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]);
        samples.push({ t: (i + 1) * h, theta, thetaDot: w });
      }
      return { samples, steps, stepS: h };
    };
    const study = calibrateBalance(n, BALANCE_CASES.slice(0, 2), { integrate: defective });
    expect(study.status).toBe("FAIL");
    expect(study.casesFailing).toBeGreaterThan(0);
    expect(study.worstRatio).not.toBeNull();
    expect(study.worstRatio as number).toBeGreaterThan(BALANCE_CLASSIFICATION.failRatio);
  });

  it("reports UNRESOLVED, not PASS, when no budget can be formed", () => {
    // A generator that ignores its step produces identical trajectories, so the
    // self-convergence difference is zero and the budget cannot be justified.
    const frozen: typeof integratePrescribed = (opts) => {
      const fixed = integratePrescribed({ ...opts, stepS: opts.durationS / 40 });
      // Re-sample onto this request's grid so the sample counts still match the step.
      const steps = Math.round(opts.durationS / opts.stepS);
      const stride = (fixed.samples.length - 1) / steps;
      if (!Number.isInteger(stride) || stride < 1) return fixed;
      return {
        samples: Array.from({ length: steps + 1 }, (_, i) => fixed.samples[i * stride]),
        steps,
        stepS: opts.durationS / steps,
      };
    };
    const study = calibrateBalance(n, BALANCE_CASES.slice(0, 1), { integrate: frozen });
    expect(study.status).toBe("UNRESOLVED");
    expect(study.cases[0].worstRatio).toBeNull();
    expect(study.cases[0].reasons.join(" ")).toMatch(/No error budget/);
  });
});

/**
 * Nonlinear prescribed-length histories and nonzero initial rates.
 *
 * The gradient each history reports is checked against independent central differences of
 * its own closed form, so the deployment term is not being validated against itself. These
 * tests establish that the machinery handles the histories; they do not establish that any
 * real reel or actuator follows them.
 */
describe("prescribed length histories", () => {
  const n = N0;
  const T_END = 6900;
  const sgn = (v: number) => Math.sign(v);

  it("reports the exact Logarithmic gradient of each closed form", () => {
    const cases: { label: string; hist: ReturnType<typeof linearLength>; at: number }[] = [
      { label: "linear", hist: linearLength(20_000, 1.5), at: 1200 },
      { label: "exponential", hist: exponentialLength(20_000, 1e-4), at: 1200 },
      { label: "quadratic", hist: quadraticLength(20_000, 1, 2e-4), at: 1200 },
      { label: "sinusoidal", hist: sinusoidalLength(20_000, 2000, (2 * Math.PI) / 2400), at: 700 },
    ];
    const h = 1e-4;
    for (const c of cases) {
      const numeric = (c.hist.at(c.at + h) - c.hist.at(c.at - h)) / (2 * h) / c.hist.at(c.at);
      const exact = c.hist.logGradient(c.at);
      expect(Math.abs(exact - numeric)).toBeLessThan(1e-8 * Math.max(1, Math.abs(numeric)));
      expect(Math.abs(exact)).toBeGreaterThan(0);
      expect(sgn(exact)).toBe(sgn(numeric));
    }
  });

  it("falls back to the linear pair exactly when no history is supplied", () => {
    const fromDefault = lengthHistoryOf({ nRadS: N0, length0M: 20_000, rateMS: 1 });
    const explicit = linearLength(20_000, 1);
    for (const t of [0, 137.5, T_END]) {
      expect(fromDefault.at(t)).toBe(explicit.at(t));
      expect(fromDefault.logGradient(t)).toBe(explicit.logGradient(t));
    }
  });

  it("refuses a history that would make the length non-positive", () => {
    expect(() => linearLength(1000, -1).at(2000)).not.toThrow();
    // L would be zero at t = 1000 s, so the gradient (and any step past it) is refused.
    expect(() => linearLength(1000, -1).logGradient(2000)).toThrow(/not positive/);
    expect(() => quadraticLength(1000, -1, 0).logGradient(2000)).toThrow(/not positive/);
    expect(() => sinusoidalLength(1000, 600, 1)).toThrow(/keep the prescribed length positive/);
    // And the integrator checks both ends before stepping.
    expect(() =>
      integratePrescribed({
        nRadS: n,
        length0M: 1000,
        rateMS: 0,
        length: linearLength(1000, -1),
        theta0Rad: THETA0,
        thetaDot0RadPerS: 0,
        durationS: 2000,
        stepS: 10,
      }),
    ).toThrow(/must stay positive/);
  });

  it("satisfies the balance identity under a nonlinear history, with Ldot changing sign", () => {
    const hist = sinusoidalLength(20_000, 2000, (2 * Math.PI) / 2400);
    const opts = { nRadS: n, length0M: 20_000, rateMS: 0, length: hist };
    const run = integratePrescribed({ ...opts, theta0Rad: THETA0, thetaDot0RadPerS: 0, durationS: T_END, stepS: 7.5 });
    const points = balanceAlong(run.samples, { ...opts, fractions: BALANCE_FRACTIONS });
    const last = points[points.length - 1];
    // The integral is genuinely bidirectional: it is not monotone under this history.
    const integrals = points.map((p) => p.integral);
    const rises = integrals.some((v, i) => i > 0 && v < integrals[i - 1]);
    expect(rises).toBe(true);
    // A mutated deployment term produces a relative residual of order 1, so 1e-6 is the
    // level at which "consistent with the equation" is distinguishable from "wrong term"
    // without pretending the residual should be zero.
    expect(Math.abs(last.residual)).toBeLessThan(1e-6 * Math.abs(last.integral));
    // Same history, same step, but with the deployment term dropped: the identity must
    // then be violated by orders of magnitude rather than by round-off.
    const h = 7.5;
    const steps = Math.round(T_END / h);
    let theta = THETA0;
    let w = 0;
    const mutant: { t: number; theta: number; thetaDot: number }[] = [{ t: 0, theta, thetaDot: w }];
    for (let i = 0; i < steps; i++) {
      const t = i * h;
      const f = (_t: number, th: number, ww: number): [number, number] => [
        ww,
        -3 * n * n * Math.sin(th) * Math.cos(th),
      ];
      const k1 = f(t, theta, w);
      const k2 = f(t + h / 2, theta + (h / 2) * k1[0], w + (h / 2) * k1[1]);
      const k3 = f(t + h / 2, theta + (h / 2) * k2[0], w + (h / 2) * k2[1]);
      const k4 = f(t + h, theta + h * k3[0], w + h * k3[1]);
      theta += (h / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]);
      w += (h / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]);
      mutant.push({ t: (i + 1) * h, theta, thetaDot: w });
    }
    const mutantPoints = balanceAlong(mutant, { ...opts, fractions: [1] });
    expect(Math.abs(mutantPoints[0].residual)).toBeGreaterThan(1e-3 * Math.abs(last.integral));
  });

  it("changes the trajectory when the deployment history changes, at equal initial rate", () => {
    const linear = integratePrescribed({
      nRadS: n,
      length0M: 20_000,
      rateMS: 1,
      theta0Rad: THETA0,
      thetaDot0RadPerS: 0,
      durationS: 1800,
      stepS: 7.5,
    });
    const quadratic = integratePrescribed({
      nRadS: n,
      length0M: 20_000,
      rateMS: 1,
      length: quadraticLength(20_000, 1, 2e-4),
      theta0Rad: THETA0,
      thetaDot0RadPerS: 0,
      durationS: 1800,
      stepS: 7.5,
    });
    const diff = trajectoryDifference(linear.samples, quadratic.samples);
    expect(diff.maxTheta).toBeGreaterThan(0);
    // Both start from the same length and rate, so the difference is the history alone.
    expect(quadratic.samples[0].theta).toBe(linear.samples[0].theta);
  });

  it("handles a nonzero initial angular rate", () => {
    const base = { nRadS: n, length0M: 20_000, rateMS: 1, durationS: 1800, stepS: 7.5, theta0Rad: THETA0 };
    const zero = integratePrescribed({ ...base, thetaDot0RadPerS: 0 });
    const positive = integratePrescribed({ ...base, thetaDot0RadPerS: 2e-4 });
    const negative = integratePrescribed({ ...base, thetaDot0RadPerS: -2e-4 });
    expect(positive.samples[1].theta).toBeGreaterThan(zero.samples[1].theta);
    expect(negative.samples[1].theta).toBeLessThan(zero.samples[1].theta);
    // K is not the same as the zero-rate case: the trajectory carries different energy.
    const kPos = librationK(positive.samples[0].theta, positive.samples[0].thetaDot, n);
    const kZero = librationK(zero.samples[0].theta, zero.samples[0].thetaDot, n);
    expect(Math.abs(kPos - kZero)).toBeGreaterThan(1e-9 * Math.abs(kZero));
    // The balance still holds along the nonzero-rate trajectory.
    const opts = { nRadS: n, length0M: 20_000, rateMS: 1 };
    const points = balanceAlong(positive.samples, { ...opts, fractions: [1] });
    expect(Math.abs(points[0].residual)).toBeLessThan(1e-6 * Math.abs(points[0].integral));
  });
});
