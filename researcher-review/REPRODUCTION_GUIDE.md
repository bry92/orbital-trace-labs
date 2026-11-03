# Reproduction Guide

How to run the application, produce a recorded run, export it, and re-execute it independently —
including what reproduction does and does not prove.

**RESEARCH PROTOTYPE — NOT FLIGHT SOFTWARE.** Reproduction demonstrates that a calculation is
repeatable and that a record is intact. It does not demonstrate correctness, and it is not
validation.

---

## 1. Requirements

| Item | Requirement |
| --- | --- |
| Node.js | 24.x for tooling (the application itself is a static browser bundle) |
| Package manager | npm, using the committed `package-lock.json` |
| Browser | Any current Chromium, Firefox or Safari build with `localStorage` enabled |
| Network | **None required at run time.** The application makes no network calls |
| Disk | No database. Runs persist in the browser's `localStorage` under the key `otl.runs.v1` |

Dependencies are `react`, `react-dom` (runtime) and TypeScript, Vite, Vitest, the React plugin,
type packages, plus `disk` (used only by the optional Archil archive script). Nothing else is
needed to reproduce a run.

## 2. Install, test, build

```bash
git clone <this repository>            # or use the snapshot bundle in provenance/
cd orbital-trace-labs
npm ci                                 # install exactly the locked dependency tree
npm test                               # Vitest: 17 files / 259 tests
npm run build                          # tsc --noEmit && vite build
npm run dev                            # Vite dev server on http://localhost:3000
```

Expected results on the recorded snapshot (`c06bcb5`):

| Command | Expected |
| --- | --- |
| `npm test` | `Test Files 17 passed (17)`, `Tests 259 passed (259)` |
| `npm run build` | Exit 0; `dist/index.html` ≈ 0.60 kB, CSS ≈ 14.68 kB, JS ≈ 576 kB (≈ 172 kB gzip) |
| `npm run typecheck` | Exit 0 (`tsc --noEmit`) |
| `npm run dev` | `VITE ready`, serving on port 3000 |

No environment variables are required for the application. `.env.example` documents the optional
Archil script only (see §7), and `.env*` files are git-ignored so credentials cannot be committed.

## 3. Produce a run

1. Open `http://localhost:3000` and select the **Simulation Laboratory** tab.
2. Choose a model: `OTL-2BP` (two-body) or `OTL-TETH-1` (tether). The three remaining registry
   entries are visible but not executable, by design.
3. Enter inputs. Every field shows its unit; values are converted to SI once at validation, and the
   record keeps both the entered value/unit and the SI value used.
4. For `OTL-2BP` choose the solver: fixed-step `RK4` (with step `h` in seconds) or adaptive
   `DOPRI5` (with relative/absolute tolerance, initial step, maximum step).
5. Execute. Validation errors block execution and are displayed with a code (for example
   `STEP_BUDGET_EXCEEDED`, `SINGULAR_GEOMETRY`, `DEGENERATE_ANGULAR_MOMENTUM_NORMALIZATION`).
   Warnings do not block; they are recorded in the run.
6. The run is appended to storage. Records are never rewritten by a calculation.

### 3.1 A minimal reproducible example (tether)

The configuration used throughout the verification suite, and a reasonable first case:

| Parameter | Value |
| --- | --- |
| Model | `OTL-TETH-1` |
| μ | `3.986004418e14` m³/s² (Earth, `EV-PHY-001`) |
| Initial position | `6778137` m along x (400 km altitude) |
| Initial velocity | circular, ≈ `7669.6` m/s along y |
| `m₁` / `m₂` | 500 kg / 500 kg |
| Tether length | 20 km |
| Deployment rate | 0 m/s (constant length) |
| θ₀ / θ̇₀ | 5° / 0 rad/s |
| Duration | 3 h |
| Step | 2 s (RK4) |

Expected qualitative behaviour: libration about the local vertical with a period near
`2π/(√3·n)` ≈ 3206 s, and an `L/r` value of ≈ 2.95e-3, well inside the model's first-order regime
(the engine warns above `L/r = 0.05`).

## 4. Inspect the outputs

A run record (`otl-run-v1`) contains: run id, UTC timestamp, data origin
(`LIVE_CALCULATION` or `EVIDENCE_INFORMED_RECONSTRUCTION`), application name/version/release/build
id, **code revision status (`UNVERIFIED`)**, model id/version, scenario name, every parameter with
entered and SI values plus its origin (`USER_EDITED`/`PRESET_DEFAULT`/`IMPORTED`), solver
descriptor and settings, units, metrics, the decimated series (with the decimation rule and
sample counts), the model's verification results, warnings, limitations, assumptions, references,
unresolved quantities, evidence flags, validation issues, and the payload hash with its hash scope.

### 4.1 Export artifacts

Exporting a run produces five files, each with a SHA-256 over its **exact bytes**:

| File | Content |
| --- | --- |
| `<runId>.json` | The full run record |
| `<runId>.timeseries.csv` | Computed series, SI values, with header comments (run id, model, scenario, UTC time, columns, decimation, payload hash) |
| `<runId>.report.md` | Human-readable technical report: identity, inputs, outputs, verification at execution time, warnings, assumptions, limitations, unresolved quantities, evidence flags, provenance, reproduction steps |
| `<runId>.verification.json` | `otl-verification-report-v1`: the checks executed with that run, plus an outcome summary |
| `<runId>.manifest.json` | `otl-manifest-v1`: application, model, solver, payload hash and scope, and every artifact's name, byte count and SHA-256 |

The manifest deliberately does **not** list or hash itself (that would be recursive). Byte
integrity and payload integrity are separate properties; neither is evidence of correctness.

### 4.2 What the payload hash binds

Two integrity concepts are kept apart in the record and its `hashSpec`:

- **Result identity** (`otl-result-hash-v1`): a SHA-256 over a canonical JSON payload of the
  computed result, its inputs and the model/solver identity. Canonicalisation: object keys sorted
  by UTF-16 code unit, no insignificant whitespace, shortest round-trip numbers, `-0` serialised as
  `0`, non-finite numbers rejected.
- **Provenance, recorded but not bound**: run id, execution timestamp, build id, code revision,
  per-check wall-clock timings. These are excluded because none of them is part of the answer — so
  the same results re-exported, or exported after a rebuild, produce the same digest.

Legacy records written before this split hashed the whole record including timings. Those hashes
are still verified against the legacy scope and reported as `LEGACY`, **never** as tampering.

`hashStatus` can be `BLOCKED` when hashing is unavailable; a blocked hash is reported, not hidden.

## 5. Reproduce a stored run

1. Take an exported `<runId>.json` and import it in the **Simulation Laboratory** (*Import
   experiment*).
2. The importer validates schema, units, model identity and payload hash. Malformed or unsupported
   files are **rejected**, not repaired.
3. Select the imported run and choose **Reproduce**. The application re-executes the calculation
   from the stored inputs through the same validation path and compares.

Comparison policy (documented in `src/verification/reproducibility.ts`, not tuned after the fact):

| Situation | Behaviour |
| --- | --- |
| Same build | Series must agree within **1e-12** of each column's maximum magnitude; metrics within 1e-12 relative |
| Different build, same model | Tolerance relaxed to **1e-9**, result labelled cross-build, with an explicit statement that identical results are not guaranteed |
| Different model version | **`BLOCKED`** — no comparison is made as if the runs were equivalent |
| Model not implemented in this build | **`BLOCKED`** |
| Stored inputs no longer pass validation | **`BLOCKED`** |
| Payload hash matches neither current nor legacy scope | **`FAIL`** — the record was altered, so comparison is not meaningful |

Comparing series is done per column, normalised by the column's own maximum magnitude; a differing
sample count (decimation not reproduced) is a `FAIL` with the reason stated. Verification outcomes
must also reproduce identically. `OT-PF-003` in the Verification Center reports the outcome of
whichever reproduction was run — before any reproduction it is honestly `NOT_TESTED`.

## 6. Reproduce the verification study

1. Open the **Verification Center**. All 27 model checks execute against the live engine on page
   load; the 3 platform checks run alongside them.
2. Read each row: criterion, expected behaviour, measured value, unit, tolerance, tolerance
   justification, method, evidence, limitations.
3. Export the convergence artifact (`otl-convergence-artifact-v1` JSON), which carries its own
   SHA-256 over a declared canonical payload scope, then use **Import & verify** to re-import it.
   The importer rejects: `MALFORMED_JSON`, `UNSUPPORTED_SCHEMA`, `INVALID_STRUCTURE`, and any file
   claiming `RIGOROUS_BOUND` or `VALIDATED_ENCLOSURE` (`UNSUPPORTED_REFERENCE_CLAIM`) — because this
   build computes neither and cannot check such a claim. A structurally valid file whose digest
   does not match is surfaced as a mismatch, never silently accepted.
4. Re-run `npm test` to reproduce the automated assertions, including the boundary tests of the
   classification thresholds and the mutation tests for wrong coefficients and signs.

## 7. Optional: archiving evidence (not required, not bundled)

`scripts/archil-evidence.mjs` can archive exported evidence to an Archil disk so it survives
between sessions. This is **Node tooling only**: it is a dev dependency, it is not part of the
browser bundle, the application still makes no network calls, and it is outside the test suite.

```bash
cp .env.example .env.local     # then set ARCHIL_API_KEY (git-ignored)
npm run archil -- status
npm run archil -- push artifacts
npm run archil -- list runs/
npm run archil -- pull <run-id> artifacts
npm run archil -- exec "<command>"
```

Each push writes `runs/<utc-timestamp>-<directory>/files/` plus a `manifest.json` recording every
path, byte count and SHA-256; `pull` refuses any file whose digest does not match. Archiving
establishes integrity of the bytes moved, not correctness of the results. Reproduction does not
require this script, and no credentials are needed to review the application.

## 8. Troubleshooting

| Symptom | Cause | What to do |
| --- | --- | --- |
| `STEP_BUDGET_EXCEEDED` | `duration/step` (or `duration/hmax`) exceeds 200,000 steps | Increase the step or shorten the duration; the application will not change either for you |
| `SINGULAR_GEOMETRY` | Initial position is the zero vector | Supply a non-degenerate state |
| `DEGENERATE_ANGULAR_MOMENTUM_NORMALIZATION` | Initial speed is zero | This state is deliberately rejected rather than re-normalised |
| Period shows `—` / null | The orbit is open (energy ≥ 0) | Expected: no period is reported rather than estimated |
| Warning about steps per period < 50 | Step too coarse for the orbit | Refine the step and check convergence |
| Warning `L/r > 0.05` | Tether outside the first-order regime | Treat results as outside the model's stated validity |
| `TETHER_LENGTH_NONPOSITIVE` | Prescribed length reaches ≤ 0 | Fix the length history; negative deployment rates are rejected outright |
| Reproduction `BLOCKED` | Model version differs or inputs no longer validate | Use the matching model version; compare only like with like |
| Runs disappear after reload | Browser privacy mode or cleared storage | Export artefacts before closing; storage is local only |

## 9. What reproduction proves, and what it does not

**Proves:** the same inputs, through the same code path, produce the same series and metrics within
the stated tolerance; the stored payload is intact under its declared hash scope; the verification
outcomes are stable.

**Does not prove:** that the equations are the right ones for a real system; that the numerical
error is small for a case that was never refined; that the model has been validated against any
measurement; or which source tree produced a build, because the code revision is `UNVERIFIED`.
