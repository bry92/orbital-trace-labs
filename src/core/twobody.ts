/**
 * Two-body point-mass orbital mechanics. Model identifier OTL-2BP.
 *
 * Implemented equation (Earth-centred inertial frame, SI units):
 *
 *     r''(t) = -mu * r(t) / |r(t)|^3
 *
 * Propagated numerically. No perturbations, no drag, no third bodies, no
 * relativity, no Earth rotation, no oblateness.
 *
 * Normalised invariance diagnostics:
 *
 *     eps_E = |E(t) - E(0)| / max(|E(0)|, E_scale),   E_scale = mu / |r0|
 *     eps_h = |h(t) - h(0)| / max(|h(0)|, h_scale),   h_scale = |r0| * |v0|
 *
 * Both scale values are documented, nonzero and independent of the propagated
 * state, so a near-zero initial value cannot inflate the diagnostic. A zero
 * initial velocity is rejected rather than normalised (h_scale would be 0).
 */

import { MAX_STEPS } from "./constants";
import { IntegrationError, integrateDOPRI5, integrateRK4, type DerivFunc } from "./integrators";
import { cross, dot, norm, sub, type Vec3 } from "./vec";

export type SolverSelection =
  | { method: "RK4"; stepS: number }
  | { method: "DOPRI5"; relTol: number; absTol: number; initialStepS: number; maxStepS: number };

export interface TimeSeries {
  t: number[];
  x: number[];
  y: number[];
  z: number[];
  vx: number[];
  vy: number[];
  vz: number[];
  energy: number[];
  hMag: number[];
  epsEnergy: number[];
  epsAngularMomentum: number[];
  radius: number[];
  speed: number[];
}

export type OrbitalRegime = "ELLIPTIC" | "HYPERBOLIC" | "PARABOLIC" | "CIRCULAR-PLANE-DEGENERATE";

export interface OrbitalElements {
  semiMajorAxisM: number | null;
  eccentricity: number;
  inclinationRad: number;
  raanRad: number;
  argPeriapsisRad: number;
  trueAnomalyRad: number;
  periapsisRadiusM: number | null;
  apoapsisRadiusM: number | null;
  periodS: number | null;
  regime: OrbitalRegime;
  /** True for a closed (elliptic) orbit with well-defined period. */
  isClosed: boolean;
}

export interface StateMetrics {
  energyJPerKg: number;
  angularMomentumM2PerS: number;
  radiusM: number;
  speedMS: number;
  elements: OrbitalElements;
}

export interface PropagationRequest {
  mu: number;
  positionM: Vec3;
  velocityMS: Vec3;
  durationS: number;
  solver: SolverSelection;
}

export interface PropagationResult {
  series: TimeSeries;
  initial: StateMetrics;
  final: StateMetrics;
  steps: number;
  rejectedSteps: number;
  solverDescription: string;
  energyScaleJPerKg: number;
  angularMomentumScaleM2PerS: number;
  maxEpsEnergy: number;
  maxEpsAngularMomentum: number;
  maxAbsEnergyDriftJPerKg: number;
  minRadiusM: number;
  maxRadiusM: number;
  maxSpeedMS: number;
  warnings: string[];
}

export function twoBodyDerivative(mu: number): DerivFunc {
  return (_t, y, out) => {
    const x = y[0];
    const yy = y[1];
    const z = y[2];
    const r2 = x * x + yy * yy + z * z;
    const r = Math.sqrt(r2);
    if (!(r > 0)) {
      throw new IntegrationError("SINGULAR_GEOMETRY", "Position magnitude reached zero (singular gravity field).");
    }
    const k = -mu / (r2 * r);
    out[0] = y[3];
    out[1] = y[4];
    out[2] = y[5];
    out[3] = k * x;
    out[4] = k * yy;
    out[5] = k * z;
  };
}

export const specificEnergy = (mu: number, r: Vec3, v: Vec3): number =>
  0.5 * dot(v, v) - mu / norm(r);

export const specificAngularMomentum = (r: Vec3, v: Vec3): number => norm(cross(r, v));

export function computeElements(mu: number, r: Vec3, v: Vec3): OrbitalElements {
  const rMag = norm(r);
  const v2 = dot(v, v);
  const energy = 0.5 * v2 - mu / rMag;
  const hVec = cross(r, v);
  const hMag = norm(hVec);

  // Eccentricity vector.
  const rv = dot(r, v);
  const eVec: Vec3 = [
    ((v2 - mu / rMag) * r[0] - rv * v[0]) / mu,
    ((v2 - mu / rMag) * r[1] - rv * v[1]) / mu,
    ((v2 - mu / rMag) * r[2] - rv * v[2]) / mu,
  ];
  const e = norm(eVec);

  let semiMajorAxisM: number | null = null;
  if (Math.abs(energy) > 1e-14 * (mu / rMag)) {
    semiMajorAxisM = -mu / (2 * energy);
  } else {
    semiMajorAxisM = null; // parabolic limit: a is undefined
  }

  const inclinationRad = hMag > 0 ? Math.acos(Math.min(1, Math.max(-1, hVec[2] / hMag))) : 0;

  // Node vector n = z_hat x h
  const nVec: Vec3 = [-hVec[1], hVec[0], 0];
  const nMag = norm(nVec);
  const eps = 1e-10;

  let raanRad = 0;
  if (nMag > eps * Math.max(1, hMag)) {
    raanRad = Math.atan2(nVec[1], nVec[0]);
    if (raanRad < 0) raanRad += 2 * Math.PI;
  }

  let argPeriapsisRad = 0;
  let trueAnomalyRad = 0;
  if (e > eps && nMag > eps * Math.max(1, hMag)) {
    argPeriapsisRad = Math.acos(Math.min(1, Math.max(-1, dot(nVec, eVec) / (nMag * e))));
    if (eVec[2] < 0) argPeriapsisRad = 2 * Math.PI - argPeriapsisRad;
    trueAnomalyRad = Math.acos(Math.min(1, Math.max(-1, dot(eVec, r) / (e * rMag))));
    if (rv < 0) trueAnomalyRad = 2 * Math.PI - trueAnomalyRad;
  } else if (e > eps) {
    // Equatorial eccentric orbit: argument of periapsis measured from x axis.
    argPeriapsisRad = Math.atan2(eVec[1], eVec[0]);
    if (argPeriapsisRad < 0) argPeriapsisRad += 2 * Math.PI;
    trueAnomalyRad = Math.acos(Math.min(1, Math.max(-1, dot(eVec, r) / (e * rMag))));
    if (rv < 0) trueAnomalyRad = 2 * Math.PI - trueAnomalyRad;
  } else if (nMag > eps * Math.max(1, hMag)) {
    // Circular inclined orbit: report argument of latitude as true anomaly.
    trueAnomalyRad = Math.acos(Math.min(1, Math.max(-1, dot(nVec, r) / (nMag * rMag))));
    if (r[2] < 0) trueAnomalyRad = 2 * Math.PI - trueAnomalyRad;
  } else {
    // Circular equatorial orbit: the node and periapsis are undefined by convention.
    trueAnomalyRad = Math.atan2(r[1], r[0]);
    if (trueAnomalyRad < 0) trueAnomalyRad += 2 * Math.PI;
  }

  const isClosed = energy < 0 && semiMajorAxisM !== null && semiMajorAxisM > 0;
  const periodS = isClosed ? 2 * Math.PI * Math.sqrt(semiMajorAxisM! ** 3 / mu) : null;
  const periapsisRadiusM = isClosed ? semiMajorAxisM! * (1 - e) : e > 0 ? hMag * hMag / mu / (1 + e) : null;
  const apoapsisRadiusM = isClosed ? semiMajorAxisM! * (1 + e) : null;

  const regime: OrbitalRegime = isClosed
    ? "ELLIPTIC"
    : energy > 0
      ? "HYPERBOLIC"
      : hMag === 0
        ? "CIRCULAR-PLANE-DEGENERATE"
        : "PARABOLIC";

  return {
    semiMajorAxisM,
    eccentricity: e,
    inclinationRad,
    raanRad,
    argPeriapsisRad,
    trueAnomalyRad,
    periapsisRadiusM,
    apoapsisRadiusM,
    periodS,
    regime,
    isClosed,
  };
}

export function stateMetrics(mu: number, r: Vec3, v: Vec3): StateMetrics {
  return {
    energyJPerKg: specificEnergy(mu, r, v),
    angularMomentumM2PerS: specificAngularMomentum(r, v),
    radiusM: norm(r),
    speedMS: norm(v),
    elements: computeElements(mu, r, v),
  };
}

function emptySeries(): TimeSeries {
  return {
    t: [],
    x: [],
    y: [],
    z: [],
    vx: [],
    vy: [],
    vz: [],
    energy: [],
    hMag: [],
    epsEnergy: [],
    epsAngularMomentum: [],
    radius: [],
    speed: [],
  };
}

/**
 * Propagate a two-body state. Throws on invalid solver settings or degenerate
 * geometry; never falls back to a different method or a default input.
 */
export function propagateTwoBody(req: PropagationRequest): PropagationResult {
  const { mu, positionM, velocityMS, durationS, solver } = req;
  if (!(mu > 0) || !Number.isFinite(mu)) {
    throw new IntegrationError("INVALID_MU", `Gravitational parameter must be finite and > 0; received ${mu}.`);
  }
  if (!(durationS > 0) || !Number.isFinite(durationS)) {
    throw new IntegrationError("INVALID_DURATION", `Duration must be finite and > 0; received ${durationS}.`);
  }
  const r0Mag = norm(positionM);
  const v0Mag = norm(velocityMS);
  if (!(r0Mag > 0)) {
    throw new IntegrationError("SINGULAR_GEOMETRY", "Initial position magnitude is zero; the point-mass field is singular.");
  }
  if (!(v0Mag > 0)) {
    throw new IntegrationError(
      "DEGENERATE_ANGULAR_MOMENTUM_NORMALIZATION",
      "Initial speed is zero, so the documented angular-momentum scale |r0||v0| is zero. This condition is unsupported; an alternative normalisation would be required.",
    );
  }

  const initial = stateMetrics(mu, positionM, velocityMS);
  const energyScale = mu / r0Mag;
  const hScale = r0Mag * v0Mag;

  const series = emptySeries();
  const y0 = new Float64Array([
    positionM[0],
    positionM[1],
    positionM[2],
    velocityMS[0],
    velocityMS[1],
    velocityMS[2],
  ]);

  const record = (t: number, y: Float64Array): void => {
    const r: Vec3 = [y[0], y[1], y[2]];
    const v: Vec3 = [y[3], y[4], y[5]];
    const E = specificEnergy(mu, r, v);
    const h = specificAngularMomentum(r, v);
    series.t.push(t);
    series.x.push(r[0]);
    series.y.push(r[1]);
    series.z.push(r[2]);
    series.vx.push(v[0]);
    series.vy.push(v[1]);
    series.vz.push(v[2]);
    series.energy.push(E);
    series.hMag.push(h);
    series.epsEnergy.push(Math.abs(E - initial.energyJPerKg) / Math.max(Math.abs(initial.energyJPerKg), energyScale));
    series.epsAngularMomentum.push(
      Math.abs(h - initial.angularMomentumM2PerS) /
        Math.max(initial.angularMomentumM2PerS, hScale),
    );
    series.radius.push(norm(r));
    series.speed.push(norm(v));
  };

  record(0, y0);

  let steps = 0;
  let rejectedSteps = 0;
  let solverDescription: string;

  if (solver.method === "RK4") {
    if (!(solver.stepS > 0) || !Number.isFinite(solver.stepS)) {
      throw new IntegrationError("INVALID_STEP", `RK4 step must be finite and > 0; received ${solver.stepS}.`);
    }
    solverDescription = `Classical fixed-step RK4, h = ${solver.stepS} s (order 4, non-symplectic)`;
    const res = integrateRK4(twoBodyDerivative(mu), y0, durationS, {
      stepS: solver.stepS,
      maxSteps: MAX_STEPS,
      onSample: record,
    });
    steps = res.steps;
  } else {
    if (!(solver.relTol > 0) || !(solver.absTol > 0) || !(solver.initialStepS > 0) || !(solver.maxStepS > 0)) {
      throw new IntegrationError(
        "INVALID_SOLVER_SETTINGS",
        "DOPRI5 requires relTol > 0, absTol > 0, initialStepS > 0 and maxStepS > 0.",
      );
    }
    solverDescription =
      `Adaptive Dormand–Prince 5(4), relTol = ${solver.relTol}, absTol = ${solver.absTol}, ` +
      `h0 = ${solver.initialStepS} s, hmax = ${solver.maxStepS} s (non-symplectic)`;
    const res = integrateDOPRI5(twoBodyDerivative(mu), y0, durationS, {
      relTol: solver.relTol,
      absTol: solver.absTol,
      initialStepS: solver.initialStepS,
      maxStepS: solver.maxStepS,
      minStepS: 1e-6,
      maxSteps: MAX_STEPS,
      onSample: record,
    });
    steps = res.accepted;
    rejectedSteps = res.rejected;
  }

  const last = series.t.length - 1;
  const rFinal: Vec3 = [series.x[last], series.y[last], series.z[last]];
  const vFinal: Vec3 = [series.vx[last], series.vy[last], series.vz[last]];
  const final = stateMetrics(mu, rFinal, vFinal);

  const warnings: string[] = [];
  if (!final.elements.isClosed) {
    warnings.push(
      `Final osculating orbit is ${final.elements.regime}; orbital period is not defined for an open orbit and is reported as null.`,
    );
  }
  const minRadiusM = Math.min(...series.radius);
  if (minRadiusM < 6378137) {
    warnings.push(
      "Trajectory radius falls below the Earth equatorial radius. The point-mass model has no surface, atmosphere or drag: the numerical result is valid for the equations but not physically interpretable below the surface.",
    );
  }

  return {
    series,
    initial,
    final,
    steps,
    rejectedSteps,
    solverDescription,
    energyScaleJPerKg: energyScale,
    angularMomentumScaleM2PerS: hScale,
    maxEpsEnergy: Math.max(...series.epsEnergy),
    maxEpsAngularMomentum: Math.max(...series.epsAngularMomentum),
    maxAbsEnergyDriftJPerKg: Math.max(...series.energy.map((e) => Math.abs(e - initial.energyJPerKg))),
    minRadiusM,
    maxRadiusM: Math.max(...series.radius),
    maxSpeedMS: Math.max(...series.speed),
    warnings,
  };
}

/**
 * Independent analytic reference for closed orbits: solve Kepler's equation
 * with Newton iteration and evaluate the conic in the perifocal frame.
 * This is a different numerical path from the ODE integration, so comparing the
 * two is a genuine cross-check rather than a self-comparison.
 *
 * Returns null when the initial state is not a closed ellipse.
 */
export function keplerPropagate(
  mu: number,
  r0: Vec3,
  v0: Vec3,
  t: number,
): { positionM: Vec3; velocityMS: Vec3 } | null {
  const el = computeElements(mu, r0, v0);
  if (!el.isClosed || el.semiMajorAxisM === null) return null;
  const a = el.semiMajorAxisM;
  const e = el.eccentricity;

  const hVec = cross(r0, v0);
  const hMag = norm(hVec);
  if (!(hMag > 0)) return null;

  const energy = 0.5 * dot(v0, v0) - mu / norm(r0);
  const eVec: Vec3 = [
    ((dot(v0, v0) - mu / norm(r0)) * r0[0] - dot(r0, v0) * v0[0]) / mu,
    ((dot(v0, v0) - mu / norm(r0)) * r0[1] - dot(r0, v0) * v0[1]) / mu,
    ((dot(v0, v0) - mu / norm(r0)) * r0[2] - dot(r0, v0) * v0[2]) / mu,
  ];
  const eMag = norm(eVec);
  const eHat: Vec3 = eMag > 1e-12 ? [eVec[0] / eMag, eVec[1] / eMag, eVec[2] / eMag] : [r0[0] / norm(r0), r0[1] / norm(r0), r0[2] / norm(r0)];
  const hHat: Vec3 = [hVec[0] / hMag, hVec[1] / hMag, hVec[2] / hMag];
  const qHat: Vec3 = cross(hHat, eHat);

  const nu0 = Math.atan2(dot(r0, qHat), dot(r0, eHat));
  const E0 = 2 * Math.atan2(Math.sqrt(1 - e) * Math.sin(nu0 / 2), Math.sqrt(1 + e) * Math.cos(nu0 / 2));
  const n = Math.sqrt(mu / (a * a * a));
  const M0 = E0 - e * Math.sin(E0);
  const M = M0 + n * t;

  // Newton iteration on Kepler's equation E - e sinE = M.
  let E = M;
  for (let i = 0; i < 100; i++) {
    const f = E - e * Math.sin(E) - M;
    const fp = 1 - e * Math.cos(E);
    const d = f / fp;
    E -= d;
    if (Math.abs(d) < 1e-15) break;
  }

  const cosE = Math.cos(E);
  const sinE = Math.sin(E);
  const r = a * (1 - e * cosE);
  const posPerifocal = [a * (cosE - e), a * Math.sqrt(1 - e * e) * sinE, 0];
  const velPerifocal = [
    (-Math.sqrt(mu * a) / r) * sinE,
    (Math.sqrt(mu * a) / r) * Math.sqrt(1 - e * e) * cosE,
    0,
  ];

  const positionM: Vec3 = [
    posPerifocal[0] * eHat[0] + posPerifocal[1] * qHat[0],
    posPerifocal[0] * eHat[1] + posPerifocal[1] * qHat[1],
    posPerifocal[0] * eHat[2] + posPerifocal[1] * qHat[2],
  ];
  const velocityMS: Vec3 = [
    velPerifocal[0] * eHat[0] + velPerifocal[1] * qHat[0],
    velPerifocal[0] * eHat[1] + velPerifocal[1] * qHat[1],
    velPerifocal[0] * eHat[2] + velPerifocal[1] * qHat[2],
  ];

  // Guard against silently returning a wrong conic: verify the analytic energy.
  const Echeck = 0.5 * dot(velocityMS, velocityMS) - mu / norm(positionM);
  if (!Number.isFinite(Echeck) || Math.abs(Echeck - energy) > 1e-6 * Math.abs(energy)) {
    return null;
  }
  return { positionM, velocityMS };
}

/**
 * Build an inertial state from classical elements. Used only to construct documented
 * scenario presets and regression cases; never inside the propagation path.
 * Angles in radians.
 */
export function stateFromElements(
  mu: number,
  a: number,
  e: number,
  inclination: number,
  raan: number,
  argPeriapsis: number,
  trueAnomaly: number,
): { positionM: Vec3; velocityMS: Vec3 } {
  if (!(a > 0) || !(e >= 0) || e >= 1) {
    throw new Error("stateFromElements supports elliptic elements only (a > 0, 0 <= e < 1)");
  }
  const p = a * (1 - e * e);
  const r = p / (1 + e * Math.cos(trueAnomaly));

  const cO = Math.cos(raan);
  const sO = Math.sin(raan);
  const cw = Math.cos(argPeriapsis);
  const sw = Math.sin(argPeriapsis);
  const ci = Math.cos(inclination);
  const si = Math.sin(inclination);

  const xHat: Vec3 = [cO * cw - sO * sw * ci, sO * cw + cO * sw * ci, sw * si];
  const yHat: Vec3 = [-cO * sw - sO * cw * ci, -sO * sw + cO * cw * ci, cw * si];

  const cosNu = Math.cos(trueAnomaly);
  const sinNu = Math.sin(trueAnomaly);
  const vFactor = Math.sqrt(mu / p);

  const positionM: Vec3 = [
    r * cosNu * xHat[0] + r * sinNu * yHat[0],
    r * cosNu * xHat[1] + r * sinNu * yHat[1],
    r * cosNu * xHat[2] + r * sinNu * yHat[2],
  ];
  const velocityMS: Vec3 = [
    vFactor * (-sinNu * xHat[0] + (e + cosNu) * yHat[0]),
    vFactor * (-sinNu * xHat[1] + (e + cosNu) * yHat[1]),
    vFactor * (-sinNu * xHat[2] + (e + cosNu) * yHat[2]),
  ];
  return { positionM, velocityMS };
}

/** Relative state error against the analytic Kepler reference, over full series. */
export function relativeErrorVsKepler(
  mu: number,
  r0: Vec3,
  v0: Vec3,
  series: TimeSeries,
): { maxPositionRelError: number; maxVelocityRelError: number } {
  const ref0 = keplerPropagate(mu, r0, v0, 0);
  if (!ref0) return { maxPositionRelError: NaN, maxVelocityRelError: NaN };
  const rScale = norm(r0);
  const vScale = norm(v0);
  let maxPos = 0;
  let maxVel = 0;
  for (let i = 0; i < series.t.length; i++) {
    const ref = keplerPropagate(mu, r0, v0, series.t[i]);
    if (!ref) return { maxPositionRelError: NaN, maxVelocityRelError: NaN };
    const dp = norm(sub([series.x[i], series.y[i], series.z[i]], ref.positionM)) / rScale;
    const dv = norm(sub([series.vx[i], series.vy[i], series.vz[i]], ref.velocityMS)) / vScale;
    maxPos = Math.max(maxPos, dp);
    maxVel = Math.max(maxVel, dv);
  }
  return { maxPositionRelError: maxPos, maxVelocityRelError: maxVel };
}
