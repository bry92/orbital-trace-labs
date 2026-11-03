# Verification and Validation

What has been checked, against what criterion, with what measured value — and, kept strictly
separate, what has **not** been validated at all.

**RESEARCH PROTOTYPE — NOT FLIGHT SOFTWARE.** A `PASS` in this document is the result of a
numerical acceptance criterion. It is not evidence of physical validity, flight readiness, or
operational suitability.

---

## 1. Three different things, kept apart

The application distinguishes these explicitly, in the interface and in every exported artifact.
Conflating them is the single most common way a numerical prototype is over-read.

| Kind | Question it answers | Status in this build |
| --- | --- | --- |
| **Computational verification** | Does the code solve *the stated equations* correctly, and do the numerical methods behave as claimed? | Substantially addressed for the implemented equations, with stated gaps (see §9, §10) |
| **Model validation** | Are *the stated equations* an adequate representation of the physical system for the intended scenario? | **Not performed.** No comparison against independent physics, experiments, or higher-fidelity models |
| **Physical validation** | Does the model agree with *measured reality* — flight data, ground tests, tracked objects? | **Not performed and not claimed.** No flight data is used anywhere; the reconstruction workspace is explicitly not a validated digital twin |

A numerical `PASS` here establishes the first row only. Where the evidence cannot decide — for
example an order estimate that never settles — the verdict is `UNRESOLVED`, never `PASS` and never
`FAIL`.

## 2. Inventory and execution model

Source: `src/verification/registry.ts` (`ALL_CHECKS = [...TWO_BODY_CHECKS, ...TETHER_CHECKS]`).

| Group | Count | IDs | Executed |
| --- | --- | --- | --- |
| Two-body model checks | 9 | `OT-TB-001 … 009` | Against the live engine |
| Tether model checks | 18 | `OT-TT-001 … 018` | Against the live engine |
| Platform checks | 3 | `OT-PF-001 … 003` | In the Verification Center |
| **Total displayed** | **30** | — | 27 model-level + 3 platform |

Every model check runs the real calculation engine or the real validation layer and returns a
measured value; none compares a hard-coded expected string with a hard-coded actual string. Each
row carries: criterion, expected behaviour, measured value, unit, tolerance, tolerance
justification, method, evidence, limitations. A check that throws is reported as `FAIL` with the
exception message, never silently skipped.

Outcome states: `PASS`, `FAIL`, `UNRESOLVED`, `NOT_TESTED`, `BLOCKED` — plus `INVALID` for any
outcome outside those five, so summary counts always reconcile with the number of rows
(`checkSummary()`).

## 3. Two-body checks

Tolerances: `TB_TOLERANCES` in `src/verification/twoBodyChecks.ts`. Measured values as reported
in `README.md` and reproduced live by the Verification Center.

| Check | Criterion | Tolerance | Measured |
| --- | --- | --- | --- |
| `OT-TB-001` circular radius invariance | `max |r(t)/r₀ − 1|` over one period | ≤ 1e-8 relative | 5.28e-10 |
| `OT-TB-002` eccentric vs analytic Kepler | Relative state error against the analytic Kepler solution | ≤ 1e-6 relative | 8.23e-8 |
| `OT-TB-003` energy conservation | Max normalised energy discrepancy `ε_E` | ≤ 1e-8 | 4.85e-11 |
| `OT-TB-004` angular-momentum conservation | Max normalised `ε_h` | ≤ 1e-10 | 4.85e-11 |
| `OT-TB-005` RK4 convergence order | Observed order under step halving | ≥ 3.5 (exact 4) | 4.06 |
| `OT-TB-006` invalid input rejection | All listed invalid cases rejected | All (equality) | 9/9 cases |
| `OT-TB-007` repeatability | Two identical executions | = 0 exactly | 0 exactly |
| `OT-TB-008` DOPRI5 vs analytic | Relative error of the adaptive path | ≤ 1e-7 | 1.14e-9 |
| `OT-TB-009` open-orbit reporting | Period must be reported as `null`, never estimated | `null` required | `null` |

Note on `OT-TB-004` vs `OT-TB-003`: the angular-momentum criterion is two orders tighter than the
energy criterion, and the measured values are close to each other (4.85e-11 both). The reviewer
should judge whether these thresholds are independently justified rather than chosen to match
observed drift — this is listed as a review question, not resolved here.

## 4. Tether checks

Tolerances: `TT_TOLERANCES` in `src/verification/tetherChecks.ts`. The tether check set is
substantially larger because the tether model raises questions a two-body propagation does not:
which invariant exists, whether the reference used for convergence is adequate, and whether the
equation itself (not merely its numerical solution) is right.

| Check | Criterion | Tolerance | Measured |
| --- | --- | --- | --- |
| `OT-TT-001` libration period | Small-amplitude period vs `2π/(√3 n)` | ≤ 1 % relative | 3206.448 s vs 3206.386 s analytic |
| `OT-TT-002` vertical equilibria | θ drift from θ=0 and θ=π | ≤ 1e-12 rad | 0 rad |
| `OT-TT-003` horizontal instability | Growth from θ=π/2 vs `cosh` prediction | ≥ 4× | 5.30× (prediction 5.30×) |
| `OT-TT-004` tension vs exact balance | Quasi-static tension vs exact point-mass force balance | ≤ 2·L/r + 1e-9 | 1.47e-3 relative (L/r = 2.95e-3) |
| `OT-TT-005` prescribed length exactness | Length history as an identity | ≤ 1e-9 m | 0 m |
| `OT-TT-006` invalid tether inputs | All invalid cases rejected | All (equality) | 10/10 cases |
| `OT-TT-007` repeatability | Two identical executions | = 0 exactly | 0 exactly |
| `OT-TT-008` no conservation claim | The application must declare its unresolved quantities rather than imply conservation | ≥ 4 specific items | 6 declared |
| `OT-TT-009` libration invariant | `K = θ'²/2 − (3/2)n²cos²θ` at constant length | ≤ 1e-6 relative | 2.48e-12 |
| `OT-TT-010` convergence, constant length | Observed order under refinement | ≥ 3.5 (exact 4) | 4.055 |
| `OT-TT-011` convergence, prescribed deployment | Observed order under refinement | ≥ 3.5 (exact 4) | 3.952 |
| `OT-TT-012` reference adequacy | Finest isolated error ÷ empirical reference error, minimum of four components | ≥ 100× | 3.80e2× |
| `OT-TT-013` reference-error status not overstated | Declared as empirical estimate, not a bound | 5/5 conditions | 5/5 |
| `OT-TT-014` equation vs exact force balance | Explained fraction of the discrepancy; fitted order in `L/r`; Taylor bound | within 0.1 %; order in [1.8, 2.2] | explained 1.000000; 82 % of bound |
| `OT-TT-015` closed-form reference first integral | Jacobi-elliptic reference holds `K` | ≤ 1e-12 | 3.33e-16 |
| `OT-TT-016` balance identity, manufactured solution | Quadrature of an exact integral; convergence order | ≤ 1e-9; order in [3.5, 5.5] | 3.19e-13 relative |
| `OT-TT-017` variable-length balance | Residual vs derived budget; residual order | ≤ 1; order ≥ 3 | 2.2e-4 of budget |
| `OT-TT-018` balance budget calibration | 14 configurations, per-case budget and order consistency | ≤ 1 for every case; consistent order ≥ 3 | 3.7e-2 of budget; **11 PASS, 3 UNRESOLVED, 0 FAIL** |

`OT-TT-008` is unusual and worth noting: it is a check whose subject is the *application's own
claims*. It fails if the application stops declaring the quantities it cannot compute.

## 5. Convergence study

Source: `src/verification/tetherConvergence.ts`, `src/core/elliptic.ts`.

- **TC-1, constant length** (2.37 exact libration periods, θ₀ = 5°). Reference: the exact
  Jacobi-elliptic solution `sinθ = k·sn(√3·n·t + K, k)`, computed by descending Landen/AGM
  recursion. Cross-checked against DOPRI5 at two tolerances and an RK4 Richardson limit; largest
  observed difference 1.28e-10 rad in θ.
- **TC-2, prescribed deployment** (6,900 s, L: 20 km → 26.9 km at 1 m/s, θ₀ = 2°). No closed form
  exists, so the reference is adaptive DOPRI5 at rtol 1e-12 / atol 1e-15 on the **same 2-state
  equation** the isolated metric integrates, explicitly labelled a **numerical** reference.
  Cross-checks: rtol 1e-10 (Δθ 1.52e-11) and 1e-11 (Δθ 1.38e-12), plus an RK4 Richardson limit
  (Δθ 3.01e-11).
- **Order estimation** uses `p_k = ln(e_{k−1}/e_k)/ln(h_{k−1}/h_k)` at h = 240, 120, 60, 30 s; no
  order is assumed.
- **Final time is deliberately not an integer number of libration periods**, because at an exact
  integer the leading phase error hides at the turning point and the observed order spuriously
  rises to about 5. This is documented in the configuration comment.

Measured isolated θ errors — TC-1: 4.77e-4 → 2.75e-5 → 1.61e-6 → 9.70e-8 rad (orders 4.120,
4.089, 4.055); TC-2: 8.45e-5 → 6.62e-6 → 4.51e-7 → 2.91e-8 rad (orders 3.674, 3.875, 3.952).

### 5.1 The reference error is an empirical estimate, not a bound

`study.referenceErrorKind` records `EMPIRICAL_ESTIMATE`. It is the largest observed disagreement
between the adopted reference and three independently constructed comparisons. It is **not** a
proven upper bound and not a validated interval enclosure. `referenceErrorStatement` says so in
words, every case repeats it, and `OT-TT-013` fails if that status is missing, inconsistent or
overstated.

Three routes to a genuine bound were considered and rejected, with reasons recorded in
`src/verification/tetherConvergence.ts`: validated interval / Taylor-model integration (needs
outward-rounded arithmetic including `sin`/`cos`, and ECMAScript permits implementation-approximated
`Math.sin`/`Math.cos`); defect-control plus a Gronwall bound (the plain Lipschitz constant of
1 s⁻¹ makes `exp(L_f T) = exp(6900)` vacuous without a weighted energy norm with a proven
logarithmic-norm bound); and an a-priori DOPRI5 truncation bound (needs sixth-derivative bounds and
is expected to exceed the finest measured error by far more than the adequacy threshold).

**Consequence for the reviewer:** adequacy is demonstrated (380×–969× against a 100× requirement),
boundedness is not. A shared error across all three comparisons — in particular an error in the
right-hand side itself — would be invisible to the study, which is exactly why `OT-TT-014`
exists.

## 6. Checking the equation, not just its solution

Source: `src/verification/tetherEquation.ts`; check `OT-TT-014`.

Every convergence comparison above solves the same right-hand side, so a wrong coefficient would be
invisible to all of them. `OT-TT-014` closes that gap **without integrating anything**:

- The constraint force is eliminated rather than modelled: for a massless rod the force acts along
  the tether, so projecting the relative acceleration perpendicular to the rod removes the unknown
  tension: `L·θ'' + 2L̇·θ' = [g(r₂) − g(r₁)]·e_perp`, with end positions `r_cm ∓ (L/2)e` and `g`
  Newtonian gravity evaluated exactly at each mass.
- Expanding about the centre of mass gives `−3n²sinθcosθ` and the kinematic `2(L̇/L)θ'` — exactly
  what `src/core/tether.ts` integrates.
- The leading omitted term is **derived** from the third directional derivative of `r/|r|³` in
  closed form, then compared with the measured discrepancy: at `L/r = 2.951e-3`, predicted
  5.740e-12 rad/s² versus measured 5.740e-12 rad/s² — explained fraction 1.000000, sitting at
  82 % of the Taylor bound `(15/24)(L/r)²`, with fitted orders 2.000 across `L/r = 3e-2 … 3e-4`.
- Sensitivity: because the truncation is explained, the check would reject a relative error of
  3.9e-4 % in the gravity-gradient coefficient, 10 % in the deployment term, a missing deployment
  term, or a sign flip. A test mutates the expression by 1 % and requires the explanation to fail.
- The production 8-state path reproduces a hand-written replica of the documented right-hand side
  **bit-exactly** (difference 0 in both θ and θ'), which is what ties this physics check to the code
  that ships.

This verifies the equation and its coefficients. It says nothing about the physical model:
in-plane, massless rigid rod, circular reference orbit, prescribed deployment, one-way coupling
all remain assumptions.

## 7. The variable-length balance identity

Source: `src/verification/tetherBalance.ts`; checks `OT-TT-015 … 018`.

With `K = θ'²/2 − (3/2)n²cos²θ`, differentiating along any smooth path gives
`dK/dt = θ'(θ'' + 3n²sinθcosθ)`; substituting the equation yields

```
dK/dt = −2 (L̇/L) θ'²          K(t) − K(0) = −2 ∫₀ᵗ (L̇/L) θ'² dt
```

So with `L̇ > 0` the mean-motion term must **decrease**, by an amount equal to the accumulated
integral. `L⁴K` is **not** conserved (it drifts by 227 % in the documented run), and the
application does not present it as an invariant. **No conservation claim is made for the tether
subsystem:** length is prescribed, so work is done on it by whatever enforces the prescription,
and that mechanism is not modelled.

Evidence kinds, deliberately kept distinct:

| Evidence | Kind | What it shows |
| --- | --- | --- |
| `OT-TT-016` | analytic identity + independent quadrature | The identity and the quadrature are right, with no integrator in the loop |
| `OT-TT-017` | independent numerical check + measured budget | The production equation satisfies the identity under refinement |
| `OT-TT-018` | empirical calibration over 14 configurations | The budget *methodology* is tested as a method, per configuration |
| test suite | mutation detection | Wrong terms, signs and coefficients are rejected |

Budget derivation (not calibration): trajectory error is measured by self-convergence against a
run at half the step, propagated through the two places it enters (`3n²εθ + |θ'|εθ'` for `K`;
`4(L̇/L)|θ'|Tεθ'` for the integral), added to the Richardson quadrature estimate and multiplied by
a **declared** safety factor of 4. Measured residuals sit 4–5 orders below that budget, which is
the honest reading: the budget is conservative, so the check is strong evidence of consistency
but not a tight bound on truncation.

### 7.1 The 14-case matrix, and what its verdicts mean

| case | configuration | worst residual/budget | asymptotic orders | status |
| --- | --- | --- | --- | --- |
| BC-1 | 2°, 20 km, 1 m/s (TC-2 reference) | 1.50e-4 | 3.494, 3.801 | PASS |
| BC-2 | 5°, 20 km, 0 m/s (constant length) | 2.52e-3 | 4.993, 4.988 | PASS |
| BC-3 | 30°, 20 km, 1 m/s | 1.45e-3 | 3.540, 3.816 | PASS |
| BC-4 | 60°, 20 km, 1 m/s | 7.59e-4 | 3.472, 3.795 | PASS |
| BC-5 | 5°, 20 km, 5 m/s | 4.57e-3 | 3.931, 3.967 | PASS |
| BC-6 | 5°, 20 km, 0.1 m/s | 1.98e-3 | 5.521, 7.952 | **UNRESOLVED** (spread 2.431) |
| BC-7 | 5°, 1 km, 1 m/s | 3.69e-2 | 3.995, 3.999 | PASS |
| BC-8 | 5°, 20 km, 2 m/s, 1,800 s | 8.60e-3 | 3.797, 3.909 | PASS |
| BC-9 | exponential history, `L̇/L = 1e-4 s⁻¹` | 1.83e-3 | 3.840, 3.927 | PASS |
| BC-10 | sinusoidal history, ±2 km, period 2,400 s | 1.64e-3 | 1.754, 3.522 | **UNRESOLVED** (spread 1.769) |
| BC-11 | quadratic history, 1 m/s + 2e-4 m/s² | 1.17e-3 | 3.783, 3.903 | PASS |
| BC-12 | 5°, +2e-4 rad/s initial rate, 1 m/s | 3.69e-4 | 3.405, 3.775 | PASS |
| BC-13 | 10°, −2e-4 rad/s initial rate, constant length | 4.64e-3 | 5.069, 5.151 | PASS |
| BC-14 | 0.05°, 20 km, 0.1 m/s (small signal) | 2.42e-5 | 5.550, 7.389 | **UNRESOLVED** (round-off limited) |

Every budgeted residual is inside its own budget: 252 budgeted (configuration, step, time) points
plus 84 unbudgeted finest-step residuals over 14 configurations. Those are **measurements, not
experiments** — each configuration is one initial-value problem — and the check's evidence string
says so explicitly, so 252 points must not be read as 252 validated cases.

The three `UNRESOLVED` verdicts are the interesting ones and are reported, not hidden:

- **BC-6** previously passed on a single order statistic (5.521). The second asymptotic pair gives
  7.952 — a spread of 2.431 — so no single order is established.
- **BC-10** shows the same failure at 1.754 against 3.522: the coarsest pair is not yet in the
  asymptotic regime for a history that reverses direction every 1,200 s.
- **BC-14**'s residual reaches the estimated double-precision floor before the order settles, so
  there is no order to measure.

None is a criterion violation; all three are far inside their budgets. They are cases where the
*evidence* cannot support an order-based conclusion.

### 7.2 Classification order (thresholds declared before the matrix ran)

Ratio 1× (caution), 10× (failure), order floor 3, order-spread allowance 1 unit, resolution
allowance `|residual|/|integral| ≤ 1`:

1. no computable budget → `UNRESOLVED` (`BUDGET_NOT_COMPUTABLE`)
2. `|residual|/|integral| > 1` → `UNRESOLVED` (`BALANCE_BELOW_RESOLUTION`)
3. ratio > 10 → `FAIL` (`BUDGET_EXCEEDED_BEYOND_10X`)
4. 1 < ratio ≤ 10 → `UNRESOLVED` (`BUDGET_EXCEEDED_WITHIN_10X`)
5. order not computable → `UNRESOLVED` (`ORDER_NOT_COMPUTABLE`)
6. successive orders differ by more than 1 unit → `UNRESOLVED`
   (`ORDER_ESTIMATE_UNRELIABLE`, or `ORDER_ROUND_OFF_LIMITED` when the finest residual is at the
   estimated floor)
7. order below 3 → `UNRESOLVED` (`ORDER_BELOW_FLOOR`)
8. otherwise → `PASS` (`CRITERION_MET`)

`FAIL` is reachable **only** through the budget comparison, and it states that the numerical
acceptance criterion was violated — not that the equation, the model, or the physics is wrong. A
test asserts that no order value can produce `FAIL` on its own.

### 7.3 Scope boundary, measured rather than declared

The same balance check that returns a relative residual of ~1e-9 on the prescribed constant-`n`
equation returns **1.5e-2** on the production 8-state run when the reference orbit is eccentric
(e = 0.05, `n` varying by 12 %). That is the constant-`n` identity being correctly inapplicable to
the coupled `n(t)` model, and a test asserts it, so the calibration's verdict cannot be quietly
extended to the coupled trajectory.

## 8. Platform checks

Source: `src/ui/VerificationCenter.tsx`.

| ID | Check | Criterion | Notes |
| --- | --- | --- | --- |
| `OT-PF-001` | SHA-256 known-answer test | SHA-256 of ASCII `"abc"` equals the published NIST test vector | Validates the hashing primitive only, nothing about the payload |
| `OT-PF-002` | Canonical serialisation key-order invariance | Two objects with identical content but different key order canonicalise identically | Required for an independent implementation to reproduce a payload hash |
| `OT-PF-003` | Reproducibility of a stored run | Import → re-execute → compare within tolerance, with a valid payload hash | `NOT_TESTED` until a reproduction is actually run; then reflects that result |

Summary cards count **every row displayed**: for this build, 27 model + 3 platform = 30, and
`OT-PF-003` is `NOT_TESTED` until a reproduction is performed. An outcome outside the five
recognised states counts as `INVALID` rather than being dropped.

## 9. What is unresolved or untested, stated plainly

| Item | State | Why |
| --- | --- | --- |
| Reference error as a rigorous bound | **Not established** | `EMPIRICAL_ESTIMATE`; three bounding routes considered and rejected with reasons (§5.1) |
| Balance budget as a tight bound | **Not established** | Declared safety factor 4; residuals sit 4–5 orders below it |
| Order convergence for BC-6, BC-10, BC-14 | `UNRESOLVED` | Evidence cannot decide; not criterion violations |
| Physical validity of either model | **Not established** | No validation of any kind was performed |
| Perturbation-free two-body accuracy vs reality | **Not established** | No perturbation model exists, so the difference from a real orbit is unquantified |
| Tether dynamics under retrieval (`L̇ < 0`) | **Not modelled** | Production engine rejects negative rates |
| Out-of-plane libration | `NOT_MODELED` | Equation recorded (`EQ-T-010`), not implemented |
| Coupled orbit–tether exchange | `NOT_MODELED` | One-way coupling only (`EQ-T-008`) |
| EDT performance | `BLOCKED` | Required inputs and benchmark evidence missing |
| Reproduction on this machine before pressing Reproduce | `NOT_TESTED` | The platform check reports it honestly until executed |

## 10. Automated test suite

`npm test` (Vitest) runs 17 test files / 259 tests, covering: physics invariants
(`physics.test.ts`, `tether.test.ts`), the elliptic reference (`elliptic.test.ts`), convergence
and balance studies (`tetherConvergence.test.ts`, `tetherBalance.test.ts`, `tetherEquation.test.ts`),
validation (`validation.test.ts`), verification aggregation (`verification.test.ts`), run hashing and
records (`runHash.test.ts`, `provenance.test.ts`), artifact import/limits
(`convergenceArtifact.test.ts`, `compareLimits.test.ts`), presentation
(`runPresentation.test.ts`, `summary.test.ts`, `diagnostics.test.ts`, `presets.test.ts`), and UI
render smoke tests (`ui-smoke.test.tsx`).

The suite asserts the properties this document relies on, including: boundary behaviour of every
classification threshold, mutation rejection for wrong coefficients and signs, `FAIL` never arising
from an order statistic alone, the reference adequacy estimate equalling the largest listed
difference, and the reproduction study returning `UNRESOLVED` (never `PASS`/`FAIL`) when the
reference is deliberately degraded.

**A passing test suite verifies the implementation against these assertions. It does not validate
the physics.** The tests were written by the same author as the code they test, and no independent
test suite exists.

## 11. What none of this establishes

- That the point-mass equations are an adequate model of any real orbit (they are the textbook
  equations; adequacy for a scenario is a validation question).
- That the prescribed-length dumbbell represents a real tether deployment, whose reel, elasticity,
  distributed mass, damping and out-of-plane motion are all absent.
- That any numerical result is accurate for a case other than those actually refined.
- That the software is suitable for any operational, planning, or safety-related use.

---

# Appendix — Which measurements can be regenerated, and how

Distinguishing (a) values regenerable by re-executing this code, (b) values an independent reviewer
can check without trusting this code, and (c) values that exist only as documentation.

## A. Regenerable by re-execution

All **27 model checks** execute against the live engine whenever the Verification Center is opened
(`runAllChecks()` in `src/verification/registry.ts`), and 17 test files / 259 tests re-exercise the
same code paths under `npm test`. `OT-PF-001` (SHA-256 known-answer test) and `OT-PF-002`
(canonical-key-order invariance) also run on each load. Regeneration is therefore possible for
every model measurement — but it re-runs *the same implementation*, so it confirms determinism, not
correctness.

## B. Checkable without trusting this implementation

These depend on textbook results or on an identity the reviewer can verify by hand or with
independent software:

| Check | Independent basis |
| --- | --- |
| `OT-TB-001` | Radius is constant for a circular two-body orbit — analytic |
| `OT-TB-003`, `OT-TB-004` | `E` and `|h|` are exact invariants of `r'' = −μr/|r|³`; a reviewer can integrate independently and compare drift magnitude |
| `OT-TB-005` | Fourth-order convergence of RK4 is a textbook property; the observed 4.06 is checkable by independent step refinement |
| `OT-TB-009` | Whether a period is reported for an open orbit is directly observable |
| `OT-TT-001` | Small-amplitude libration period `2π/(√3·n)` is analytic |
| `OT-TT-002`, `OT-TT-003` | Vertical equilibrium and the horizontal instability growth follow from linearising `θ'' = −3n²sinθcosθ` |
| `OT-TT-004` | The exact two-end force balance admits an independent closed-form computation (`verticalTensionExactN`) |
| `OT-TT-005` | `L(t) = L₀ + L̇t` is a direct identity on the series |
| `OT-TT-009`, `OT-TT-015` | `K = θ'²/2 − (3/2)n²cos²θ` is exactly invariant at constant `n`, `L` — derivable and checkable independently |
| `OT-TT-014` | The Taylor term `(15/24)(L/r)²` derives from the third directional derivative of `r/|r|³`; a reviewer can re-derive it |
| `OT-TT-016` | The manufactured-solution integral has a closed form; the quadrature claim is checkable outside this code |

## C. Reproducible only by re-running this code (no independent oracle)

| Check | Why |
| --- | --- |
| `OT-TB-002`, `OT-TB-008` | Compared against `keplerPropagate()` — an analytic Kepler solution implemented **in this repository**. It is independent of the RK4/DOPRI5 paths, but not independent of the authors |
| `OT-TT-010`, `OT-TT-011` | Observed orders are properties of this implementation's error sequence at these steps |
| `OT-TT-012`, `OT-TT-013` | Reference adequacy compares this code's isolated errors against this code's reference-error estimate |
| `OT-TT-017`, `OT-TT-018` | Residual/budget ratios depend on the derived budget with its declared safety factor of 4 |
| `OT-PF-003` | Requires a user-initiated import → reproduce action; reported as `NOT_TESTED` until performed |

## D. Documentation-only values (recorded, not regenerated in this pass)

| Value | Where it lives | Status |
| --- | --- | --- |
| Verification table measurements (e.g. 5.28e-10, 8.23e-8, 380×, BC-1…BC-14 rows) | `README.md`, reproduced in this package | Recorded results. They are **not** hash-bound to an artifact and were **not** re-executed when this package was written; the code that computes them is intact and re-runnable |
| Convergence artifact hashes | Exported `otl-convergence-artifact-v1` files | Only exist once exported; the package quotes none |
| `259 tests / 17 files` | This session's `vitest run` | Regenerable with `npm test` |
| Build sizes (576.01 kB JS, 14.68 kB CSS) | This session's `npm run build` | Regenerable with `npm run build`; sizes vary by tooling version |

**Consequence for the reviewer:** no value in this package is fabricated, but the numeric
measurements in §3–§7 are the project's recorded results, not independently re-derived here.
Regenerating them requires running the application or the test suite; independently *checking* them
is possible only for the rows in group B.
