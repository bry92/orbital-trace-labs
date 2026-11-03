# Orbital Trace Labs — Project Brief

**RESEARCH PROTOTYPE — NOT FLIGHT SOFTWARE.** Independent computational research prototype. No
flight qualification, no physical validation, and no endorsement by any agency, university, or
researcher is claimed or implied.

This brief is a two-page summary for a prospective technical reviewer. Every statement is
traceable to the eight review documents or to the source tree; the traceability note at the end maps
claims to their origin.

---

## 1. Purpose

Orbital Trace Labs is a browser-based computational research prototype for two problems in orbital
mechanics: Newtonian **two-body point-mass propagation**, and **planar libration of a
gravity-gradient tether** on a prescribed length history, coupled one way to a two-body reference
orbit. The research area of interest is **orbital tether mechanics** — specifically, what can and
cannot be established about tether libration and deployment with a deliberately minimal model whose
limitations are declared rather than hidden.

The design principle is uniform: every displayed number is computed at run time from the model that
produced it; every run records how it was obtained; every model declares what it omits. Capability
that the code cannot support is recorded as `NOT_MODELED`, `BLOCKED`, `UNKNOWN`, `CONFLICT`,
`UNRESOLVED`, or `NOT_TESTED` instead of being presented as implemented.

## 2. Current computational capabilities

- Two executable models (of five registered); three are specification records for physics that is
  deliberately absent.
- Fixed-step RK4 and adaptive Dormand–Prince 5(4) integrators, with a 200,000-step budget per
  propagation.
- 27 model-level verification checks plus 3 platform checks, executed against the live engine.
- Append-only run records with entered and SI inputs, solver settings, series, warnings,
  assumptions, unresolved quantities, evidence flags and a SHA-256 result hash over a declared
  canonical scope.
- Export of JSON, CSV, Markdown report, verification report and manifest, each hashed over its exact
  bytes; import → re-execute → compare at 1e-12 (same build) or 1e-9 (cross-build).
- A 32-record evidence register classifying every quantitative claim, and an isolated TSS-1/TSS-1R
  reconstruction workspace that requires attested assumptions for values that are not source-reported.

## 3. Implemented model inventory

| ID | Version | Status | Physics present in code |
| --- | --- | --- | --- |
| `OTL-2BP` | 1.0.0 | `IMPLEMENTED` | `r'' = −μr/|r|³`; osculating elements; measured energy and angular-momentum drift |
| `OTL-TETH-1` | 1.0.0 | `IMPLEMENTED` | Planar dumbbell, `θ'' + 2(L̇/L)θ' + 3n(t)²sinθcosθ = 0`, `L(t) = L₀ + L̇t`, one-way coupling, quasi-static vertical tension diagnostic |
| `OTL-TETH-2` | 0.0.0-spec | `NOT_MODELED` | Reel dynamics, elasticity, distributed mass — specification only |
| `OTL-TETH-3` | 0.0.0-spec | `NOT_MODELED` | Coupled spacecraft–tether orbital dynamics — specification only |
| `OTL-EDT-1` | 0.0.0-spec | `BLOCKED` | Electrodynamic tether concept — physics specification and missing-evidence list only |

Two of five models are executable. That ratio is displayed by the application itself, computed from
the model registry, not asserted in prose.

## 4. Numerical methods

Classical fixed-step **RK4** (order 4, final step clipped to the exact duration) and adaptive
**Dormand–Prince 5(4)** with embedded error estimate, error norm
`max|err| / (atol + rtol·max(|y|,|y5|))`, and standard `0.9·err^(−1/5)` step control. Both are
non-symplectic, so energy and angular momentum drift; the drift is **measured and reported**, not
assumed away, and no symplectic method is implemented. The two-body model exposes either solver to
the user; the tether model always runs fixed-step RK4, with the adaptive path reserved for building
a numerical reference in the convergence study.

## 5. Verification status

30 checks are displayed: 27 model-level (9 two-body, 18 tether) plus 3 platform. Representative
results, as measured by the checks themselves:

- RK4 convergence order **4.06**; tether convergence **4.055** (constant length) and **3.952**
  (prescribed deployment), against a ≥ 3.5 requirement.
- Reference adequacy for the convergence study: **380×** the empirical reference-error estimate,
  against a 100× requirement.
- Variable-length balance identity across 14 configurations: **11 PASS, 3 UNRESOLVED, 0 FAIL**.
- Conservation drift: energy **4.85e-11**, angular momentum **4.85e-11** (criteria 1e-8 and 1e-10).

Three points matter more than the passes:

1. The reference error is an **empirical estimate, not a bound**. The application says so in words,
   and a check fails if that status is overstated.
2. `UNRESOLVED` verdicts are reported where the *evidence* cannot decide an order — not converted to
   passes, and not treated as defects.
3. A `PASS` is a numerical criterion result. It is **software verification** of the stated equations.
   It is not model validation, and it is not physical validation.

## 6. Evidence-register status

32 records: **17 `SOURCE_REPORTED`**, **4 `DERIVED`**, **1 `ASSUMED`**, **5 `CONFLICT`**,
**5 `UNKNOWN`**. Conflicts are preserved and cross-linked, never averaged or resolved: TSS-1 mass
518 vs 515 kg; TSS-1R mass 517 vs 518 kg; tether diameter 2.54 vs 2.0 mm; TSS-1 deployed length
256 vs 262.1 m; TSS-1 altitude 230 nmi vs 296 km. Five quantities remain `UNKNOWN` (tether mass,
tether linear density, orbiter-side effective mass, insulation-damage initiator, measured Lorentz
thrust); no generic substitute is inserted for any of them. Seven records rest on secondary
compilations, and two could not be page-verified at primary level.

## 7. Major physical-model limitations

- **No perturbation forces** — no J2, drag, third-body, solar radiation pressure, relativity, thrust.
- **Idealised inertial frame**, not a rigorous J2000/ICRF realisation; no frame rotation.
- **Tether model is planar, massless, rigid, inextensible, prescribed-length, one-way coupled** — no
  reel or actuator, no elasticity, no damping, no distributed mass, no out-of-plane libration.
- **Deployment only** (`L̇ ≥ 0`); retrieval is rejected by the engine, not modelled.
- **No eccentricity-dependent libration coupling**; the model warns above e = 0.05 and above
  `L/r = 0.05`, where its first-order treatment ends.
- **No uncertainty propagation**; μ is treated as an exact model constant.
- **No validation against any measurement**, and no orbit-determination capability.

## 8. Six documented audit findings

Tracked in `AUDIT_FINDINGS.md`, all **open and unfixed** by design. None is evidence that a physical
model is wrong; they are documentation, presentation, configuration and criterion questions.

| ID | Finding | Significance |
| --- | --- | --- |
| F-01 | `README.md` states "9 two-body + 12 tether" checks (21) while the registry holds **18** tether checks (27 model, 30 displayed) | Documentation understates tether coverage and contradicts itself |
| F-02 | Exported Markdown report prints internal unit ids (`mps`, `m3s2`) because both branches of a ternary are identical | Cosmetic, export-only; invites a false suspicion of unit errors |
| F-03 | Dead `vCirc` computation in the two-body validation path (`void vCirc`) | Code hygiene; a signal about validation-branch coverage |
| F-04 | One scalar `absTolerance` applied to a mixed-unit state (m and m/s) | May bias adaptive step selection; effect unquantified |
| F-05 | Retrieval (`L̇ < 0`) is unsupported but an exported run does not state it | Scope limit visible only on attempted use |
| F-06 | `OT-TB-003`/`OT-TB-004` thresholds differ 100× over an identical measurement; `OT-TB-004` has ~2× margin | Criterion justification is unstated, unlike the tether budgets |

## 9. What this project is explicitly not

- Not flight software, not flight-ready, not qualified or certified.
- Not a validated digital twin, and not a fidelity claim about TSS-1 or TSS-1R.
- Not an orbit-prediction tool: with no perturbations, the difference from a real orbit is
  unquantified.
- Not independently reviewed: 259 tests over 17 files were written by the same author as the code.
- Not a source of operational, planning, or safety-critical output.

## 10. Feedback requested

1. Are the governing equations correctly formulated, including the `2(L̇/L)θ'` deployment term, the
   `n(t)` coupling, and the sign conventions?
2. Is fixed-step RK4 with step-refinement evidence appropriate here, and does the absence of a
   symplectic integrator undermine the reported conservation diagnostics?
3. Are the conservation and balance criteria well-posed, and are the `UNRESOLVED` verdicts handled
   correctly?
4. Is two-case convergence coverage sufficient for the parameter ranges the interface allows?
5. Are the modelling assumptions defensible for the stated scope, and which omitted effect dominates?
6. What data would be required for validation, and which step should be prioritised before the model
   is expanded?

`RESEARCHER_REVIEW_QUESTIONS.md` expands these into 40 specific questions. They are unanswered by
design.

---

## Traceability

Model inventory and statuses: `src/models/registry.ts`, `src/models/notImplemented.ts`; equations:
`src/models/twoBody.ts`, `src/models/tether.ts`, evaluated in `src/core/twobody.ts`,
`src/core/tether.ts`; integrators and step budget: `src/core/integrators.ts`,
`src/core/constants.ts`; checks, criteria and tolerances: `src/verification/registry.ts`,
`twoBodyChecks.ts`, `tetherChecks.ts`, `tetherConvergence.ts`, `tetherBalance.ts`,
`tetherEquation.ts`; evidence counts: `src/evidence/register.ts`; run and hash scope:
`src/core/run.ts`, `src/export/serialize.ts`; findings: `AUDIT_FINDINGS.md`. Measured values quoted
here are the project's recorded results, reproducible by opening the Verification Center or running
`npm test`; they were not independently re-derived for this brief.
