# Audit Findings

Findings from the second, documentation-only audit pass over Orbital Trace Labs, prepared so that
an independent reviewer knows where the implementation and its documentation diverge.

**Status: none of these findings has been fixed.** This pass was documentation preservation and
audit completion only. No application source, solver, verification criterion, evidence record, run
record, artifact, or landing-page file was modified.

**RESEARCH PROTOTYPE — NOT FLIGHT SOFTWARE.** These findings are documentation and presentation
observations. They do not change any computed result, and none of them is evidence for or against
the physical validity of the models.

---

## 1. How these findings were established

Each finding was found by tracing a documented claim to the code that produces it, not by reading
documentation alone. The method for each is recorded in §3 so a reviewer can reproduce it.

Scope of the pass: `README.md`, `src/models/`, `src/core/`, `src/verification/`, `src/evidence/`,
`src/export/`, and the accepted snapshot `c06bcb5` (tree `07680ac8…`).

## 2. Summary

| ID | Title | Severity | Affects results? | Status |
| --- | --- | --- | --- | --- |
| F-01 | Verification check count in `README.md` disagrees with the registry (21 vs 27) | Documentation accuracy | No | Open, unfixed |
| F-02 | Markdown report unit column renders internal unit ids instead of symbols | Cosmetic (export only) | No | Open, unfixed |
| F-03 | Dead `vCirc` computation in two-body validation | Code hygiene | No | Open, unfixed |
| F-04 | Single scalar `absTolerance` applied to a mixed-unit state vector | Numerical configuration | Yes, potentially, via step selection | Open, unfixed |
| F-05 | Retrieval (`L̇ < 0`) unsupported but not stated inside exported runs | Scope transparency | No | Open, unfixed |
| F-06 | `OT-TB-003` / `OT-TB-004` thresholds differ by 100× while measured values are identical; `OT-TB-004` has ~2× margin | Criterion justification | No | Open, unfixed |

---

## 3. Findings in detail

### F-01 — Documentation undercounts the tether checks

**Affected files:** `README.md` line 67; `src/verification/tetherChecks.ts`;
`src/verification/registry.ts`.

**What the documentation says:** "`src/verification/` implements 9 two-body checks and 12 tether
checks, all executed against the live engine…" (21 checks).

**What the code does:** `TETHER_CHECKS` defines 18 checks, `OT-TT-001` through `OT-TT-018`.
`ALL_CHECKS = [...TWO_BODY_CHECKS, ...TETHER_CHECKS]`, i.e. 9 + 18 = 27 model checks. The same
README states later: "27 model + 3 platform = 30 total".

**Technical significance:** the application's own counts are computed from `ALL_CHECKS` and are
correct (27 model, 30 displayed). The stale sentence understates tether coverage by six checks, and
the README contradicts itself eight lines apart. A reviewer relying on line 67 would form a
materially wrong impression of how much tether verification exists — particularly since the
`OT-TT-015 … 018` balance-identity family is the strongest evidence the project has.

**Reproduce:** `grep -n "two-body checks and" README.md` then
`grep -c "^    checkId: \"OT-TT-" src/verification/tetherChecks.ts`.

**Recommended reviewer questions:** Does documentation drift of this kind undermine confidence in
the other stated counts? Which document is authoritative — the prose or the registry? (See
`RESEARCHER_REVIEW_QUESTIONS.md` Q16, Q22, Q39.)

### F-02 — Exported Markdown report shows unit ids, not symbols

**Affected file:** `src/export/serialize.ts` line 87.

**What the code does:**

```ts
`| ${x.label} | ${x.value === null ? "NOT REPORTED" : fmt(x.value, 10)} | ${unitSymbol(x.unit) === x.unit ? x.unit : x.unit} | …`
```

Both branches of the ternary are `x.unit`, so the `unitSymbol()` lookup is discarded. Metric rows in
`<runId>.report.md` therefore show internal identifiers — `mps`, `m3s2`, `degps`, `none` — where
`m/s`, `m³/s²`, `°/s`, `-` were intended.

**Technical significance:** cosmetic, and confined to the human-readable report. The JSON record,
the CSV header comments and the manifest carry unit labels and SI values correctly, and parameter
rows in the same report use `enteredUnitSymbol`, which is correct. The risk is interpretive: a
reader who sees `mps` in an exported research report may suspect a unit error in the computation
rather than a formatting defect. Reported values are unaffected.

**Reproduce:** export any run and open `<runId>.report.md`, section *Computed outputs*.

**Recommended reviewer questions:** When a report labels a quantity `mps`, is the unit unambiguous
to a reader who has not seen the unit registry? Should archived reports be self-describing without
the application? (See Q38.)

### F-03 — Dead computation in the two-body validation path

**Affected file:** `src/models/twoBody.ts` lines 392–393 and 409.

**What the code does:** computes `rCirc = rMag` and `vCirc = Math.sqrt(mu / rCirc)` inside
`validateTwoBodyInputs()`, then explicitly discards the result with `void vCirc;`.

**Technical significance:** no effect on any computation or warning. It is residue of an earlier
circular-speed check and a small signal that this branch of the validation path may not be covered
as tightly as the rest. Note that the low-Earth-orbit warning path (`rMag < 6378137`) *is* live and
does use `mu`.

**Reproduce:** `grep -n "void vCirc" src/models/twoBody.ts`.

**Recommended reviewer questions:** Are the validation-path warnings covered by tests that assert
their trigger conditions, not merely their absence? (See Q11.)

### F-04 — One absolute tolerance for a mixed-unit state

**Affected files:** `src/models/twoBody.ts` (parameter description for `absTolerance`);
`src/core/integrators.ts` (`integrateDOPRI5`, error norm).

**What the code does:** the DOPRI5 error norm is
`max_i |err_i| / (atol + rtol·max(|y_i|, |y5_i|))` over a state vector whose first three components
are metres (≈ 6.7e6) and last three are m/s (≈ 7.7e3). A single scalar `atol` is applied to both.

**Technical significance:** with `rtol` in the documented range the relative term dominates for
position, so the controller is effectively unscaled across components. The parameter description
calls this "a documented simplification … so relTolerance governs in practice"; it is therefore
declared, but its effect on step selection — especially near perigee of an eccentric orbit, where
position and velocity errors scale differently — has not been quantified anywhere in the build.

**Reproduce:** read the `absTolerance` description in `twoBody.ts` and the norm in
`integrateDOPRI5()`.

**Recommended reviewer questions:** Would per-component scaling change the accepted step sequence
materially at the eccentricities the presets reach? Is the adaptive path therefore verified only
for near-circular cases? (See Q9, Q12.)

### F-05 — Retrieval is out of scope but invisible in exported runs

**Affected files:** `src/core/tether.ts` (`INVALID_DEPLOYMENT_RATE`); warning block in
`propagateTether()`; `src/models/tether.ts` (parameter description).

**What the code does:** rejects `deploymentRate < 0` with a typed validation error, so only
deployment (`L̇ ≥ 0`) is representable. The parameter description says "Retrieval (negative rate) is
not modelled", and a run with `L̇ > 0` carries a warning that reel inertia, motor torque, elasticity
and damping are not modelled — but that warning does not say retrieval is unsupported.

**Technical significance:** a reviewer holding only an exported run with `L̇ = 0` (or a positive
rate) sees no statement that the model cannot represent retrieval; the scope limit is visible only
when a negative rate is attempted. The libration equation itself is valid for either sign, so the
restriction is a product decision embedded in an engine guard rather than in the model description.

**Reproduce:** submit a negative deployment rate in the Laboratory; read the emitted warnings for a
constant-length run.

**Recommended reviewer questions:** Is deployment-only an acceptable scope for a tether study that
discusses TSS-1/TSS-1R? Should every exported run state the restriction, given that
`L̇ = 0` runs are agnostic to it? (See Q26.)

### F-06 — Two conservation thresholds, one measurement

**Affected file:** `src/verification/twoBodyChecks.ts` (`TB_TOLERANCES`, `OT-TB-003`, `OT-TB-004`).

**What the code and documentation show:** `energyEps = 1e-8` and `angularMomentumEps = 1e-10`, two
orders apart, while both checks record a measured value of 4.85e-11.

**Technical significance:** both pass, but `OT-TB-004` passes with only ≈ 2.1× margin, whereas
`OT-TB-003` passes with ≈ 206× margin. Two distinct thresholds producing an identical reported
measurement suggest either that the two diagnostics are numerically coupled for the tested case, or
that the tighter threshold was chosen close to the observed drift. The application does not explain
how either threshold was derived — unlike the tether balance budget, which documents its derivation
and its safety factor.

**Reproduce:** open the Verification Center and compare the measured values for `OT-TB-003` and
`OT-TB-004`; read `TB_TOLERANCES`.

**Recommended reviewer questions:** Are `1e-8` and `1e-10` independently justified, or calibrated
to observed drift? Would a factor-of-two change in the integrator settings flip `OT-TB-004`? Should
conservation thresholds scale with step size rather than being fixed constants? (See Q12, Q17.)

---

## 4. What these findings are not

- They are **not** evidence that any physical model is wrong. F-01 and F-02 are documentation and
  formatting; F-03 is dead code; F-04, F-05 and F-06 are scope, configuration and criterion
  justification questions.
- They are **not** hidden by the verification suite. The suite passes (259 tests, 17 files) with all
  six present — which is itself informative: none of the six is covered by an assertion.
- They are **not** fixed here. Applying any fix would change files the review package describes, and
  the accepted checkpoint `c06bcb5` must remain byte-identical.

## 5. Bound-analysis remark (not counted as a separate finding)

While auditing `TETHER_PARAMETER_SPECS` (recorded in full in `MODEL_DOCUMENTATION.md`, §8), one
pattern is worth flagging without raising it to a numbered finding: some accepted parameter ranges
permit configurations outside the model's stated validity regime, with a warning rather than
rejection. `tetherLength` is allowed up to 1000 km, which at a 400 km-altitude reference orbit gives
`L/r ≈ 0.15` — three times the `L/r = 0.05` threshold above which the engine itself warns that
"results are outside their intended regime". Likewise `stepSeconds` may be set as coarse as 1e5 s
against an orbital period near 5.4e3 s. The guards therefore protect the *runtime*, not the
*physics*: the application warns, it does not refuse.

This is a design choice consistent with the project's stated philosophy (measure and report, do not
silently intervene), but a reviewer should decide whether a warning is sufficient for a configuration
that is known in advance to be outside the model's regime.
