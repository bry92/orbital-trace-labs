/**
 * Registry entries for models that are deliberately NOT executable.
 *
 * They exist so that the boundaries of the implemented physics are explicit, and so
 * that missing evidence and missing equations are recorded rather than papered over
 * with a plausible-looking interface.
 */

import type { ModelSpec } from "./types";

export const TETHER_DYNAMIC_DEPLOYMENT_MODEL: ModelSpec = {
  id: "OTL-TETH-2",
  version: "0.0.0-spec",
  name: "Dynamically calculated tether deployment",
  family: "TETHER_MECHANICS",
  status: "NOT_MODELED",
  summary:
    "Planned model in which tether length is a solved state driven by reel torque, tension and brake behaviour, instead of a prescribed input.",
  statusRationale:
    "NOT_MODELED in this build. TETH-1 prescribes L(t); presenting its output as deployment dynamics would be a false capability claim. The equations and required evidence are listed here so the gap is explicit.",
  referenceFrame: "As TETH-1: inertial centre of mass plus local orbital frame for libration.",
  coordinateConventions: "As TETH-1 plus a reel degree of freedom (deployed length and its rate).",
  unitConventions: "SI.",
  initialConditionDefinition:
    "Would require: initial deployed length, initial deployment rate, reel inertia, motor torque profile, brake law, tether axial stiffness and damping.",
  massRepresentation:
    "Would require distributed tether mass (linear density as a function of deployed length) in addition to the two end masses.",
  governingEquations: [
    {
      id: "EQ-T2-001",
      statement: "J_reel L'' = T(L, L', θ, θ') R_reel − τ_motor − τ_brake",
      implementedInCode: false,
      note: "Not implemented anywhere in this build.",
    },
    {
      id: "EQ-T2-002",
      statement: "T = EA (L − L_unstretched)/L_unstretched + damping term",
      implementedInCode: false,
      note: "No axial stiffness or damping parameter exists in this build.",
    },
    {
      id: "EQ-T2-003",
      statement: "μ_red(t) = (m₁ + ρL)(m₂ + ρL) / (m₁ + m₂ + 2ρL), with ρ the tether linear density",
      implementedInCode: false,
      note: "Requires a sourced or explicitly assumed linear density. No generic tether mass-per-length is substituted.",
    },
  ],
  assumptions: [],
  effects: [
    { effect: "Reel inertia and motor torque", status: "NOT_MODELED" },
    { effect: "Tether axial elasticity and damping", status: "NOT_MODELED" },
    { effect: "Distributed tether mass", status: "NOT_MODELED" },
    { effect: "Deployment transients and snatch loads", status: "NOT_MODELED" },
  ],
  numericalMethod: "Not defined: the model is not implemented.",
  solverSettings: [],
  validityLimits: ["Not applicable until implemented and verified."],
  knownFailureModes: ["Not applicable until implemented."],
  verificationCheckIds: [],
  verificationRequirements: [
    "Demonstrate that the deployment ODE conserves the expected invariants under zero torque and zero rate.",
    "Cross-check a reel-out case against an independent formulation before any result is shown.",
    "Establish that tether linear density is sourced or explicitly declared as an assumption for the case at hand.",
    "Confirm that the deployed-length history converges under step refinement.",
  ],
  parameterSpecs: [],
  limitations: [
    "No dynamic deployment capability exists in this build.",
    "The interface must not be read as implying that reel or tension dynamics are solved.",
  ],
  references: [
    { label: "Beletskii, V. V. & Levin, E. M., Dynamics of Space Tether Systems (1993)", note: "Deployment dynamics formulation." },
  ],
  outOfScope: ["Everything: this model is not implemented."],
};

export const TETHER_COUPLED_MODEL: ModelSpec = {
  id: "OTL-TETH-3",
  version: "0.0.0-spec",
  name: "Coupled spacecraft–tether orbital dynamics",
  family: "TETHER_MECHANICS",
  status: "NOT_MODELED",
  summary:
    "Planned model in which tether tension and libration feed back on the centre-of-mass orbit, so that the orbit and the tether are solved as one system.",
  statusRationale:
    "NOT_MODELED in this build. TETH-1 couples one-way: the tether does not perturb the orbit. That is a stated limitation, not an approximation the interface hides.",
  referenceFrame: "Inertial frame with both end bodies propagated; no separate prescribed centre-of-mass orbit.",
  coordinateConventions: "Two-body (or N-body) states for both end masses plus tether constraint.",
  unitConventions: "SI.",
  initialConditionDefinition: "Would require independent states for both end masses and the tether constraint.",
  massRepresentation: "Both end masses (and optionally distributed tether mass) propagated independently.",
  governingEquations: [
    {
      id: "EQ-T3-001",
      statement: "m₁ r₁'' = −μ m₁ r₁/|r₁|³ + T û + F_disturbance,1",
      implementedInCode: false,
    },
    {
      id: "EQ-T3-002",
      statement: "m₂ r₂'' = −μ m₂ r₂/|r₂|³ − T û + F_disturbance,2",
      implementedInCode: false,
    },
    {
      id: "EQ-T3-003",
      statement: "|r₂ − r₁| = L(t)  (constraint) or elastic force law",
      implementedInCode: false,
    },
  ],
  assumptions: [],
  effects: [
    { effect: "Two-way orbit–tether coupling", status: "NOT_MODELED" },
    { effect: "Tether-induced orbital perturbation", status: "NOT_MODELED" },
    { effect: "Disturbance forces on both ends", status: "NOT_MODELED" },
  ],
  numericalMethod: "Not defined: the model is not implemented.",
  solverSettings: [],
  validityLimits: ["Not applicable until implemented."],
  knownFailureModes: ["Not applicable until implemented."],
  verificationCheckIds: [],
  verificationRequirements: [
    "Show that in the limit of vanishing tether mass the coupled model reproduces the two-body orbit to integrator accuracy.",
    "Demonstrate two-way momentum exchange: the tether must measurably perturb the centre-of-mass orbit.",
    "Check total linear and angular momentum of the coupled system with no external torque.",
    "Verify the constraint (or elastic force) residual stays within a stated bound.",
  ],
  parameterSpecs: [],
  limitations: [
    "Orbit and tether are not solved as a coupled system.",
    "Any statement about orbital change caused by a tether is outside this build.",
  ],
  references: [
    { label: "Cosmo, M. L. & Lorenzini, E. C., Tethers in Space Handbook (3rd ed.), NASA", note: "Tether system dynamics overview." },
  ],
  outOfScope: ["Everything: this model is not implemented."],
};

export const EDT_MODEL: ModelSpec = {
  id: "OTL-EDT-1",
  version: "0.0.0-spec",
  name: "Electrodynamic tether — end-of-life disposal concept (specification only)",
  family: "ELECTRODYNAMIC_TETHER",
  status: "BLOCKED",
  summary:
    "Bounded research milestone: a conducting tether used to generate current in Earth's magnetic field, producing a Lorentz drag force for end-of-life spacecraft disposal. Specification only; no calculation is implemented.",
  statusRationale:
    "BLOCKED. Required inputs, constitutive models and verification evidence are missing: no plasma collection model, no geomagnetic field model, no circuit/contactor model and no verified measured thrust benchmark. Manufacturing plausible outputs would violate the project's evidence rule, so the model reports BLOCKED and lists what is required.",
  referenceFrame:
    "Would require an inertial orbital frame plus a geomagnetic field model in an Earth-fixed frame and an explicit frame transformation chain, including Earth rotation.",
  coordinateConventions:
    "Would require tether direction, magnetic field direction and relative velocity to be resolved in a common frame with documented sign conventions for current and force.",
  unitConventions: "SI: A, V, T, N, Ω, m⁻³, S/m.",
  initialConditionDefinition:
    "Would require orbital state, tether length and orientation, current state (or circuit initial condition), spacecraft potential and plasma density at epoch.",
  massRepresentation:
    "Distributed conducting tether with structural and conductor mass; end bodies as point masses. Not yet defined in executable form.",
  governingEquations: [
    {
      id: "EQ-EDT-001",
      statement: "emf = ∫ (v_rel × B) · dl   along the tether",
      implementedInCode: false,
      note: "Documented requirement only.",
    },
    {
      id: "EQ-EDT-002",
      statement: "I = emf / (R_tether + R_plasma + R_contactor)   (lumped circuit)",
      implementedInCode: false,
      note: "Requires an explicit current-collection model; OML (orbital-motion-limited) collection is a candidate, not yet selected or verified.",
    },
    {
      id: "EQ-EDT-003",
      statement: "F = ∫ I dl × B   (Lorentz force)",
      implementedInCode: false,
    },
    {
      id: "EQ-EDT-004",
      statement: "P = I² R + I·emf   (electrical power balance; sign conventions pending)",
      implementedInCode: false,
    },
    {
      id: "EQ-EDT-005",
      statement: "Plasma current collection: I_coll = A · J_OML(V_sc, n_e, T_e)",
      implementedInCode: false,
      note: "Not defined in this build; multiple competing formulations exist.",
    },
    {
      id: "EQ-EDT-006",
      statement: "Thermal limit: I²R per unit length ≤ allowable conductor dissipation",
      implementedInCode: false,
    },
  ],
  assumptions: [],
  effects: [
    { effect: "Induced emf from orbital motion in the geomagnetic field", status: "NOT_MODELED" },
    { effect: "Current distribution along the tether", status: "NOT_MODELED" },
    { effect: "Plasma current collection / contactor behaviour", status: "NOT_MODELED" },
    { effect: "Lorentz force and orbital response", status: "NOT_MODELED" },
    { effect: "Electrical power generation or consumption", status: "NOT_MODELED" },
    { effect: "Thermal limits", status: "NOT_MODELED" },
    { effect: "Tether stability under current and deployment", status: "NOT_MODELED" },
  ],
  numericalMethod:
    "Not defined. Would require a coupled orbit–attitude–circuit solver with a documented geomagnetic field model and a stated integration scheme.",
  solverSettings: [],
  validityLimits: ["Undefined until the physics specification is completed and reviewed."],
  knownFailureModes: [
    "Risk of reporting a plausible thrust number derived from an unverified lumped circuit.",
    "Risk of treating an electrodynamic tether as a mechanical tether with an extra force term.",
  ],
  verificationCheckIds: [],
  verificationRequirements: [
    "Document and page-verify the source of every electrodynamic equation before implementation.",
    "Close the electrical power balance (mechanical power in, Joule heating, power delivered to the load) within a stated tolerance.",
    "Reproduce a documented measured current for a specific TSS-1R geometry and condition, or state why the data are insufficient.",
    "Show Lorentz force sign and magnitude against an independent calculation for a fixed geometry and field.",
    "Quantify sensitivity to the geomagnetic field model and to the plasma collection law.",
    "Demonstrate a thermal limit check with sourced conductor properties.",
    "No debris-removal, thrust or disposal-performance claim may be made before all of the above pass.",
  ],
  parameterSpecs: [],
  limitations: [
    "No electrodynamic calculation exists. Every EDT quantity is BLOCKED, not NOT_TESTED-by-omission.",
    "No debris-removal performance may be inferred from this application.",
    "TSS-1R measured current (~480 mA) and voltage (up to 3,500 V) are recorded as source-reported evidence, but they do not constitute a verified model benchmark: the measurement conditions, uncertainties and geometry are not fully documented in the readable sources.",
  ],
  references: [
    {
      label: "NASA, STS-75 mission page",
      url: "https://www.nasa.gov/mission/sts-75/",
      note: "Source-reported current and voltage levels (EV-TSS1R-011, EV-TSS1R-012).",
    },
    {
      label: "ESA, Tethered Satellite System-1 Reflight USMP-3",
      url: "https://www.esa.int/Science_Exploration/Human_and_Robotic_Exploration/Tethered_Satellite_System-1_Reflight_USMP-3",
      note: "Mission description and 20.7 km planned deployment.",
    },
    {
      label: "Cosmo, M. L. & Lorenzini, E. C., Tethers in Space Handbook (3rd ed.), NASA",
      note: "General electrodynamic tether background. Specific equations still require a page-verified source before implementation.",
    },
  ],
  outOfScope: [
    "Active capture or de-orbiting of a large debris object.",
    "Any operational disposal planning.",
    "Any claim that this application can remove debris.",
  ],
};

/** Required inputs and evidence for a future EDT implementation. */
export const EDT_REQUIRED_INPUTS: {
  id: string;
  description: string;
  status: "UNKNOWN" | "CONFLICT" | "ASSUMED" | "BLOCKED";
  note: string;
}[] = [
  { id: "geomagneticFieldModel", description: "Geomagnetic field model (e.g. IGRF epoch) with frame convention", status: "BLOCKED", note: "Not selected, not integrated, no coefficient data included." },
  { id: "tetherConductivity", description: "Tether conductor resistance per unit length and temperature dependence", status: "UNKNOWN", note: "No sourced value; conductor construction is only partially documented (EV-TSS1-007, EV-TSS1R-007/008 conflict)." },
  { id: "plasmaDensity", description: "Plasma density and electron temperature model along the orbit", status: "BLOCKED", note: "Requires an ionosphere model and its uncertainty." },
  { id: "currentCollection", description: "Current collection law (OML or equivalent) and contactor characteristics", status: "BLOCKED", note: "Multiple formulations exist; none has been selected and verified here." },
  { id: "circuitModel", description: "Circuit topology, contactor voltage drop, and ground/spacecraft return path", status: "UNKNOWN", note: "Not defined." },
  { id: "thermalLimits", description: "Allowable conductor dissipation and tether temperature model", status: "UNKNOWN", note: "Not defined." },
  { id: "verificationBenchmark", description: "Verified measured current/thrust benchmark with documented conditions and uncertainty", status: "UNKNOWN", note: "EV-TSS1R-013 (measured Lorentz thrust) is UNKNOWN. Source-reported current and voltage alone are insufficient to validate a model." },
];
