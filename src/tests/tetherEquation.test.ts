/**
 * Tests of the independent equation check.
 *
 * Unlike the convergence tests, nothing here integrates an ODE to make its point: the
 * oracle is Newtonian gravity evaluated at the two end masses, and the comparison is
 * with the documented second-derivative expression. These tests therefore ask whether
 * the EQUATION is right, not whether an integrator solves it consistently.
 */

import { describe, expect, it } from "vitest";
import {
  REFERENCE_RADIUS_M,
  analyticInvariantDefect,
  equationAgreement,
  equationTruncationStudy,
  exactThetaAccel,
  implementedThetaAccel,
  meanMotion,
  truncationBound,
  type PointMassState,
} from "../verification/tetherEquation";
import { MU_EARTH } from "../core/constants";
import { analyticLibration as analyticLibrationSample, exactLibrationPeriod } from "../verification/tetherConvergence";
import { propagateTether } from "../core/tether";

const R0 = REFERENCE_RADIUS_M;
const N0 = meanMotion(R0);
const L_STUDY = 20_000; // the length the convergence study uses
const RATE = 1;

function state(over: Partial<PointMassState> = {}): PointMassState {
  return {
    radiusM: R0,
    lengthM: L_STUDY,
    deploymentRateMS: RATE,
    thetaRad: 0.6,
    thetaDotRadPerS: 2e-4,
    mu: MU_EARTH,
    ...over,
  };
}

describe("exact point-mass force balance", () => {
  it("vanishes at both vertical orientations, where sin(theta)cos(theta) = 0", () => {
    // theta_dot = 0 so that the kinematic 2 (Ldot/L) theta_dot term is also zero: at a
    // vertical equilibrium the whole acceleration must vanish, not just gravity's part.
    for (const theta of [0, Math.PI]) {
      const s = state({ thetaRad: theta, thetaDotRadPerS: 0 });
      expect(exactThetaAccel(s)).toBeLessThan(1e-18);
      expect(Math.abs(implementedThetaAccel(theta, 0, s.lengthM, s.deploymentRateMS, N0))).toBeLessThan(1e-18);
    }
    // With rate non-zero the gravitational part still vanishes, and the exact
    // acceleration is then exactly the kinematic term -2 (Ldot/L) theta_dot.
    const s = state({ thetaRad: 0 });
    const kinematic = (-2 * s.deploymentRateMS * s.thetaDotRadPerS) / s.lengthM;
    expect(Math.abs(exactThetaAccel(s) - kinematic)).toBeLessThan(1e-18);
  });

  it("is antisymmetric in theta, as the equation is", () => {
    // The documented equation is invariant under theta -> -theta taken together with
    // theta'' -> -theta'', so mirroring the geometry must mirror the acceleration.
    const s = state({ thetaDotRadPerS: 0 });
    const a = exactThetaAccel(s);
    const b = exactThetaAccel({ ...s, thetaRad: -s.thetaRad });
    expect(Math.abs(a + b)).toBeLessThan(1e-18);
  });

  it("reproduces the small-angle frequency sqrt(3) n", () => {
    // A 20 m rod keeps the tidal truncation below 1e-10, so the coefficient itself is
    // what is being measured.
    const s = state({ thetaRad: 1e-6, thetaDotRadPerS: 0, lengthM: 20 });
    const ratio = -exactThetaAccel(s) / (s.thetaRad * N0 * N0);
    expect(ratio).toBeCloseTo(3, 8);
    expect(-implementedThetaAccel(1e-6, 0, s.lengthM, RATE, N0) / (1e-6 * N0 * N0)).toBeCloseTo(3, 8);
    // At the study's 20 km length the same ratio includes the measured truncation.
    const atStudyLength = -exactThetaAccel(state({ thetaRad: 1e-6, thetaDotRadPerS: 0 })) / (1e-6 * N0 * N0);
    expect(Math.abs(atStudyLength - 3)).toBeLessThan(1e-4);
    expect(Math.abs(atStudyLength - 3)).toBeGreaterThan(0);
  });
});

describe("the implemented equation is the first-order tidal limit", () => {
  it("agrees with the exact balance, with a difference that falls as (L/r)^2", () => {
    const study = equationTruncationStudy();
    // Monotonically decreasing difference as the rod is shortened.
    for (let i = 1; i < study.length; i++) {
      expect(study[i].normalisedDifference).toBeLessThan(study[i - 1].normalisedDifference);
    }
    // The measured order is reported, not assumed: the leading omitted term is third
    // order in the length but is normalised by 1/L, so the fitted order is 2.
    for (const p of study.slice(1)) {
      expect(p.observedOrder).not.toBeNull();
      expect(p.observedOrder as number).toBeGreaterThan(1.8);
      expect(p.observedOrder as number).toBeLessThan(2.2);
    }
  });

  it("lies inside the bound derived from Taylor's theorem at the study's length", () => {
    const point = equationAgreement(L_STUDY);
    expect(point.normalisedDifference).toBeLessThanOrEqual(truncationBound(point.lengthOverRadius));
    expect(truncationBound(point.lengthOverRadius)).toBeCloseTo((15 / 24) * (L_STUDY / R0) ** 2, 20);
  });

  it("is fully accounted for by the analytic third-order tidal term", () => {
    // Stronger than a bound: the measured difference from exact gravity is the term the
    // expansion drops, including its size and sign. A wrong coefficient anywhere in the
    // implemented equation cannot reproduce this.
    for (const p of equationTruncationStudy()) {
      expect(Number.isFinite(p.explainedFraction)).toBe(true);
      expect(Math.abs(p.explainedFraction - 1)).toBeLessThan(1e-3);
      // And it is not a coincidence of sign: the predicted term is not negligible.
      expect(Math.abs(p.predictedOmittedRadPerS2)).toBeGreaterThan(0);
    }
  });

  it("detects a perturbed coefficient through the explained fraction", () => {
    // Mutate the implemented expression by 1 % and require the explanation to fail,
    // so that the previous test is demonstrably not vacuous.
    const point = equationAgreement(L_STUDY);
    const mutated = point.implementedThetaAccel * 1.01;
    const mutatedDifference = mutated - point.exactThetaAccel;
    const mutatedExplained = -mutatedDifference / point.predictedOmittedRadPerS2;
    expect(Math.abs(point.explainedFraction - 1)).toBeLessThan(1e-3);
    expect(Math.abs(mutatedExplained - 1)).toBeGreaterThan(1e3);
  });

  it("would detect a wrong coefficient or a wrong deployment term", () => {
    // Sensitivity is the point of the check: at L/r = 2.95e-3 the truncation is tiny,
    // so a plausible coding error must stand far above it.
    const point = equationAgreement(L_STUDY);
    const bound = truncationBound(point.lengthOverRadius) * N0 * N0; // rad/s^2
    const theta = 0.6;
    const w = 2e-4;
    const gg = 3 * N0 * N0 * Math.sin(theta) * Math.cos(theta);

    const coefficientError = 0.01 * gg; // 3 -> 3.03
    const deploymentError = 0.1 * (2 * RATE / L_STUDY) * w; // 2 -> 2.2
    expect(coefficientError).toBeGreaterThan(bound * 10);
    expect(deploymentError).toBeGreaterThan(bound * 10);

    // And a missing deployment term entirely (2 -> 0) must stand out still further.
    expect((2 * RATE / L_STUDY) * w).toBeGreaterThan(bound * 10);
    // Sign flip of the gravity-gradient term must also be detected.
    expect(2 * gg).toBeGreaterThan(bound * 10);
    void point;
  });
});

describe("the closed-form reference satisfies the equation's first integral", () => {
  it("keeps K = theta_dot^2/2 - 3 n^2 cos^2(theta)/2 constant to round-off", () => {
    const theta0 = (5 * Math.PI) / 180;
    const T = exactLibrationPeriod(theta0, N0);
    const d = analyticInvariantDefect(theta0, N0, 2.37 * T);
    // Round-off only: a wrong amplitude, phase or rate breaks this identity by many
    // orders of magnitude more than 1e-12.
    expect(d.maxRelativeDrift).toBeLessThan(1e-12);
    expect(d.maxRelativeDrift).toBeGreaterThanOrEqual(0);
  });

  it("would detect a mismatched rate in the closed form", () => {
    // Scaling theta0 is NOT a mutation: the scaled expression is still an exact
    // solution of the same equation with different initial conditions, and K is
    // conserved for any solution. The check has teeth only against a pair (theta,
    // theta_dot) that does not satisfy the identity, so perturb the rate instead.
    const theta0 = (5 * Math.PI) / 180;
    const T = exactLibrationPeriod(theta0, N0);
    const ok = analyticInvariantDefect(theta0, N0, 0.5 * T);
    const K = (theta: number, thetaDot: number): number =>
      (thetaDot * thetaDot) / 2 - 1.5 * N0 * N0 * Math.cos(theta) ** 2;
    const first = analyticLibrationSample(theta0, N0, 0);
    const k0 = K(first.theta, first.thetaDot);
    let worst = 0;
    for (let i = 1; i <= 500; i++) {
      const t = (i / 500) * 0.5 * T;
      const s = analyticLibrationSample(theta0, N0, t);
      // 0.1 % error in the rate alone.
      worst = Math.max(worst, Math.abs(K(s.theta, s.thetaDot * 1.001) - k0) / Math.abs(k0));
    }
    expect(ok.maxRelativeDrift).toBeLessThan(1e-12);
    expect(worst).toBeGreaterThan(1e-6);
  });
});

describe("production equation equals the documented expression", () => {
  it("reproduces the production 8-state libration row exactly for one step", () => {
    // Replicate the documented 8-state right-hand side here, with the documented
    // libration row, and integrate one RK4 step by hand. The production path must
    // produce the same state: this is what links the physics check above to the code
    // that actually runs.
    const stepS = 10;
    const theta0 = 0.6;
    const thetaDot0 = 2e-4;
    const res = propagateTether({
      mu: MU_EARTH,
      positionM: [R0, 0, 0],
      velocityMS: [0, Math.sqrt(MU_EARTH / R0), 0],
      satelliteMassKg: 500,
      orbiterMassKg: 500,
      lengthM: L_STUDY,
      deploymentRateMS: RATE,
      theta0Rad: theta0,
      thetaDot0RadPerS: thetaDot0,
      durationS: stepS,
      stepS,
    });

    const f = (t: number, y: number[]): number[] => {
      const r2 = y[0] ** 2 + y[1] ** 2 + y[2] ** 2;
      const r = Math.sqrt(r2);
      const L = L_STUDY + RATE * t;
      const n = Math.sqrt(MU_EARTH / (r2 * r));
      const k = -MU_EARTH / (r2 * r);
      return [y[3], y[4], y[5], k * y[0], k * y[1], k * y[2], y[7], implementedThetaAccel(y[6], y[7], L, RATE, n)];
    };
    const y0 = [R0, 0, 0, 0, Math.sqrt(MU_EARTH / R0), 0, theta0, thetaDot0];
    const h = stepS;
    const k1 = f(0, y0);
    const k2 = f(h / 2, y0.map((v, i) => v + (h / 2) * k1[i]));
    const k3 = f(h / 2, y0.map((v, i) => v + (h / 2) * k2[i]));
    const k4 = f(h, y0.map((v, i) => v + h * k3[i]));
    const yf = y0.map((v, i) => v + (h / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]));

    const prodTheta = (res.series.thetaDeg[1] * Math.PI) / 180;
    const prodRate = (res.series.thetaRateDegPerS[1] * Math.PI) / 180;
    expect(Math.abs(prodTheta - yf[6])).toBeLessThan(1e-14);
    expect(Math.abs(prodRate - yf[7])).toBeLessThan(1e-16);
  });
});
