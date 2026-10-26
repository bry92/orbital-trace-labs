/**
 * Model TETH-1: gravity-gradient dumbbell with prescribed length history.
 *
 * Geometry and mass representation
 *   Two point masses m1 (payload) and m2 (counterweight / orbiter side) joined by a
 *   massless, rigid rod of length L(t). L(t) is PRESCRIBED by the researcher:
 *       L(t) = L0 + Ldot * t
 *   The rod stays straight; no bending, no elasticity, no distributed mass.
 *
 * Reference orbit
 *   The centre of mass follows the two-body equation
 *       r'' = -mu r / |r|^3
 *   Coupling is ONE-WAY: the tether does not react on the centre-of-mass orbit.
 *   Full coupled spacecraft-tether orbital dynamics is NOT modelled.
 *
 * In-plane libration
 *   theta is the in-plane angle between the tether and the local vertical.
 *   Gravity-gradient torque on a dumbbell with zero axial inertia and transverse
 *   moment of inertia J = mu_red L^2 gives the standard libration equation
 *       theta'' = -3 n(t)^2 sin(theta) cos(theta)
 *   where the local orbital rate is n(t) = sqrt(mu / |r(t)|^3).
 *
 *   With a prescribed rate of length change and no torque applied by the deployer
 *   about the out-of-plane axis, the transverse angular momentum H = J theta_dot
 *   changes only through the gravity-gradient torque:
 *       d/dt(mu_red L^2 theta_dot) = -3 n^2 mu_red L^2 sin(theta) cos(theta)
 *   which gives
 *       theta'' + 2 (Ldot/L) theta_dot + 3 n^2 sin(theta) cos(theta) = 0
 *   This is the equation implemented. It is an approximation: the reel, the tether
 *   axial dynamics and any actuator torque are absent, so this model cannot predict
 *   a deployment transient.
 *
 * Quasi-static tension diagnostic
 *   For the vertical (theta = 0) configuration only, first order in L/r:
 *       T = 3 mu_red mu L / r^3
 *   with mu_red = m1 m2 / (m1 + m2). This is a DIAGNOSTIC ESTIMATE, not the tension
 *   of the librating configuration, and not a structural prediction.
 *
 * No conservation claim is made for the tether subsystem: length is prescribed, so
 * the mechanical energy of the dumbbell is not conserved and is not reported as if
 * it were. Only the two-body reference orbit has invariants, and they are reported
 * separately.
 */

import { IntegrationError, integrateDOPRI5, integrateRK4, type DerivFunc } from "./integrators";
import { MAX_STEPS } from "./constants";
import { computeElements, specificAngularMomentum, specificEnergy } from "./twobody";
import { cross, dot, norm, type Vec3 } from "./vec";

export interface TetherRequest {
  mu: number;
  positionM: Vec3;
  velocityMS: Vec3;
  satelliteMassKg: number;
  orbiterMassKg: number;
  lengthM: number;
  deploymentRateMS: number;
  theta0Rad: number;
  thetaDot0RadPerS: number;
  durationS: number;
  stepS: number;
  /**
   * Integrator selection. The researcher-facing model always uses fixed-step RK4;
   * the adaptive path exists so the verification suite can build an independent,
   * more accurate NUMERICAL reference for cases with no closed-form solution. A
   * reference produced this way is labelled as such, never as exact.
   */
  method?: "RK4" | "DOPRI5";
  /** Relative tolerance for the adaptive reference path only. */
  relTol?: number;
  /** Absolute tolerance for the adaptive reference path only. */
  absTol?: number;
}

export interface TetherSeries {
  t: number[];
  x: number[];
  y: number[];
  z: number[];
  vx: number[];
  vy: number[];
  vz: number[];
  radius: number[];
  speed: number[];
  thetaDeg: number[];
  thetaRateDegPerS: number[];
  lengthM: number[];
  meanMotionRadS: number[];
  tensionVerticalN: number[];
  lengthOverRadius: number[];
  orbitEnergy: number[];
  orbitAngularMomentum: number[];
  epsEnergyOrbit: number[];
  epsAngularMomentumOrbit: number[];
}

export interface TetherResult {
  series: TetherSeries;
  steps: number;
  solverDescription: string;
  reducedMassKg: number;
  massRatio: number;
  initial: {
    radiusM: number;
    speedMS: number;
    orbitEnergy: number;
    orbitAngularMomentum: number;
    periodS: number | null;
    eccentricity: number;
    meanMotionRadS: number;
    librationPeriodS: number | null;
  };
  final: {
    radiusM: number;
    speedMS: number;
    thetaDeg: number;
    thetaRateDegPerS: number;
    lengthM: number;
    tensionVerticalN: number;
  };
  maxAbsThetaDeg: number;
  maxTensionN: number;
  maxLengthOverRadius: number;
  maxEpsEnergyOrbit: number;
  maxEpsAngularMomentumOrbit: number;
  warnings: string[];
}

function tetherDerivative(mu: number, length0: number, rate: number): DerivFunc {
  return (t, y, out) => {
    const x = y[0];
    const yy = y[1];
    const z = y[2];
    const r2 = x * x + yy * yy + z * z;
    const r = Math.sqrt(r2);
    if (!(r > 0)) {
      throw new IntegrationError("SINGULAR_GEOMETRY", "Reference orbit radius reached zero.");
    }
    const L = length0 + rate * t;
    if (!(L > 0)) {
      throw new IntegrationError(
        "TETHER_LENGTH_NONPOSITIVE",
        `Prescribed tether length reached ${L} m at t = ${t} s. A non-positive length has no physical meaning.`,
      );
    }
    const n2 = mu / (r2 * r);

    out[0] = y[3];
    out[1] = y[4];
    out[2] = y[5];
    const k = -mu / (r2 * r);
    out[3] = k * x;
    out[4] = k * yy;
    out[5] = k * z;
    out[6] = y[7];
    out[7] = -3 * n2 * Math.sin(y[6]) * Math.cos(y[6]) - 2 * (rate / L) * y[7];
  };
}

export function tetherTensionVerticalN(mu: number, reducedMass: number, lengthM: number, radiusM: number): number {
  return (3 * reducedMass * mu * lengthM) / radiusM ** 3;
}

export function propagateTether(req: TetherRequest): TetherResult {
  const {
    mu,
    positionM,
    velocityMS,
    satelliteMassKg,
    orbiterMassKg,
    lengthM,
    deploymentRateMS,
    theta0Rad,
    thetaDot0RadPerS,
    durationS,
    stepS,
  } = req;

  if (!(mu > 0) || !Number.isFinite(mu)) throw new IntegrationError("INVALID_MU", "Gravitational parameter must be positive and finite.");
  if (!(durationS > 0)) throw new IntegrationError("INVALID_DURATION", "Duration must be positive.");
  if (!(stepS > 0)) throw new IntegrationError("INVALID_STEP", "Step must be positive.");
  if (!(satelliteMassKg > 0) || !(orbiterMassKg > 0)) {
    throw new IntegrationError("INVALID_MASS", "Both end masses must be positive.");
  }
  if (!(lengthM > 0)) throw new IntegrationError("INVALID_TETHER_LENGTH", "Tether length must be positive.");
  if (!(deploymentRateMS >= 0) || !Number.isFinite(deploymentRateMS)) {
    throw new IntegrationError("INVALID_DEPLOYMENT_RATE", "Deployment rate must be finite and non-negative.");
  }
  if (!(lengthM + deploymentRateMS * durationS > 0)) {
    throw new IntegrationError("TETHER_LENGTH_NONPOSITIVE", "Prescribed length becomes non-positive during the propagation.");
  }

  const reducedMass = (satelliteMassKg * orbiterMassKg) / (satelliteMassKg + orbiterMassKg);
  const massRatio = satelliteMassKg / orbiterMassKg;
  const r0Mag = norm(positionM);
  const v0Mag = norm(velocityMS);
  if (!(r0Mag > 0) || !(v0Mag > 0)) {
    throw new IntegrationError("SINGULAR_GEOMETRY", "Initial state must have nonzero position and velocity.");
  }

  const E0 = specificEnergy(mu, positionM, velocityMS);
  const h0 = specificAngularMomentum(positionM, velocityMS);
  const energyScale = mu / r0Mag;
  const hScale = r0Mag * v0Mag;
  const elements0 = computeElements(mu, positionM, velocityMS);
  const n0 = Math.sqrt(mu / r0Mag ** 3);

  const series: TetherSeries = {
    t: [],
    x: [],
    y: [],
    z: [],
    vx: [],
    vy: [],
    vz: [],
    radius: [],
    speed: [],
    thetaDeg: [],
    thetaRateDegPerS: [],
    lengthM: [],
    meanMotionRadS: [],
    tensionVerticalN: [],
    lengthOverRadius: [],
    orbitEnergy: [],
    orbitAngularMomentum: [],
    epsEnergyOrbit: [],
    epsAngularMomentumOrbit: [],
  };

  const y0 = new Float64Array([
    positionM[0],
    positionM[1],
    positionM[2],
    velocityMS[0],
    velocityMS[1],
    velocityMS[2],
    theta0Rad,
    thetaDot0RadPerS,
  ]);

  const record = (t: number, y: Float64Array): void => {
    const r: Vec3 = [y[0], y[1], y[2]];
    const v: Vec3 = [y[3], y[4], y[5]];
    const rMag = norm(r);
    const L = lengthM + deploymentRateMS * t;
    const E = specificEnergy(mu, r, v);
    const h = specificAngularMomentum(r, v);
    series.t.push(t);
    series.x.push(r[0]);
    series.y.push(r[1]);
    series.z.push(r[2]);
    series.vx.push(v[0]);
    series.vy.push(v[1]);
    series.vz.push(v[2]);
    series.radius.push(rMag);
    series.speed.push(norm(v));
    series.thetaDeg.push((y[6] * 180) / Math.PI);
    series.thetaRateDegPerS.push((y[7] * 180) / Math.PI);
    series.lengthM.push(L);
    series.meanMotionRadS.push(Math.sqrt(mu / rMag ** 3));
    series.tensionVerticalN.push(tetherTensionVerticalN(mu, reducedMass, L, rMag));
    series.lengthOverRadius.push(L / rMag);
    series.orbitEnergy.push(E);
    series.orbitAngularMomentum.push(h);
    series.epsEnergyOrbit.push(Math.abs(E - E0) / Math.max(Math.abs(E0), energyScale));
    series.epsAngularMomentumOrbit.push(Math.abs(h - h0) / Math.max(h0, hScale));
  };

  record(0, y0);
  const f = tetherDerivative(mu, lengthM, deploymentRateMS);
  const adaptive = req.method === "DOPRI5";
  let steps = 0;
  if (adaptive) {
    const relTol = req.relTol ?? 1e-12;
    const absTol = req.absTol ?? 1e-14;
    if (!(relTol > 0) || !(absTol > 0)) {
      throw new IntegrationError("INVALID_TOLERANCE", "Adaptive tolerances must be positive.");
    }
    const stats = integrateDOPRI5(f, y0, durationS, {
      relTol,
      absTol,
      initialStepS: Math.min(stepS, durationS),
      maxStepS: durationS,
      minStepS: 1e-6,
      maxSteps: MAX_STEPS,
      onSample: record,
    });
    steps = stats.accepted;
  } else {
    const res = integrateRK4(f, y0, durationS, {
      stepS,
      maxSteps: MAX_STEPS,
      onSample: record,
    });
    steps = res.steps;
  }

  const last = series.t.length - 1;
  const warnings: string[] = [];
  const maxLengthOverRadius = Math.max(...series.lengthOverRadius);
  if (maxLengthOverRadius > 0.05) {
    warnings.push(
      `Maximum L/r = ${maxLengthOverRadius.toFixed(4)} exceeds 0.05. The dumbbell libration equation and the tension diagnostic are first-order in L/r; results are outside their intended regime.`,
    );
  }
  if (elements0.eccentricity > 0.05) {
    warnings.push(
      `Initial osculating eccentricity is ${elements0.eccentricity.toFixed(4)}. The implemented libration equation uses the local mean motion n(t) = sqrt(mu/r^3); eccentricity-dependent libration coupling is NOT modelled.`,
    );
  }
  if (deploymentRateMS > 0) {
    warnings.push(
      `Tether length is prescribed with a constant rate of ${deploymentRateMS} m/s. Reel inertia, motor torque, tether elasticity and damping are NOT modelled, so this is not a deployment simulation.`,
    );
  }

  return {
    series,
    steps,
    solverDescription: adaptive
      ? `Adaptive Dormand–Prince 5(4), rtol = ${req.relTol ?? 1e-12}, atol = ${req.absTol ?? 1e-14}, ` +
        `${steps} accepted steps, 8-state [r, v, theta, theta_dot] (non-symplectic; reference path)`
      : `Classical fixed-step RK4, h = ${stepS} s, 8-state [r, v, theta, theta_dot] (non-symplectic)`,
    reducedMassKg: reducedMass,
    massRatio,
    initial: {
      radiusM: r0Mag,
      speedMS: v0Mag,
      orbitEnergy: E0,
      orbitAngularMomentum: h0,
      periodS: elements0.periodS,
      eccentricity: elements0.eccentricity,
      meanMotionRadS: n0,
      librationPeriodS: 2 * Math.PI / (Math.sqrt(3) * n0),
    },
    final: {
      radiusM: series.radius[last],
      speedMS: series.speed[last],
      thetaDeg: series.thetaDeg[last],
      thetaRateDegPerS: series.thetaRateDegPerS[last],
      lengthM: series.lengthM[last],
      tensionVerticalN: series.tensionVerticalN[last],
    },
    maxAbsThetaDeg: Math.max(...series.thetaDeg.map(Math.abs)),
    maxTensionN: Math.max(...series.tensionVerticalN),
    maxLengthOverRadius,
    maxEpsEnergyOrbit: Math.max(...series.epsEnergyOrbit),
    maxEpsAngularMomentumOrbit: Math.max(...series.epsAngularMomentumOrbit),
    warnings,
  };
}

/**
 * Exact radial force balance for a vertical, rigidly rotating dumbbell, using the
 * full point-mass gravity (no linearisation). Used only as an independent check of
 * the first-order tension diagnostic in the verification suite.
 */
export function verticalTensionExactN(
  mu: number,
  m1: number,
  m2: number,
  lengthM: number,
  radiusM: number,
): { tensionOuterN: number; tensionInnerN: number; linearisedN: number } {
  const M = m1 + m2;
  const a2 = (m1 / M) * lengthM; // m2 sits outward
  const a1 = (m2 / M) * lengthM; // m1 sits inward
  const n2 = mu / radiusM ** 3;
  const rOuter = radiusM + a2;
  const rInner = radiusM - a1;
  const tensionOuterN = m2 * (n2 * rOuter - mu / rOuter ** 2);
  const tensionInnerN = m1 * (mu / rInner ** 2 - n2 * rInner);
  const reduced = (m1 * m2) / M;
  return { tensionOuterN, tensionInnerN, linearisedN: (3 * reduced * mu * lengthM) / radiusM ** 3 };
}

/** Force difference between the two ends along the local vertical, for diagnostics. */
export function verticalGravityDifferenceN(mu: number, m1: number, m2: number, lengthM: number, radiusM: number): number {
  const M = m1 + m2;
  const a2 = (m1 / M) * lengthM;
  const a1 = (m2 / M) * lengthM;
  const gOuter = mu / (radiusM + a2) ** 2;
  const gInner = mu / (radiusM - a1) ** 2;
  return (m1 * m2) / M * (gInner - gOuter);
}

/** In-plane libration right-hand side, exposed for unit tests of the equation. */
export function librationAcceleration(thetaRad: number, nRadS: number, lengthDotOverLength: number, thetaDot: number): number {
  return -3 * nRadS ** 2 * Math.sin(thetaRad) * Math.cos(thetaRad) - 2 * lengthDotOverLength * thetaDot;
}

/** Angular momentum of the dumbbell about its centre of mass, out-of-plane component. */
export function dumbbellAngularMomentum(reducedMass: number, lengthM: number, thetaDot: number): number {
  return reducedMass * lengthM ** 2 * thetaDot;
}

/** Direction cosines helper used by tests to confirm the in-plane equation only. */
export function tetherDirection(thetaRad: number): Vec3 {
  return [Math.cos(thetaRad), Math.sin(thetaRad), 0];
}

export function angularMomentumVector(r: Vec3, v: Vec3): Vec3 {
  return cross(r, v);
}

export function dotProduct(a: Vec3, b: Vec3): number {
  return dot(a, b);
}
