# Model Documentation

Technical description of every model in the registry: what is implemented, with which
equations, under which assumptions, with which parameters and units, integrated by which
numerical method.

**Scope rule used throughout this document:** an equation is listed as *implemented* only where
shipped code evaluates it. Equations that appear in the registry with `implementedInCode: false`
are documented intentions, and are labelled as such. Nothing here is inferred from a symbol
name or a comment; each item is traced to a file and function.

**RESEARCH PROTOTYPE — NOT FLIGHT SOFTWARE.** Nothing in this document constitutes flight
qualification or independent validation.

---

## 1. Model inventory

Source: `src/models/registry.ts` (`MODELS`, `IMPLEMENTED_MODEL_IDS`).

| ID | Version | Status | Governing physics present in code |
| --- | --- | --- | --- |
| `OTL-2BP` | 1.0.0 | `IMPLEMENTED` | Newtonian two-body point mass, osculating elements, conservation diagnostics |
| `OTL-TETH-1` | 1.0.0 | `IMPLEMENTED` | Planar gravity-gradient dumbbell, prescribed length, one-way coupling to a two-body reference orbit |
| `OTL-TETH-2` | 0.0.0-spec | `NOT_MODELED` | Specification only (reel dynamics, elasticity, distributed mass) |
| `OTL-TETH-3` | 0.0.0-spec | `NOT_MODELED` | Specification only (coupled spacecraft–tether orbit) |
| `OTL-EDT-1` | 0.0.0-spec | `BLOCKED` | Physics specification, required inputs and missing evidence only |

`IMPLEMENTED_MODEL_IDS` is derived from the registry at runtime (2 of 5), so the interface and
the landing page cannot claim more executable models than the registry contains.

## 2. Physical constants and units

Source: `src/core/constants.ts`, `src/core/units.ts`; evidence records `EV-PHY-001`,
`EV-PHY-002` in `src/evidence/register.ts`.

| Constant | Value | Source |
| --- | --- | --- |
| Earth gravitational parameter μ | `3.986004418e14` m³/s² | IERS Conventions (2010), Table 1.1 (`EV-PHY-001`) |
| Earth equatorial radius | `6378137` m | WGS-84 defining parameter (NIMA TR8350.2) (`EV-PHY-002`) |
| Step budget | `200,000` attempted steps per propagation | Runtime guard (`MAX_STEPS`) |

μ is treated as an **exact model constant**. Its tabulated uncertainty is not propagated; this
is stated in the evidence record and repeated in `KNOWN_LIMITATIONS.md`.

Internally every quantity is SI (m, s, kg, m/s, m³/s², J/kg, m²/s, rad, rad/s). User input may
be given in the display units registered in `src/core/units.ts` — `m`, `km`, `s`, `h`, `d`,
`kg`, `m/s`, `km/s`, `deg`, `rad`, `deg/s`, `rad/s`, `m³/s²`, `N`, `kg/m`, dimensionless — and
is converted **exactly once**, at validation. Run records keep both the entered value/unit and
the SI value actually used (`src/core/run.ts`, `RunParameter`).

Earth is treated as a **sphere** of the WGS-84 equatorial radius for surface/altitude
interpretation only; flattening is not modelled and the radius does not enter the equations of
motion.

---

## 3. `OTL-2BP` — two-body point-mass propagation

Registry entry: `src/models/twoBody.ts`. Engine: `src/core/twobody.ts`.

### 3.1 Equations evaluated in code

| ID | Equation | Implemented | Notes |
| --- | --- | --- | --- |
| `EQ-2BP-1` | `r''(t) = −μ r(t) / |r(t)|³` | Yes | `twoBodyDerivative()`, integrated by RK4 or DOPRI5 |
| `EQ-2BP-2` | `E = ½|v|² − μ/|r|` [J/kg] | Yes | Specific mechanical energy at every sample |
| `EQ-2BP-3` | `h = r × v`, `|h|` reported [m²/s] | Yes | Specific angular momentum |
| `EQ-2BP-4` | `a = (2/|r| − |v|²/μ)⁻¹` [m] | Yes | Osculating semi-major axis; `null` at the parabolic limit |
| `EQ-2BP-5` | `e = |((|v|² − μ/|r|) r − (r·v) v)/μ|` | Yes | Osculating eccentricity |
| `EQ-2BP-6` | `T = 2π√(a³/μ)` | Yes | **Closed orbits only** (`E < 0`); `null` for open orbits, never estimated |
| `EQ-2BP-7` | `ε_E = |E(t) − E(0)| / max(|E(0)|, E_scale)`, `E_scale = μ/|r₀|` | Yes | Normalised energy discrepancy |
| `EQ-2BP-8` | `ε_h = ||h(t)| − |h(0)|| / max(|h(0)|, h_scale)`, `h_scale = |r₀||v₀|` | Yes | Normalised angular-momentum discrepancy |
| `EQ-2BP-9` | `r'' = −μ r/|r|³ + a_J2 + a_drag + a_3body + a_SRP` | **No** | Future-work record only; no perturbation term exists anywhere in this build |

Classical elements (inclination, RAAN, argument of periapsis, true anomaly) are **osculating**
elements of the instantaneous state, not mean elements. `RAAN` and `ω` are reported as `0` by
convention when geometrically undefined (equatorial / circular cases), and the code notes this.

### 3.2 Assumptions

From the registry entry (`assumptions`), verbatim in substance:

1. The central body is spherically symmetric and treated as a fixed point mass; its motion about
   the system barycentre is neglected.
2. The orbiting body is a point mass with negligible mass relative to the central body.
3. The reference frame is inertial: no Earth rotation, precession or nutation is modelled. It is
   **not** a rigorous J2000/ICRF realisation.
4. No force other than central gravity acts on the body.
5. Classical elements are osculating elements of the instantaneous state.

### 3.3 Parameters (identity, unit, range)

Source: `BASE_SPECS` / `twoBodyParameterSpecs()` in `src/models/twoBody.ts`. The solver-specific
parameters are shown only for the selected method.

| Parameter | Unit | Required | Accepted range | Rationale recorded in code |
| --- | --- | --- | --- | --- |
| `gravitationalParameter` | m³/s² | Yes | 1e10 … 1e18 | Spans small asteroids to the Sun; outside it the point-mass model is not the intended regime |
| `initialPositionX/Y/Z` | km | Yes | — | Inertial position of the initial state |
| `initialVelocityX/Y/Z` | km/s | Yes | — | Inertial velocity of the initial state |
| `duration` | h | Yes | 1e-6 … 720 | 30-day cap keeps the step budget finite in a browser runtime |
| `stepSeconds` (RK4) | s | Yes | 1e-3 … 1e5 | Below 1 ms is not resolvable in double precision for states of order 1e7 m |
| `relTolerance` (DOPRI5) | — | Yes | 1e-14 … 1e-2 | Below 1e-14 round-off dominates the embedded estimate; above 1e-2 the solution is not a credible orbit |
| `absTolerance` (DOPRI5) | — | Yes | 1e-14 … 1e-2 | See the documented simplification in §3.6 |
| `initialStepSeconds` (DOPRI5) | s | Yes | 1e-3 … 1e7 | Must be finite and positive; the controller adapts from here |
| `maxStepSeconds` (DOPRI5) | s | Yes | 1e-3 … 1e7 | Hard cap on the adaptive step |

Initial conditions are supplied as a Cartesian state, and elements are derived from it — there is
one source of truth for the initial condition, and elements cannot be supplied independently.

### 3.4 Validation rejections and warnings

Source: `validateTwoBodyInputs()` in `src/models/twoBody.ts`.

Energy errors (execution blocked):

| Code | Condition |
| --- | --- |
| `SINGULAR_GEOMETRY` | Initial position is the zero vector (singular gravity field) |
| `DEGENERATE_ANGULAR_MOMENTUM_NORMALIZATION` | Initial speed is zero, so `|r₀||v₀|` would make `ε_h` undefined — the state is rejected rather than re-normalised |
| `STEP_BUDGET_EXCEEDED` | `duration/step` (RK4) or `duration/hmax` (DOPRI5) exceeds `200,000` |
| `INVALID_SOLVER_SETTINGS` | DOPRI5 initial step exceeds the maximum step |

Warnings (execution allowed, recorded in the run):

- Non-negative initial osculating energy: the orbit is open and **no period will be reported**.
- Fewer than 50 steps per orbital period: truncation error is likely to dominate and a
  convergence test is required for that configuration.
- Initial radius below the Earth equatorial radius: results below the surface have no physical
  interpretation in a point-mass model.

### 3.5 Known failure modes recorded in the registry

- `r = 0`: singular field, rejected.
- Zero initial speed: degenerate `ε_h` normalisation, rejected.
- A step comparable to the orbital period aliases the orbit and can produce plausible-looking
  wrong results — the reason the steps-per-period warning exists.
- Near-parabolic states can report a `null` semi-major axis although a finite osculating ellipse
  exists.

---

## 4. `OTL-TETH-1` — prescribed-length gravity-gradient dumbbell

Registry entry: `src/models/tether.ts`. Engine: `src/core/tether.ts`.

### 4.1 Geometry and mass representation

Two point masses — `m₁` (payload) and `m₂` (counterweight / orbiter side) — joined by a
**massless, rigid, straight** rod of length `L(t)`. Only the reduced mass
`μ_red = m₁m₂/(m₁+m₂)` enters the libration equation. Distributed tether mass is `NOT_MODELED`
because no mass-per-length is required or assumed.

The centre of mass follows an **unperturbed** two-body orbit. Coupling is **one-way**: the tether
exerts no force on the centre of mass, so `OTL-TETH-1` cannot represent orbit–tether exchange.

### 4.2 Equations evaluated in code

| ID | Equation | Implemented | Notes |
| --- | --- | --- | --- |
| `EQ-T-001` | `r'' = −μ r/|r|³` (centre of mass) | Yes | Two-body reference orbit; one-way coupling |
| `EQ-T-002` | `L(t) = L₀ + (dL/dt)·t` | Yes | **Prescribed** kinematics, not a solution of reel dynamics |
| `EQ-T-003` | `θ'' + 2(L̇/L)θ' + 3n(t)² sinθ cosθ = 0` | Yes | Derived from `d/dt(μ_red L²θ') = −3n²μ_red L² sinθ cosθ`; no deployer torque |
| `EQ-T-004` | `n(t) = √(μ/|r(t)|³)` | Yes | Local mean motion from the instantaneous reference radius |
| `EQ-T-005` | `T_vert = 3 μ_red μ L / r³` | Yes | **Quasi-static diagnostic**, vertical (θ ≈ 0), first order in `L/r`; not the tension of a librating tether and not a structural prediction |
| `EQ-T-006` | `μ_red = m₁m₂/(m₁+m₂)` | Yes | Reduced mass |
| `EQ-T-007` | `J_reel θ''_reel = τ_motor − T R_reel` | **No** | No reel inertia, motor or brake |
| `EQ-T-008` | `m r'' = F_grav + F_tether + F_disturbance` | **No** | Coupled orbit–tether dynamics absent |
| `EQ-T-009` | `∂²u/∂t² = (EA/ρ)∂²u/∂s² + damping` | **No** | No axial elasticity, wave propagation or damping |
| `EQ-T-010` | `φ'' + 3n² cos²θ · φ = 0` (linearised out-of-plane) | **No** | The implemented model is strictly planar |

The integrated state is 8-dimensional: `[r(3), v(3), θ, θ̇]`
(`tetherDerivative()` in `src/core/tether.ts`).

### 4.3 Assumptions

1. The tether is straight, massless and inextensible, treated as a rigid rod of prescribed length.
2. Both end bodies are point masses; finite size, inertia tensors and attitude are ignored.
3. Motion is confined to the orbital plane; out-of-plane libration and 3-D attitude are absent.
4. Length change is kinematic: the deployer has no inertia and applies no torque.
5. The centre of mass follows an unperturbed two-body orbit.
6. The libration equation uses the local mean motion from the instantaneous radius;
   eccentricity-dependent coupling terms are omitted.
7. No aerodynamic, solar-radiation, magnetic or electrodynamic forces act on either end body.

### 4.4 Parameters

Parameter identifiers accepted by `validateTetherInputs()`
(specs in `TETHER_PARAMETER_SPECS`, `src/models/tether.ts`; used as in
`src/verification/tetherChecks.ts`): `gravitationalParameter`, `initialPositionX/Y/Z`,
`initialVelocityX/Y/Z`, `satelliteMass` (kg), `orbiterMass` (kg), `tetherLength` (km),
`deploymentRate` (m/s), `theta0` (deg), `thetaDot0` (deg/s), `duration` (h), `stepSeconds` (s).

Engine-enforced domain (`propagateTether()`), each throwing a typed error:

| Code | Condition |
| --- | --- |
| `INVALID_MU` | μ not positive and finite |
| `INVALID_DURATION` | Duration not positive |
| `INVALID_STEP` | Step not positive |
| `INVALID_MASS` | Either end mass not positive |
| `INVALID_TETHER_LENGTH` | Initial length not positive |
| `INVALID_DEPLOYMENT_RATE` | Rate not finite, or **negative** |
| `TETHER_LENGTH_NONPOSITIVE` | Prescribed length becomes ≤ 0 during propagation |
| `SINGULAR_GEOMETRY` | Reference-orbit radius reaches zero |

**Capability boundary worth noting for the reviewer:** the engine accepts `L̇ ≥ 0` only, so the
production model represents *deployment*, not *retrieval*, even though the libration equation
itself is written for either sign. The verification-side balance study does exercise sign-changing
length histories, but that is the verification path, not the researcher-facing model.

### 4.5 Regime warnings emitted with every run

- `L/r > 0.05`: the dumbbell libration equation and tension diagnostic are first order in `L/r`;
  results are outside their intended regime.
- Initial eccentricity `> 0.05`: eccentricity-dependent libration coupling is **not** modelled.
- `L̇ > 0`: reel inertia, motor torque, elasticity and damping are not modelled, "so this is not a
  deployment simulation".

The `L/r` warning is the primary, measured statement of where the model stops applying — the
verification study itself runs at `L/r ≈ 2.95e-3`.

---

## 5. Models that are deliberately not executable

Source: `src/models/notImplemented.ts`. These entries exist so that missing equations and
missing evidence are recorded rather than hidden behind a plausible interface.

### 5.1 `OTL-TETH-2` — dynamically calculated deployment (`NOT_MODELED`)

Rationale recorded in the registry: `TETH-1` prescribes `L(t)`; presenting its output as
deployment dynamics would be a false capability claim. Specification only:

| ID | Equation / requirement | Status |
| --- | --- | --- |
| `EQ-T2-001` | `J_reel L'' = T(L, L', θ, θ')R_reel − τ_motor − τ_brake` | Not implemented |
| `EQ-T2-002` | `T = EA(L − L_unstretched)/L_unstretched + damping` | Not implemented; no stiffness or damping parameter exists |
| `EQ-T2-003` | `μ_red(t)` including distributed mass with linear density ρ | Not implemented; would need a sourced or explicitly assumed ρ |

### 5.2 `OTL-TETH-3` — coupled spacecraft–tether orbital dynamics (`NOT_MODELED`)

Equations `EQ-T3-001 … EQ-T3-003` are recorded as specification only. The current implementation
propagates the centre of mass as an unperturbed two-body orbit and lets the tether react on
nothing.

### 5.3 `OTL-EDT-1` — electrodynamic tether disposal (`BLOCKED`)

Six specification equations (`EQ-EDT-001 … 006`) and a required-input table whose entries carry
their own statuses:

| Required input | Status |
| --- | --- |
| Geomagnetic field model (epoch, frame convention) | `BLOCKED` — not selected, not integrated, no coefficients |
| Tether conductivity / resistance per unit length | `UNKNOWN` — no sourced value; conductor construction only partly documented |
| Plasma density and electron temperature model | `BLOCKED` — needs an ionosphere model and its uncertainty |
| Current collection law (OML or equivalent), contactor characteristics | `BLOCKED` — multiple formulations, none selected or verified here |
| Circuit topology, contactor drop, return path | `UNKNOWN` |
| Thermal limits / conductor dissipation model | `UNKNOWN` |
| Verified current/thrust benchmark with conditions and uncertainty | `UNKNOWN` — measured Lorentz thrust is not established |

No generic mass-per-length, conductivity, or "typical" tether parameter is substituted anywhere
to make this model runnable.

---

## 6. Numerical methods actually implemented

Source: `src/core/integrators.ts`.

### 6.1 Classical fixed-step RK4 (order 4)

- Explicit, single-step, **non-symplectic**.
- The final step is clipped (`min(stepS, durationS − t)`) so the propagated duration is exact.
- Deterministic, which is what makes bit-identical repeatability and step-refinement convergence
  measurable.
- Throws `INVALID_STEP`, `STEP_LIMIT_EXCEEDED`, `NUMERICAL_OVERFLOW`.

### 6.2 Adaptive Dormand–Prince 5(4)

- Standard 7-stage embedded pair with the classical Butcher tableau (`A`, `B5`, `B4`, nodes `C`).
- Error estimate `h(B5 − B4)·k`, norm `max_i |err_i| / (atol + rtol·max(|y_i|, |y5_i|))`.
- Step control: accept when the norm ≤ 1, grow by `0.9·err^(−1/5)` clamped to `[0.2, 5]`
  (`5` when the error is exactly zero); reject and shrink by `max(0.9·err^(−1/5), 0.1)`.
- Samples are emitted at **accepted** steps only; the final state lands exactly on `durationS`.
- Throws `STEP_SIZE_UNDERFLOW` (below 1e-6 s in the tether reference path),
  `STEP_LIMIT_EXCEEDED`, `NUMERICAL_OVERFLOW`.

### 6.3 Method availability by model

| Model | Researcher-facing method | Additional path |
| --- | --- | --- |
| `OTL-2BP` | RK4 (fixed step) **or** DOPRI5 (adaptive), researcher-selected | — |
| `OTL-TETH-1` | RK4 (fixed step) **always** | A DOPRI5 path exists **only** to build an independent numerical reference for the convergence study; the interface does not expose it, and any reference built this way is labelled numerical, never exact |

No solver silently changes method or step size. If the requested settings cannot be honoured, an
error is raised and shown.

### 6.4 Known numerical limitations

- Both methods are non-symplectic: energy and angular momentum **drift**, and the drift is
  measured and reported rather than assumed away. No symplectic integrator is implemented.
- Hard cap of 200,000 attempted steps per propagation (browser runtime guard); the tether adaptive
  reference path uses a 1e-6 s minimum step.
- A single scalar absolute tolerance is applied to a mixed-unit SI state (metres and m/s) in
  DOPRI5, so in practice the relative tolerance governs. This is documented in the parameter
  description as a deliberate simplification, not a validated scaling.
- Cross-platform bit-identical results are **not** guaranteed (browser-only, single-node
  execution); this is why the reproduction tolerance relaxes from 1e-12 to 1e-9 across builds.

---

## 7. Traceability map

| Claim | Source |
| --- | --- |
| Model list, statuses, versions | `src/models/registry.ts`, `src/models/notImplemented.ts` |
| Two-body equations `EQ-2BP-1…9` | `src/models/twoBody.ts` (registry) + `src/core/twobody.ts` (evaluation: `twoBodyDerivative`, `specificEnergy`, `specificAngularMomentum`, `computeElements`) |
| Tether equations `EQ-T-001…010` | `src/models/tether.ts` + `src/core/tether.ts` (`tetherDerivative`, `tetherTensionVerticalN`, `librationAcceleration`) |
| Constants and units | `src/core/constants.ts`, `src/core/units.ts` |
| Integrators, error control, step budget | `src/core/integrators.ts`, `MAX_STEPS` |
| Validation codes and warnings | `validateTwoBodyInputs()`, `propagateTether()`, `validateParameters()` (`src/core/validation.ts`) |
| Immediately non-executable requirements | `src/models/notImplemented.ts` (`EDT_REQUIRED_INPUTS`) |

---

# Appendix — Complete `TETHER_PARAMETER_SPECS` inventory

All parameter definitions from `src/models/tether.ts`, read individually. "Configured bound" is what
the validator enforces; the basis column quotes or paraphrases the `boundRationale` where one is
recorded. **A configured bound is not a physical justification** unless the basis column says so.

| Parameter | Unit | Configured min | Configured max | Basis recorded in code | Assessment |
| --- | --- | --- | --- | --- | --- |
| `gravitationalParameter` | m³/s² | `1e10` | `1e18` | **No `boundRationale` recorded in the tether spec**; the identical 1e10…1e18 range carries that rationale in the two-body spec ("spans small asteroids to the Sun") | Model-regime motivated by analogy, not by a tether-specific rationale. Wide by design: it selects a central body, it does not validate one |
| `initialPositionX/Y/Z` | km | — | — | No rationale (unbounded) | Well-posedness enforced downstream: `r = 0` → `SINGULAR_GEOMETRY`; radius below Earth raises a warning only |
| `initialVelocityX/Y/Z` | km/s | — | — | No rationale (unbounded) | `|v| = 0` → `DEGENERATE_ANGULAR_MOMENTUM_NORMALIZATION`; no upper bound, so unbound, unphysical orbits are accepted with a warning when `E ≥ 0` |
| `satelliteMass` (m₁) | kg | `1e-3` | `1e7` | "Non-positive mass has no meaning in this representation; the upper bound keeps the point-mass idealisation defensible." | Lower bound necessary for well-posedness; upper bound is a soft modelling claim, not derived |
| `orbiterMass` (m₂) | kg | `1e-3` | `1e8` | "Must be positive; the reduced mass is undefined otherwise." | Lower bound necessary; **upper bound of 1e8 kg has no stated justification** — the rationale only addresses positivity, and one order higher than m₁ |
| `tetherLength` (L₀) | km | `0.001` (1 m) | `1000` | "Below 1 m the point-mass dumbbell is not a meaningful representation; above 1000 km the first-order L/r treatment is far outside its regime." | Both bounds physically motivated — but the upper bound does not enforce the regime: 1000 km at a low-Earth reference orbit gives `L/r ≈ 0.15`, i.e. 3× the engine's own `L/r = 0.05` warning threshold (see `AUDIT_FINDINGS.md` §5) |
| `deploymentRate` (L̇) | m/s | `0` | `100` | "Only deployment is represented; 100 m/s is far above any realistic tether deployment rate." | Lower bound encodes a **modelling restriction** (no retrieval), enforced again in the engine; upper bound is an engineering guard |
| `theta0` (θ₀) | deg | `-180` | `180` | No rationale | Complete angular domain; well-posed by construction |
| `thetaDot0` (θ̇₀) | deg/s | `-360` | `360` | No rationale | Generous and undocumented; no statement of how large a rate remains meaningful for the small-angle/`L/r` approximations |
| `duration` | h | `1e-6` | `720` | "Upper bound of 720 h keeps the fixed-step budget finite in a browser runtime." | Runtime guard, explicitly not a validity statement |
| `stepSeconds` | s | `1e-3` | `1e5` | "A step below 1 ms is not resolvable for these state magnitudes." | Lower bound numerical; **upper bound permits a step ~19× the orbital period** at low Earth orbit, where the engine's `< 50 steps per period` warning fires |

## Derived-from-configured values (not user parameters)

| Quantity | Expression | Consequence |
| --- | --- | --- |
| Reduced mass | `μ_red = m₁m₂/(m₁+m₂)` | Always < min(m₁, m₂); undefined only if a mass were non-positive, which the bounds prevent |
| Mass ratio | `m₁/m₂` | Reported, not used in the libration equation; no bound of its own |
| `L/r` | `L(t)/|r(t)|` | Monitored; warning above 0.05, never a rejection |
| Libration period | `2π/(√3·n₀)` | Analytic estimate reported at t = 0 only; `null` if the orbit is open |

## Summary of bound quality

- **Necessary for well-posedness:** the lower bounds on the two masses (positivity of the reduced
  mass). Everything else is a range choice.
- **Physically motivated:** the `tetherLength` bounds (dumbbell representation / first-order `L/r`)
  and the `deploymentRate` lower bound (deployment-only scope).
- **Runtime guards:** `duration` (720 h) and `stepSeconds` (1 ms floor), both described in code as
  browser-runtime or floating-point limits rather than physics.
- **Undocumented or soft:** the `orbiterMass` upper bound, both `thetaDot0` bounds, and the
  `tetherLength`/`stepSeconds` upper bounds, which admit configurations the engine itself warns are
  outside its regime.

No bound was altered. Where the code records no rationale, this appendix says so instead of
supplying one.
