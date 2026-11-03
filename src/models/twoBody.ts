/**
 * Model OTL-2BP: two-body point-mass orbital mechanics.
 *
 * This module contains the declarative model registry entry (equations,
 * assumptions, excluded effects, limits) and the executable calculation. The
 * registry entry is data; the calculation is code. Equations are flagged
 * implementedInCode only when a shipped function evaluates them.
 */

import { MAX_STEPS, MU_EARTH } from "../core/constants";
import { fmt } from "../core/units";
import type { ParameterInput, ParameterSpec, ValidationIssue } from "../core/validation";
import { validateParameters } from "../core/validation";
import {
  propagateTwoBody,
  stateFromElements,
  type SolverSelection,
  type TimeSeries,
} from "../core/twobody";
import type { CalculationResult, ModelSpec, SeriesColumn } from "./types";

export const TWO_BODY_MODEL_ID = "OTL-2BP";
export const TWO_BODY_MODEL_VERSION = "1.0.0";

export type TwoBodySolverMethod = "RK4" | "DOPRI5";

export const POSITION_PARAM_IDS = ["initialPositionX", "initialPositionY", "initialPositionZ"] as const;
export const VELOCITY_PARAM_IDS = ["initialVelocityX", "initialVelocityY", "initialVelocityZ"] as const;

const BASE_SPECS: ParameterSpec[] = [
  {
    id: "gravitationalParameter",
    label: "Gravitational parameter μ",
    quantity: "gravitationalParameter",
    unit: "m3s2",
    required: true,
    min: 1e10,
    max: 1e18,
    description:
      "Central-body gravitational parameter GM. Default is Earth (IERS Conventions 2010). Changing it means a different central body.",
    boundRationale: "Range spans small asteroids to the Sun; outside it the point-mass orbit model is not the intended regime.",
  },
  {
    id: "initialPositionX",
    label: "Initial position x",
    quantity: "length",
    unit: "km",
    required: true,
    description: "Inertial x component of the initial position, measured from the central-body centre of mass.",
  },
  {
    id: "initialPositionY",
    label: "Initial position y",
    quantity: "length",
    unit: "km",
    required: true,
    description: "Inertial y component of the initial position.",
  },
  {
    id: "initialPositionZ",
    label: "Initial position z",
    quantity: "length",
    unit: "km",
    required: true,
    description: "Inertial z component of the initial position.",
  },
  {
    id: "initialVelocityX",
    label: "Initial velocity vx",
    quantity: "velocity",
    unit: "kmps",
    required: true,
    description: "Inertial x component of the initial velocity.",
  },
  {
    id: "initialVelocityY",
    label: "Initial velocity vy",
    quantity: "velocity",
    unit: "kmps",
    required: true,
    description: "Inertial y component of the initial velocity.",
  },
  {
    id: "initialVelocityZ",
    label: "Initial velocity vz",
    quantity: "velocity",
    unit: "kmps",
    required: true,
    description: "Inertial z component of the initial velocity.",
  },
  {
    id: "duration",
    label: "Propagation duration",
    quantity: "time",
    unit: "h",
    required: true,
    min: 1e-6,
    max: 720,
    description: "Total simulated time. Internally converted to seconds.",
    boundRationale: "Upper bound of 720 h (30 days) keeps the requested step budget finite in a browser runtime.",
  },
  {
    id: "stepSeconds",
    label: "RK4 step size h",
    quantity: "time",
    unit: "s",
    required: true,
    min: 1e-3,
    max: 1e5,
    description: "Fixed integration step for the classical RK4 solver. Determines both cost and truncation error.",
    boundRationale: "A step below 1 ms is not resolvable in double precision for orbital states of order 1e7 m.",
  },
  {
    id: "relTolerance",
    label: "DOPRI5 relative tolerance",
    quantity: "dimensionless",
    unit: "none",
    required: true,
    min: 1e-14,
    max: 1e-2,
    description: "Relative error tolerance for the adaptive Dormand–Prince 5(4) step controller.",
    boundRationale: "Below 1e-14 double-precision round-off dominates the embedded error estimate; above 1e-2 the solution is not a credible orbit.",
  },
  {
    id: "absTolerance",
    label: "DOPRI5 absolute tolerance",
    quantity: "dimensionless",
    unit: "none",
    required: true,
    min: 1e-14,
    max: 1e-2,
    description:
      "Absolute error floor applied to the mixed SI state vector (m and m/s). Documented simplification: a single scalar is used for a mixed-unit state, so relTolerance governs in practice.",
    boundRationale: "Same numerical floor as the relative tolerance.",
  },
  {
    id: "initialStepSeconds",
    label: "DOPRI5 initial step h0",
    quantity: "time",
    unit: "s",
    required: true,
    min: 1e-3,
    max: 1e7,
    description: "Initial trial step for the adaptive controller. The controller may grow or shrink it.",
    boundRationale: "Must be finite and positive; the controller adapts from here.",
  },
  {
    id: "maxStepSeconds",
    label: "DOPRI5 maximum step hmax",
    quantity: "time",
    unit: "s",
    required: true,
    min: 1e-3,
    max: 1e7,
    description: "Hard cap on the adaptive step size.",
    boundRationale: "Must be finite and positive.",
  },
];

export function twoBodyParameterSpecs(method: TwoBodySolverMethod): ParameterSpec[] {
  const always = BASE_SPECS.filter(
    (s) => !["stepSeconds", "relTolerance", "absTolerance", "initialStepSeconds", "maxStepSeconds"].includes(s.id),
  );
  const solverSpecs = BASE_SPECS.filter((s) =>
    method === "RK4" ? s.id === "stepSeconds" : ["relTolerance", "absTolerance", "initialStepSeconds", "maxStepSeconds"].includes(s.id),
  );
  return [...always, ...solverSpecs];
}

export const TWO_BODY_MODEL: ModelSpec = {
  id: TWO_BODY_MODEL_ID,
  version: TWO_BODY_MODEL_VERSION,
  name: "Two-body point-mass propagation",
  family: "ORBITAL_MECHANICS",
  status: "IMPLEMENTED",
  summary:
    "Numerically integrates the Newtonian two-body problem for a point mass about a fixed central mass, in an inertial frame, and reports orbital elements plus measured energy and angular-momentum diagnostics.",
  referenceFrame:
    "Inertial frame with origin at the central body's centre of mass. Axes are treated as inertially fixed; no frame precession, nutation or Earth rotation is applied (this is not a strict J2000 realisation).",
  coordinateConventions:
    "Right-handed Cartesian axes. Position and velocity are given as (x, y, z) and (vx, vy, vz). Angles (inclination, RAAN, argument of periapsis, true anomaly) are measured in the standard classical (Keplerian) convention and reported in radians plus degrees.",
  unitConventions:
    "All internal computation is SI: metres, seconds, kilograms, m/s, m^3/s^2, J/kg (specific energy), m^2/s (specific angular momentum). Inputs may be entered in km, km/s or hours and are converted once at validation.",
  initialConditionDefinition:
    "The initial state is the inertial position and velocity at t = 0. Osculating elements are derived from this state, not supplied independently: there is one source of truth for the initial condition.",
  massRepresentation:
    "The orbiting body is a point mass; its mass does not enter the equation of motion. The central body is a point mass characterised only by μ = GM.",
  governingEquations: [
    {
      id: "EQ-2BP-1",
      statement: "r''(t) = -μ · r(t) / |r(t)|³",
      implementedInCode: true,
      note: "Evaluated by twoBodyDerivative() and integrated by RK4 or DOPRI5.",
    },
    {
      id: "EQ-2BP-2",
      statement: "E = ½|v|² − μ/|r|   [J/kg]",
      implementedInCode: true,
      note: "Specific mechanical energy, evaluated at every sample.",
    },
    {
      id: "EQ-2BP-3",
      statement: "h = r × v   [m²/s],  |h| reported",
      implementedInCode: true,
    },
    {
      id: "EQ-2BP-4",
      statement: "a = (2/|r| − |v|²/μ)⁻¹   [m]",
      implementedInCode: true,
      note: "Osculating semi-major axis; null when the energy is numerically zero (parabolic limit).",
    },
    {
      id: "EQ-2BP-5",
      statement: "e = |((|v|² − μ/|r|)·r − (r·v)·v) / μ|",
      implementedInCode: true,
    },
    {
      id: "EQ-2BP-6",
      statement: "T = 2π·√(a³/μ)",
      implementedInCode: true,
      note: "Evaluated only for closed orbits (E < 0). For open orbits T is reported as null, never estimated.",
    },
    {
      id: "EQ-2BP-7",
      statement: "ε_E = |E(t) − E(0)| / max(|E(0)|, E_scale),  E_scale = μ/|r₀|",
      implementedInCode: true,
      note: "E_scale is a state-independent specific-energy scale; it is nonzero for every accepted initial state.",
    },
    {
      id: "EQ-2BP-8",
      statement: "ε_h = ||h(t)| − |h(0)|| / max(|h(0)|, h_scale),  h_scale = |r₀|·|v₀|",
      implementedInCode: true,
      note: "Zero initial speed would make h_scale zero, so that state is rejected rather than normalised differently.",
    },
    {
      id: "EQ-2BP-9",
      statement: "r'' = −μ r/|r|³ + a_J2 + a_drag + a_3body + a_SRP",
      implementedInCode: false,
      note: "Documented for future work only. No perturbation term is evaluated anywhere in this build.",
    },
  ],
  assumptions: [
    "The central body is spherically symmetric and is treated as a fixed point mass; its motion about the system barycentre is neglected.",
    "The orbiting body is a point mass with negligible mass relative to the central body.",
    "The reference frame is inertial: no Earth rotation, precession or nutation is modelled.",
    "No external forces other than central gravity act on the body.",
    "Classical elements are osculating elements of the instantaneous state, not mean elements.",
  ],
  effects: [
    { effect: "Central point-mass gravity", status: "MODELED" },
    { effect: "Earth oblateness (J2 and higher)", status: "NOT_MODELED", note: "Dominant unmodelled perturbation in low Earth orbit." },
    { effect: "Atmospheric drag", status: "NOT_MODELED", note: "Relevant below roughly 600 km altitude; no atmosphere model exists in this build." },
    { effect: "Third-body (Sun, Moon) gravity", status: "NOT_MODELED" },
    { effect: "Solar radiation pressure", status: "NOT_MODELED" },
    { effect: "Relativistic corrections", status: "NOT_MODELED" },
    { effect: "Thrust / manoeuvres", status: "NOT_MODELED" },
    { effect: "Attitude dynamics", status: "NOT_MODELED", note: "The body is a point mass; attitude cannot affect the trajectory in this model." },
    { effect: "Tidal deformation / non-spherical mass distribution", status: "NOT_MODELED" },
  ],
  numericalMethod:
    "Explicit single-step integration of a 6-state ODE. Two methods are available: classical fixed-step RK4 (order 4) and adaptive Dormand–Prince 5(4). Both are non-symplectic, so energy and angular momentum drift is expected and is measured, not assumed away.",
  solverSettings: [
    "RK4: fixed step h chosen by the researcher (seconds). The final step is clipped so the propagated duration is exact.",
    "DOPRI5: relative/absolute tolerance, initial step and maximum step chosen by the researcher. Step control uses the standard 5(4) exponent -1/5 with a safety factor of 0.9.",
    "No solver silently changes method or step size; if the requested settings cannot be honoured an error is raised.",
    `Hard step budget: ${MAX_STEPS.toLocaleString("en-US")} attempted steps per propagation (browser runtime guard).`,
  ],
  validityLimits: [
    "Valid as a solution of the stated point-mass equations only; it is not a trajectory prediction for a real spacecraft.",
    "Physical interpretation requires r above the central body's surface and outside its atmosphere.",
    "Classical elements become ill-conditioned near the parabolic limit (E ≈ 0) and for near-circular equatorial orbits where node and periapsis are undefined.",
    "Long propagations accumulate truncation error; convergence must be demonstrated for the specific case, not assumed.",
  ],
  knownFailureModes: [
    "r = 0 produces a singular gravity field; rejected with SINGULAR_GEOMETRY.",
    "Zero initial speed makes the documented h normalisation degenerate; rejected with DEGENERATE_ANGULAR_MOMENTUM_NORMALIZATION.",
    "A step comparable to or larger than the orbital period aliases the orbit and can produce plausible-looking but wrong results; the step-per-period warning exists for this reason.",
    "Near-parabolic initial states can report a null semi-major axis even though a finite osculating ellipse exists.",
  ],
  verificationCheckIds: [
    "OT-TB-001",
    "OT-TB-002",
    "OT-TB-003",
    "OT-TB-004",
    "OT-TB-005",
    "OT-TB-006",
    "OT-TB-007",
    "OT-TB-008",
    "OT-TB-009",
  ],
  parameterSpecs: twoBodyParameterSpecs("RK4"),
  limitations: [
    "No perturbation model: results differ from a real orbit by an amount this build cannot quantify.",
    "No validation against flight data has been performed.",
    "The frame is an idealised inertial frame, not a rigorous J2000/ICRF realisation.",
    "Verification checks validate the implementation of these equations, not the physical fidelity of the model.",
  ],
  references: [
    { label: "Vallado, D. A., Fundamentals of Astrodynamics and Applications (4th ed.), Microcosm Press", note: "Two-body equations, classical elements, Kepler's equation." },
    { label: "IERS Conventions (2010), Table 1.1", url: "https://iers-conventions.obspm.fr/", note: "GM(Earth) = 3.986004418e14 m³/s²." },
    { label: "NIMA, WGS-84 (TR8350.2)", note: "Equatorial radius a = 6378137 m." },
    { label: "Dormand, J. R. & Prince, P. J., A family of embedded Runge–Kutta formulae, J. Comput. Appl. Math. 6 (1980) 19–26", note: "DOPRI5 Butcher tableau." },
    { label: "Hairer, Nørsett & Wanner, Solving Ordinary Differential Equations I", note: "Error control and step-size selection for explicit RK pairs." },
  ],
  outOfScope: [
    "Any perturbation force model.",
    "Any estimation/fitting against tracking data.",
    "Any operational or flight-planning use.",
  ],
};

export interface TwoBodyValidation {
  ok: boolean;
  issues: ValidationIssue[];
  si: Record<string, number>;
  accepted: ReturnType<typeof validateParameters>["accepted"];
  extraWarnings: string[];
}

/** Validation for OTL-2BP: declarative parameter checks plus model-specific physics checks. */
export function validateTwoBodyInputs(inputs: ParameterInput[], method: TwoBodySolverMethod): TwoBodyValidation {
  const base = validateParameters(twoBodyParameterSpecs(method), inputs);
  const issues = [...base.issues];
  const extraWarnings: string[] = [];

  if (base.ok) {
    const { si } = base;
    const rx = si.initialPositionX ?? 0;
    const ry = si.initialPositionY ?? 0;
    const rz = si.initialPositionZ ?? 0;
    const rMag = Math.hypot(rx, ry, rz);
    const vMag = Math.hypot(si.initialVelocityX ?? 0, si.initialVelocityY ?? 0, si.initialVelocityZ ?? 0);

    if (!(rMag > 0)) {
      issues.push({
        code: "SINGULAR_GEOMETRY",
        severity: "error",
        paramId: "initialPositionX",
        message:
          "Initial position is the zero vector, where the point-mass gravity field is singular. The model cannot be evaluated at r = 0.",
      });
    }
    if (!(vMag > 0)) {
      issues.push({
        code: "DEGENERATE_ANGULAR_MOMENTUM_NORMALIZATION",
        severity: "error",
        paramId: "initialVelocityX",
        message:
          "Initial speed is zero. The documented angular-momentum scale |r₀|·|v₀| would be zero, so ε_h is undefined. This condition is unsupported rather than silently re-normalised.",
      });
    }

    const durationS = si.duration ?? 0;
    if (method === "RK4") {
      const step = si.stepSeconds ?? 0;
      const steps = Math.ceil(durationS / step);
      if (steps > MAX_STEPS) {
        issues.push({
          code: "STEP_BUDGET_EXCEEDED",
          severity: "error",
          paramId: "stepSeconds",
          message: `duration/step requires ${steps.toLocaleString("en-US")} steps, above the ${MAX_STEPS.toLocaleString("en-US")} step budget. Increase the step or shorten the duration; the application will not silently change either.`,
        });
      }
    } else {
      if ((si.initialStepSeconds ?? 0) > (si.maxStepSeconds ?? 0)) {
        issues.push({
          code: "INVALID_SOLVER_SETTINGS",
          severity: "error",
          paramId: "initialStepSeconds",
          message: "Initial step must not exceed the maximum step; the controller would otherwise be clamped from its first attempt.",
        });
      }
      if (si.maxStepSeconds && durationS / si.maxStepSeconds > MAX_STEPS) {
        issues.push({
          code: "STEP_BUDGET_EXCEEDED",
          severity: "error",
          paramId: "maxStepSeconds",
          message: `Duration divided by the maximum step exceeds the ${MAX_STEPS.toLocaleString("en-US")} step budget.`,
        });
      }
    }

    if (rMag > 0 && vMag > 0) {
      const mu = si.gravitationalParameter ?? MU_EARTH;
      const energy = 0.5 * vMag * vMag - mu / rMag;
      if (energy >= 0) {
        extraWarnings.push(
          "Initial osculating energy is non-negative: the orbit is open. No orbital period will be reported (a value would require an unsupported extrapolation).",
        );
      }
      const rCirc = rMag;
      const vCirc = Math.sqrt(mu / rCirc);
      if (energy < 0) {
        const a = -mu / (2 * energy);
        const period = 2 * Math.PI * Math.sqrt(a ** 3 / mu);
        const stepsPerPeriod = method === "RK4" ? period / (si.stepSeconds ?? 1) : period / (si.maxStepSeconds ?? 1);
        if (stepsPerPeriod < 50) {
          extraWarnings.push(
            `Only ${stepsPerPeriod.toFixed(1)} ${method === "RK4" ? "RK4 steps" : "maximum adaptive-step steps"} per orbital period. Truncation error is likely to dominate; a convergence test is required for this configuration.`,
          );
        }
      }
      if (rMag < 6378137 && mu === MU_EARTH) {
        extraWarnings.push(
          "Initial radius is below the Earth equatorial radius. The point-mass equations have no surface; results below the surface have no physical interpretation.",
        );
      }
      void vCirc;
    }
  }

  return { ok: !issues.some((i) => i.severity === "error"), issues, si: base.si, accepted: base.accepted, extraWarnings };
}

const COLUMNS: SeriesColumn[] = [
  { key: "t", label: "Time", unit: "s" },
  { key: "x", label: "Position x", unit: "m" },
  { key: "y", label: "Position y", unit: "m" },
  { key: "z", label: "Position z", unit: "m" },
  { key: "vx", label: "Velocity vx", unit: "m/s" },
  { key: "vy", label: "Velocity vy", unit: "m/s" },
  { key: "vz", label: "Velocity vz", unit: "m/s" },
  { key: "radius", label: "Radius |r|", unit: "m" },
  { key: "speed", label: "Speed |v|", unit: "m/s" },
  { key: "energy", label: "Specific energy E", unit: "J/kg" },
  { key: "hMag", label: "Specific angular momentum |h|", unit: "m^2/s" },
  { key: "epsEnergy", label: "Normalised energy discrepancy ε_E", unit: "1" },
  { key: "epsAngularMomentum", label: "Normalised angular-momentum discrepancy ε_h", unit: "1" },
];

/** Execute a validated OTL-2BP calculation. Requires SI inputs that already passed validation. */
export function calculateTwoBody(si: Record<string, number>, method: TwoBodySolverMethod): CalculationResult {
  const mu = si.gravitationalParameter;
  const positionM: [number, number, number] = [si.initialPositionX, si.initialPositionY, si.initialPositionZ];
  const velocityMS: [number, number, number] = [si.initialVelocityX, si.initialVelocityY, si.initialVelocityZ];
  const durationS = si.duration;

  const solver: SolverSelection =
    method === "RK4"
      ? { method: "RK4", stepS: si.stepSeconds }
      : {
          method: "DOPRI5",
          relTol: si.relTolerance,
          absTol: si.absTolerance,
          initialStepS: si.initialStepSeconds,
          maxStepS: si.maxStepSeconds,
        };

  const result = propagateTwoBody({ mu, positionM, velocityMS, durationS, solver });
  const s: TimeSeries = result.series;

  const elements = result.final.elements;
  const metrics = [
    { id: "mu", label: "Gravitational parameter μ", value: mu, unit: "m^3/s^2" },
    { id: "initialRadius", label: "Initial radius |r₀|", value: result.initial.radiusM, unit: "m" },
    { id: "initialSpeed", label: "Initial speed |v₀|", value: result.initial.speedMS, unit: "m/s" },
    { id: "finalRadius", label: "Final radius |r(t)|", value: result.final.radiusM, unit: "m" },
    { id: "finalSpeed", label: "Final speed |v(t)|", value: result.final.speedMS, unit: "m/s" },
    { id: "energyInitial", label: "Specific energy E(0)", value: result.initial.energyJPerKg, unit: "J/kg" },
    { id: "energyFinal", label: "Specific energy E(t)", value: result.final.energyJPerKg, unit: "J/kg" },
    { id: "energyDrift", label: "Max |E(t) − E(0)|", value: result.maxAbsEnergyDriftJPerKg, unit: "J/kg" },
    {
      id: "epsEnergy",
      label: "Max normalised energy discrepancy ε_E",
      value: result.maxEpsEnergy,
      unit: "1",
      note: `Denominator max(|E(0)|, μ/|r₀|) with μ/|r₀| = ${fmt(result.energyScaleJPerKg)} J/kg`,
    },
    {
      id: "epsAngularMomentum",
      label: "Max normalised angular-momentum discrepancy ε_h",
      value: result.maxEpsAngularMomentum,
      unit: "1",
      note: `Denominator max(|h(0)|, |r₀||v₀|) with |r₀||v₀| = ${fmt(result.angularMomentumScaleM2PerS)} m²/s`,
    },
    { id: "hInitial", label: "Specific angular momentum |h(0)|", value: result.initial.angularMomentumM2PerS, unit: "m^2/s" },
    { id: "hFinal", label: "Specific angular momentum |h(t)|", value: result.final.angularMomentumM2PerS, unit: "m^2/s" },
    { id: "semiMajorAxis", label: "Final osculating semi-major axis a", value: elements.semiMajorAxisM, unit: "m" },
    { id: "eccentricity", label: "Final osculating eccentricity e", value: elements.eccentricity, unit: "1" },
    {
      id: "inclination",
      label: "Final osculating inclination i",
      value: (elements.inclinationRad * 180) / Math.PI,
      unit: "deg",
    },
    {
      id: "raan",
      label: "Final osculating RAAN Ω",
      value: (elements.raanRad * 180) / Math.PI,
      unit: "deg",
      note: "Undefined by convention (reported 0) when the orbit is equatorial.",
    },
    {
      id: "argPeriapsis",
      label: "Final osculating argument of periapsis ω",
      value: (elements.argPeriapsisRad * 180) / Math.PI,
      unit: "deg",
      note: "Undefined by convention (reported 0) for a circular orbit.",
    },
    { id: "period", label: "Final osculating orbital period T", value: elements.periodS, unit: "s", note: "Null for open orbits." },
    { id: "periapsis", label: "Final osculating periapsis radius", value: elements.periapsisRadiusM, unit: "m" },
    { id: "apoapsis", label: "Final osculating apoapsis radius", value: elements.apoapsisRadiusM, unit: "m" },
    { id: "minRadius", label: "Minimum radius over propagation", value: result.minRadiusM, unit: "m" },
    { id: "maxRadius", label: "Maximum radius over propagation", value: result.maxRadiusM, unit: "m" },
    { id: "maxSpeed", label: "Maximum speed over propagation", value: result.maxSpeedMS, unit: "m/s" },
    { id: "samples", label: "Recorded samples", value: s.t.length, unit: "count" },
    { id: "steps", label: "Integration steps accepted", value: result.steps, unit: "count" },
    { id: "stepsRejected", label: "Integration steps rejected", value: result.rejectedSteps, unit: "count" },
  ];

  return {
    modelId: TWO_BODY_MODEL_ID,
    modelVersion: TWO_BODY_MODEL_VERSION,
    columns: COLUMNS,
    series: {
      t: s.t,
      x: s.x,
      y: s.y,
      z: s.z,
      vx: s.vx,
      vy: s.vy,
      vz: s.vz,
      radius: s.radius,
      speed: s.speed,
      energy: s.energy,
      hMag: s.hMag,
      epsEnergy: s.epsEnergy,
      epsAngularMomentum: s.epsAngularMomentum,
    },
    metrics,
    solver: {
      method,
      description: result.solverDescription,
      settings:
        method === "RK4"
          ? { stepS: si.stepSeconds }
          : {
              relTol: si.relTolerance,
              absTol: si.absTolerance,
              initialStepS: si.initialStepSeconds,
              maxStepS: si.maxStepSeconds,
            },
    },
    warnings: [...result.warnings],
    limitations: TWO_BODY_MODEL.limitations,
    unresolved: elements.isClosed
      ? []
      : [
          {
            item: "Orbital period T",
            reason: `Final osculating orbit is ${elements.regime}; a period is undefined for an open orbit.`,
          },
        ],
  };
}

/**
 * Documented scenario presets. Values are derived from the cited μ and element sets.
 * A preset may carry settings for both solver methods; only the parameters declared
 * by the selected method are submitted, and anything else would be rejected as an
 * unknown parameter rather than ignored.
 */
export interface ScenarioPreset {
  id: string;
  name: string;
  description: string;
  method: TwoBodySolverMethod;
  values: Record<string, { value: number; unit: string }>;
}

function km(value: number): { value: number; unit: string } {
  return { value: value / 1000, unit: "km" };
}
function kmps(value: number): { value: number; unit: string } {
  return { value: value / 1000, unit: "kmps" };
}

function presetFromElements(
  id: string,
  name: string,
  description: string,
  a: number,
  e: number,
  inclinationDeg: number,
  raanDeg: number,
  argpDeg: number,
  nuDeg: number,
  durationHours: number,
  stepS: number,
): ScenarioPreset {
  const st = stateFromElements(
    MU_EARTH,
    a,
    e,
    (inclinationDeg * Math.PI) / 180,
    (raanDeg * Math.PI) / 180,
    (argpDeg * Math.PI) / 180,
    (nuDeg * Math.PI) / 180,
  );
  return {
    id,
    name,
    description,
    method: "RK4",
    values: {
      gravitationalParameter: { value: MU_EARTH, unit: "m3s2" },
      initialPositionX: km(st.positionM[0]),
      initialPositionY: km(st.positionM[1]),
      initialPositionZ: km(st.positionM[2]),
      initialVelocityX: kmps(st.velocityMS[0]),
      initialVelocityY: kmps(st.velocityMS[1]),
      initialVelocityZ: kmps(st.velocityMS[2]),
      duration: { value: durationHours, unit: "h" },
      stepSeconds: { value: stepS, unit: "s" },
      relTolerance: { value: 1e-10, unit: "none" },
      absTolerance: { value: 1e-10, unit: "none" },
      initialStepSeconds: { value: 10, unit: "s" },
      maxStepSeconds: { value: 60, unit: "s" },
    },
  };
}

export const TWO_BODY_PRESETS: ScenarioPreset[] = [
  presetFromElements(
    "leo-circular-400",
    "LEO circular 400 km, 3 revolutions",
    "Circular low Earth orbit at 400 km altitude in the equatorial plane. Period ≈ 92.5 min.",
    6378137 + 400e3,
    0,
    0,
    0,
    0,
    0,
    5,
    10,
  ),
  presetFromElements(
    "leo-circular-400-inclined",
    "LEO circular 400 km, i = 51.6°",
    "Same circular orbit inclined by 51.6°, to exercise the 3-D element solution (RAAN and inclination non-degenerate).",
    6378137 + 400e3,
    0,
    51.6,
    40,
    0,
    0,
    5,
    10,
  ),
  presetFromElements(
    "gto-eccentric",
    "GTO-like eccentric orbit (e ≈ 0.73)",
    "Perigee ≈ 187 km altitude (6 565.5 km radius) and apogee near geostationary radius (42 176 km). This is a textbook GTO element set (a = 24 371 km, e = 0.7306) chosen for its strong eccentricity, which stresses both the integrator and the element solution.",
    24371e3,
    0.7306,
    27,
    0,
    180,
    0,
    12,
    10,
  ),
  presetFromElements(
    "gps-molniya",
    "Molniya-like orbit, i = 63.4°",
    "Highly eccentric 12 h orbit at the critical inclination: long-period geometry with a slow perigee passage.",
    26560e3,
    0.74,
    63.4,
    90,
    270,
    10,
    24,
    30,
  ),
];