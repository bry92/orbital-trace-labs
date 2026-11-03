/**
 * Tests of the tether convergence study: order estimation, measured convergence of
 * both cases, invalid configuration rejection, and export/import integrity.
 *
 * These tests assert on MEASURED values produced by executing the engine. They do
 * not encode expected error magnitudes; they check the structural and numerical
 * properties the study claims.
 */

import { describe, expect, it } from "vitest";
import {
  ACCEPTANCE,
  DEFAULT_CONVERGENCE_CONFIG,
  REFERENCE_ERROR_KIND,
  ConvergenceConfigError,
  componentAdequacy,
  estimateOrders,
  exactLibrationPeriod,
  analyticLibration,
  runTetherConvergence,
  validateConvergenceConfig,
  type ConvergenceConfig,
} from "../verification/tetherConvergence";
import { MU_EARTH, R_EARTH } from "../core/constants";

const cfg = DEFAULT_CONVERGENCE_CONFIG;
const R0 = R_EARTH + 400e3;
const N0 = Math.sqrt(MU_EARTH / R0 ** 3);

/**
 * Independent check of the reference-error estimate, written in this test file from
 * the documented equation rather than by calling the study's own machinery:
 *
 *     theta'' + 2 (Ldot/L) theta' + 3 n0^2 sin(theta) cos(theta) = 0
 *
 * integrated with plain RK4 at a step several times finer than the study's finest, so
 * its truncation error is expected to be fainter than the adopted reference's. The
 * test does not assume that: it asserts that |independent - adopted reference| is not
 * LARGER than the reported empirical estimate by more than a small factor, which is
 * what "largest observed difference" would fail to deliver if the estimate were
 * fabricated or computed for the wrong equation.
 */
function independentRK4(theta0: number, T: number, length0: number, rate: number, stepS: number) {
  let th = theta0;
  let w = 0;
  const f = (t: number, yTh: number, yW: number): [number, number] => {
    const L = length0 + rate * t;
    return [yW, -3 * N0 * N0 * Math.sin(yTh) * Math.cos(yTh) - (2 * rate * yW) / L];
  };
  let t = 0;
  const n = Math.round(T / stepS);
  const h = T / n;
  for (let i = 0; i < n; i++) {
    const k1 = f(t, th, w);
    const k2 = f(t + h / 2, th + (h / 2) * k1[0], w + (h / 2) * k1[1]);
    const k3 = f(t + h / 2, th + (h / 2) * k2[0], w + (h / 2) * k2[1]);
    const k4 = f(t + h, th + h * k3[0], w + h * k3[1]);
    th += (h / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]);
    w += (h / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]);
    t += h;
  }
  return { theta: th, thetaDot: w };
}

describe("order estimation", () => {
  it("recovers a known fourth-order sequence", () => {
    const steps = [80, 40, 20, 10];
    const errors = steps.map((h) => 1e-3 * (h / 80) ** 4);
    const orders = estimateOrders(steps, errors);
    expect(orders[0]).toBeNull();
    for (const o of orders.slice(1)) expect(Math.abs((o as number) - 4)).toBeLessThan(1e-12);
  });

  it("recovers a fifth-order sequence and non-halving ratios", () => {
    const steps = [90, 30, 10];
    const errors = steps.map((h) => 2e-2 * (h / 90) ** 5);
    const orders = estimateOrders(steps, errors).slice(1) as number[];
    expect(orders.length).toBe(2);
    for (const o of orders) expect(Math.abs(o - 5)).toBeLessThan(1e-10);
  });

  it("returns null instead of a fabricated order for invalid input pairs", () => {
    expect(estimateOrders([10, 10], [1e-3, 1e-4])[1]).toBeNull(); // not refined
    expect(estimateOrders([20, 10], [1, 0])[1]).toBeNull(); // zero error
    expect(estimateOrders([20, 10], [0, 1e-4])[1]).toBeNull(); // zero coarse error
  });

  it("rejects mismatched arrays", () => {
    expect(() => estimateOrders([10, 5], [1e-3])).toThrow(ConvergenceConfigError);
  });
});

describe("configuration validation", () => {
  const base = { ...DEFAULT_CONVERGENCE_CONFIG };

  it("rejects too few refinement levels, bad steps and unordered steps", () => {
    expect(() => validateConvergenceConfig({ ...base, stepsS: [60, 30] })).toThrow(/at least three/);
    expect(() => validateConvergenceConfig({ ...base, stepsS: [120, 60, 0] })).toThrow(/finite and positive/);
    expect(() => validateConvergenceConfig({ ...base, stepsS: [60, 120, 30] })).toThrow(/decrease strictly/);
    expect(() => validateConvergenceConfig({ ...base, stepsS: [60, 60, 30] })).toThrow(/decrease strictly/);
  });

  it("rejects invalid physical inputs", () => {
    expect(() => validateConvergenceConfig({ ...base, theta0ADeg: 0 })).toThrow(/amplitude/);
    expect(() => validateConvergenceConfig({ ...base, theta0BDeg: 95 })).toThrow(/amplitude/);
    expect(() => validateConvergenceConfig({ ...base, durationBS: -1 })).toThrow(/positive/);
    expect(() => validateConvergenceConfig({ ...base, lengthM: 0 })).toThrow(/length must be positive/);
    expect(() => validateConvergenceConfig({ ...base, deploymentRateMS: -0.5 })).toThrow(/non-negative/);
    expect(() => validateConvergenceConfig({ ...base, satelliteMassKg: 0 })).toThrow(/masses must be positive/);
    expect(() => validateConvergenceConfig({ ...base, relTolReference: 0 })).toThrow(/tolerances/);
  });

  it("rejects a configuration outside the stated model validity limit", () => {
    expect(() => validateConvergenceConfig({ ...base, lengthM: 400_000 })).toThrow(/OUTSIDE_MODEL_REGIME|L\/r/);
  });

  it("does not repair a rejected configuration", () => {
    const bad: ConvergenceConfig = { ...base, stepsS: [0, 0, 0] };
    expect(() => runTetherConvergence(bad, true)).toThrow(ConvergenceConfigError);
  });
});

describe("measured convergence of the tether equations", () => {
  // One execution of the study, reused by the assertions below.
  const study = runTetherConvergence(cfg, true);

  it("runs both cases at every refinement level", () => {
    expect(study.cases.map((c) => c.caseId)).toEqual(["TC-1", "TC-2"]);
    for (const c of study.cases) {
      expect(c.points.length).toBe(cfg.stepsS.length);
      expect(c.points.map((p) => p.stepS)).toEqual(cfg.stepsS);
      for (const p of c.points) {
        expect(p.steps).toBeGreaterThan(0);
        expect(Number.isFinite(p.thetaErrRad)).toBe(true);
        expect(Number.isFinite(p.isolatedThetaErrRad)).toBe(true);
      }
    }
  });

  it("fixes physical initial conditions and final time across refinements", () => {
    for (const c of study.cases) {
      const uniq = new Set(c.points.map((p) => p.stepS));
      expect(uniq.size).toBe(c.points.length);
      expect(c.initialConditions.theta0Rad).toBeGreaterThan(0);
      expect(c.initialConditions.thetaDot0RadPerS).toBe(0);
      expect(c.durationS).toBeGreaterThan(0);
    }
    // TC-1 duration is the exact non-linear libration period times 2.37, not an
    // integer number of periods (which would hide the leading phase error).
    expect(cfg.durationLibrationPeriods % 1).not.toBe(0);
  });

  it("shows fourth-order convergence inside the pre-registered criteria", () => {
    for (const c of study.cases) {
      const orders = c.points.map((p) => p.isolatedThetaOrder).filter((o): o is number => o !== null);
      const lastTwo = orders.slice(-2);
      expect(lastTwo.length).toBe(2);
      expect(Math.min(...lastTwo)).toBeGreaterThanOrEqual(ACCEPTANCE.minOrder);
      for (const o of lastTwo) expect(o).toBeLessThan(5.5);
      // error ratios consistent with 2^4 = 16
      for (const r of c.points.map((p) => p.isolatedThetaRatio).slice(1)) {
        expect(r).not.toBeNull();
        expect(r as number).toBeGreaterThan(ACCEPTANCE.minRatioLowerBound);
        expect(r as number).toBeLessThan(ACCEPTANCE.maxRatioUpperBound);
      }
      expect(c.acceptance.status).toBe("PASS");
    }
    expect(study.overallStatus).toBe("PASS");
  });

  it("keeps each reference component more accurate than the finest matching measurement", () => {
    for (const c of study.cases) {
      const finest = c.points[c.points.length - 1];
      // The metric is exactly: finest isolated error for the component / empirical
      // estimate for the same component. It must hold for theta AND theta_dot.
      expect(c.reference.adequacyTheta).toBeCloseTo(
        finest.isolatedThetaErrRad / c.reference.empiricalErrorThetaRad,
        10,
      );
      expect(c.reference.adequacyThetaRate).toBeCloseTo(
        finest.isolatedThetaRateErrRadPerS / c.reference.empiricalErrorThetaRateRadPerS,
        10,
      );
      expect(c.reference.adequacyTheta).toBeGreaterThanOrEqual(ACCEPTANCE.referenceAdequacyRatioMin);
      expect(c.reference.adequacyThetaRate).toBeGreaterThanOrEqual(ACCEPTANCE.referenceAdequacyRatioMin);
      expect(c.reference.adequacyRatioMin).toBe(
        Math.min(c.reference.adequacyTheta as number, c.reference.adequacyThetaRate as number),
      );
      expect(c.reference.empiricalErrorThetaRad).toBeGreaterThan(0);
      expect(c.reference.empiricalErrorThetaRateRadPerS).toBeGreaterThan(0);
      expect(c.reference.adequacyMetric).toMatch(/finest isolated/i);
    }
    expect(study.cases[0].reference.kind).toBe("ANALYTIC_CLOSED_FORM");
    expect(study.cases[1].reference.kind).toBe("NUMERICAL_ADAPTIVE");
    expect(study.cases[1].reference.method).toMatch(/Dormand/);
    // TC-2's reference solves the same 2-state equation as the isolated metric.
    expect(study.cases[1].reference.method).toMatch(/2-state/);
  });

  it("derives each estimate from several independent comparisons, not one pair", () => {
    for (const c of study.cases) {
      expect(c.reference.estimates.length).toBeGreaterThanOrEqual(3);
      const maxTheta = Math.max(...c.reference.estimates.map((e) => e.thetaDifferenceRad));
      const maxRate = Math.max(...c.reference.estimates.map((e) => e.thetaRateDifferenceRadPerS));
      expect(c.reference.empiricalErrorThetaRad).toBe(maxTheta);
      expect(c.reference.empiricalErrorThetaRateRadPerS).toBe(maxRate);
      // An estimate of exactly zero would mean the comparisons are not independent.
      expect(maxTheta).toBeGreaterThan(0);
      expect(maxRate).toBeGreaterThan(0);
    }
  });

  it("is validated by an independently coded integration of the documented equation", () => {
    for (const c of study.cases) {
      // 1/8 of the finest study step: this integrator's own error should be far below
      // the reference's, so it can expose a reference error of the reported size.
      const independent = independentRK4(
        c.initialConditions.theta0Rad,
        c.durationS,
        c.parameters.lengthM,
        c.parameters.deploymentRateMS,
        c.points[c.points.length - 1].stepS / 8,
      );
      const dTheta = Math.abs(independent.theta - c.reference.adoptedThetaRad);
      const dRate = Math.abs(independent.thetaDot - c.reference.adoptedThetaRateRadPerS);
      // The estimate is a largest observed difference, so an independent solution may
      // disagree by at most a modest multiple of it; it must not disagree by orders of
      // magnitude more, which would mean the estimate describes a different problem.
      expect(dTheta).toBeLessThan(c.reference.empiricalErrorThetaRad * 20);
      expect(dRate).toBeLessThan(c.reference.empiricalErrorThetaRateRadPerS * 20);
    }
  });

  it("states the empirical status of the reference error and claims nothing stronger", () => {
    expect(study.referenceErrorKind).toBe("EMPIRICAL_ESTIMATE");
    expect(study.referenceErrorKind).toBe(REFERENCE_ERROR_KIND);
    expect(study.referenceErrorStatement).toMatch(/NOT a proven upper bound/i);
    for (const c of study.cases) {
      expect(c.reference.errorKind).toBe("EMPIRICAL_ESTIMATE");
      expect(c.reference.doesNotCover.join(" ")).toMatch(/no proven upper bound/i);
    }
  });

  it("reports the reference-orbit error separately from the tether-state error", () => {
    for (const c of study.cases) {
      for (const p of c.points) {
        expect(p.orbitPositionErrRel).toBeGreaterThan(0);
        expect(p.orbitPositionErrRel).toBeLessThan(p.thetaErrRel * 100);
      }
      // The measured orbit-error slope is reported and is close to fourth order.
      expect(c.orbitErrorOrder).not.toBeNull();
      expect(c.orbitErrorOrder as number).toBeGreaterThan(3.5);
      // Coupling contributes a measurable, signed difference at every level.
      expect(c.points.some((p) => p.orbitCouplingDeltaRad !== 0)).toBe(true);
    }
  });

  it("does not claim conservation or coupled dynamics it does not model", () => {
    expect(study.limitations.join(" ")).toMatch(/not conserved|no conservation/i);
    expect(study.limitations.join(" ")).toMatch(/not modelled|NOT modelled/i);
    for (const c of study.cases) {
      expect(c.assumptions.join(" ")).toMatch(/one-way/i);
      expect(c.limitations).toMatch(/does not validate the physical model/i);
    }
  });

  it("is deterministic: a forced re-execution reproduces every measured value", () => {
    const again = runTetherConvergence(cfg, true);
    for (let i = 0; i < study.cases.length; i++) {
      for (let k = 0; k < study.cases[i].points.length; k++) {
        expect(again.cases[i].points[k].isolatedThetaErrRad).toBe(study.cases[i].points[k].isolatedThetaErrRad);
        expect(again.cases[i].points[k].thetaErrRad).toBe(study.cases[i].points[k].thetaErrRad);
        expect(again.cases[i].points[k].steps).toBe(study.cases[i].points[k].steps);
      }
    }
  });

  it("caches one execution per configuration until cleared", () => {
    const a = runTetherConvergence(cfg);
    const b = runTetherConvergence(cfg);
    expect(a).toBe(b); // same object: no recomputation
  });

  it("analytic helper agrees with the exact period definition", () => {
    const theta0 = (5 * Math.PI) / 180;
    const n = 1.1308e-3;
    const T = exactLibrationPeriod(theta0, n);
    const a = analyticLibration(theta0, n, 0);
    const b = analyticLibration(theta0, n, T);
    expect(Math.abs(a.theta - theta0)).toBeLessThan(1e-12);
    expect(Math.abs(b.theta - theta0)).toBeLessThan(1e-10);
  });
});

describe("reference adequacy arithmetic", () => {
  it("divides the finest isolated error by the same component's estimate", () => {
    expect(componentAdequacy(3e-9, 3e-12)).toBeCloseTo(1000, 6);
    // A zero finest error is a real measurement: it yields 0 and fails adequacy, it
    // does not become Infinity.
    expect(componentAdequacy(0, 1e-12)).toBe(0);
  });

  it("returns null, never a number, when the ratio would be meaningless", () => {
    expect(componentAdequacy(1e-9, 0)).toBeNull(); // zero estimate: no scale
    expect(componentAdequacy(1e-9, -1e-12)).toBeNull(); // negative estimate
    expect(componentAdequacy(Number.NaN, 1e-12)).toBeNull();
    expect(componentAdequacy(1e-9, Number.POSITIVE_INFINITY)).toBeNull();
    expect(componentAdequacy(-1e-9, 1e-12)).toBeNull(); // negative error
  });
});

describe("status when the reference is not good enough", () => {
  it("reports UNRESOLVED rather than PASS or FAIL when adequacy is too low", () => {
    // A deliberately loose reference: its own error is comparable to or larger than
    // the finest measured integration error, so the study cannot resolve the order.
    const weak = {
      ...cfg,
      relTolReference: 1e-6,
      absTolReference: 1e-12,
      relTolReferenceCoarse: 1e-4,
      absTolReferenceCoarse: 1e-10,
    };
    const s = runTetherConvergence(weak, true);
    for (const c of s.cases) {
      expect(c.reference.adequacyRatioMin).not.toBeNull();
      expect(c.reference.adequacyRatioMin as number).toBeLessThan(ACCEPTANCE.referenceAdequacyRatioMin);
      // Evidence-limited, not implementation-failed.
      expect(c.acceptance.status).toBe("UNRESOLVED");
      expect(c.acceptance.reasons.join(" ")).toMatch(/adequacy/i);
    }
    expect(s.overallStatus).toBe("UNRESOLVED");
    // The measured errors themselves are unchanged by weakening the reference.
    const good = runTetherConvergence(cfg, true);
    expect(s.cases[0].points.map((p) => p.isolatedThetaErrRad)).toEqual(good.cases[0].points.map((p) => p.isolatedThetaErrRad));
    // Restore the cached default study for any later test in this file.
    runTetherConvergence(cfg, true);
  });
});
