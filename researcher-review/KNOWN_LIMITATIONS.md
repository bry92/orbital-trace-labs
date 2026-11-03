# Known Limitations

A transparent list of what this prototype cannot do, what it does not claim, and what was found
during the audit that prepared this package.

**RESEARCH PROTOTYPE — NOT FLIGHT SOFTWARE.** Nothing here is validated, qualified, or approved
for any operational use.

Items marked **FINDING** were discovered while preparing this package. All of them are **documented
here and left unfixed**, as instructed: this is preparation for review, not a repair pass. No
simulation, solver, verification, evidence, artifact, run-record, or landing-page file was modified.

---

## 1. Physical and modelling limitations

1. **No perturbation forces.** No J2 or higher harmonics, atmospheric drag, third-body gravity,
   solar radiation pressure, relativity, or thrust. Results are therefore not orbit predictions for
   a real spacecraft, and the difference from a real orbit is not quantified anywhere in this build.
2. **Idealised inertial frame.** No Earth rotation, precession or nutation. This is not a rigorous
   J2000/ICRF realisation.
3. **Point masses only.** No finite-size effects, inertia tensors, or attitude dynamics. The
   orbiting body's mass does not enter the two-body equation at all.
4. **Osculating, not mean, elements.** Elements are instantaneous; they oscillate, and `RAAN`/`ω`
   are reported as `0` by convention in degenerate (equatorial/circular) geometries.
5. **No validation against any measurement.** No flight data, ground test, or higher-fidelity model
   comparison was performed. The reconstruction workspace is explicitly **not** a validated digital
   twin.
6. **No uncertainty propagation.** Source uncertainties (including the tabulated uncertainty in μ)
   and model uncertainties are not propagated into results. μ is treated as an exact model constant.
7. **Spherical Earth for interpretation only.** Radius 6378137 m; flattening is not modelled, and
   the radius does not enter the equations of motion.
8. **No orbit determination, estimation, or fitting.** No tracking data is ingested.
9. **Parameter ranges are engineering guards, not physics.** For example the 720 h duration cap
   exists to keep the browser step budget finite; it is not a statement about model validity.

## 2. Tether-specific limitations

10. **Planar only.** Out-of-plane libration is specified (`EQ-T-010`) but `NOT_MODELED`.
11. **Massless, rigid, inextensible rod** at prescribed length. No elasticity, no wave propagation,
    no damping, no distributed mass, no bending.
12. **Prescribed length, not solved.** `L(t) = L₀ + L̇t`. Reel inertia, motor torque, brake behaviour
    and any actuator are absent, so a deployment transient cannot be predicted.
13. **Deployment only.** The production engine rejects `L̇ < 0` (`INVALID_DEPLOYMENT_RATE`), so
    retrieval is outside the shipped model even though the equation supports it. **(FINDING — scope
    boundary, not a defect.)**
14. **One-way coupling.** The tether exerts no force on the centre of mass, so orbit–tether energy
    and angular-momentum exchange cannot be represented (`EQ-T-008` `NOT_MODELED`).
15. **First-order regime.** The libration equation and the vertical tension diagnostic are first
    order in `L/r`; the engine warns above `L/r = 0.05`. The verification study runs at
    `L/r ≈ 2.95e-3`, well inside that regime — so evidence at one `L/r` does not transfer to another.
16. **No eccentricity-dependent coupling.** `n(t)` comes from the instantaneous radius; a warning is
    emitted above e = 0.05 but the omitted terms are not quantified.
17. **Tension is a diagnostic, not a design load.** `T_vert = 3μ_redμL/r³` is quasi-static and
    vertical-only; it is not the tension of a librating tether and carries no structural model.
18. **No electrodynamics.** `OTL-EDT-1` is `BLOCKED`; the geomagnetic field model, plasma
    environment, current-collection law, circuit topology, thermal model and a verified thrust
    benchmark are all missing or `UNKNOWN`.
19. **No conservation claim for the tether subsystem.** Length is prescribed, work is done by
    whatever enforces the prescription, and `L⁴K` is explicitly not an invariant.

## 3. Numerical limitations

20. **Non-symplectic integrators.** RK4 and DOPRI5 both drift in energy and angular momentum; the
    drift is measured and reported, not eliminated. No symplectic method is implemented.
21. **Single scalar `absTolerance` on a mixed-unit state** (metres and m/s), so the relative
    tolerance governs in practice. Documented as a deliberate simplification, but it means the
    adaptive controller is not per-component scaled. **(FINDING — documented simplification;
    reviewer should judge its effect on step selection.)**
22. **200,000-step budget per propagation.** A browser runtime guard; cases requiring more are
    rejected rather than silently coarsened.
23. **Convergence coverage is narrow.** Two configurations for the tether study; the 14-case balance
    matrix is calibration evidence, not 14 validated cases (252 measured points over 14
    initial-value problems).
24. **Reference error is an empirical estimate, not a bound.** Explicitly labelled
    `EMPIRICAL_ESTIMATE`; three bounding routes were considered and rejected with reasons.
25. **Three balance configurations are `UNRESOLVED`** (BC-6, BC-10, BC-14): the evidence cannot
    decide an order. They are far inside their budgets; the verdict is about the evidence, not the
    model.
26. **Balance budget carries a declared safety factor of 4**, so it is conservative rather than
    tight; residuals sit 4–5 orders below it.
27. **Cross-platform bit-identical results are not guaranteed.** Browser-only, single-node
    execution; reproduction tolerance relaxes from 1e-12 (same build) to 1e-9 (cross-build).
28. **The tether adaptive path is not researcher-facing**; it exists only to build a numerical
    reference for the convergence study.

## 4. Provenance, evidence and platform limitations

29. **Code revision is `UNVERIFIED`.** The bundle carries a build id but no bound version-control
    revision, so a run record cannot prove which source tree produced it.
30. **The earlier local commit chain was lost.** `75b7fb9 → … → de942de` was destroyed when a VM
    restoration discarded the disposable cache holding it; it was never pushed, so it is
    unrecoverable. The current snapshot (`c06bcb5`) is a documented fresh root commit and does
    **not** continue that chain. Recovery record: `provenance/PROVENANCE.md`.
31. **The verification suite was written by the same author as the implementation.** 259 tests
    across 17 files assert properties the documentation relies on, but they are not independent
    evidence.
32. **Hashing establishes integrity only.** A payload hash match proves the bytes were not altered;
    it says nothing about correctness, authorship, or physical validity. The hash deliberately does
    not bind the build or the clock.
33. **No backend, no accounts, no multi-user support.** Persistence is `localStorage` under
    `otl.runs.v1`, per browser profile. Clearing storage or using a private window loses runs;
    exported artifacts are the durable form.
34. **Evidence register limits.** Some records rest on secondary summaries (reflected in confidence);
    quotations are short transcriptions and carry transcription risk; source uncertainties are not
    propagated; the register is not a literature survey and does not adjudicate the conflicts it
    preserves.
35. **Optional Archil archiving is dev-only tooling** that requires an API key in `.env.local`. The
    application itself makes no network calls; using the script does.

## 5. Findings from this audit

These were found while tracing claims to source. **None was fixed.** They do not change any
computed result; they are recorded so a reviewer is not misled and so the maintainers can decide
whether to address them.

| ID | Finding | Location | Effect |
| --- | --- | --- | --- |
| F-01 | **Documentation inconsistency:** `README.md` says the verification module "implements 9 two-body checks and 12 tether checks" (21), while the registry contains 9 + **18** = 27 model checks, and the same README later states "27 model + 3 platform = 30 total". | `README.md` line 67 vs line 106; `src/verification/tetherChecks.ts`, `src/verification/registry.ts` | Stale prose only; the application's counts are computed from `ALL_CHECKS` and are correct (27 model, 30 displayed). A reader trusting line 67 would undercount the tether checks by six. |
| F-02 | **Markdown report unit column renders internal unit ids.** The metrics row in the technical report uses `unitSymbol(x.unit) === x.unit ? x.unit : x.unit` — both branches are identical, so the symbol lookup is discarded and internal ids (`mps`, `m3s2`, `degps`) appear instead of symbols (`m/s`, `m³/s²`, `°/s`). | `src/export/serialize.ts` line 87 | Cosmetic, in exported `.report.md` only. Values are unaffected; JSON/CSV exports carry the unit label and SI value correctly. |
| F-03 | **Dead computation in two-body validation.** `rCirc` and `vCirc` are computed and then discarded via `void vCirc`. | `src/models/twoBody.ts` lines 392–393, 409 | No effect on results; dead code in the validation path. |
| F-04 | **`absTolerance` is a single scalar for a mixed-unit state** (see item 21 above). | `src/models/twoBody.ts` parameter description; `src/core/integrators.ts` error norm | Step selection near perigee may be driven by position error (metres) rather than velocity error (m/s). Documented, not validated. |
| F-05 | **Deployment-only restriction is not surfaced in the results.** The engine rejects `L̇ < 0` with a validation error, but runs with `L̇ = 0` and `L̇ > 0` carry no statement that retrieval is unsupported. | `src/core/tether.ts` (`INVALID_DEPLOYMENT_RATE`), warnings block | A reviewer reading only an exported run cannot tell retrieval is out of scope from the run itself. |
| F-06 | **`OT-TB-003` and `OT-TB-004` measured values are identical (4.85e-11) with criteria two orders apart** (1e-8 vs 1e-10). | `src/verification/twoBodyChecks.ts` (`TB_TOLERANCES`) | Both pass comfortably; noted because identical measurements under different thresholds invite a question about how the thresholds were chosen. |

## 6. What would be required before any stronger claim

- An independent derivation audit of the two governing equation sets by someone other than the
  author, ideally with an independently coded reimplementation compared against the shipped one.
- Resolution (or explicit bounding) of the reference-error question, replacing the empirical
  estimate with a proven bound if a validation claim is ever intended.
- A source of measured tether behaviour (TSS-1/TSS-1R libration, tension, deployed length) with
  documented uncertainties, and the primary sources for the five conflicts and five unknowns.
- Perturbation modelling and uncertainty propagation, if any comparison with real orbits is
  intended.
- A bound code revision (so a run record identifies its source tree), and archived build
  environments for long-term reproduction.
- An external reviewer's answers to `RESEARCHER_REVIEW_QUESTIONS.md` — and a decision about whether
  the omissions in §1–§2 are acceptable for the intended research questions or disqualifying.
