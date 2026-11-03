/**
 * Independent verification of the LIBRATION EQUATION, not of an integrator.
 *
 * The convergence study compares several numerical solutions of the same right-hand
 * side. All of them share that right-hand side, so a wrong coefficient in the equation
 * would be invisible to those comparisons. This module checks the equation against
 * physics derived by a different route:
 *
 *   (a) EXACT POINT-MASS FORCE BALANCE. Two point masses joined by a massless rod of
 *       prescribed length L(t), their centre of mass on a circular reference orbit of
 *       radius r_c and rate n. The constraint force acts along the rod, so it has no
 *       component perpendicular to it. Projecting the relative acceleration onto the
 *       perpendicular direction therefore eliminates the unknown tension:
 *
 *           L theta'' + 2 Ldot theta_dot = [ g(r2) - g(r1) ] . e_perp
 *
 *       with g(r) = -mu r / |r|^3 evaluated EXACTLY at both end masses. Nothing here
 *       integrates an ODE and nothing here reuses the implemented right-hand side.
 *
 *       Expanding the right-hand side to first order in L/r_c about the centre of
 *       mass gives, with e = cos(theta) r_hat + sin(theta) t_hat,
 *
 *           [g(r2) - g(r1)] . e_perp = -3 n^2 L sin(theta) cos(theta) + O(n^2 L (L/r)^3)
 *
 *       so the implemented equation
 *
 *           theta'' = -3 n^2 sin(theta) cos(theta) - 2 (Ldot/L) theta_dot
 *
 *       is recovered, including the coefficient 3 and the 2 (Ldot/L) term. The
 *       difference from the exact balance is therefore a TRUNCATION of the tidal
 *       expansion. Rather than merely bounding it, the leading omitted term is derived
 *       exactly (`omittedTidalThetaAccel`) and the measured difference is compared with
 *       it: if the implemented coefficients are right, the whole discrepancy from exact
 *       gravity is that term, and nothing else. The fall with L/r is measured too
 *       (`equationTruncationStudy`), so a difference that is not the documented
 *       truncation cannot pass by being merely small.
 *
 *   (b) FIRST INTEGRAL of the constant-length equation. For constant n and L,
 *       multiplying theta'' = -3 n^2 sin(theta) cos(theta) by theta_dot gives
 *
 *           K = theta_dot^2 / 2 - (3/2) n^2 cos^2(theta),     dK/dt = 0 exactly.
 *
 *       Sampling the closed-form Jacobi-elliptic reference at many times and checking
 *       that K is constant verifies that the analytic reference is a genuine solution
 *       of the stated equation, independently of every integrator in the codebase.
 *
 * What this establishes and what it does not
 * ------------------------------------------
 * It establishes that the implemented coefficients (3, and 2 for Ldot/L), their signs
 * and their n^2 scaling match Newtonian point-mass gravity in the documented limit,
 * and that the analytic reference satisfies the equation's first integral. It does NOT
 * validate the physical model: the dumbbell is massless-rod, in-plane, prescribed-length,
 * one-way coupled, and real tether dynamics (flexibility, out-of-plane motion, reel
 * dynamics, atmospheric drag, electrodynamics) is not represented.
 */

import { MU_EARTH, R_EARTH } from "../core/constants";
import { analyticLibration } from "./tetherConvergence";

export interface PointMassState {
  /** Circular reference-orbit radius, metres. */
  radiusM: number;
  /** Tether length at the instant, metres. Must be positive. */
  lengthM: number;
  /** Prescribed length rate, m/s. */
  deploymentRateMS: number;
  /** Libration angle from the local vertical, radians. */
  thetaRad: number;
  /** Libration rate, rad/s. */
  thetaDotRadPerS: number;
  /** Central-body gravitational parameter, m^3/s^2. */
  mu: number;
}

export const REFERENCE_RADIUS_M = R_EARTH + 400e3;

/** Circular mean motion at a radius. */
export function meanMotion(radiusM: number, mu: number = MU_EARTH): number {
  return Math.sqrt(mu / radiusM ** 3);
}

/**
 * The implemented equation, written out here as the object under test:
 *
 *     theta'' = -3 n^2 sin(theta) cos(theta) - 2 (Ldot/L) theta'
 *
 * This is the same expression as `src/core/tether.ts` integrates. It is duplicated on
 * purpose: the point of the module is to compare a documented expression against an
 * independent physical derivation, so sharing code would defeat the check. A test
 * asserts this expression reproduces the production 8-state derivative's libration row.
 */
export function implementedThetaAccel(thetaRad: number, thetaDotRadPerS: number, lengthM: number, rate: number, n: number): number {
  return -3 * n * n * Math.sin(thetaRad) * Math.cos(thetaRad) - (2 * rate) / lengthM * thetaDotRadPerS;
}

/**
 * Exact perpendicular acceleration from Newtonian gravity at both end masses.
 *
 * Basis: r_hat points from the central body to the centre of mass; t_hat is the
 * in-plane along-track direction (z_hat x r_hat). The tether direction is
 * e = cos(theta) r_hat + sin(theta) t_hat and e_perp = -sin(theta) r_hat + cos(theta) t_hat.
 *
 * Returns theta'' obtained from the exact gravity difference, including the kinematic
 * 2 (Ldot/L) theta_dot term that comes from differentiating rho = L e:
 *
 *     rho'' . e_perp = 2 Ldot theta_dot + L theta''
 *
 * so theta'' = ([g(r2) - g(r1)] . e_perp) / L - 2 (Ldot/L) theta_dot.
 *
 * The masses are placed symmetrically about the centre of mass; the result does not
 * depend on the mass ratio because the rod is massless and the centre of mass is fixed
 * on the reference orbit (one-way coupling).
 */
export function exactThetaAccel(s: PointMassState): number {
  const { radiusM: r, lengthM: L, deploymentRateMS: rate, thetaRad: theta, thetaDotRadPerS: w, mu } = s;
  if (!(r > 0) || !(L > 0) || !Number.isFinite(theta) || !Number.isFinite(w)) {
    throw new Error("exactThetaAccel: radius and length must be positive and the state finite.");
  }
  const c = Math.cos(theta);
  const sn = Math.sin(theta);
  // In-plane basis, centre of mass on the +x axis without loss of generality.
  const rHat = [1, 0, 0];
  const tHat = [0, 1, 0];
  const e = [c * rHat[0] + sn * tHat[0], c * rHat[1] + sn * tHat[1], 0];
  const ePerp = [-sn * rHat[0] + c * tHat[0], -sn * rHat[1] + c * tHat[1], 0];
  const cm = [r, 0, 0];
  const p1 = [cm[0] - (L / 2) * e[0], cm[1] - (L / 2) * e[1], 0];
  const p2 = [cm[0] + (L / 2) * e[0], cm[1] + (L / 2) * e[1], 0];
  const accel = (p: number[]): number[] => {
    const q = Math.hypot(p[0], p[1], p[2]);
    const k = -mu / (q * q * q);
    return [k * p[0], k * p[1], k * p[2]];
  };
  const a1 = accel(p1);
  const a2 = accel(p2);
  const dg = [a2[0] - a1[0], a2[1] - a1[1], a2[2] - a1[2]];
  const perp = dg[0] * ePerp[0] + dg[1] * ePerp[1] + dg[2] * ePerp[2];
  return perp / L - (2 * rate) / L * w;
}

export interface EquationAgreement {
  lengthOverRadius: number;
  nRadS: number;
  implementedThetaAccel: number;
  exactThetaAccel: number;
  /** Implemented minus exact, rad/s^2. */
  differenceRadPerS2: number;
  /**
   * The analytic leading term the implemented equation omits: the third-order tidal
   * term of g(r2) - g(r1), projected perpendicular and divided by L. Units rad/s^2,
   * sign convention: exact minus implemented.
   */
  predictedOmittedRadPerS2: number;
  /**
   * |difference| / n^2, dimensionless. The leading omitted tidal term is third order in
   * the length and normalised by 1/L here, so this quantity falls like (L/r)^2.
   */
  normalisedDifference: number;
  /**
   * Measured difference divided by the analytic prediction of the omitted term, with
   * matching sign. A value near 1 means the whole discrepancy from exact gravity is
   * accounted for by the term the expansion drops; anything else means the difference
   * is not the documented truncation.
   */
  explainedFraction: number;
}

/**
 * Analytic third-order tidal term, exact (not a bound).
 *
 * For f(r) = r/|r|^3 the third directional derivative is
 *
 *   D^3 f(u,u,u)_m = -9 u_m |u|^2 r^-5 + 45 u_m (x.u)^2 r^-7
 *                    + 45 |u|^2 x_m (x.u) r^-7 - 105 x_m (x.u)^3 r^-9
 *
 * and, with g = -mu f, Taylor's theorem for the odd difference gives
 *
 *   g(x+u) - g(x-u) = 2 grad(g)(x) u - (mu/3) D^3 f(u,u,u) + O(|u|^5).
 *
 * With u = (L/2) e, the first term reproduces -3 n^2 sin(theta) cos(theta) exactly and
 * the second is the leading omitted term. Returning it in theta'' units means dividing
 * the perpendicular projection by L.
 */
export function omittedTidalThetaAccel(s: PointMassState): number {
  const { radiusM: r, lengthM: L, thetaRad: theta, mu } = s;
  const c = Math.cos(theta);
  const sn = Math.sin(theta);
  // e = (c, sn, 0) in the (r_hat, t_hat) basis; e_perp = (-sn, c, 0).
  const u = [(L / 2) * c, (L / 2) * sn, 0];
  const x = [r, 0, 0];
  const u2 = u[0] * u[0] + u[1] * u[1] + u[2] * u[2];
  const s1 = x[0] * u[0] + x[1] * u[1] + x[2] * u[2];
  const term = (m: number): number =>
    -9 * u[m] * u2 * r ** -5 +
    45 * u[m] * s1 ** 2 * r ** -7 +
    45 * u2 * x[m] * s1 * r ** -7 -
    105 * x[m] * s1 ** 3 * r ** -9;
  const T = [term(0), term(1), term(2)];
  const perp = T[0] * -sn + T[1] * c;
  return (-mu / 3) * perp / L;
}

/**
 * Compare the implemented equation with the exact force balance at one length, using a
 * circular orbit so that the mean motion is exactly the orbital rate and the only
 * difference is the tidal truncation.
 *
 * The angle and rate are deliberately OFF the vertical and away from the turning point,
 * so that every term in the equation is active: at theta = 0 the gravity-gradient term
 * vanishes and a coefficient error would be invisible, and at theta_dot = 0 the
 * deployment term would be invisible.
 */
export function equationAgreement(
  lengthM: number,
  opts: { radiusM?: number; thetaRad?: number; thetaDotRadPerS?: number; deploymentRateMS?: number; mu?: number } = {},
): EquationAgreement {
  const radiusM = opts.radiusM ?? REFERENCE_RADIUS_M;
  const mu = opts.mu ?? MU_EARTH;
  const thetaRad = opts.thetaRad ?? 0.6; // ~34.4 deg: sin and cos both order 0.5-0.8
  const thetaDotRadPerS = opts.thetaDotRadPerS ?? 2e-4; // comparable to the libration rate
  const deploymentRateMS = opts.deploymentRateMS ?? 1;
  const n = meanMotion(radiusM, mu);
  const state: PointMassState = { radiusM, lengthM, deploymentRateMS, thetaRad, thetaDotRadPerS, mu };
  const impl = implementedThetaAccel(thetaRad, thetaDotRadPerS, lengthM, deploymentRateMS, n);
  const exact = exactThetaAccel(state);
  const difference = impl - exact;
  const predictedOmitted = omittedTidalThetaAccel(state); // exact minus implemented
  return {
    lengthOverRadius: lengthM / radiusM,
    nRadS: n,
    implementedThetaAccel: impl,
    exactThetaAccel: exact,
    differenceRadPerS2: difference,
    predictedOmittedRadPerS2: predictedOmitted,
    normalisedDifference: Math.abs(difference) / (n * n),
    explainedFraction: predictedOmitted === 0 ? Number.NaN : -difference / predictedOmitted,
  };
}

export interface TruncationPoint extends EquationAgreement {
  /** Observed order in L/r between this point and the previous one; null if not computable. */
  observedOrder: number | null;
}

/**
 * Measure how the implemented equation's truncation falls as L/r is reduced over a
 * geometric sequence, holding the physical state fixed. No order is assumed: each
 * point reports the order fitted from the two measured neighbours.
 *
 * Used for two things: showing that the difference IS the documented tidal truncation
 * (a constant, a sign error or a missing term would not fall this way), and reporting
 * how large the truncation is at the length the convergence study actually uses.
 */
export function equationTruncationStudy(
  ratios: number[] = [3e-2, 1e-2, 3e-3, 1e-3, 3e-4],
  opts: { radiusM?: number; thetaRad?: number; thetaDotRadPerS?: number; deploymentRateMS?: number; mu?: number } = {},
): TruncationPoint[] {
  const radiusM = opts.radiusM ?? REFERENCE_RADIUS_M;
  const points = ratios.map((ratio) => equationAgreement(ratio * radiusM, { ...opts, radiusM }));
  return points.map((point, i) => {
    if (i === 0) return { ...point, observedOrder: null };
    const prev = points[i - 1];
    const order =
      point.normalisedDifference > 0 && prev.normalisedDifference > 0
        ? Math.log(prev.normalisedDifference / point.normalisedDifference) /
          Math.log(prev.lengthOverRadius / point.lengthOverRadius)
        : null;
    return { ...point, observedOrder: order };
  });
}

/**
 * Relative drift of the first integral of the constant-length equation, sampled on the
 * closed-form reference:
 *
 *     K(theta, theta_dot) = theta_dot^2 / 2 - (3/2) n^2 cos^2(theta)
 *
 * For constant n and L, K is exactly invariant along any solution of
 * theta'' + 3 n^2 sin(theta) cos(theta) = 0. A correct closed form keeps K constant to
 * round-off; a wrong amplitude, phase or rate does not.
 */
export function analyticInvariantDefect(
  theta0Rad: number,
  nRadS: number,
  durationS: number,
  samples = 4001,
): { maxRelativeDrift: number; initialK: number; worstTimeS: number } {
  const K = (theta: number, thetaDot: number): number =>
    (thetaDot * thetaDot) / 2 - 1.5 * nRadS * nRadS * Math.cos(theta) ** 2;
  const first = analyticLibration(theta0Rad, nRadS, 0);
  const k0 = K(first.theta, first.thetaDot);
  let maxDrift = 0;
  let worst = 0;
  for (let i = 0; i <= samples; i++) {
    const t = (i / samples) * durationS;
    const { theta, thetaDot } = analyticLibration(theta0Rad, nRadS, t);
    const drift = Math.abs(K(theta, thetaDot) - k0) / Math.abs(k0);
    if (drift > maxDrift) {
      maxDrift = drift;
      worst = t;
    }
  }
  return { maxRelativeDrift: maxDrift, initialK: k0, worstTimeS: worst };
}

/**
 * Upper bound on the omitted term of the tidal expansion, derived rather than tuned.
 *
 * Taylor's theorem about the centre of mass gives, for the odd difference,
 *
 *     g(r + rho/2) - g(r - rho/2) = grad(g) rho + (1/24) D^3 g (rho, rho, rho) + ...
 *
 * The leading term reproduces -3 n^2 sin(theta) cos(theta). With rho = L e and the
 * standard bound on the third derivative of the Newtonian field,
 * |D^3 (mu/r)| <= 15 mu / r^4, the omitted term obeys
 *
 *     |omitted| / L <= (15/24) n^2 (L/r)^2,   n^2 = mu / r^3,
 *
 * and projecting onto e_perp cannot increase it. Dividing by L gives the bound on the
 * theta'' difference, normalised by n^2:
 *
 *     |theta''_impl - theta''_exact| / n^2 <= (15/24) (L/r)^2.
 *
 * The measured value at the study's L/r is compared against this bound, which is why
 * the criterion has a physical derivation rather than a fitted constant.
 */
export function truncationBound(lengthOverRadius: number): number {
  return (15 / 24) * lengthOverRadius ** 2;
}
