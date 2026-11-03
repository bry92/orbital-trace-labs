# Researcher Review Questions

Questions for an independent aerospace researcher. They are grouped by subject and phrased so that
each can be answered from the source, the recorded evidence, or the reviewer's own judgement.

**These questions are deliberately not answered here.** They are not rhetorical, and several have
no obviously correct answer. Where this package states what the code does, it does not state whether
that is the right thing to do.

Context for every question: **RESEARCH PROTOTYPE — NOT FLIGHT SOFTWARE.** No validation of any kind
has been performed, and none is claimed.

---

## A. Are the governing equations formulated correctly?

1. `OTL-2BP` integrates `r'' = −μ r/|r|³` in an idealised inertial frame with a fixed central point
   mass. For a low-Earth-orbit study, is the omission of frame rotation, precession and nutation
   acceptable as a *documented idealisation*, or does it make the reported osculating elements
   misleading even for a first-order study?
2. The specific energy and angular momentum are computed as `E = ½|v|² − μ/|r|` and `h = r × v`, and
   the discrepancies are normalised as
   `ε_E = |E(t) − E(0)| / max(|E(0)|, μ/|r₀|)` and
   `ε_h = ||h(t)| − |h(0)|| / max(|h(0)|, |r₀||v₀|)`.
   Are these normalisations well-posed for near-parabolic and high-eccentricity cases, and is
   `max(...)` the right denominator compared with alternatives such as a running scale or a
   relative-to-initial form?
3. The tether libration equation is
   `θ'' + 2(L̇/L)θ' + 3n(t)² sinθ cosθ = 0`, obtained from
   `d/dt(μ_red L²θ') = −3n²μ_red L² sinθ cosθ`. Is the derivation correct, including the sign and
   factor of the `2(L̇/L)θ'` term for a prescribed deployment with no deployer torque?
4. `n(t) = √(μ/|r(t)|³)` is taken from the instantaneous reference radius, with
   eccentricity-dependent coupling terms omitted. How large is the omitted coupling for the
   eccentricities the interface allows (a warning appears above e = 0.05), and would a
   true-anomaly-based formulation be materially different?
5. The quasi-static vertical tension diagnostic is `T_vert = 3μ_redμL/r³`, reported for the whole
   run including librating configurations. Is presenting this quantity alongside `θ(t)` defensible
   if it is explicitly labelled a vertical, first-order diagnostic — or should it be withheld
   outside θ ≈ 0?
6. The dumbbell model assumes zero axial inertia and a transverse moment of inertia
   `J = μ_red L²`. Is that the correct inertia for a two-point-mass dumbbell about its centre of
   mass, and does the libration equation remain correct when the two end masses differ substantially
   (the interface permits that)?

## B. Is the numerical integration approach appropriate?

7. Both integrators are explicit and non-symplectic (classical RK4 and Dormand–Prince 5(4)). For
   long-duration orbital propagation, is measuring and reporting energy/angular-momentum drift an
   adequate substitute for a symplectic or energy-preserving method, or should the absence of a
   symplectic option be treated as a design limitation?
8. Is order-4 convergence at the steps used in the study (h = 240 → 30 s for the convergence cases,
   h = 60 → 7.5 s for the balance cases) sufficient for the claimed accuracy, given that the
   observed orders (4.055 constant-length, 3.952 prescribed deployment) are close to the theoretical
   4?
9. A single scalar `absTolerance` is applied to a mixed-unit state vector (metres and m/s) in
   DOPRI5, so in practice the relative tolerance governs. What is the consequence for step selection
   near perigee, and would per-component scaling be required before trusting the adaptive path?
10. The step budget is 200,000 steps per propagation, and the interface warns when fewer than 50
    steps fall in one orbital period. Are either of these thresholds defensible, and what error
    would a reviewer expect at 50 steps per period for the eccentricities the presets offer?
11. The tether model always runs fixed-step RK4; an adaptive DOPRI5 path exists only to build a
    numerical reference for the convergence study. Is it acceptable to verify the shipped fixed-step
    path against an adaptive path over the *same* right-hand side, given that a shared error in the
    right-hand side would be invisible to that comparison?

## C. Are the conservation-law checks correctly defined?

12. No conservation claim is made for the tether subsystem, on the grounds that length is
    prescribed and work is done by whatever enforces the prescription. Is that reasoning correct,
    and is it stated clearly enough that a reader will not read the reported `K` behaviour as a
    conservation law?
13. The variable-length balance identity
    `K(t) − K(0) = −2∫(L̇/L)θ'² dt` with `K = θ'²/2 − (3/2)n²cos²θ` is used as the tether's
    consistency check. Is this the strongest available identity for this equation, or does a
    different invariant (for example a scaled or transformed form) provide a sharper test?
14. `L⁴K` drifts by 227 % in the documented run and by 1e-12 to 3.9e+3 relative across the 14-case
    matrix. The application states that it is therefore an invariant of none of these cases. Is that
    conclusion sound, and is the choice of `K` (rather than a length-weighted variant) the right one
    to present to a reviewer?
15. The balance budget is derived by propagating trajectory error through the two places it enters
    and multiplying by a **declared safety factor of 4**, with measured residuals 4–5 orders below
    it. Is a declared safety factor an acceptable methodology for this purpose, and is the resulting
    check strong evidence of consistency rather than a bound — as the documentation claims?
16. Three of the 14 balance configurations are `UNRESOLVED` (order spread > 1 unit, or round-off
    limited). Is `UNRESOLVED` the right verdict for these, or should they be reported as `PASS` on
    the budget criterion alone with the order caveat noted separately?

## D. Is the numerical convergence testing sufficient?

17. Convergence is demonstrated for two configurations (constant length; one prescribed deployment).
    Is that sufficient coverage for the parameter ranges the interface allows, or does each regime
    (L/r, eccentricity, deployment rate, initial rate) require its own refinement study?
18. The TC-2 reference is a numerical DOPRI5 solution at rtol 1e-12 / atol 1e-15 on the same 2-state
    equation, cross-checked against two looser tolerances and an RK4 Richardson limit. Reference
    adequacy is reported as 380×–969× against a 100× requirement. Is 100× the right adequacy
    threshold, and is taking the **minimum** of four component ratios the conservative choice?
19. The reference error is an `EMPIRICAL_ESTIMATE`, explicitly **not** a bound; three bounding routes
    were considered and rejected (validated interval arithmetic, defect control with a Gronwall
    bound, a-priori DOPRI5 truncation bounds). Are those rejections correct, and is any of them
    feasible within a browser-only implementation?
20. The adequacy criterion compares the finest isolated error against the reference error estimate.
    Does that comparison risk circularity, given both quantities derive from the same integrator
    family?
21. The final time of the convergence cases is deliberately not an integer number of libration
    periods, because at an exact integer the phase error hides at a turning point and the measured
    order rises spuriously to about 5. Is avoiding that configuration the right choice, or should
    both cases be reported?
22. `OT-TT-014` eliminates the constraint force by projecting the relative acceleration perpendicular
    to the rod, then explains the residual with the leading term derived from the third directional
    derivative of `r/|r|³` (explained fraction 1.000000, 82 % of the Taylor bound). Does this
    constitute adequate evidence that the implemented coefficients are correct, and what other
    coefficient errors would it fail to detect?

## E. Are the model assumptions appropriate for the stated scenarios?

23. The application's own framing is "independent aerospace research prototype for two-body orbital
    mechanics and bounded tether dynamics", with a historical TSS-1/TSS-1R reconstruction workspace.
    Given the assumptions (planar, massless, rigid, prescribed-length, one-way coupling, no
    perturbations), is that framing accurate, or does the TSS material imply a fidelity the models
    cannot support?
24. The reconstruction workspace requires the researcher to supply and attest assumptions
    (counterweight mass, libration angle, deployment rate) and labels resulting runs
    `EVIDENCE_INFORMED_RECONSTRUCTION`, explicitly not a validated digital twin. Is that labelling
    sufficient, or does the existence of the workspace itself invite an unwarranted comparison with
    the missions?
25. Earth is treated as a sphere of the WGS-84 equatorial radius for surface/altitude
    interpretation, and μ is treated as an exact constant with no uncertainty propagation. For a
    research prototype, is this acceptable, and at what point would it become misleading?
26. The production tether engine accepts deployment rates `L̇ ≥ 0` only, so retrieval is not
    modelled, even though the libration equation supports either sign. Is that an appropriate scope
    restriction, and is it stated prominently enough for a reviewer who only reads outputs?

## F. Does the tether formulation omit important physical effects?

27. Which omitted effect dominates for a 20 km, 500 kg + 500 kg tether in low Earth orbit:
    distributed tether mass, axial elasticity and wave propagation, out-of-plane libration, deployer
    and brake dynamics, atmospheric drag on the tether, or electrodynamic interaction?
28. `OTL-TETH-2` (solved length, reel dynamics, distributed mass) and `OTL-TETH-3` (coupled
    spacecraft–tether orbit) are specified but `NOT_MODELED`. Is the specification complete enough
    that an implementer could build them without further decisions, and are the required inputs
    correctly identified?
29. The one-way coupling means the tether exerts no force on the centre of mass. At what
    tether-to-spacecraft mass ratio does that become untenable for libration studies, and does the
    current model have any way to signal that it has been exceeded?
30. `OTL-EDT-1` is `BLOCKED` because the geomagnetic field model, plasma environment, current
    collection law, circuit topology and a verified thrust benchmark are all missing or `UNKNOWN`.
    Is that the correct set of blockers, and is any of them obtainable from published TSS-1R data?
31. A quasi-static tension estimate is reported but no structural or material model exists. Is the
    reported quantity useful to a tether engineer, or is it more likely to be misread as a design
    load?

## G. What data would be needed for validation?

32. For the two-body model: what benchmark would constitute meaningful validation — high-precision
    ephemerides with documented perturbations, laser ranging residuals, or a published
    propagation-tool comparison — and what tolerance would be appropriate?
33. For the tether model: which TSS-1/TSS-1R measurements would be usable (libration angle, tether
    tension, deployed length history, current/voltage), what is their documented uncertainty, and
    are they publicly available in a form that could be compared against a model output?
34. The evidence register records five `CONFLICT` records (TSS-1R mass 517 vs 518 kg, tether
    diameter 2.54 vs 2.0 mm, TSS-1 deployed length 256 vs 262.1 m, TSS-1 altitude 230 nmi vs 296 km,
    plus one further conflicting record) and five `UNKNOWN` quantities. Which of these would need a
    primary-source resolution before any validation attempt, and which are immaterial at the
    model's current fidelity?
35. What level of uncertainty propagation (inputs, model form, numerical error) would a reviewer
    require before accepting a comparison against flight data as validation rather than coincidence?

## H. What should be prioritised before expanding the model?

36. Given the current state, which is the higher-value next step: (a) adding perturbation forces to
    the two-body model, (b) implementing `OTL-TETH-2` with reel and elasticity, (c) attempting
    validation of `OTL-TETH-1` against TSS-1R libration data, or (d) strengthening the verification
    evidence (rigorous reference bounds, wider convergence coverage)?
37. Should the project pursue a rigorous reference-error bound (validated interval arithmetic or
    defect control) before any validation attempt, given that the current estimate is empirical and
    explicitly not a bound?
38. Is the current provenance design — payload hash over a declared canonical scope, code revision
    `UNVERIFIED`, reproduction at 1e-12 same-build / 1e-9 cross-build — adequate for research
    traceability, and what would an independent reviewer need in addition (for example a bound
    source revision, signed builds, or archived environments)?
39. The verification suite (259 tests) was written by the same author as the implementation. What
    independent review activity would add the most assurance per unit of effort: a line-by-line
    derivation audit, an independently coded reimplementation of the equations, or a
    cross-comparison against an established astrodynamics tool?
40. Are there questions this package should have asked and did not? Please state them.
