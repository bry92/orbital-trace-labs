/**
 * Model TETH-1 registry entry, validation and executable calculation.
 *
 * Scope statement (repeated on purpose): prescribed length, massless rigid rod,
 * in-plane libration, one-way coupling to a two-body reference orbit, quasi-static
 * vertical tension diagnostic. Dynamically solved deployment, reel dynamics,
 * coupled orbital dynamics, out-of-plane motion, elasticity and damping are all
 * NOT_MODELED. See core/tether.ts for the derivation.
 */

import { MAX_STEPS, MU_EARTH } from "../core/constants";
import type { ParameterInput, ParameterSpec, ValidationIssue } from "../core/validation";
import { validateParameters } from "../core/validation";
import { computeElements } from "../core/twobody";
import { propagateTether } from "../core/tether";
import type { CalculationResult, ModelSpec, SeriesColumn } from "./types";
import type { ScenarioPreset } from "./twoBody";

export const TETHER_MODEL_ID = "OTL-TETH-1";
export const TETHER_MODEL_VERSION = "1.0.0";

export const TETHER_PARAMETER_SPECS: ParameterSpec[] = [
  {
    id: "gravitationalParameter",
    label: "Gravitational parameter μ",
    quantity: "gravitationalParameter",
    unit: "m3s2",
    required: true,
    min: 1e10,
    max: 1e18,
    description: "Central-body gravitational parameter. Earth by default (IERS 2010).",
  },
  {
    id: "initialPositionX",
    label: "Reference-orbit position x",
    quantity: "length",
    unit: "km",
    required: true,
    description: "Inertial x coordinate of the centre of mass at t = 0.",
  },
  {
    id: "initialPositionY",
    label: "Reference-orbit position y",
    quantity: "length",
    unit: "km",
    required: true,
    description: "Inertial y coordinate of the centre of mass at t = 0.",
  },
  {
    id: "initialPositionZ",
    label: "Reference-orbit position z",
    quantity: "length",
    unit: "km",
    required: true,
    description: "Inertial z coordinate of the centre of mass at t = 0.",
  },
  {
    id: "initialVelocityX",
    label: "Reference-orbit velocity vx",
    quantity: "velocity",
    unit: "kmps",
    required: true,
    description: "Inertial x velocity of the centre of mass at t = 0.",
  },
  {
    id: "initialVelocityY",
    label: "Reference-orbit velocity vy",
    quantity: "velocity",
    unit: "kmps",
    required: true,
    description: "Inertial y velocity of the centre of mass at t = 0.",
  },
  {
    id: "initialVelocityZ",
    label: "Reference-orbit velocity vz",
    quantity: "velocity",
    unit: "kmps",
    required: true,
    description: "Inertial z velocity of the centre of mass at t = 0.",
  },
  {
    id: "satelliteMass",
    label: "Payload mass m₁",
    quantity: "mass",
    unit: "kg",
    required: true,
    min: 1e-3,
    max: 1e7,
    description: "Mass of the deployed end body. Treated as a point mass.",
    boundRationale: "Non-positive mass has no meaning in this representation; the upper bound keeps the point-mass idealisation defensible.",
  },
  {
    id: "orbiterMass",
    label: "Counterweight mass m₂",
    quantity: "mass",
    unit: "kg",
    required: true,
    min: 1e-3,
    max: 1e8,
    description:
      "Effective mass at the other end (for a historical case this is often the unknown orbiter-side attachment mass). Used only through the reduced mass.",
    boundRationale: "Must be positive; the reduced mass is undefined otherwise.",
  },
  {
    id: "tetherLength",
    label: "Initial tether length L₀",
    quantity: "length",
    unit: "km",
    required: true,
    min: 0.001,
    max: 1000,
    description: "Length at t = 0. Prescribed, not solved.",
    boundRationale: "Below 1 m the point-mass dumbbell is not a meaningful representation; above 1000 km the first-order L/r treatment is far outside its regime.",
  },
  {
    id: "deploymentRate",
    label: "Deployment rate dL/dt",
    quantity: "velocity",
    unit: "mps",
    required: true,
    min: 0,
    max: 100,
    description:
      "Constant prescribed rate of length change. Zero means a fixed-length tether. Retrieval (negative rate) is not modelled.",
    boundRationale: "Only deployment is represented; 100 m/s is far above any realistic tether deployment rate.",
  },
  {
    id: "theta0",
    label: "Initial in-plane libration angle θ₀",
    quantity: "angle",
    unit: "deg",
    required: true,
    min: -180,
    max: 180,
    description:
      "Angle between the tether and the local vertical, measured in the orbital plane. Zero is the gravity-gradient-stable vertical.",
  },
  {
    id: "thetaDot0",
    label: "Initial libration rate dθ/dt",
    quantity: "angularRate",
    unit: "degps",
    required: true,
    min: -360,
    max: 360,
    description: "In-plane angular rate at t = 0.",
  },
  {
    id: "duration",
    label: "Propagation duration",
    quantity: "time",
    unit: "h",
    required: true,
    min: 1e-6,
    max: 720,
    description: "Total simulated time.",
    boundRationale: "Upper bound of 720 h keeps the fixed-step budget finite in a browser runtime.",
  },
  {
    id: "stepSeconds",
    label: "RK4 step size h",
    quantity: "time",
    unit: "s",
    required: true,
    min: 1e-3,
    max: 1e5,
    description: "Fixed integration step for the 8-state dumbbell + reference-orbit propagation.",
    boundRationale: "A step below 1 ms is not resolvable for these state magnitudes.",
  },
];

export const TETHER_MODEL: ModelSpec = {
  id: TETHER_MODEL_ID,
  version: TETHER_MODEL_VERSION,
  name: "Gravity-gradient dumbbell with prescribed length history",
  family: "TETHER_MECHANICS",
  status: "IMPLEMENTED",
  summary:
    "Two point masses on a massless rigid rod of prescribed length, librating in the orbital plane under gravity-gradient torque, with the centre of mass on a two-body reference orbit. Reports a separate quasi-static vertical tension diagnostic.",
  statusRationale:
    "Implementation is deliberately narrower than 'tether deployment dynamics'. Length is an input, coupling is one-way, and only in-plane libration is solved. The broader models (dynamic deployment, coupled orbital dynamics) are separate registry entries with status NOT_MODELED.",
  referenceFrame:
    "Inertial frame for the centre of mass, plus a local orbital frame for the libration angle: θ is measured in the orbital plane from the local vertical (radially outward direction), positive toward the along-track direction.",
  coordinateConventions:
    "Centre of mass in Cartesian inertial coordinates. θ in radians internally, displayed in degrees. The tether lies in the orbital plane by construction; out-of-plane motion is not represented.",
  unitConventions:
    "SI internally: m, s, kg, N, rad, rad/s. Angles and angular rates may be entered in degrees; conversion happens once at validation.",
  initialConditionDefinition:
    "The initial state is the centre-of-mass position and velocity plus the initial tether length, libration angle and libration rate. The end masses are derived from the centre of mass using the mass ratio; they are not supplied as separate states.",
  massRepresentation:
    "Two point masses m₁ (payload) and m₂ (counterweight) joined by a massless rigid rod. Only the reduced mass μ_red = m₁m₂/(m₁+m₂) enters the libration equation. Distributed tether mass is NOT_MODELED because no mass-per-length is required or assumed.",
  governingEquations: [
    {
      id: "EQ-T-001",
      statement: "r'' = −μ r / |r|³   (centre-of-mass reference orbit)",
      implementedInCode: true,
      note: "Two-body only; the tether does not react on the centre of mass (one-way coupling).",
    },
    {
      id: "EQ-T-002",
      statement: "L(t) = L₀ + (dL/dt)·t   (prescribed length history)",
      implementedInCode: true,
      note: "Kinematic prescription, not a solution of reel dynamics.",
    },
    {
      id: "EQ-T-003",
      statement: "θ'' + 2(L'/L)θ' + 3n(t)² sinθ cosθ = 0",
      implementedInCode: true,
      note: "In-plane libration with prescribed length change and no deployer torque. Derived from d/dt(μ_red L²θ') = −3n²μ_red L² sinθ cosθ.",
    },
    {
      id: "EQ-T-004",
      statement: "n(t) = √(μ / |r(t)|³)",
      implementedInCode: true,
      note: "Local mean motion from the instantaneous reference-orbit radius.",
    },
    {
      id: "EQ-T-005",
      statement: "T_vert = 3 μ_red μ L / r³   (vertical, first order in L/r)",
      implementedInCode: true,
      note: "Quasi-static diagnostic only, valid for θ ≈ 0. Not the tension of a librating tether.",
    },
    {
      id: "EQ-T-006",
      statement: "μ_red = m₁m₂ / (m₁ + m₂)",
      implementedInCode: true,
    },
    {
      id: "EQ-T-007",
      statement: "Reel dynamics: J_reel θ''_reel = τ_motor − T R_reel",
      implementedInCode: false,
      note: "Documented for future work; no reel inertia, motor torque or brake is implemented.",
    },
    {
      id: "EQ-T-008",
      statement: "Coupled spacecraft–tether orbit: m r'' = F_grav(r, L, θ) + F_tether + F_disturbance",
      implementedInCode: false,
      note: "Not implemented. The current model propagates the centre of mass as an unperturbed two-body orbit.",
    },
    {
      id: "EQ-T-009",
      statement: "Elastic tether: ∂²u/∂t² = (EA/ρ) ∂²u/∂s² + damping",
      implementedInCode: false,
      note: "No axial elasticity, no wave propagation, no damping.",
    },
    {
      id: "EQ-T-010",
      statement: "Out-of-plane libration φ'' + 3n² cos²θ · φ = 0 (linearised)",
      implementedInCode: false,
      note: "Documented only. The implemented model is strictly planar.",
    },
  ],
  assumptions: [
    "The tether is straight, massless and inextensible, and is treated as a rigid rod of prescribed length.",
    "The two end bodies are point masses; their finite size, inertia tensors and attitude dynamics are ignored.",
    "Motion is confined to the orbital plane; out-of-plane libration and three-dimensional attitude are not represented.",
    "Length change is kinematic: the deployer applies no torque and has no inertia. No mechanism, brake or motor is modelled.",
    "The centre of mass follows an unperturbed two-body orbit; the tether exerts no force on it.",
    "The libration equation uses the local mean motion n(t) from the instantaneous radius; eccentricity-dependent coupling terms are omitted.",
    "No aerodynamic, solar-radiation, magnetic or electrodynamic forces act on either end body.",
  ],
  effects: [
    { effect: "Prescribed tether length history", status: "MODELED", note: "Constant or constant-rate; not solved." },
    { effect: "Gravity-gradient torque (in-plane)", status: "MODELED" },
    { effect: "Dynamically calculated deployment (reel dynamics)", status: "NOT_MODELED", note: "Separate model TETH-2, not implemented." },
    { effect: "Coupled spacecraft–tether orbital dynamics", status: "NOT_MODELED", note: "Separate model TETH-3, not implemented. Current coupling is one-way." },
    { effect: "Gravity-gradient tension estimate (vertical, quasi-static)", status: "APPROXIMATE", note: "First order in L/r; not a transient or structural prediction." },
    { effect: "Out-of-plane libration / 3-D attitude", status: "NOT_MODELED" },
    { effect: "Distributed tether mass and taper", status: "NOT_MODELED" },
    { effect: "Tether elasticity, bending stiffness and damping", status: "NOT_MODELED" },
    { effect: "Reel inertia, actuator torque, braking", status: "NOT_MODELED" },
    { effect: "Atmospheric drag", status: "NOT_MODELED" },
    { effect: "Solar radiation pressure", status: "NOT_MODELED" },
    { effect: "Electrodynamic (Lorentz) forces", status: "NOT_MODELED", note: "Reserved for the blocked EDT model family." },
  ],
  numericalMethod:
    "Single explicit RK4 integration of an 8-state system [r, v, θ, θ'] at a fixed step selected by the researcher. The reference orbit and the libration angle are advanced in the same integration step, so the local mean motion is evaluated from the instantaneous radius. Non-symplectic; no conservation claim is made for the tether subsystem.",
  solverSettings: [
    "Fixed step h in seconds, chosen by the researcher; the final step is clipped so the duration is exact.",
    `Step budget ${MAX_STEPS.toLocaleString("en-US")} attempted steps (browser runtime guard).`,
    "No adaptive control, no event detection, no automatic step reduction.",
  ],
  validityLimits: [
    "First-order dumbbell equations: valid only for L/r ≪ 1. The interface warns above L/r = 0.05 and rejects above 0.5.",
    "In-plane only: a real tether with an out-of-plane disturbance is outside this model.",
    "Tension is a quasi-static vertical estimate; it is not valid during libration or deployment transients.",
    "Near-circular reference orbits: eccentricity above 0.05 triggers a warning because eccentricity coupling is not modelled.",
    "Constant prescribed length change: no mechanism limits, no tension-driven speed limits.",
  ],
  knownFailureModes: [
    "A prescribed retrieval (negative rate) is not supported and is rejected rather than approximated.",
    "A prescribed length that reaches zero is rejected with TETHER_LENGTH_NONPOSITIVE.",
    "Large libration angles are integrated correctly for the equation, but the equation itself is a restricted model; no attitude or flexibility coupling is available.",
    "For very long tethers or very low orbits, L/r validity is violated; the result is reported with a warning, not silently trusted.",
  ],
  verificationCheckIds: ["OT-TT-001", "OT-TT-002", "OT-TT-003", "OT-TT-004", "OT-TT-005", "OT-TT-006", "OT-TT-007", "OT-TT-008", "OT-TT-009"],
  parameterSpecs: TETHER_PARAMETER_SPECS,
  limitations: [
    "Not a deployment simulation: length is prescribed, not solved.",
    "Not a coupled spacecraft–tether model: the orbit does not feel the tether.",
    "Not a structural model: no tension dynamics, no elasticity, no damping.",
    "No validation against any tether mission data. No flight comparison has been performed.",
    "Results are for the implemented planar dumbbell equations only.",
  ],
  references: [
    { label: "Hughes, P. C., Spacecraft Attitude Dynamics, Dover", note: "Gravity-gradient torque and dumbbell libration equation." },
    { label: "Beletskii, V. V. & Levin, E. M., Dynamics of Space Tether Systems, Advances in the Astronautical Sciences 83 (1993)", note: "Tether libration and deployment literature." },
    { label: "Cosmo, M. L. & Lorenzini, E. C., Tethers in Space Handbook (3rd ed.), NASA", note: "Tether concepts, TSS programme background." },
    { label: "IERS Conventions (2010), Table 1.1", url: "https://iers-conventions.obspm.fr/", note: "GM(Earth)." },
  ],
  outOfScope: [
    "Reel and deployer hardware behaviour.",
    "Tether survivability, debris impact and cut resistance.",
    "Electrodynamic current collection, plasma contactor behaviour and Lorentz force.",
    "Any debris-removal performance claim.",
  ],
};

export interface TetherValidation {
  ok: boolean;
  issues: ValidationIssue[];
  si: Record<string, number>;
  accepted: ReturnType<typeof validateParameters>["accepted"];
  extraWarnings: string[];
}

export function validateTetherInputs(inputs: ParameterInput[]): TetherValidation {
  const base = validateParameters(TETHER_PARAMETER_SPECS, inputs);
  const issues = [...base.issues];
  const extraWarnings: string[] = [];

  if (base.ok) {
    const si = base.si;
    const rMag = Math.hypot(si.initialPositionX ?? 0, si.initialPositionY ?? 0, si.initialPositionZ ?? 0);
    const vMag = Math.hypot(si.initialVelocityX ?? 0, si.initialVelocityY ?? 0, si.initialVelocityZ ?? 0);
    if (!(rMag > 0)) {
      issues.push({
        code: "SINGULAR_GEOMETRY",
        severity: "error",
        paramId: "initialPositionX",
        message: "Reference-orbit position is the zero vector; the gravity field is singular.",
      });
    }
    if (!(vMag > 0)) {
      issues.push({
        code: "DEGENERATE_ORBIT_STATE",
        severity: "error",
        paramId: "initialVelocityX",
        message: "Reference-orbit velocity is zero; the local mean motion and the libration equation are undefined for a radial-fall state in this model.",
      });
    }
    if (rMag > 0) {
      const ratio = (si.tetherLength ?? 0) / rMag;
      if (ratio > 0.5) {
        issues.push({
          code: "OUTSIDE_MODEL_VALIDITY",
          severity: "error",
          paramId: "tetherLength",
          message: `Initial L/r = ${ratio.toFixed(3)} exceeds 0.5. The dumbbell equations and the first-order tension estimate are not applicable; this configuration is rejected rather than computed.`,
        });
      } else if (ratio > 0.05) {
        extraWarnings.push(
          `Initial L/r = ${ratio.toFixed(3)} exceeds 0.05: the first-order L/r treatment is being used outside its intended regime.`,
        );
      }
      const finalL = (si.tetherLength ?? 0) + (si.deploymentRate ?? 0) * (si.duration ?? 0);
      if (finalL / rMag > 0.5) {
        extraWarnings.push(
          `Prescribed final L/r = ${(finalL / rMag).toFixed(3)} exceeds 0.5 during the propagation; late-time results are outside the modelled regime.`,
        );
      }
      if ((si.deploymentRate ?? 0) < 0) {
        issues.push({
          code: "UNSUPPORTED_RETRIEVAL",
          severity: "error",
          paramId: "deploymentRate",
          message: "Negative deployment rate (retrieval) is not supported by this model.",
        });
      }
      if (rMag < 6378137 && (si.gravitationalParameter ?? 0) === MU_EARTH) {
        extraWarnings.push(
          "Reference orbit radius is below the Earth equatorial radius; the point-mass model has no surface.",
        );
      }
      if (vMag > 0) {
        try {
          const el = computeElements(si.gravitationalParameter ?? MU_EARTH, [si.initialPositionX, si.initialPositionY, si.initialPositionZ], [si.initialVelocityX, si.initialVelocityY, si.initialVelocityZ]);
          if (!el.isClosed) {
            extraWarnings.push("Reference orbit is not closed (non-negative energy); the libration model assumes an orbital context and results are reported with that caveat.");
          }
          if (el.eccentricity > 0.05) {
            extraWarnings.push(
              `Initial eccentricity ${el.eccentricity.toFixed(4)} > 0.05: eccentricity-dependent libration coupling is NOT modelled.`,
            );
          }
          if (el.periodS) {
            const stepsPerPeriod = el.periodS / (si.stepSeconds ?? 1);
            if (stepsPerPeriod < 200) {
              extraWarnings.push(
                `Only ${stepsPerPeriod.toFixed(0)} RK4 steps per orbital period. Libration periods are ~3.5× longer, but perigee passage may still be under-resolved; run a step-refinement check before trusting the result.`,
              );
            }
          }
        } catch {
          // Element computation is diagnostic here; failures are reported by the calculation itself.
        }
      }
      if (Math.abs(si.theta0 ?? 0) > (60 * Math.PI) / 180) {
        extraWarnings.push(
          "Initial libration angle exceeds 60°. The planar dumbbell equation is integrated without small-angle linearisation, but large-angle behaviour of a real tether involves flexibility and out-of-plane motion that are NOT modelled.",
        );
      }
    }
    const steps = Math.ceil((si.duration ?? 0) / (si.stepSeconds ?? 1));
    if (steps > MAX_STEPS) {
      issues.push({
        code: "STEP_BUDGET_EXCEEDED",
        severity: "error",
        paramId: "stepSeconds",
        message: `duration/step requires ${steps.toLocaleString("en-US")} steps, above the ${MAX_STEPS.toLocaleString("en-US")} budget. The application will not silently change either value.`,
      });
    }
  }

  return { ok: !issues.some((i) => i.severity === "error"), issues, si: base.si, accepted: base.accepted, extraWarnings };
}

const COLUMNS: SeriesColumn[] = [
  { key: "t", label: "Time", unit: "s" },
  { key: "x", label: "CM position x", unit: "m" },
  { key: "y", label: "CM position y", unit: "m" },
  { key: "z", label: "CM position z", unit: "m" },
  { key: "vx", label: "CM velocity vx", unit: "m/s" },
  { key: "vy", label: "CM velocity vy", unit: "m/s" },
  { key: "vz", label: "CM velocity vz", unit: "m/s" },
  { key: "radius", label: "CM radius |r|", unit: "m" },
  { key: "speed", label: "CM speed |v|", unit: "m/s" },
  { key: "thetaDeg", label: "Libration angle θ", unit: "deg" },
  { key: "thetaRateDegPerS", label: "Libration rate dθ/dt", unit: "deg/s" },
  { key: "lengthM", label: "Tether length L(t)", unit: "m" },
  { key: "meanMotionRadS", label: "Local mean motion n(t)", unit: "rad/s" },
  { key: "tensionVerticalN", label: "Quasi-static vertical tension diagnostic", unit: "N" },
  { key: "lengthOverRadius", label: "L/r validity ratio", unit: "1" },
  { key: "orbitEnergy", label: "Reference-orbit specific energy", unit: "J/kg" },
  { key: "orbitAngularMomentum", label: "Reference-orbit |h|", unit: "m^2/s" },
  { key: "epsEnergyOrbit", label: "ε_E of reference orbit only", unit: "1" },
  { key: "epsAngularMomentumOrbit", label: "ε_h of reference orbit only", unit: "1" },
];

export function calculateTether(si: Record<string, number>): CalculationResult {
  const result = propagateTether({
    mu: si.gravitationalParameter,
    positionM: [si.initialPositionX, si.initialPositionY, si.initialPositionZ],
    velocityMS: [si.initialVelocityX, si.initialVelocityY, si.initialVelocityZ],
    satelliteMassKg: si.satelliteMass,
    orbiterMassKg: si.orbiterMass,
    lengthM: si.tetherLength,
    deploymentRateMS: si.deploymentRate,
    theta0Rad: si.theta0,
    thetaDot0RadPerS: si.thetaDot0,
    durationS: si.duration,
    stepS: si.stepSeconds,
  });

  const s = result.series;
  const metrics = [
    { id: "mu", label: "Gravitational parameter μ", value: si.gravitationalParameter, unit: "m^3/s^2" },
    { id: "reducedMass", label: "Reduced mass μ_red", value: result.reducedMassKg, unit: "kg", note: "m₁m₂/(m₁+m₂); the only mass combination in the libration equation." },
    { id: "massRatio", label: "Mass ratio m₁/m₂", value: result.massRatio, unit: "1" },
    { id: "tetherLengthInitial", label: "Initial tether length L(0)", value: s.lengthM[0], unit: "m" },
    { id: "tetherLengthFinal", label: "Final tether length L(t)", value: result.final.lengthM, unit: "m" },
    { id: "deploymentRate", label: "Prescribed deployment rate dL/dt", value: si.deploymentRate, unit: "m/s" },
    { id: "orbitRadiusInitial", label: "Initial CM radius", value: result.initial.radiusM, unit: "m" },
    { id: "orbitRadiusFinal", label: "Final CM radius", value: result.final.radiusM, unit: "m" },
    { id: "orbitSpeedInitial", label: "Initial CM speed", value: result.initial.speedMS, unit: "m/s" },
    { id: "orbitPeriod", label: "Reference-orbit period", value: result.initial.periodS, unit: "s", note: "Null for an open reference orbit." },
    { id: "eccentricity", label: "Reference-orbit eccentricity", value: result.initial.eccentricity, unit: "1" },
    {
      id: "librationPeriod",
      label: "Analytic small-angle libration period",
      value: result.initial.librationPeriodS,
      unit: "s",
      note: "2π/(√3·n₀): valid only for constant length and small angles. Reported for reference, not as a result of this run.",
    },
    { id: "thetaInitial", label: "Initial libration angle", value: s.thetaDeg[0], unit: "deg" },
    { id: "thetaFinal", label: "Final libration angle", value: result.final.thetaDeg, unit: "deg" },
    { id: "thetaRateInitial", label: "Initial libration rate", value: s.thetaRateDegPerS[0], unit: "deg/s" },
    { id: "maxAbsTheta", label: "Maximum |θ| over propagation", value: result.maxAbsThetaDeg, unit: "deg" },
    { id: "tensionInitial", label: "Quasi-static vertical tension at t = 0", value: s.tensionVerticalN[0], unit: "N", note: "3μ_red μL/r³; valid only for θ ≈ 0." },
    { id: "tensionMax", label: "Maximum quasi-static vertical tension", value: result.maxTensionN, unit: "N" },
    { id: "maxLengthOverRadius", label: "Maximum L/r validity ratio", value: result.maxLengthOverRadius, unit: "1" },
    { id: "epsEnergyOrbit", label: "Max ε_E of the reference orbit only", value: result.maxEpsEnergyOrbit, unit: "1", note: "Reference orbit only: diagnostic of the two-body integration, not of the tether subsystem." },
    { id: "epsAngularMomentumOrbit", label: "Max ε_h of the reference orbit only", value: result.maxEpsAngularMomentumOrbit, unit: "1", note: "Reference orbit only: diagnostic of the two-body integration, not of the tether subsystem." },
    { id: "steps", label: "Integration steps", value: result.steps, unit: "count" },
    { id: "samples", label: "Recorded samples", value: s.t.length, unit: "count" },
  ];

  return {
    modelId: TETHER_MODEL_ID,
    modelVersion: TETHER_MODEL_VERSION,
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
      thetaDeg: s.thetaDeg,
      thetaRateDegPerS: s.thetaRateDegPerS,
      lengthM: s.lengthM,
      meanMotionRadS: s.meanMotionRadS,
      tensionVerticalN: s.tensionVerticalN,
      lengthOverRadius: s.lengthOverRadius,
      orbitEnergy: s.orbitEnergy,
      orbitAngularMomentum: s.orbitAngularMomentum,
      epsEnergyOrbit: s.epsEnergyOrbit,
      epsAngularMomentumOrbit: s.epsAngularMomentumOrbit,
    },
    metrics,
    solver: {
      method: "RK4",
      description: result.solverDescription,
      settings: { stepS: si.stepSeconds, states: 8 },
    },
    warnings: result.warnings,
    limitations: TETHER_MODEL.limitations,
    unresolved: [
      {
        item: "Total tether-system mechanical energy and angular momentum",
        reason:
          "Length is prescribed and no deployer torque is modelled, so the tether subsystem is not closed. Conservation is neither claimed nor tested as a pass; only the two-body reference orbit has reported invariants.",
      },
      {
        item: "Instantaneous tether tension for θ ≠ 0",
        reason: "Only the vertical (θ ≈ 0) quasi-static estimate T = 3μ_red μL/r³ is implemented.",
      },
      {
        item: "Dynamically calculated deployment",
        reason: "Reel inertia, motor torque, braking and tension-driven deployment are NOT_MODELED. Length is an input.",
      },
      {
        item: "Coupled spacecraft–tether orbital dynamics",
        reason: "The centre of mass follows an unperturbed two-body orbit; the tether does not react on it (one-way coupling).",
      },
      {
        item: "Out-of-plane libration and 3-D attitude",
        reason: "The implemented libration equation is strictly planar.",
      },
      {
        item: "Tether mass, elasticity and damping",
        reason: "The tether is massless and rigid; no distributed-mass or structural model exists.",
      },
    ],
  };
}

function tetherPreset(
  id: string,
  name: string,
  description: string,
  radiusM: number,
  mass1: number,
  mass2: number,
  lengthM: number,
  rate: number,
  thetaDeg: number,
  durationHours: number,
  stepS: number,
): ScenarioPreset {
  const v = Math.sqrt(MU_EARTH / radiusM);
  return {
    id,
    name,
    description,
    method: "RK4",
    values: {
      gravitationalParameter: { value: MU_EARTH, unit: "m3s2" },
      initialPositionX: { value: radiusM / 1000, unit: "km" },
      initialPositionY: { value: 0, unit: "km" },
      initialPositionZ: { value: 0, unit: "km" },
      initialVelocityX: { value: 0, unit: "kmps" },
      initialVelocityY: { value: v / 1000, unit: "kmps" },
      initialVelocityZ: { value: 0, unit: "kmps" },
      satelliteMass: { value: mass1, unit: "kg" },
      orbiterMass: { value: mass2, unit: "kg" },
      tetherLength: { value: lengthM / 1000, unit: "km" },
      deploymentRate: { value: rate, unit: "mps" },
      theta0: { value: thetaDeg, unit: "deg" },
      thetaDot0: { value: 0, unit: "degps" },
      duration: { value: durationHours, unit: "h" },
      stepSeconds: { value: stepS, unit: "s" },
    },
  };
}

/**
 * Synthetic research presets. These are NOT mission reconstructions and are not
 * derived from any flight data; the geometry is chosen to exercise the model inside
 * its validity limits. Historical reconstruction uses the separate workspace.
 */
export const TETHER_PRESETS: ScenarioPreset[] = [
  tetherPreset(
    "teth-synthetic-vertical",
    "Synthetic: 20 km tether, small libration, 400 km orbit",
    "Synthetic geometry with 500 kg at each end, L = 20 km, θ₀ = 5°, fixed length. Exercises the linear libration regime. Not a mission reconstruction.",
    6378137 + 400e3,
    500,
    500,
    20_000,
    0,
    5,
    3,
    2,
  ),
  tetherPreset(
    "teth-synthetic-deploy",
    "Synthetic: prescribed deployment ramp, 500 km orbit",
    "Synthetic case with L₀ = 1 km deployed at 1 m/s for 4 h. Length is prescribed: this is a kinematic ramp, not reel dynamics.",
    6378137 + 500e3,
    300,
    1000,
    1_000,
    1,
    2,
    4,
    1,
  ),
  tetherPreset(
    "teth-synthetic-large-angle",
    "Synthetic: large-angle libration, 400 km orbit",
    "Synthetic case at θ₀ = 45° to exercise the non-linear in-plane equation. Flexibility and out-of-plane motion remain unmodelled.",
    6378137 + 400e3,
    500,
    500,
    20_000,
    0,
    45,
    3,
    2,
  ),
  {
    ...tetherPreset(
      "teth-tss1r-geometry",
      "TSS-1R geometry with synthetic counterweight mass",
      "Uses only the source-reported TSS-1R deployed length and altitude with a SYNTHETIC 500 kg counterweight mass; the orbiter-side effective mass is UNKNOWN. This is not a historical reconstruction and produces no mission claim.",
      6378137 + 296_320,
      517,
      500,
      19_695,
      0,
      1,
      2,
      2,
    ),
  },
];
