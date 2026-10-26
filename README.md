# Orbital Trace Labs — v1.0-research-prototype

**RESEARCH PROTOTYPE — NOT FLIGHT SOFTWARE.** Results are limited to the implemented
mathematical models and documented assumptions. No flight qualification or independent
validation is implied.

Independent aerospace research prototype for two-body orbital mechanics and bounded tether
dynamics. Every displayed number is computed at run time, every run records how it was
obtained, and every model declares what it does not include.

## Run it

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # vitest, physics + validation + provenance + UI render tests
npm run build      # tsc --noEmit && vite build
```

Runtime: Node 24 for tooling; the application itself is a static browser bundle (React 19,
TypeScript, Vite). No backend, no database, no network calls. Persistence uses
`localStorage`; runs are append-only.

## Implemented models

| Model | Status | Contains |
| --- | --- | --- |
| `OTL-2BP` v1.0.0 | IMPLEMENTED | Two-body point-mass propagation, classical elements, measured energy/angular-momentum diagnostics |
| `OTL-TETH-1` v1.0.0 | IMPLEMENTED | Prescribed-length gravity-gradient dumbbell, planar libration, one-way coupling to a two-body reference orbit, quasi-static vertical tension diagnostic |
| `OTL-TETH-2` v0.0.0-spec | NOT_MODELED | Dynamically calculated deployment (reel dynamics, elasticity, distributed mass) — specification only |
| `OTL-TETH-3` v0.0.0-spec | NOT_MODELED | Coupled spacecraft–tether orbital dynamics — specification only |
| `OTL-EDT-1` v0.0.0-spec | BLOCKED | Electrodynamic tether disposal concept — physics specification, required inputs and missing evidence only |

### Equations actually evaluated

Two-body (`core/twobody.ts`):

- `r'' = -mu r / |r|^3`
- `E = ½|v|² − mu/|r|`, `h = r × v`
- `a = (2/|r| − |v|²/mu)^-1`, eccentricity vector, classical elements, `T = 2π√(a³/mu)` for closed orbits only
- `ε_E = |E(t) − E(0)| / max(|E(0)|, mu/|r0|)`, `ε_h = ||h(t)| − |h(0)|| / max(|h(0)|, |r0||v0|)`

Tether (`core/tether.ts`):

- `L(t) = L0 + Ldot·t` (prescribed input, not solved)
- `θ'' + 2(Ldot/L)θ' + 3n(t)² sinθ cosθ = 0`, derived from `d/dt(μ_red L²θ') = −3n²μ_red L² sinθ cosθ`
- `n(t) = √(mu/|r(t)|³)` from the two-body reference orbit (one-way coupling)
- `T_vert = 3μ_red mu L / r³`, `μ_red = m1m2/(m1+m2)` — vertical quasi-static diagnostic only

No perturbation force (J2, drag, third body, SRP, relativity), no attitude dynamics, no
elasticity, no electrodynamics, and no state estimation is implemented anywhere.

## Numerical methods

- Classical fixed-step RK4 (order 4), non-symplectic; final step clipped to the exact duration.
- Dormand–Prince 5(4) adaptive pair with embedded error estimate and standard 1/5 step control
  (two-body model, and the tether engine's explicit reference-solution path used by the
  convergence study; the researcher-facing tether model always runs fixed-step RK4).
- Independent analytic Kepler reference (Newton solution of Kepler's equation) used only as a test oracle.
- Hard step budget of 200,000 steps per propagation.

Conservation drift is measured and reported, never assumed. No run claims convergence until
the step-refinement check has been executed.

## Verification

`src/verification/` implements 9 two-body checks and 12 tether checks, all executed against the
live engine and displayed in the Verification Center with criterion, expected behaviour,
measured value, unit, tolerance, tolerance justification, method, evidence and limitations.

Latest measured results (recorded from actual test runs):

| Check | Measured | Criterion |
| --- | --- | --- |
| OT-TB-001 circular radius invariance | 5.28e-10 | ≤ 1e-8 relative |
| OT-TB-002 eccentric vs analytic Kepler | 8.23e-8 | ≤ 1e-6 relative |
| OT-TB-003 energy conservation | 4.85e-11 | ≤ 1e-8 |
| OT-TB-004 angular-momentum conservation | 4.85e-11 | ≤ 1e-10 |
| OT-TB-005 RK4 convergence order | 4.06 | ≥ 3.5 (exact 4) |
| OT-TB-006 invalid input rejection | 9/9 cases | all |
| OT-TB-007 repeatability | 0 exactly | = 0 |
| OT-TB-008 DOPRI5 vs analytic | 1.14e-9 | ≤ 1e-7 |
| OT-TB-009 open-orbit reporting | period null | null required |
| OT-TT-001 libration period | 3206.448 s vs 3206.386 s analytic | ≤ 1 % |
| OT-TT-002 vertical equilibria | 0 rad drift | ≤ 1e-12 rad |
| OT-TT-003 horizontal instability | 5.30× (cosh prediction 5.30×) | ≥ 4× |
| OT-TT-004 tension vs exact balance | 1.47e-3 relative (L/r = 2.95e-3) | ≤ 2·L/r |
| OT-TT-005 prescribed length exactness | 0 m | ≤ 1e-9 m |
| OT-TT-006 invalid tether inputs | 10/10 cases | all |
| OT-TT-007 repeatability | 0 exactly | = 0 |
| OT-TT-008 no conservation claim | 6 unresolved items declared | ≥ 4 specific |
| OT-TT-009 libration invariant | 2.48e-12 | ≤ 1e-6 |
| OT-TT-010 convergence, constant length | order 4.055 | ≥ 3.5 (exact 4) |
| OT-TT-011 convergence, prescribed deployment | order 3.952 | ≥ 3.5 (exact 4) |
| OT-TT-012 reference adequacy (min of 4 component ratios) | 3.80e2× | ≥ 100× |
| OT-TT-013 reference-error status not overstated | 5/5 conditions | all |
| OT-TT-014 equation vs exact point-mass force balance | explained 1.000000; 82 % of bound | within 0.1 %; order in [1.8, 2.2] |
| OT-TT-015 closed-form reference preserves the first integral | 3.33e-16 | ≤ 1e-12 |
| OT-TT-016 balance identity on a manufactured exact solution | 3.19e-13 relative | ≤ 1e-9, order in [3.5, 5.5] |
| OT-TT-017 variable-length balance along refined trajectories | 2.2e-4 of budget | ≤ 1, residual order ≥ 3 |
| OT-TT-018 balance-budget calibration, 14-case matrix | 3.7e-2 of budget; 11 PASS, 3 UNRESOLVED | ≤ 1 for every case, consistent order ≥ 3 |

A PASS is a numerical criterion result. It does not establish physical validity.

The summary cards count **every check shown on the page** — model checks plus platform checks —
and the panel states the reconciliation (for this build: 27 model + 3 platform = 30 total). Before
a reproduction is run, OT-PF-003 is counted as `NOT_TESTED`, so the cards always agree with the
tables; previously the platform checks were omitted and a `NOT_TESTED` row was invisible in the
totals. An outcome outside the five recognised states is counted as `INVALID` rather than dropped.

### Tether convergence study

`src/verification/tetherConvergence.ts` refines the step at fixed physical initial conditions and
final time and measures the observed order with `p_k = ln(e_(k-1)/e_k) / ln(h_(k-1)/h_k)`; no
order is assumed. Two cases are run at h = 240, 120, 60, 30 s:

- **TC-1, constant length** (2.37 exact libration periods, θ₀ = 5°). Reference: the exact
  Jacobi-elliptic solution of `θ'' = −3n² sinθ cosθ`, i.e. `sinθ = k sn(√3 n t + K, k)`, computed
  by descending Landen/AGM recursion in `src/core/elliptic.ts`. Cross-checked against DOPRI5 at two
  tolerances and an RK4 Richardson limit; largest observed difference: 1.28e-10 rad in θ.
- **TC-2, prescribed deployment** (6900 s, L: 20 km → 26.9 km at 1 m/s, θ₀ = 2°). No closed form
  exists, so the reference is adaptive DOPRI5 at rtol 1e-12 / atol 1e-15 on the **same 2-state
  equation** the isolated metric integrates, identified everywhere as a **numerical** reference.
  Cross-checks: DOPRI5 at rtol 1e-10 (Δθ 1.52e-11) and 1e-11 (Δθ 1.38e-12), plus an RK4 Richardson
  limit (Δθ 3.01e-11). The residual is the **largest** of these per component: 3.01e-11 rad in θ,
  9.64e-14 rad/s in θ̇.

**Reference adequacy** is evaluated per component and stated once:
`adequacy = (finest isolated error for the component) / (empirical reference-error estimate for the
same component)`.
Measured: TC-1 θ 760×, θ̇ 498×; TC-2 θ 969×, θ̇ 380×; the reported check value is the minimum of
the four (380× against a required 100×). An earlier build compared TC-2's rtol 1e-12 and 1e-10
*coupled 8-state* runs and obtained 1.10e-14 rad; that pair agreed by accident (both runs happened
to land close together) and understated the reference error by an order of magnitude. It has been
replaced by the multi-estimate maximum above, and a regression test asserts the estimate equals
the largest listed difference.

#### The equation itself is checked against physics, not against another integrator

Every convergence comparison above solves the same right-hand side, so a wrong coefficient in
that right-hand side would be invisible to all of them. `src/verification/tetherEquation.ts`
closes that gap without integrating anything:

- **Instrument eliminated, not modelled.** For a massless rod the constraint force acts along the
  tether, so projecting the relative acceleration perpendicular to the rod removes the unknown
  tension: `L theta'' + 2 Ldot theta' = [g(r2) - g(r1)] . e_perp`. Both end-mass positions are
  `r_cm ∓ (L/2)e` with `e = cos(theta) r_hat + sin(theta) t_hat`, and `g` is Newtonian gravity
  evaluated **exactly** at each mass.
- **The first-order term is the implemented equation.** Expanding about the centre of mass gives
  `-3 n^2 sin(theta) cos(theta)` and the kinematic `2 (Ldot/L) theta'`, i.e. exactly what
  `core/tether.ts` integrates.
- **The residue is derived, not hidden.** From the exact third directional derivative of
  `r/|r|^3`, the leading omitted term is computed in closed form and compared with the measured
  discrepancy. At the study's `L/r = 2.951e-3` the difference is 5.740e-12 rad/s² against a
  predicted 5.740e-12 rad/s²: **explained fraction 1.000000** (0.999983 at `L/r = 3e-2`, where the
  next term is relatively larger). It sits at 82 % of the derived Taylor bound
  `(15/24)(L/r)^2`, and across `L/r = 3e-2 … 3e-4` the normalised difference falls with fitted
  orders 2.000, 2.000, 2.000, 2.000 — second order because the third-order term is divided by `L`.
- **Sensitivity.** Because the truncation is fully explained, the check would reject a relative
  error of 3.9e-4 % in the gravity-gradient coefficient, 10 % in the deployment term, a missing
  deployment term or a sign flip. A test mutates the expression by 1 % and requires the
  explanation to fail.
- **The two code paths are the same computation.** A test replicates the documented 8-state
  right-hand side and one RK4 step; the production path reproduces it **bit-exactly** (difference 0
  in both theta and theta'), which is what links this physics check to the code that actually runs.
- **The closed-form reference is checked against the equation's first integral.** For constant
  `n` and `L`, `K = theta'^2/2 - (3/2) n^2 cos^2(theta)` is exactly invariant; sampled at 4,001
  points over the TC-1 duration, the Jacobi-elliptic reference holds it to **3.33e-16** relative
  (round-off), where a 0.1 % error in the rate alone gives more than 1e-6 drift.

This verifies the equation and its coefficients. It still says nothing about the physical model:
in-plane, massless rigid rod, circular reference orbit, prescribed deployment, one-way coupling.

#### Is the reference error a bound? No — and it is labelled as such

The reference-error quantity is an **empirical estimate**: the largest observed disagreement
between the adopted reference and three independently constructed comparisons. It is **not** a
proven upper bound and not a validated interval enclosure. `study.referenceErrorKind` records
`EMPIRICAL_ESTIMATE`, every case repeats it, `referenceErrorStatement` says in words that it is not
a bound, and OT-TT-013 fails if that status is missing, inconsistent or overstated.

Three routes to a genuine bound were considered in `src/verification/tetherConvergence.ts` and not
adopted, with the reasons recorded there: validated interval/Taylor-model integration (needs
outward-rounded arithmetic for `+ − × ÷ sin cos` and a certified elementary-function layer —
ECMAScript permits `Math.sin`/`Math.cos` to be implementation-approximated, so an in-house enclosure
would itself be unvalidated); a defect-control + Gronwall bound (the plain Lipschitz constant is
1 s⁻¹, making `exp(L_f T) = exp(6900)` vacuous unless a weighted energy norm with a proven
logarithmic-norm bound is derived, which again needs validated evaluation along the trajectory);
and an a priori DOPRI5 truncation bound (needs sixth-derivative bounds along the true solution and
is expected to exceed the finest measured error by far more than the adequacy threshold, turning
the study UNRESOLVED without adding evidence).

What the estimate *does* establish: the reference and the isolated metric integrate the same
2-state equation, initial conditions, length history and final time; the three comparisons disagree
by 1.4e-12 … 3.0e-11 rad (θ) and 4.2e-15 … 9.6e-14 rad/s (θ̇); adequacy is 380×–969× against a
100× requirement. What it does **not** establish: a bound, and any error shared by all three
comparisons — they use the same right-hand side, so a wrong-but-consistent equation would be
invisible to them. A test file now contains an independently coded RK4 integration of the
documented equation at h/8 and requires it to agree with the adopted reference to within 20× the
reported estimate, which is a check of the *equation* the estimate describes, not of its size.

If the reference is not good enough, the case becomes `UNRESOLVED` — never `PASS`, never `FAIL`.
A regression test drives the study with `relTolReference = 1e-6` (adequacy 5.6e-3) and asserts
`UNRESOLVED` for both cases, while the measured integrated errors stay bit-identical to the
default run.

Every error is reported twice: the **as-executed** tether error from the production 8-state path,
and an **isolated** tether-only error from a 2-state RK4 integration with the analytic mean motion.
The isolated metric is the primary evidence for the integrator; reference-orbit error is reported
separately (its own order, ~4.2) and the coupled-minus-isolated difference is recorded, because the
two O(h⁴) contributions measurably partially cancel. Measured isolated θ errors TC-1:
4.77e-4 → 2.75e-5 → 1.61e-6 → 9.70e-8 rad (ratios 17.4, 17.0, 16.6; orders 4.120, 4.089, 4.055);
TC-2: 8.45e-5 → 6.62e-6 → 4.51e-7 → 2.91e-8 rad (ratios 12.8, 14.7, 15.5; orders 3.674, 3.875,
3.952). The final time is deliberately not an integer number of libration periods: at an exact
integer the leading phase error hides at the turning point and the measured order spuriously rises
to about 5 (this is documented in the configuration comment).

### Variable-length balance identity (TC-2)

`src/verification/tetherBalance.ts` checks the deployment equation against its own balance
identity. With `K = θ'^2/2 − (3/2) n² cos²θ`, differentiating along any smooth path gives
`dK/dt = θ'(θ'' + 3n² sinθ cosθ)`; substituting the equation gives

```
dK/dt = −2 (L̇/L) θ'^2          K(t) − K(0) = −2 ∫₀ᵗ (L̇/L) θ'^2 dt
```

so with `L̇ > 0` the mean motion term `K` must **decrease**, and the decrease must equal the
accumulated integral. `L⁴K` is *not* conserved — the run below drifts it by 227 % — and the
application does not present it as an invariant. No conservation claim is made for the tether
subsystem: length is prescribed, so work is done on it by whatever enforces the prescription,
and that mechanism is not modelled.

Three kinds of evidence, kept distinct:

| Evidence | Kind | What it shows |
|---|---|---|
OT-TT-016 | analytic identity + independent quadrature | the identity and the quadrature are right, with no integrator in the loop |
OT-TT-017 | independent numerical check + measured budget | the production *equation* satisfies the identity under refinement |
OT-TT-018 | empirical calibration over 14 configurations | the budget methodology is tested as a method, and its verdicts are reported per configuration (11 PASS, 3 UNRESOLVED) |
tests | mutation detection | wrong terms, signs and coefficients are rejected |

- **Manufactured exact solution.** With `θ(t) = θ₀ + a t` (`θ'' = 0`) the equation forces
  `L̇/L = −3n² sinθ cosθ / (2a)`, which integrates to
  `L(t) = L₀ exp{(3n²/(8a²))[cos 2θ(t) − cos 2θ₀]}`, and then `ΔK = (3/2)n²[cos²θ₀ − cos²θ]`
  exactly. Quadrature of the exact integrand reproduces the exact integral to **3.19e-13**
  (101 samples), 1.57e-14 (201), 2.55e-15 (401), with Richardson estimates bracketing the
  actual errors, at observed quadrature orders **4.324, 3.997, 4.055**.
- **Prescribed-deployment trajectory**, TC-2 configuration (θ₀ = 2°, L₀ = 20 km, L̇ = 1 m/s,
  6,900 s), integrated by a fixed-step RK4 that is independent of the production RHS, at
  h = 60, 30, 15, 7.5 s, with residuals reported at 25 %, 50 %, 75 % and 100 % of the run:

| h (s) | residual at 25/50/75/100 % (rad²/s²) | budget | share of budget | measured εθ |
|---|---|---|---|---|
60 | −4.86e-16, 3.55e-16, 5.45e-16, 7.08e-16 | 9.37e-12 | 0.01 % | 4.49e-7
30 | 8.28e-17, 1.45e-16, 2.16e-16, 2.72e-16 | 1.26e-12 | 0.02 % | 2.80e-8
15 | 6.91e-18, 1.38e-17, 1.93e-17, 2.41e-17 | 4.13e-13 | 0.01 % | 1.74e-9

  `K(0) = −1.917647e-6`, `ΔK = −1.021e-9`, integral `+1.021e-9` rad²/s². Residual orders:
  **1.381, 3.494, 3.801** — the 60 → 30 s pair is pre-asymptotic and is reported but not held
  to the floor; the two finer pairs are ≥ 3 against RK4's fourth order.
- **Budget derivation, not calibration.** Trajectory error is measured by self-convergence
  against a run at half the step and propagated through the two places it enters
  (`3n²εθ + |θ'|εθ'` for `K`; `4(L̇/L)|θ'|Tεθ'` for the integral), then added to the
  Richardson quadrature estimate and multiplied by a **declared** safety factor of 4. The
  measured residual sits 4–5 orders below that budget, which is the honest reading: the
  budget is conservative, so this check is strong evidence of consistency but not a tight
  bound on truncation.
- **Mutations rejected.** At h = 30 s (budget 1.26e-12): missing deployment term
  **1.34e-9** (1,064× budget), reversed sign **3.63e-9**, coefficient 3 → 3.05 **3.34e-11**
  (27× budget), kernel sign flip **2.04e-9**. A 0.033 % coefficient error (3 → 3.001) gives
  6.3e-13, at the detection limit; 0.17 % is clearly rejected.
- **Tied to the code that ships.** A full 6,900 s run of the production 8-state path matches a
  hand-written replication of the documented RHS to **1.0e-17** in θ and 6.8e-21 in θ'
  (round-off), so the identity above applies to the production equation and not merely to a
  re-typed copy.

**What this does not establish.** The identity follows from the equation, so satisfying it
shows *consistency*, not that the deployment mechanism is physically right. The actuator,
reel dynamics, tether elasticity, damping, out-of-plane motion and flight-data comparison
remain separate validation questions, none of which this check touches. The identity is
evaluated at constant `n`, while the production engine integrates the orbit and uses
`n(t) = √(μ/|r|³)`; that difference is why the trajectory check uses the 2-state form.

#### Calibrating the budget across cases, then testing whether the calibration generalises

One case cannot show that an error budget is conservative. OT-TT-018 runs the same balance check
over 14 configurations at four steps and six reporting times (10, 25, 50, 75, 90, 100 %), and
classifies each configuration against its own budget.

The first eight are the original calibration set. The last six were added specifically to ask
whether the acceptance rule survives outside the configurations it was built on: an exponential
history (constant `L̇/L`), a sinusoidal history (`L̇` changes sign, so the integral is not
monotone), a quadratic history (both `L̇` and `L̇/L` vary), nonzero positive and negative initial
rates, and a small-signal case where `|ΔK|` is about five orders below `|K|`. Nonlinear histories
are supplied in closed form together with their exact `L̇/L`; nothing is differentiated
numerically, and each closed form's gradient is tested against independent central differences of
its own `L(t)`.

| case | configuration | worst residual/budget | asymptotic orders | status |
|---|---|---|---|---|
BC-1 | 2°, 20 km, 1 m/s (TC-2 reference) | 1.50e-4 | 3.494, 3.801 | PASS
BC-2 | 5°, 20 km, 0 m/s (constant length) | 2.52e-3 | 4.993, 4.988 | PASS
BC-3 | 30°, 20 km, 1 m/s | 1.45e-3 | 3.540, 3.816 | PASS
BC-4 | 60°, 20 km, 1 m/s | 7.59e-4 | 3.472, 3.795 | PASS
BC-5 | 5°, 20 km, 5 m/s | 4.57e-3 | 3.931, 3.967 | PASS
BC-6 | 5°, 20 km, 0.1 m/s | 1.98e-3 | 5.521, 7.952 | **UNRESOLVED** (orders disagree, spread 2.431)
BC-7 | 5°, 1 km, 1 m/s | 3.69e-2 | 3.995, 3.999 | PASS
BC-8 | 5°, 20 km, 2 m/s, 1,800 s | 8.60e-3 | 3.797, 3.909 | PASS
BC-9 | exponential history, `L̇/L = 1e-4 s⁻¹` | 1.83e-3 | 3.840, 3.927 | PASS
BC-10 | sinusoidal history, ±2 km, period 2,400 s | 1.64e-3 | 1.754, 3.522 | **UNRESOLVED** (orders disagree, spread 1.769)
BC-11 | quadratic history, 1 m/s + 2e-4 m/s² | 1.17e-3 | 3.783, 3.903 | PASS
BC-12 | 5°, +2e-4 rad/s initial rate, 1 m/s | 3.69e-4 | 3.405, 3.775 | PASS
BC-13 | 10°, −2e-4 rad/s initial rate, constant length | 4.64e-3 | 5.069, 5.151 | PASS
BC-14 | 0.05°, 20 km, 0.1 m/s (small signal) | 2.42e-5 | 5.550, 7.389 | **UNRESOLVED** (round-off limited)

Every budgeted residual is inside its own budget: **252 budgeted (configuration, step, time)
points plus 84 unbudgeted finest-step residuals over 14 configurations**. Those counts are
measurements, not experiments — each configuration is one initial-value problem — and the check's
evidence string states that explicitly, so 252 points cannot be read as 252 validated cases.

The spread of worst ratios (2.4e-5 to 3.7e-2) is reported rather than summarised away, because it
is the calibration result: the methodology stays conservative but is not equally loose everywhere,
and BC-7 (1 km tether) comes closest at 27× inside its budget. The resolution measure
`|residual| / |integral|` is at most 6.32e-9 (BC-7), six orders inside the level at which the
balance would stop being resolvable at all. `L⁴K` drifts by 1.0e-12 to 3.9e+3 relative across the
matrix, so it is an invariant of none of these cases.

**The extended matrix changed the verdict, and that change is the result.** BC-6 previously passed
on an order statistic of 5.521; the second asymptotic pair gives 7.952, a spread of 2.431, so no
single order is established and the case is now `UNRESOLVED`. BC-10 shows the same failure at
1.754 against 3.522 — the first asymptotic pair is not yet in the asymptotic regime for a history
that reverses direction every 1,200 s. BC-14's residual reaches the estimated double-precision
floor before the order settles, so there is no order to measure at all. None of these is a
criterion violation: all three are far inside their budgets. They are cases where the *evidence*
cannot support an order-based conclusion, which is a different statement and is now reported as
such.

**Two aggregation defects were found by the matrix, not by the physics.** The first run classified
three cases as `FAIL` because the order statistic still included the pre-asymptotic 60 → 30 s pair;
cases are now judged from the 30 → 15 s and 15 → 7.5 s pairs, with the coarsest pair still
reported. The extension then exposed the second: a *low or inconsistent* order was being treated as
a demonstrated defect. It is not — leaving the asymptotic regime, cancellation between truncation
and quadrature contributions, and round-off all produce it, so the order path can no longer produce
`FAIL`.

**Classification order, and what each verdict means.** Thresholds were declared before the matrix
ran and were not moved when the extension changed outcomes: ratio 1× (caution), 10× (failure),
order floor 3, order-spread allowance 1 unit, resolution allowance `|residual|/|integral| ≤ 1`.

1. no computable budget → `UNRESOLVED` (`BUDGET_NOT_COMPUTABLE`)
2. `|residual|/|integral| > 1` → `UNRESOLVED` (`BALANCE_BELOW_RESOLUTION`)
3. ratio > 10 → `FAIL` (`BUDGET_EXCEEDED_BEYOND_10X`)
4. 1 < ratio ≤ 10 → `UNRESOLVED` (`BUDGET_EXCEEDED_WITHIN_10X`)
5. order not computable → `UNRESOLVED` (`ORDER_NOT_COMPUTABLE`)
6. successive orders differ by more than 1 unit → `UNRESOLVED` (`ORDER_ESTIMATE_UNRELIABLE`, or
   `ORDER_ROUND_OFF_LIMITED` when the finest residual is at the estimated floor
   `ε·(|K|max + |J|)·√steps`)
7. order below 3 → `UNRESOLVED` (`ORDER_BELOW_FLOOR`)
8. otherwise → `PASS` (`CRITERION_MET`)

`FAIL` is reachable only through the budget comparison, and it states that the **numerical
acceptance criterion** was violated — not that the equation, the model or the physics is wrong.
`BALANCE_STATUS_MEANING` says this in the UI and in the exported evidence, and a test asserts that
no order value can produce `FAIL` on its own. Tests drive every branch, including both sides of
each boundary (ratio 1 ± 1e-6, 10 ± 1e-6, order 3 ± 1e-6, spread 1 ± 0.001), a 1.7 % coefficient
defect injected through a documented hook (`FAIL`), a step-blind generator (`UNRESOLVED`, never
`PASS`), and the constant-length case where the integral is identically zero and the resolution
rule must not apply.

| claim | kind | status |
|---|---|---|
`dK/dt = −2(L̇/L)θ̇²` and its integral form | **analytic identity** of the documented equation | established by derivation, re-derived in tests
quadrature + independent integrator reproduce it | **independent numerical check** | PASS (manufactured exact solution, 3.19e-13 relative)
measured residuals inside measured budgets, 14 configurations | **empirical comparison** against an estimated budget | 11 PASS, 3 UNRESOLVED, 0 FAIL
reference/balance error rigorously bounded | **rigorous bound** | not established (declared safety factor 4)
physical deployment valid | **physical validation** | not established

**The scope boundary is measured, not just declared.** The same balance check that returns a
relative residual of ~1e-9 on the prescribed constant-`n` equation returns **1.5e-2** on the
production 8-state run when the reference orbit is eccentric (e = 0.05, `n` varying by 12 %). That
is the constant-`n` identity being correctly inapplicable to the coupled `n(t)` model, and a test
asserts it, so nobody can quietly extend the calibration's verdict to the coupled trajectory.

Limits of this calibration: it covers prescribed length, in-plane motion, a massless rod and
constant `n` — the model's own scope. Dynamics of a real reel or actuator, tether elasticity,
out-of-plane motion and the production `n(t)` coupling are outside it, and the finest step of each
configuration has no budget of its own because a budget requires a finer solution. The
`√steps` round-off allowance is an estimate of the floor, not a bound on it. Everything here shows
consistency with the documented equation; it does not validate tether deployment as hardware.

### Deterministic result hash and export scope

The study is displayed in the Verification Center and exported as `otl-convergence-artifact-v1`
JSON with a SHA-256 payload hash over an explicitly constructed canonical payload. The scope is
declared in the file (`hashSpec.includedFields` / `excludedFields`) and enforced by
`convergenceHashPayload()` in `src/export/convergenceArtifact.ts`:

- **Hashed** — artifact `schemaVersion`; `app.name`, `app.version`, `app.releaseLabel`; and
  `study.schemaVersion`, `study.model`, `study.purpose`, `study.orderEstimator`,
  `study.roundOffFloorRel`, `study.overallStatus`, `study.referenceErrorKind`,
  `study.referenceErrorStatement`, `study.cases`, `study.limitations`
  (all measured errors, ratios, orders, reference estimates, acceptance criteria and statuses).
- **Not hashed, recorded for provenance** — export timestamp (`generatedAtUtc`), execution
  timestamp (`study.generatedAtUtc`), build identifier (`app.buildId`), and the hash metadata
  itself.

Consequently the same results exported twice, or after a rebuild, produce the **same digest**;
re-exporting does not create a new evidence identity. The complement is stated plainly in the
file and the UI: the hash does not bind the build or the clock, so it cannot be used to show which
build produced a result. Hash matching is integrity evidence only, not correctness evidence.

A validating importer (`parseConvergenceArtifact`) rejects malformed JSON (`MALFORMED_JSON`),
unknown artifact or study schemas (`UNSUPPORTED_SCHEMA`), missing/mistyped/non-finite fields
(`INVALID_STRUCTURE`), and any file claiming `RIGOROUS_BOUND` or `VALIDATED_ENCLOSURE`
(`UNSUPPORTED_REFERENCE_CLAIM`, because this build computes neither and cannot check the claim),
rather than repairing them. A structurally valid file whose digest does not
match is surfaced as a mismatch, never silently accepted. The Verification Center exposes this as
**Import & verify**.

## Provenance and reproducibility

Each run is an append-only record containing: run id, UTC timestamp, application version,
build id, model id/version, full input list with entered units and SI values, solver
settings, computed series and metrics, verification results, warnings, assumptions,
limitations, unresolved quantities, evidence flags, and a SHA-256 payload hash.

- Payload hash: canonical JSON (sorted keys, shortest round-trip numbers), excluding
  `payloadHash`, `hashSpec` and `hashStatus`. The included field list is stored in the record.
- Artifact hash: SHA-256 over the exact bytes of each exported file (JSON, CSV, Markdown
  report, verification JSON, manifest).
- Code revision is reported **UNVERIFIED**: no VCS revision is bound to the bundle.
- Hashing establishes integrity only — not correctness, authorship or physical validity.

Reproduction: import an exported JSON run, then press **Reproduce**. The importer validates
schema, units, model and payload hash; the re-run is compared against the stored series and
metrics at 1e-12 (same build) or 1e-9 (cross-build) per-column normalised tolerance. Different
model versions are reported as BLOCKED, not compared.

## Evidence register

`src/evidence/register.ts` classifies every quantitative claim as `SOURCE_REPORTED`,
`DERIVED`, `ASSUMED`, `CONFLICT` or `UNKNOWN`, with source title, URL, locator, quotations
where available, interpretation, confidence and conflict links.

Preserved conflicts include: TSS-1R satellite mass 517 vs 518 kg; tether diameter 2.54 vs
2.0 mm; TSS-1 deployed length 256 vs 262.1 m; TSS-1 orbit altitude 230 nmi vs 296 km.
Unknowns include tether mass, tether linear density, orbiter-side effective mass, the TSS-1R
insulation damage initiator, and measured Lorentz thrust. No value is inferred from a
diameter, a generic mass-per-length, or a similar mission.

## Verification archive on an Archil disk (optional)

`scripts/archil-evidence.mjs` keeps exported verification evidence on a persistent
[Archil](https://docs.archil.com/sdks/typescript) disk so it survives between sessions. It is
Node tooling only: it is a dev dependency, it is not bundled, the browser app still makes no
network calls, and it is outside the vitest suite and the browser check scripts.

```bash
cp .env.example .env.local    # then set ARCHIL_API_KEY (git-ignored file)
npm run archil -- status            # disk identity and what it already holds
npm run archil -- push [dir]        # archive a directory (default: artifacts)
npm run archil -- list [prefix]     # list archived objects (default: runs/)
npm run archil -- pull <run-id> [dir]   # restore one run, digest-checked
npm run archil -- exec "<command>"  # run a command on the disk
```

Each `push` uploads the directory under `runs/<utc-timestamp>-<directory>/files/` plus a
`manifest.json` that records every path, byte count and SHA-256 of the archived bytes. `pull`
refuses any file whose digest does not match the manifest. `exec` runs bash in a microVM with
the disk mounted as the working directory, so files and installed dependencies persist across
invocations. The disk is created on first use (name `orbital-trace-labs-evidence` unless
`ARCHIL_DISK_NAME` or `ARCHIL_DISK_ID` says otherwise).

Credentials come from the environment only — `ARCHIL_API_KEY` is required; `ARCHIL_REGION`
defaults to `aws-us-east-1`. The npm script loads `.env.local` if it exists. Archiving and
restoring establish integrity of the bytes moved, not correctness of the archived results.

## Historical reconstruction workspace

An isolated TSS-1 / TSS-1R workspace lets a researcher select source-reported values and
supplies explicit assumptions for unknowns (counterweight mass, libration angle, deployment
rate). Execution is blocked until the assumptions are entered and attested. Resulting runs are
labelled `EVIDENCE_INFORMED_RECONSTRUCTION`, carry every assumption in `evidenceFlags`, and are
not compared with flight data. A reconstruction is an evidence-informed model, not a validated
digital twin.

## Known limitations

- No perturbation forces: results are not orbit predictions for a real spacecraft.
- No validation against flight data; no calibration or digital-twin fidelity claim.
- Tether model is planar, massless, rigid, prescribed-length, one-way coupled.
- No uncertainty propagation; source uncertainties are not propagated.
- Browser-only single-node execution; cross-platform bit-identical results are not guaranteed.
- Earth is treated as a sphere of the WGS-84 equatorial radius for surface checks.

## Repository layout

```
src/core/         units, validation, integrators, two-body, tether, canonical hashing, run records
src/models/       model registry entries, parameter specifications, validation and calculations
src/verification/ checks against the live engine, reproducibility
src/evidence/     evidence register
src/export/       JSON/CSV/report/manifest serializers and import validation
src/storage/      append-only localStorage run store
src/review/       run comparison
src/tests/        vitest suites
src/ui/           React interface, SVG charts
scripts/          Node tooling outside the bundle (browser checks, Archil evidence archive)
```
