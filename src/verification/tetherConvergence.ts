/**
 * Tether convergence study (verification, not simulation).
 *
 * Two cases are run through the production RK4 path at successively halved steps,
 * with the physical initial conditions and the final time held fixed:
 *
 *   TC-1  Constant-length in-plane libration on a circular orbit.
 *         Closed-form reference: theta(t) = arcsin(k sn(sqrt(3) n t + K, k)) with
 *         k = sin(theta0), i.e. the exact Jacobi-elliptic solution of the non-linear
 *         pendulum form of the implemented equation. Exact for constant n and L.
 *
 *   TC-2  Prescribed deployment: L(t) = L0 + Ldot t, so the implemented equation
 *         carries the 2 (Ldot/L) theta_dot term. No closed-form solution exists for
 *         a time-varying coefficient, so the reference is a NUMERICAL one: adaptive
 *         Dormand-Prince 5(4) on the SAME 2-state equation, initial conditions,
 *         deployment history and final time as the isolated metric. It is called a
 *         numerical reference everywhere, never "exact".
 *
 * Epistemic status of the reference error: EMPIRICAL ESTIMATE, NOT A BOUND
 * -------------------------------------------------------------------------
 * The reference-error quantity is the largest observed difference between the
 * adopted reference and other independently constructed solutions (two DOPRI5
 * tolerances and an RK4 Richardson limit). That is an EMPIRICAL ESTIMATE. It is not a
 * proven upper bound on the true error, and this code does not claim one.
 *
 * Why no rigorous bound is claimed here (investigated, not dismissed):
 *
 *   1. Validated interval / Taylor-model integration would give a sound enclosure,
 *      but requires outward-rounded interval arithmetic for +,-,*,/, sin and cos, plus
 *      Taylor-model remainders. ECMAScript does not require Math.sin/Math.cos/Math.asin
 *      to be correctly rounded (it specifies implementation-approximated results), so
 *      even the elementary-function layer would need a certified implementation. A
 *      from-scratch enclosure that has not itself been validated cannot be labelled
 *      rigorous without overclaiming.
 *   2. A defect-control + Gronwall bound needs a continuous approximate solution with
 *      a rigorous defect bound AND an amplification factor. The plain Lipschitz
 *      constant of the first-order system is 1 s^-1 (the theta_dot row), so
 *      exp(Lf*T) = exp(6900) is vacuous. A sharpened bound needs a weighted energy
 *      norm and a proven logarithmic-norm bound along the trajectory, which again
 *      requires validated interval evaluation of the trajectory.
 *   3. An a priori truncation bound for DOPRI5 needs bounds on the sixth derivative
 *      along the true solution plus the method's exact error coefficients. Such a
 *      bound is expected to be far looser than the finest measured RK4 error divided
 *      by the adequacy threshold, which would make the study UNRESOLVED rather than
 *      provide useful evidence.
 *
 * The honest consequence, enforced in the types, the UI, the export and the tests: the
 * quantity is named `empiricalError*`, carries `errorKind: "EMPIRICAL_ESTIMATE"`, and
 * an exported artifact that claims RIGOROUS_BOUND or VALIDATED_ENCLOSURE is rejected.
 *
 * Separation of error sources
 * ---------------------------
 * Every refinement point reports two independent quantities:
 *   (1) the reference-ORBIT error of the two-body centre of mass against the
 *       analytic Kepler circular orbit, and
 *   (2) the TETHER-state error in theta and theta_dot against the reference.
 * Because the orbit enters the libration equation only through n(t) = sqrt(mu/r^3),
 * the tether error is additionally recomputed with a 2-state RK4 integration that
 * uses the analytic (error-free) mean motion. The difference between the coupled
 * and isolated errors is the measured orbit-coupling contribution; it is reported,
 * not assumed to be negligible.
 *
 * Order estimation is a generalised Richardson estimate
 *     p_k = ln(e_(k-1) / e_k) / ln(h_(k-1) / h_k)
 * so it does not assume a halving ratio or an order in advance. Acceptance
 * criteria are fixed before the measurement (see ACCEPTANCE below) and a case that
 * reaches the round-off floor is reported UNRESOLVED rather than PASS.
 */

import { MU_EARTH, R_EARTH } from "../core/constants";
import { IntegrationError, integrateDOPRI5, integrateRK4, type DerivFunc } from "../core/integrators";
import { completeEllipticK, jacobiAmplitude } from "../core/elliptic";
import { propagateTether } from "../core/tether";
import { keplerPropagate } from "../core/twobody";
import { norm, type Vec3 } from "../core/vec";
import { TETHER_MODEL_ID, TETHER_MODEL_VERSION } from "../models/tether";

export const CONVERGENCE_SCHEMA_VERSION = "otl-tether-convergence-v2";

export type ConvergenceStatus = "PASS" | "FAIL" | "UNRESOLVED";

export interface RefinementPoint {
  stepS: number;
  steps: number;
  /** |theta_num - theta_ref| at the final time, radians. */
  thetaErrRad: number;
  /** Same error divided by the initial angular displacement (dimensionless). */
  thetaErrRel: number;
  /** |theta_dot_num - theta_dot_ref| at the final time, rad/s. */
  thetaRateErrRadPerS: number;
  /** Same error divided by sqrt(3) n0 theta0, the small-angle rate scale. */
  thetaRateErrRel: number;
  /** Reference-orbit position error at the final time, metres. */
  orbitPositionErrM: number;
  /** Reference-orbit position error relative to |r0|. */
  orbitPositionErrRel: number;
  /**
   * Tether error from the 2-state integration with analytic mean motion. This is the
   * primary convergence metric: it removes reference-orbit error from the measured
   * tether-integration error.
   */
  isolatedThetaErrRad: number;
  isolatedThetaRateErrRadPerS: number;
  thetaRatio: number | null;
  thetaRateRatio: number | null;
  isolatedThetaRatio: number | null;
  isolatedThetaRateRatio: number | null;
  thetaOrder: number | null;
  thetaRateOrder: number | null;
  isolatedThetaOrder: number | null;
  isolatedThetaRateOrder: number | null;
  /**
   * Coupled-minus-isolated difference: the measured contribution of reference-orbit
   * error to the tether state. A negative value means the two errors partially
   * cancel; it is reported rather than assumed negligible.
   */
  orbitCouplingDeltaRad: number;
}

export interface ConvergenceAcceptance {
  criterion: string;
  tolerance: string;
  justification: string;
  status: ConvergenceStatus;
  reasons: string[];
}

/** One independent comparison against the adopted reference solution. */
export interface ReferenceEstimate {
  label: string;
  thetaDifferenceRad: number;
  thetaRateDifferenceRadPerS: number;
}

/**
 * Epistemic status of the reference-error quantity.
 *
 * Only EMPIRICAL_ESTIMATE is produced by this build. The other members exist so that
 * export/import can NAME and REJECT a claim of rigour that this code does not
 * establish. See the module header for why no rigorous bound is claimed.
 */
export type ReferenceErrorKind = "EMPIRICAL_ESTIMATE" | "VALIDATED_ENCLOSURE" | "RIGOROUS_BOUND";

export const REFERENCE_ERROR_KIND: ReferenceErrorKind = "EMPIRICAL_ESTIMATE";

export interface ConvergenceReference {
  kind: "ANALYTIC_CLOSED_FORM" | "NUMERICAL_ADAPTIVE";
  /** Always REFERENCE_ERROR_KIND in this build; exported so a reader can check the claim. */
  errorKind: ReferenceErrorKind;
  method: string;
  equation: string;
  validation: string;
  /**
   * Every independent comparison against the adopted reference. The reported
   * empirical estimate for each component is the LARGEST of these differences, so a
   * single accidental agreement cannot make the reference look better than it is.
   */
  estimates: ReferenceEstimate[];
  /**
   * EMPIRICAL reference-error estimate for the angular displacement, radians.
   * Definition: max over `estimates` of |theta_comparison - theta_adopted|.
   * NOT a proven upper bound on the true error.
   */
  empiricalErrorThetaRad: number;
  /**
   * EMPIRICAL reference-error estimate for the angular rate, rad/s.
   * Definition: max over `estimates` of |theta_dot_comparison - theta_dot_adopted|.
   * NOT a proven upper bound on the true error.
   */
  empiricalErrorThetaRateRadPerS: number;
  /** Adopted reference endpoint values, so an independent reviewer can re-derive errors. */
  adoptedThetaRad: number;
  adoptedThetaRateRadPerS: number;
  /** Exact definition of the adequacy ratio, stated once and used for both components. */
  adequacyMetric: string;
  /** finest isolated theta error / empiricalErrorThetaRad */
  adequacyTheta: number | null;
  /** finest isolated theta_dot error / empiricalErrorThetaRateRadPerS */
  adequacyThetaRate: number | null;
  /** min of the two component ratios; null if either is not computable */
  adequacyRatioMin: number | null;
  adequacyCriterion: string;
  /** What the empirical estimate covers, and what it cannot cover. */
  covers: string[];
  doesNotCover: string[];
  limitations: string;
}

export interface ConvergenceCase {
  caseId: "TC-1" | "TC-2";
  title: string;
  description: string;
  modelId: string;
  modelVersion: string;
  equation: string;
  initialConditions: Record<string, number>;
  parameters: Record<string, number>;
  durationS: number;
  reference: ConvergenceReference;
  solver: { method: string; settings: string };
  points: RefinementPoint[];
  /**
   * Observed orders from the finest refinement interval. `null` means the order could
   * not be computed (zero, negative or non-finite error). It is never encoded as
   * -Infinity: that would serialise to null and is rejected by the canonicaliser used
   * for payload hashing.
   */
  observedOrder: {
    theta: number | null;
    thetaRate: number | null;
    isolatedTheta: number | null;
    isolatedThetaRate: number | null;
  };
  orbitErrorOrder: number | null;
  acceptance: ConvergenceAcceptance;
  assumptions: string[];
  limitations: string;
  notes: string[];
}

export interface ConvergenceStudy {
  schemaVersion: typeof CONVERGENCE_SCHEMA_VERSION;
  generatedAtUtc: string;
  model: { id: string; version: string };
  purpose: string;
  orderEstimator: string;
  roundOffFloorRel: number;
  /** How reference error is established in this study. Always EMPIRICAL_ESTIMATE here. */
  referenceErrorKind: ReferenceErrorKind;
  /** Plain-language statement of what that status does and does not mean. */
  referenceErrorStatement: string;
  overallStatus: ConvergenceStatus;
  cases: ConvergenceCase[];
  limitations: string[];
}

/** Pre-registered acceptance thresholds. Not adjusted after seeing results. */
export const ACCEPTANCE = {
  /** Order floor for the isolated tether-integration metrics (primary evidence). */
  minOrder: 3.5,
  /**
   * Order floor for the as-executed (coupled) angle error. It is lower on purpose:
   * the reference-orbit error is itself O(h^4) and measurably cancels part of the
   * tether truncation error, so the coupled slope cannot be held to the same floor
   * without pretending the two error sources are independent.
   */
  coupledMinOrder: 3.0,
  roundOffFloorRel: 1e-12,
  referenceAdequacyRatioMin: 100,
  maxRatioUpperBound: 40,
  minRatioLowerBound: 8,
} as const;

export interface ConvergenceConfig {
  stepsS: number[];
  theta0ADeg: number;
  durationLibrationPeriods: number;
  lengthM: number;
  satelliteMassKg: number;
  orbiterMassKg: number;
  deploymentRateMS: number;
  theta0BDeg: number;
  durationBS: number;
  relTolReference: number;
  absTolReference: number;
  relTolReferenceCoarse: number;
  absTolReferenceCoarse: number;
  initialStepS: number;
}

export const DEFAULT_CONVERGENCE_CONFIG: ConvergenceConfig = {
  stepsS: [240, 120, 60, 30],
  theta0ADeg: 5,
  // Deliberately NOT an integer number of libration periods. At an exact integer the
  // phase error returns the angle to its turning point, where dtheta/dphi = 0 and the
  // leading O(h^4) phase error is hidden to first order; the measured order then
  // spuriously rises to about 5. 2.37 periods keeps both theta and theta_dot
  // sensitive to the phase error at first order.
  durationLibrationPeriods: 2.37,
  lengthM: 20_000,
  satelliteMassKg: 500,
  orbiterMassKg: 500,
  deploymentRateMS: 1,
  theta0BDeg: 2,
  // 6900 s spans about 2.15 small-angle libration periods, again avoiding a turning
  // point at the final time.
  durationBS: 6900,
  relTolReference: 1e-12,
  absTolReference: 1e-15,
  relTolReferenceCoarse: 1e-10,
  absTolReferenceCoarse: 1e-12,
  initialStepS: 30,
};

const R0 = R_EARTH + 400e3;
const V_CIRC = Math.sqrt(MU_EARTH / R0);
const POSITION: Vec3 = [R0, 0, 0];
const VELOCITY: Vec3 = [0, V_CIRC, 0];

export class ConvergenceConfigError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "ConvergenceConfigError";
  }
}

/** Validate a study configuration. Invalid input is rejected, never repaired. */
export function validateConvergenceConfig(cfg: ConvergenceConfig): void {
  if (!Array.isArray(cfg.stepsS) || cfg.stepsS.length < 3) {
    throw new ConvergenceConfigError(
      "INSUFFICIENT_REFINEMENTS",
      "A convergence study needs at least three refinement levels to estimate an order.",
    );
  }
  for (const h of cfg.stepsS) {
    if (!Number.isFinite(h) || h <= 0) {
      throw new ConvergenceConfigError("INVALID_STEP", `Every step size must be finite and positive; received ${h}.`);
    }
  }
  for (let i = 1; i < cfg.stepsS.length; i++) {
    if (!(cfg.stepsS[i] < cfg.stepsS[i - 1])) {
      throw new ConvergenceConfigError(
        "STEPS_NOT_REFINED",
        `Step sizes must decrease strictly (coarse to fine); received ${cfg.stepsS.join(", ")} s.`,
      );
    }
  }
  if (!(cfg.durationLibrationPeriods > 0) || !(cfg.durationBS > 0)) {
    throw new ConvergenceConfigError("INVALID_DURATION", "Durations must be positive.");
  }
  if (!(cfg.theta0ADeg > 0) || cfg.theta0ADeg >= 90) {
    throw new ConvergenceConfigError("INVALID_AMPLITUDE", "TC-1 initial amplitude must satisfy 0 < theta0 < 90 deg.");
  }
  if (!(cfg.theta0BDeg > 0) || cfg.theta0BDeg >= 90) {
    throw new ConvergenceConfigError("INVALID_AMPLITUDE", "TC-2 initial amplitude must satisfy 0 < theta0 < 90 deg.");
  }
  if (!(cfg.lengthM > 0)) {
    throw new ConvergenceConfigError("INVALID_TETHER_LENGTH", "Tether length must be positive.");
  }
  if (!(cfg.deploymentRateMS >= 0) || !Number.isFinite(cfg.deploymentRateMS)) {
    throw new ConvergenceConfigError("INVALID_DEPLOYMENT_RATE", "Deployment rate must be finite and non-negative.");
  }
  if (!(cfg.satelliteMassKg > 0) || !(cfg.orbiterMassKg > 0)) {
    throw new ConvergenceConfigError("INVALID_MASS", "Both end masses must be positive.");
  }
  for (const tol of [cfg.relTolReference, cfg.absTolReference, cfg.relTolReferenceCoarse, cfg.absTolReferenceCoarse]) {
    if (!(tol > 0) || !Number.isFinite(tol)) {
      throw new ConvergenceConfigError("INVALID_TOLERANCE", "Reference tolerances must be positive and finite.");
    }
  }
  // Validity regime of the implemented model: first order in L/r, so L/r <= 0.05.
  const maxL = cfg.lengthM + cfg.deploymentRateMS * cfg.durationBS;
  if (maxL / R0 > 0.05) {
    throw new ConvergenceConfigError(
      "OUTSIDE_MODEL_REGIME",
      `Prescribed length reaches L/r = ${(maxL / R0).toFixed(4)} > 0.05, outside the validity limit of the dumbbell model.`,
    );
  }
}

/** p_k = ln(e_(k-1)/e_k) / ln(h_(k-1)/h_k), for a strictly refined step sequence. */
export function estimateOrders(steps: number[], errors: number[]): (number | null)[] {
  if (steps.length !== errors.length) {
    throw new ConvergenceConfigError("LENGTH_MISMATCH", "Step and error arrays must have equal length.");
  }
  // The first refinement level has no preceding error, so the result is aligned with
  // the input: out[k] is the order observed between levels k-1 and k.
  const out: (number | null)[] = [null];
  for (let k = 1; k < errors.length; k++) {
    if (!(steps[k] < steps[k - 1]) || !(errors[k] > 0) || !(errors[k - 1] > 0)) {
      out.push(null);
      continue;
    }
    out.push(Math.log(errors[k - 1] / errors[k]) / Math.log(steps[k - 1] / steps[k]));
  }
  return out;
}

/**
 * Closed-form libration angle and rate theta0 (rad) on a circular orbit of mean
 * motion n, at time t. Uses the exact non-linear solution, not a small-angle one.
 */
export function analyticLibration(theta0Rad: number, nRadS: number, tS: number): { theta: number; thetaDot: number } {
  const u0 = 2 * theta0Rad;
  const k = Math.sin(u0 / 2);
  const K = completeEllipticK(k);
  const omega = Math.sqrt(3) * nRadS;
  const { sn, cn, dn } = jacobiAmplitude(K + omega * tS, k);
  const u = 2 * Math.asin(Math.min(1, Math.max(-1, k * sn)));
  const cosHalf = Math.cos(u / 2);
  const uDot = cosHalf === 0 ? 0 : (2 * omega * k * cn * dn) / cosHalf;
  return { theta: u / 2, thetaDot: uDot / 2 };
}

/** Libration period implied by the exact solution at amplitude theta0. */
export function exactLibrationPeriod(theta0Rad: number, nRadS: number): number {
  const K = completeEllipticK(Math.sin(theta0Rad));
  return (4 * K) / (Math.sqrt(3) * nRadS);
}

interface EndState {
  theta: number;
  thetaDot: number;
}

interface AdaptiveEndState extends EndState {
  steps: number;
  rejected: number;
}

interface CaseConfig {
  theta0Rad: number;
  durationS: number;
  deploymentRateMS: number;
  lengthM: number;
}

/**
 * Right-hand side of the 2-state tether equation with a PRESCRIBED mean motion:
 *     theta'' + 2 (Ldot/L) theta_dot + 3 n^2 sin(theta) cos(theta) = 0
 * This is the same tether equation the production engine integrates, with the
 * reference orbit replaced by its exact circular mean motion. Both the reference
 * solution and the isolated convergence metric use this equation, so they differ
 * only in the numerical method — reference-orbit error cannot enter either.
 */
function twoStateRhs(nRadS: number, lengthM: number, rate: number): DerivFunc {
  return (t, y, out) => {
    const L = lengthM + rate * t;
    if (!(L > 0)) throw new IntegrationError("TETHER_LENGTH_NONPOSITIVE", "Prescribed length became non-positive.");
    out[0] = y[1];
    out[1] = -3 * nRadS * nRadS * Math.sin(y[0]) * Math.cos(y[0]) - (2 * rate) / L * y[1];
  };
}

/** 2-state fixed-step RK4 solution, used for the isolated metric and for Richardson. */
function integrateTwoStateRK4(caseCfg: CaseConfig, nRadS: number, stepS: number): EndState {
  let last: Float64Array | null = null;
  const stats = integrateRK4(
    twoStateRhs(nRadS, caseCfg.lengthM, caseCfg.deploymentRateMS),
    new Float64Array([caseCfg.theta0Rad, 0]),
    caseCfg.durationS,
    {
      stepS,
      maxSteps: 5_000_000,
      onSample: (_t, y) => {
        last = new Float64Array(y);
      },
    },
  );
  if (stats.steps === 0 || last === null) throw new IntegrationError("NO_STEPS", "Isolated integration produced no steps.");
  const y = last as Float64Array;
  return { theta: y[0], thetaDot: y[1] };
}

/** 2-state adaptive DOPRI5 solution used as the numerical reference for TC-2. */
function integrateTwoStateAdaptive(
  caseCfg: CaseConfig,
  nRadS: number,
  relTol: number,
  absTol: number,
  initialStepS: number,
): AdaptiveEndState {
  let last: Float64Array | null = null;
  const stats = integrateDOPRI5(
    twoStateRhs(nRadS, caseCfg.lengthM, caseCfg.deploymentRateMS),
    new Float64Array([caseCfg.theta0Rad, 0]),
    caseCfg.durationS,
    {
      relTol,
      absTol,
      initialStepS: Math.min(initialStepS, caseCfg.durationS),
      maxStepS: caseCfg.durationS,
      minStepS: 1e-6,
      maxSteps: 5_000_000,
      onSample: (_t, y) => {
        last = new Float64Array(y);
      },
    },
  );
  if (last === null) throw new IntegrationError("NO_STEPS", "Adaptive reference produced no accepted steps.");
  const y = last as Float64Array;
  return { theta: y[0], thetaDot: y[1], steps: stats.accepted, rejected: stats.rejected };
}

/**
 * Richardson extrapolation of the fourth-order RK4 sequence: with errors C h^4 + O(h^5),
 *     R = y(h/2) + (y(h/2) - y(h)) / (2^4 - 1)
 * removes the leading term. Used only as an independent cross-check of the adopted
 * reference, never as the reference itself.
 */
function richardsonRK4(caseCfg: CaseConfig, nRadS: number, coarseStepS: number): EndState {
  const coarse = integrateTwoStateRK4(caseCfg, nRadS, coarseStepS);
  const fine = integrateTwoStateRK4(caseCfg, nRadS, coarseStepS / 2);
  return {
    theta: fine.theta + (fine.theta - coarse.theta) / 15,
    thetaDot: fine.thetaDot + (fine.thetaDot - coarse.thetaDot) / 15,
  };
}

function estimate(
  label: string,
  a: EndState,
  b: EndState,
): ReferenceEstimate {
  return {
    label,
    thetaDifferenceRad: Math.abs(a.theta - b.theta),
    thetaRateDifferenceRadPerS: Math.abs(a.thetaDot - b.thetaDot),
  };
}

function empiricalErrorsFrom(estimates: ReferenceEstimate[]): { theta: number; thetaRate: number } {
  return {
    theta: Math.max(...estimates.map((e) => e.thetaDifferenceRad)),
    thetaRate: Math.max(...estimates.map((e) => e.thetaRateDifferenceRadPerS)),
  };
}

/**
 * Component adequacy, defined once and used for both components:
 *
 *     adequacy = (finest isolated RK4 error for the component)
 *                / (empirical reference-error estimate for the same component)
 *
 * Returns null when the ratio is not computable or not meaningful: a non-finite
 * error, a non-positive or non-finite estimate, or a negative error. A zero finest
 * error is a real value and yields 0, which correctly fails the adequacy criterion
 * instead of producing Infinity.
 */
export function componentAdequacy(finestError: number, referenceEstimate: number): number | null {
  if (!Number.isFinite(finestError) || !Number.isFinite(referenceEstimate)) return null;
  if (finestError < 0 || referenceEstimate <= 0) return null;
  return finestError / referenceEstimate;
}

function ratioAndOrder(
  steps: number[],
  errors: number[],
): { ratios: (number | null)[]; orders: (number | null)[] } {
  const orders = estimateOrders(steps, errors);
  const ratios = errors.map((e, i) => (i === 0 ? null : e === 0 ? null : errors[i - 1] / e));
  return { ratios, orders };
}

interface MetricSpec {
  label: string;
  /** Which reference residual this metric is compared against for adequacy. */
  component: "theta" | "thetaRate";
  value: (p: RefinementPoint) => number;
  ratio: (p: RefinementPoint) => number | null;
  order: (p: RefinementPoint) => number | null;
  rel: (p: RefinementPoint) => number;
  minOrder: number;
  applyRatioBand: boolean;
}

function checkMetric(
  points: RefinementPoint[],
  reference: ConvergenceReference,
  spec: MetricSpec,
): { status: ConvergenceStatus; reasons: string[] } {
  const reasons: string[] = [];
  const values = points.map(spec.value);
  const orders = points.map(spec.order);
  const finestRel = spec.rel(points[points.length - 1]);

  for (let i = 1; i < points.length; i++) {
    if (!(values[i] < values[i - 1])) {
      reasons.push(
        `${spec.label}: error did not decrease from h = ${points[i - 1].stepS} s to h = ${points[i].stepS} s ` +
          `(${values[i - 1].toExponential(3)} → ${values[i].toExponential(3)}); refinement is not in the asymptotic regime.`,
      );
    }
  }
  const measured = Math.min(...orders.slice(-2).map((o) => (o === null ? Number.NEGATIVE_INFINITY : o)));
  if (!(measured >= spec.minOrder)) {
    reasons.push(
      `${spec.label}: observed order ${Number.isFinite(measured) ? measured.toFixed(3) : "n/a"} is below the required ${spec.minOrder}.`,
    );
  }
  if (spec.applyRatioBand) {
    for (const r of points.map(spec.ratio).slice(1)) {
      if (r === null) {
        reasons.push(`${spec.label}: an error ratio could not be formed (zero or non-finite error).`);
      } else if (r < ACCEPTANCE.minRatioLowerBound || r > ACCEPTANCE.maxRatioUpperBound) {
        reasons.push(
          `${spec.label}: error ratio ${r.toFixed(2)} lies outside the pre-registered band ` +
            `[${ACCEPTANCE.minRatioLowerBound}, ${ACCEPTANCE.maxRatioUpperBound}] expected for a fourth-order method under step halving.`,
        );
      }
    }
  }
  const estimate =
    spec.component === "theta" ? reference.empiricalErrorThetaRad : reference.empiricalErrorThetaRateRadPerS;
  const adequacy = spec.component === "theta" ? reference.adequacyTheta : reference.adequacyThetaRate;
  const unit = spec.component === "theta" ? "rad" : "rad/s";

  // An unusable or insufficient reference estimate is a limitation of the EVIDENCE,
  // not a failure of the implementation, so it resolves to UNRESOLVED below.
  if (adequacy === null) {
    return {
      status: "UNRESOLVED",
      reasons: [
        ...reasons,
        `${spec.label}: reference adequacy is not computable (empirical reference-error estimate ` +
          `${Number.isFinite(estimate) ? estimate.toExponential(3) + " " + unit : "non-finite"}).`,
      ],
    };
  }
  if (adequacy < ACCEPTANCE.referenceAdequacyRatioMin) {
    reasons.push(
      `${spec.label}: EMPIRICAL reference-error estimate for this component is ${estimate.toExponential(3)} ${unit} ` +
        `(not a proven bound), giving adequacy ${adequacy.toExponential(3)}; ` +
        `${ACCEPTANCE.referenceAdequacyRatioMin}x below the finest measured error is required.`,
    );
    // Also UNRESOLVED: the measurement is limited by reference quality, not failed.
    return { status: "UNRESOLVED", reasons };
  }

  // Round-off floor: a relative error this small cannot be attributed to truncation.
  if (finestRel < ACCEPTANCE.roundOffFloorRel) {
    return {
      status: "UNRESOLVED",
      reasons: [
        ...reasons,
        `${spec.label}: finest relative error ${finestRel.toExponential(3)} is below the ${ACCEPTANCE.roundOffFloorRel} round-off floor, so the measured slope cannot be attributed to truncation.`,
      ],
    };
  }
  if (!Number.isFinite(finestRel)) {
    return { status: "UNRESOLVED", reasons: [...reasons, `${spec.label}: error scale is not finite.`] };
  }
  return { status: reasons.length === 0 ? "PASS" : "FAIL", reasons };
}

function buildCase(
  cfg: ConvergenceConfig,
  caseId: "TC-1" | "TC-2",
  caseCfg: CaseConfig,
  reference: EndState,
  referenceBase: Omit<
    ConvergenceReference,
    "adoptedThetaRad" | "adoptedThetaRateRadPerS" | "adequacyTheta" | "adequacyThetaRate" | "adequacyRatioMin"
  >,
  extraNotes: string[],
): ConvergenceCase {
  const n0 = Math.sqrt(MU_EARTH / R0 ** 3);
  const points: RefinementPoint[] = [];

  for (const stepS of cfg.stepsS) {
    const res = propagateTether({
      mu: MU_EARTH,
      positionM: POSITION,
      velocityMS: VELOCITY,
      satelliteMassKg: cfg.satelliteMassKg,
      orbiterMassKg: cfg.orbiterMassKg,
      lengthM: caseCfg.lengthM,
      deploymentRateMS: caseCfg.deploymentRateMS,
      theta0Rad: caseCfg.theta0Rad,
      thetaDot0RadPerS: 0,
      durationS: caseCfg.durationS,
      stepS,
    });
    const i = res.series.t.length - 1;
    const theta = (res.series.thetaDeg[i] * Math.PI) / 180;
    const thetaDot = (res.series.thetaRateDegPerS[i] * Math.PI) / 180;
    const rNum: Vec3 = [res.series.x[i], res.series.y[i], res.series.z[i]];
    const kep = keplerPropagate(MU_EARTH, POSITION, VELOCITY, res.series.t[i]);
    if (!kep) throw new ConvergenceConfigError("REFERENCE_ORBIT_UNAVAILABLE", "Analytic circular-orbit reference unavailable.");
    const orbitPositionErrM = norm([rNum[0] - kep.positionM[0], rNum[1] - kep.positionM[1], rNum[2] - kep.positionM[2]]);

    const isolated = integrateTwoStateRK4(caseCfg, n0, stepS);

    const rateScale = Math.sqrt(3) * n0 * caseCfg.theta0Rad;
    points.push({
      stepS,
      steps: res.steps,
      thetaErrRad: Math.abs(theta - reference.theta),
      thetaErrRel: Math.abs(theta - reference.theta) / caseCfg.theta0Rad,
      thetaRateErrRadPerS: Math.abs(thetaDot - reference.thetaDot),
      thetaRateErrRel: Math.abs(thetaDot - reference.thetaDot) / rateScale,
      orbitPositionErrM,
      orbitPositionErrRel: orbitPositionErrM / R0,
      isolatedThetaErrRad: Math.abs(isolated.theta - reference.theta),
      isolatedThetaRateErrRadPerS: Math.abs(isolated.thetaDot - reference.thetaDot),
      thetaRatio: null,
      thetaRateRatio: null,
      isolatedThetaRatio: null,
      isolatedThetaRateRatio: null,
      thetaOrder: null,
      thetaRateOrder: null,
      isolatedThetaOrder: null,
      isolatedThetaRateOrder: null,
      orbitCouplingDeltaRad: Math.abs(theta - reference.theta) - Math.abs(isolated.theta - reference.theta),
    });
  }

  const steps = points.map((p) => p.stepS);
  const thetaFit = ratioAndOrder(steps, points.map((p) => p.thetaErrRad));
  const rateFit = ratioAndOrder(steps, points.map((p) => p.thetaRateErrRadPerS));
  const isolatedFit = ratioAndOrder(steps, points.map((p) => p.isolatedThetaErrRad));
  const isolatedRateFit = ratioAndOrder(steps, points.map((p) => p.isolatedThetaRateErrRadPerS));
  points.forEach((p, i) => {
    p.thetaRatio = thetaFit.ratios[i];
    p.thetaOrder = thetaFit.orders[i];
    p.thetaRateRatio = rateFit.ratios[i];
    p.thetaRateOrder = rateFit.orders[i];
    p.isolatedThetaRatio = isolatedFit.ratios[i];
    p.isolatedThetaOrder = isolatedFit.orders[i];
    p.isolatedThetaRateRatio = isolatedRateFit.ratios[i];
    p.isolatedThetaRateOrder = isolatedRateFit.orders[i];
  });
  const lastIndex = points.length - 1;
  const finiteOrNull = (v: number | null | undefined): number | null =>
    v === null || v === undefined || !Number.isFinite(v) ? null : v;
  const observedOrder = {
    theta: finiteOrNull(points[lastIndex].thetaOrder),
    thetaRate: finiteOrNull(points[lastIndex].thetaRateOrder),
    isolatedTheta: finiteOrNull(points[lastIndex].isolatedThetaOrder),
    isolatedThetaRate: finiteOrNull(points[lastIndex].isolatedThetaRateOrder),
  };
  const orbitErrorOrder = finiteOrNull(estimateOrders(steps, points.map((p) => p.orbitPositionErrM)).slice(-1)[0]);

  const finest = points[lastIndex];
  const adequacyTheta = componentAdequacy(finest.isolatedThetaErrRad, referenceBase.empiricalErrorThetaRad);
  const adequacyThetaRate = componentAdequacy(
    finest.isolatedThetaRateErrRadPerS,
    referenceBase.empiricalErrorThetaRateRadPerS,
  );
  const adequacyRatioMin =
    adequacyTheta === null || adequacyThetaRate === null ? null : Math.min(adequacyTheta, adequacyThetaRate);
  const refWithAdequacy: ConvergenceReference = {
    ...referenceBase,
    adoptedThetaRad: reference.theta,
    adoptedThetaRateRadPerS: reference.thetaDot,
    adequacyTheta,
    adequacyThetaRate,
    adequacyRatioMin,
  };

  const isolatedTheta: MetricSpec = {
    label: "isolated theta (tether-only integration)",
    component: "theta",
    value: (p) => p.isolatedThetaErrRad,
    ratio: (p) => p.isolatedThetaRatio,
    order: (p) => p.isolatedThetaOrder,
    rel: (p) => p.isolatedThetaErrRad / caseCfg.theta0Rad,
    minOrder: ACCEPTANCE.minOrder,
    applyRatioBand: true,
  };
  const isolatedRate: MetricSpec = {
    label: "isolated theta_dot (tether-only integration)",
    component: "thetaRate",
    value: (p) => p.isolatedThetaRateErrRadPerS,
    ratio: (p) => p.isolatedThetaRateRatio,
    order: (p) => p.isolatedThetaRateOrder,
    rel: (p) => p.isolatedThetaRateErrRadPerS / (Math.sqrt(3) * n0 * caseCfg.theta0Rad),
    minOrder: ACCEPTANCE.minOrder,
    applyRatioBand: true,
  };
  const coupledTheta: MetricSpec = {
    label: "as-executed theta (coupled reference orbit)",
    component: "theta",
    value: (p) => p.thetaErrRad,
    ratio: (p) => p.thetaRatio,
    order: (p) => p.thetaOrder,
    rel: (p) => p.thetaErrRel,
    minOrder: ACCEPTANCE.coupledMinOrder,
    applyRatioBand: false,
  };

  const primary = [checkMetric(points, refWithAdequacy, isolatedTheta), checkMetric(points, refWithAdequacy, isolatedRate)];
  const coupled = checkMetric(points, refWithAdequacy, coupledTheta);
  const all = [...primary, coupled];
  const status: ConvergenceStatus = all.some((r) => r.status === "FAIL")
    ? "FAIL"
    : all.some((r) => r.status === "UNRESOLVED")
      ? "UNRESOLVED"
      : "PASS";

  const acceptance: ConvergenceAcceptance = {
    criterion:
      "Primary (tether-only) metrics: theta and theta_dot errors must decrease monotonically under step refinement, the observed order on the last two refinement intervals must be at least " +
      `${ACCEPTANCE.minOrder}, each error ratio must lie in [${ACCEPTANCE.minRatioLowerBound}, ${ACCEPTANCE.maxRatioUpperBound}]. The as-executed coupled theta error must also decrease monotonically with observed order at least ` +
      `${ACCEPTANCE.coupledMinOrder}. Reference adequacy is evaluated separately for theta and theta_dot, each as ` +
      `(finest isolated error for that component) / (EMPIRICAL reference-error estimate for the same component), and both must be at least ${ACCEPTANCE.referenceAdequacyRatioMin}. ` +
      "If the empirical reference-error estimate is inadequate or not computable, the case is UNRESOLVED rather than PASS or FAIL, because the limitation is in the evidence rather than in the implementation.",
    tolerance:
      `order >= ${ACCEPTANCE.minOrder} (isolated), order >= ${ACCEPTANCE.coupledMinOrder} (coupled); ` +
      `ratio in [${ACCEPTANCE.minRatioLowerBound}, ${ACCEPTANCE.maxRatioUpperBound}] (isolated only); ` +
      `adequacy_theta >= ${ACCEPTANCE.referenceAdequacyRatioMin} and adequacy_theta_dot >= ${ACCEPTANCE.referenceAdequacyRatioMin}`,
    justification:
      "Classical RK4 has global order 4, so the expected ratio under halving is 2^4 = 16. The 3.5 order floor and the 8-40 ratio band admit asymptotic approach and modest round-off noise while excluding orders 1-3 that would indicate a coding error. The coupled floor is lower because the reference-orbit error is itself O(h^4) and is measured to partially cancel the tether truncation error, so the coupled slope cannot be treated as a clean single-source measurement. The adequacy ratio prevents a conclusion that is limited by the reference rather than by the method under test; it uses an empirical estimate, so it inherits that estimate's status — it does not prove the true reference error is below the stated level.",
    status,
    reasons: status === "PASS" ? [] : all.flatMap((r) => r.reasons),
  };

  return {
    caseId,
    title:
      caseId === "TC-1"
        ? "Constant-length in-plane libration on a circular orbit"
        : "Prescribed deployment with time-varying tether length",
    description:
      caseId === "TC-1"
        ? "Fixed length L, circular reference orbit, no deployment. Isolates the gravity-gradient libration equation and its integration."
        : "Length prescribed as L(t) = L0 + Ldot t, adding the 2 (Ldot/L) theta_dot kinematic term. No closed-form solution exists for this case.",
    modelId: TETHER_MODEL_ID,
    modelVersion: TETHER_MODEL_VERSION,
    equation:
      caseId === "TC-1"
        ? "theta'' = -3 n^2 sin(theta) cos(theta), n = sqrt(mu/r^3) with r from the two-body reference orbit; L constant."
        : "theta'' + 2 (Ldot/L) theta_dot + 3 n^2 sin(theta) cos(theta) = 0, L(t) = L0 + Ldot t.",
    initialConditions: {
      radiusM: R0,
      speedMS: V_CIRC,
      theta0Rad: caseCfg.theta0Rad,
      thetaDot0RadPerS: 0,
      muM3S2: MU_EARTH,
    },
    parameters: {
      lengthM: caseCfg.lengthM,
      deploymentRateMS: caseCfg.deploymentRateMS,
      satelliteMassKg: cfg.satelliteMassKg,
      orbiterMassKg: cfg.orbiterMassKg,
      durationS: caseCfg.durationS,
    },
    durationS: caseCfg.durationS,
    reference: refWithAdequacy,
    solver: {
      method: "RK4",
      settings: `Fixed-step classical RK4 in the production propagateTether path, steps ${cfg.stepsS.join(", ")} s, 8-state [r, v, theta, theta_dot]`,
    },
    points,
    observedOrder,
    orbitErrorOrder,
    acceptance,
    assumptions: [
      "Massless rigid rod, two point masses, in-plane libration only.",
      "One-way coupling: the tether does not react on the centre-of-mass orbit.",
      "Constant local mean motion approximation for the gravity-gradient torque.",
      "Physical initial conditions and the final time are identical at every refinement level; only the step changes.",
    ],
    limitations:
      (caseId === "TC-1"
        ? "The closed-form reference is exact only for constant n and constant L; the propagated orbit is not exactly circular, so a small orbit-coupling contribution remains and is reported separately."
        : "The reference is numerical, not exact: adaptive DOPRI5 on the 2-state equation, with the reference-error quantity being the largest of three independent comparisons (two tolerances and an RK4 Richardson limit). That quantity is an empirical estimate, not a proven bound, because DOPRI5 provides no a priori global error bound and no validated enclosure is computed. No closed-form solution exists for a time-varying coefficient.") +
      " Order convergence shows that the implemented equations are solved consistently; it does not validate the physical model against flight data.",
    notes: extraNotes,
  };
}

/**
 * Execute the full study. Results are cached per configuration so the verification
 * registry and the interface do not each pay for the computation; pass force = true
 * to re-execute.
 */
let cached: { key: string; study: ConvergenceStudy } | null = null;

export function clearConvergenceCache(): void {
  cached = null;
}

export function runTetherConvergence(
  cfg: ConvergenceConfig = DEFAULT_CONVERGENCE_CONFIG,
  force = false,
): ConvergenceStudy {
  validateConvergenceConfig(cfg);
  const key = JSON.stringify(cfg);
  if (!force && cached && cached.key === key) return cached.study;

  const n0 = Math.sqrt(MU_EARTH / R0 ** 3);
  const theta0A = (cfg.theta0ADeg * Math.PI) / 180;
  const theta0B = (cfg.theta0BDeg * Math.PI) / 180;
  const periodA = exactLibrationPeriod(theta0A, n0);
  const durationA = cfg.durationLibrationPeriods * periodA;

  const caseA: CaseConfig = {
    theta0Rad: theta0A,
    durationS: durationA,
    deploymentRateMS: 0,
    lengthM: cfg.lengthM,
  };
  const caseB: CaseConfig = {
    theta0Rad: theta0B,
    durationS: cfg.durationBS,
    deploymentRateMS: cfg.deploymentRateMS,
    lengthM: cfg.lengthM,
  };

  // ---------------- reference solutions and empirical error estimates ----------------
  //
  // Every reference is cross-checked against at least two independent constructions and
  // the reported EMPIRICAL estimate is the LARGEST observed difference per component. A
  // single comparison can agree by accident (this is exactly what happened when TC-2's
  // coupled rtol 1e-12 and 1e-10 runs happened to land 1.1e-14 rad apart while an
  // independent Richardson limit placed the reference error near 1.2e-13 rad), so one
  // pair is not treated as an estimate at all.
  //
  // This is an estimate, not a bound: see the module header for why no rigorous bound
  // is available at reasonable cost here.
  const dopriTight = (c: CaseConfig) =>
    integrateTwoStateAdaptive(c, n0, cfg.relTolReference, cfg.absTolReference, cfg.initialStepS);
  const richardsonStep = cfg.stepsS[cfg.stepsS.length - 1];

  // TC-1: exact closed-form reference. Cross-checks: adaptive DOPRI5 at two tolerances
  // and an RK4 Richardson limit, all on the same 2-state equation.
  const refA: EndState = analyticLibration(theta0A, n0, durationA);
  const aTight = dopriTight(caseA);
  const aLooser = integrateTwoStateAdaptive(
    caseA,
    n0,
    cfg.relTolReferenceCoarse,
    cfg.absTolReferenceCoarse,
    cfg.initialStepS,
  );
  const aRichardson = richardsonRK4(caseA, n0, richardsonStep);
  const estA = [
    estimate(`DOPRI5 rtol ${cfg.relTolReference} (${aTight.steps} accepted steps) vs closed form`, aTight, refA),
    estimate(`DOPRI5 rtol ${cfg.relTolReferenceCoarse} (${aLooser.steps} accepted steps) vs closed form`, aLooser, refA),
    estimate(`RK4 Richardson limit (h = ${richardsonStep}/${richardsonStep / 2} s) vs closed form`, aRichardson, refA),
  ];
  const resA = empiricalErrorsFrom(estA);

  // TC-2: no closed form. The adopted reference is adaptive DOPRI5 on the SAME 2-state
  // equation used by the isolated metric, at the tightest tolerance. Cross-checks:
  // two other tolerances and an RK4 Richardson limit (independent method).
  const refB: EndState = dopriTight(caseB);
  const bLooser = integrateTwoStateAdaptive(
    caseB,
    n0,
    cfg.relTolReferenceCoarse,
    cfg.absTolReferenceCoarse,
    cfg.initialStepS,
  );
  const bMid = integrateTwoStateAdaptive(caseB, n0, 1e-11, 1e-13, cfg.initialStepS);
  const bRichardson = richardsonRK4(caseB, n0, richardsonStep);
  const estB = [
    estimate(`DOPRI5 rtol ${cfg.relTolReferenceCoarse} (${bLooser.steps} accepted steps) vs adopted reference`, bLooser, refB),
    estimate(`DOPRI5 rtol 1e-11 (${bMid.steps} accepted steps) vs adopted reference`, bMid, refB),
    estimate(`RK4 Richardson limit (h = ${richardsonStep}/${richardsonStep / 2} s) vs adopted reference`, bRichardson, refB),
  ];
  const resB = empiricalErrorsFrom(estB);

  const adequacyMetric =
    "adequacy_component = (finest isolated RK4 error for that component) / (EMPIRICAL reference-error estimate for the same component); " +
    "adequacyRatioMin = min(adequacy_theta, adequacy_theta_dot). The estimate is the largest observed difference across the listed independent comparisons. " +
    "It is not a proven upper bound, so adequacy is evidence-strength, not a guarantee that the true reference error is below the stated level.";

  const covers = [
    "Agreement of the adopted reference with two independently toleranced DOPRI5 solutions of the same 2-state equation.",
    "Agreement with an RK4 Richardson limit at the finest study step and half that step (a different method and order).",
    "Truncation of the reference method at the final time, to the extent these three comparisons expose it.",
  ];
  const doesNotCover = [
    "No proven upper bound: the maximum observed difference is not a bound on the true error.",
    "Common-mode error shared by all DOPRI5 runs (e.g. a wrong but consistently implemented right-hand side) is invisible to tolerance comparisons.",
    "Floating-point rounding inside the reference is not bounded analytically.",
    "Error growth between the sampled final time and the rest of the interval is not characterised beyond the final-time comparisons.",
    "The coupled 8-state orbit path is not the reference; its difference from the isolated solution is reported separately.",
  ];

  const refBaseA: Omit<
    ConvergenceReference,
    "adoptedThetaRad" | "adoptedThetaRateRadPerS" | "adequacyTheta" | "adequacyThetaRate" | "adequacyRatioMin"
  > = {
    kind: "ANALYTIC_CLOSED_FORM",
    errorKind: REFERENCE_ERROR_KIND,
    method:
      "Exact Jacobi-elliptic solution of the non-linear pendulum form: sin(theta) = k sn(sqrt(3) n t + K(k), k), k = sin(theta0), evaluated by descending Landen (AGM) recursion.",
    equation: "theta'' = -3 n^2 sin(theta) cos(theta) with constant n and L.",
    validation:
      "The closed form is evaluated and then compared at the final time with two independently toleranced DOPRI5 runs and an RK4 Richardson limit on the same 2-state equation; the largest per-component difference is reported as an empirical estimate of the closed-form evaluation/truncation error. For TC-1 the comparison is against a formula, so agreement measures the formula's numerical evaluation, not its mathematical exactness for the stated equation.",
    estimates: estA,
    empiricalErrorThetaRad: resA.theta,
    empiricalErrorThetaRateRadPerS: resA.thetaRate,
    adequacyMetric,
    adequacyCriterion: `adequacy_theta >= ${ACCEPTANCE.referenceAdequacyRatioMin} and adequacy_theta_dot >= ${ACCEPTANCE.referenceAdequacyRatioMin}`,
    covers,
    doesNotCover,
    limitations:
      "Exact in closed form only for constant n and L. The reported quantity is still an empirical estimate of the numerical evaluation error, not a proof. It is not a reference for the coupled 8-state orbit; that comparison carries a small orbit-coupling difference reported separately.",
  };

  const refBaseB: Omit<
    ConvergenceReference,
    "adoptedThetaRad" | "adoptedThetaRateRadPerS" | "adequacyTheta" | "adequacyThetaRate" | "adequacyRatioMin"
  > = {
    kind: "NUMERICAL_ADAPTIVE",
    errorKind: REFERENCE_ERROR_KIND,
    method:
      `Adaptive Dormand-Prince 5(4) on the 2-state tether equation at rtol ${cfg.relTolReference}, atol ${cfg.absTolReference} (${dopriTight(caseB).steps} accepted steps); not an exact solution.`,
    equation: "theta'' + 2 (Ldot/L) theta_dot + 3 n^2 sin(theta) cos(theta) = 0, L(t) = L0 + Ldot t, with the exact circular mean motion n.",
    validation:
      "Compared at the final time with two independently toleranced DOPRI5 runs and an RK4 Richardson limit on the same 2-state equation; the largest per-component difference is reported as an EMPIRICAL estimate of the reference error. The adopted reference is NUMERICAL, not exact, and no rigorous enclosure is computed.",
    estimates: estB,
    empiricalErrorThetaRad: resB.theta,
    empiricalErrorThetaRateRadPerS: resB.thetaRate,
    adequacyMetric,
    adequacyCriterion: `adequacy_theta >= ${ACCEPTANCE.referenceAdequacyRatioMin} and adequacy_theta_dot >= ${ACCEPTANCE.referenceAdequacyRatioMin}`,
    covers,
    doesNotCover,
    limitations:
      "A numerical reference supports the error of the method under test only down to its own (estimated) error. The estimate is the maximum observed disagreement with two other DOPRI5 tolerances and one RK4 Richardson limit; it is not a proven bound, and common-mode error in the reference method is not detectable this way.",
  };

  const notesA = [
    `Duration is ${cfg.durationLibrationPeriods} exact libration periods at the initial amplitude: T = 4K(k)/(sqrt(3) n) = ${periodA.toFixed(3)} s, versus the small-angle value ${((2 * Math.PI) / (Math.sqrt(3) * n0)).toFixed(3)} s.`,
    "The isolated (2-state, analytic mean motion) integration isolates tether-integration error from reference-orbit error; both orders are reported.",
    "The reference-error quantity is an EMPIRICAL estimate from three independent comparisons, not a proven bound.",
  ];
  const notesB = [
    `Length grows from ${cfg.lengthM} m to ${(cfg.lengthM + cfg.deploymentRateMS * cfg.durationBS).toFixed(0)} m at ${cfg.deploymentRateMS} m/s; L/r reaches ${((cfg.lengthM + cfg.deploymentRateMS * cfg.durationBS) / R0).toExponential(3)}.`,
    "Deployment is PRESCRIBED: reel dynamics, actuator torque, tether elasticity and damping are not modelled. Agreement between refinements therefore says nothing about deployment transients.",
    "Reference/metric consistency: the adopted reference and the isolated metric integrate the SAME 2-state equation (theta'' + 2(Ldot/L)theta_dot + 3n^2 sin(theta)cos(theta) = 0), the same theta0 = theta_dot0 = 0 conditions, the same L0 and Ldot history and the same final time T, both with the exact circular mean motion n0. The reference differs from the isolated metric only in the numerical method (adaptive DOPRI5 vs fixed-step RK4).",
    "Difference from the as-executed path: the production 8-state engine uses n(t) = sqrt(mu/|r(t)|^3) from the numerically integrated orbit instead of the exact n0. That one-way coupling difference is reported per refinement level as orbitCouplingDeltaRad and the orbit position error; it is not mixed into the reference comparison.",
    `Reference cross-checks at the final time: ` +
      estB.map((e) => `${e.label.split(" (")[0]} → Δθ ${e.thetaDifferenceRad.toExponential(2)}, Δθ̇ ${e.thetaRateDifferenceRadPerS.toExponential(2)}`).join("; ") +
      ".",
  ];

  const cases = [
    buildCase(cfg, "TC-1", caseA, refA, refBaseA, notesA),
    buildCase(cfg, "TC-2", caseB, refB, refBaseB, notesB),
  ];

  const overallStatus: ConvergenceStatus = cases.some((c) => c.acceptance.status === "FAIL")
    ? "FAIL"
    : cases.every((c) => c.acceptance.status === "PASS")
      ? "PASS"
      : "UNRESOLVED";

  const study: ConvergenceStudy = {
    schemaVersion: CONVERGENCE_SCHEMA_VERSION,
    generatedAtUtc: new Date().toISOString(),
    model: { id: TETHER_MODEL_ID, version: TETHER_MODEL_VERSION },
    purpose:
      "Measure the observed order of accuracy of the tether integration under step refinement, with an explicit reference for each case and an explicit separation of reference-orbit error from tether-state error.",
    orderEstimator: "p_k = ln(e_(k-1)/e_k) / ln(h_(k-1)/h_k), evaluated from measured final-time errors; no order is assumed.",
    roundOffFloorRel: ACCEPTANCE.roundOffFloorRel,
    referenceErrorKind: REFERENCE_ERROR_KIND,
    referenceErrorStatement:
      "The reference error is an EMPIRICAL ESTIMATE (largest observed disagreement across independent numerical constructions). It is NOT a proven upper bound, NOT a validated interval enclosure, and NOT a rigorous bound. No validated enclosure is computed in this build; see the module header for the methods considered and why they were not adopted.",
    overallStatus,
    cases,
    limitations: [
      "Order convergence verifies numerical consistency of the implemented equations, not physical validity, flight performance or mission data agreement.",
      "Both cases use a prescribed length history with one-way orbital coupling; dynamically solved deployment and fully coupled spacecraft-tether mechanics are NOT modelled and are not verified here.",
      "Energy and angular momentum of the tether subsystem are not conserved under prescribed length change and no conservation claim is made.",
    ],
  };

  cached = { key, study };
  return study;
}
