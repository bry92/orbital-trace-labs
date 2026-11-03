# Orbital Trace Labs — Research Overview

**RESEARCH PROTOTYPE — NOT FLIGHT SOFTWARE.** Results are limited to the implemented
mathematical models and documented assumptions. No flight qualification, operational
suitability, or independent validation is implied by anything in this package.

This document is part of a review package prepared for **independent technical scrutiny**.
It is a description of what the software does and does not do, written to be checked against
the source. It is not a claim of scientific validation, and no external body has reviewed,
endorsed, or certified this work.

---

## 1. Purpose

Orbital Trace Labs is a browser-based research prototype for two problems in orbital
mechanics:

1. **Two-body point-mass propagation** with classical orbital elements and measured
   conservation diagnostics (`OTL-2BP`).
2. **Planar libration of a gravity-gradient tether** on a prescribed length history, coupled
   one way to a two-body reference orbit, with a quasi-static vertical tension diagnostic
   (`OTL-TETH-1`).

The design principle throughout is that **every displayed number is computed at run time from
the model that produced it**, every run records how it was obtained, and every model declares
what it does not include. Capability claims that the code cannot support are recorded as
`NOT_MODELED`, `BLOCKED`, `UNKNOWN`, `CONFLICT`, `UNRESOLVED`, or `NOT_TESTED` rather than
being presented as implemented.

## 2. What the reviewer is being asked to assess

Not "is the simulation correct in an absolute sense" — the software makes no such claim — but
the narrower and answerable questions:

- Are the governing equations, as stated in `src/models/` and implemented in `src/core/`,
  formulated and transcribed correctly?
- Are the numerical methods appropriate for these equations over the stated regimes, and are
  the convergence claims supported by the evidence presented?
- Are the acceptance criteria for the verification checks well-posed, and are the
  `UNRESOLVED` verdicts honest rather than convenient?
- Are the documented modelling assumptions appropriate for the scenarios the application
  implies, and which omitted physical effects dominate?
- What data would be required before any validation claim could be made?

`RESEARCHER_REVIEW_QUESTIONS.md` states these as specific questions. This package deliberately
does **not** answer them.

## 3. Current capabilities

Model statuses are read directly from the model registry (`src/models/registry.ts`,
`src/models/notImplemented.ts`); the application displays them, it does not duplicate them.

| Model | Version | Status | Executable |
| --- | --- | --- | --- |
| `OTL-2BP` — two-body point-mass propagation | 1.0.0 | `IMPLEMENTED` | Yes |
| `OTL-TETH-1` — prescribed-length gravity-gradient dumbbell | 1.0.0 | `IMPLEMENTED` | Yes |
| `OTL-TETH-2` — dynamically calculated deployment | 0.0.0-spec | `NOT_MODELED` | No |
| `OTL-TETH-3` — coupled spacecraft–tether orbital dynamics | 0.0.0-spec | `NOT_MODELED` | No |
| `OTL-EDT-1` — electrodynamic tether disposal concept | 0.0.0-spec | `BLOCKED` | No |

Platform-level capability:

- **Verification Center** — 27 model-level checks plus 3 platform checks, executed against the
  live engine in the browser (30 rows total; see `VERIFICATION_AND_VALIDATION.md`).
- **Run provenance** — append-only run records with entered and SI inputs, solver settings,
  computed series, verification results, warnings, assumptions, limitations, unresolved
  quantities, evidence flags, and a SHA-256 result hash over a declared canonical scope.
- **Export and reproduction** — JSON/CSV/Markdown/verification/manifest artifacts with
  per-file SHA-256, plus import → re-execute → compare at a documented tolerance.
- **Evidence register** — 32 classified evidence records (`SOURCE_REPORTED`, `DERIVED`,
  `ASSUMED`, `CONFLICT`, `UNKNOWN`) covering physical constants and the historical TSS-1/TSS-1R
  material used for the reconstruction workspace.
- **Historical reconstruction workspace** — an isolated TSS-1/TSS-1R workspace that requires
  explicit, attested assumptions for values that are not source-reported. Its runs are labelled
  `EVIDENCE_INFORMED_RECONSTRUCTION` and are not compared with flight data.

## 4. What it explicitly does not do

- No perturbation forces: no J2 or higher harmonics, no atmospheric drag, no third-body gravity,
  no solar radiation pressure, no relativity, no thrust.
- No attitude dynamics, no tether elasticity, no reel or actuator dynamics, no distributed
  tether mass, no electrodynamics, no out-of-plane libration.
- No state estimation, no orbit determination, no fitting to tracking data.
- No uncertainty propagation: source uncertainties and model uncertainties are not propagated
  into results.
- No validation against flight or experimental data of any kind, and no digital-twin fidelity
  claim. The reconstruction workspace is explicitly *not* a validated digital twin.
- No backend, database, account system, or API. The application is a static browser bundle; it
  makes no network calls, and persistence is `localStorage` on the reviewer's machine.

## 5. Research objectives of the current phase

1. Establish that the two implemented models are **implemented as specified** (computational
   verification), including the numerical integrators and their convergence behaviour.
2. Make the **boundary of applicability** inspectable rather than implicit: which effects are
   modelled, which are not, and where the first-order approximations break down (for example
   the `L/r` regime warnings in `src/core/tether.ts`).
3. Establish a **provenance discipline** strong enough that a third party can re-execute a
   recorded run and compare it, and weak enough that its limits are stated (a hash establishes
   integrity, not correctness).
4. Identify, with an external reviewer, what would be required to move from *verified
   implementation* toward *validated model* — and whether that move is worth making.

## 6. Package contents

| Document | Purpose |
| --- | --- |
| `RESEARCH_OVERVIEW.md` | This document: purpose, scope, capabilities, objectives |
| `MODEL_DOCUMENTATION.md` | Implemented models, equations, assumptions, parameters, numerical methods |
| `VERIFICATION_AND_VALIDATION.md` | Checks, criteria, results, unresolved items, verification vs validation |
| `EVIDENCE_REGISTER_GUIDE.md` | Evidence classifications, provenance, conflicts, unknowns |
| `REPRODUCTION_GUIDE.md` | How to reproduce a run and inspect its outputs |
| `RESEARCHER_REVIEW_QUESTIONS.md` | Questions for the reviewer to assess |
| `KNOWN_LIMITATIONS.md` | Transparent list of technical and scientific limitations |

All documents are additive: they were written **outside** the application source tree, and no
simulation, solver, verification, evidence, or run-record file was modified to produce them.

## 7. Evidence basis for this package

Every statement in these documents is traced to one of:

- **Source code** — `src/core/`, `src/models/`, `src/verification/`, `src/evidence/`,
  `src/export/`, `src/storage/`, `src/ui/`.
- **Executed checks** — the values quoted in the verification tables are the measured values
  reported by the checks themselves, as recorded in `README.md`, and are reproduced live by the
  Verification Center in the browser.
- **The project's own audit record** — `README.md` and `docs/ai-reviewer-stage1-design.md`.

Where a claim could not be verified from these sources, the document says so explicitly rather
than smoothing it over; see §5 of `KNOWN_LIMITATIONS.md`.

## 8. Provenance of the code under review

| Item | Value |
| --- | --- |
| Application version | `1.0.0`, release label `v1.0-research-prototype` |
| Snapshot commit | `c06bcb5e5699f651caead61ee70ddb20a6c0db88`, branch `provenance/phase2-landing` |
| Snapshot tree | `07680ac8e7a4e2b5938a19f33d9f5f542535c970` (107 files) |
| Commit ancestry | Fresh root commit. It does **not** continue the earlier local chain, which was lost |
| Code revision binding | `UNVERIFIED` — see below |

The application reports its own code revision as `UNVERIFIED`
(`CODE_REVISION_STATUS` in `src/core/constants.ts`): the bundle carries a build identifier but
no version-control revision is bound to it, so a run record cannot by itself prove which source
tree produced it. This is a known provenance gap, not an oversight, and it is listed in
`KNOWN_LIMITATIONS.md`.

An earlier local commit chain (`75b7fb9 → … → de942de`) was destroyed when a cloud VM
restoration discarded the disposable cache directory holding it. It was never pushed anywhere,
so it cannot be recovered. The current snapshot is a documented fresh baseline; the lost
chain is **not** restored and is not claimed to be. Its recovery record is preserved separately
in `provenance/PROVENANCE.md`.

## 9. How the numbers on screen are sourced

The figures shown on the application's landing page and dashboard — implemented models,
check totals, evidence-record counts — are computed at render time from
`MODELS`/`IMPLEMENTED_MODEL_IDS` (`src/models/registry.ts`), `ALL_CHECKS`
(`src/verification/registry.ts`), and `EVIDENCE_REGISTER`/`evidenceStatusCounts()`
(`src/evidence/register.ts`). No count is hard-coded in the interface, so the displayed scope
cannot drift from the registries it describes.

---

## 10. Review archive

The eight documents in this directory are archived, with a SHA-256 manifest, in
`provenance/researcher-review-2026-11-03.tar.gz` and `provenance/researcher-review-manifest.txt`.
The archive was verified by extraction and byte-for-byte comparison against this directory. See
`AUDIT_FINDINGS.md` for the six tracked findings of the second audit pass.
