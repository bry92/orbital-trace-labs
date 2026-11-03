# Review Package Index

How to navigate the Orbital Trace Labs review package, and why its categories must not be treated as
interchangeable.

**RESEARCH PROTOTYPE — NOT FLIGHT SOFTWARE.** Independent computational research prototype. Not
physically validated. No endorsement by any agency, university, or researcher is claimed.

The package is eight documents. They describe what the software does, what has been checked, what is
unknown, and where the documentation itself is imperfect. None of them claims that the models are
physically valid.

---

## 1. Package contents

### The archived dossier — eight documents

| Document | What it answers | Lines |
| --- | --- | --- |
| `RESEARCH_OVERVIEW.md` | Purpose, scope, capabilities, phase objectives, provenance of the code under review | 172 |
| `MODEL_DOCUMENTATION.md` | Every model, all registered equations with an implemented/not-implemented flag, assumptions, parameters, units, bounds, integrators | 370 |
| `VERIFICATION_AND_VALIDATION.md` | All 30 checks with criteria, tolerances and measured values; convergence study; reference-adequacy caveat; what is unresolved; which measurements an outsider can independently check | 385 |
| `EVIDENCE_REGISTER_GUIDE.md` | Evidence classifications, all 32 records individually, conflicts, unknowns, provenance gaps | 237 |
| `REPRODUCTION_GUIDE.md` | Install, run, export, import, reproduce; hash scopes; troubleshooting; what reproduction proves | 208 |
| `RESEARCHER_REVIEW_QUESTIONS.md` | 40 questions the reviewer is asked to assess, deliberately unanswered | 185 |
| `KNOWN_LIMITATIONS.md` | 35 numbered limitations plus the six findings and what a stronger claim would require | 139 |
| `AUDIT_FINDINGS.md` | F-01 … F-06 with affected files, significance, reproduction commands and reviewer questions | 197 |

The archive `provenance/researcher-review-2026-11-03.tar.gz` (44,494 bytes, SHA-256
`67d9a81e…9df358d`) contains exactly these eight documents in a single `researcher-review/`
directory.

### The outreach set — three documents, not archived

`PROJECT_BRIEF.md`, `REVIEW_PACKAGE_INDEX.md` (this document) and `RESEARCHER_OUTREACH_EMAIL.md`
live in `researcher-review/outreach/` and are **not** inside the tarball. The archive preserves the
technical dossier as it was sealed; the outreach set is addressed to a prospective reviewer and
summarises that dossier without adding claims to it.

## 2. Reading order

**If you have ten minutes:** `PROJECT_BRIEF.md` (this outreach set) → `AUDIT_FINDINGS.md`.

**If you have an hour:** `PROJECT_BRIEF.md` → `RESEARCH_OVERVIEW.md` → `VERIFICATION_AND_VALIDATION.md`
→ `KNOWN_LIMITATIONS.md`.

**Before offering an opinion on the physics:** read `MODEL_DOCUMENTATION.md` §3–§4 (equations and
assumptions) together with `VERIFICATION_AND_VALIDATION.md` §5–§7 (what the convergence and balance
evidence does and does not establish). The distinction in §5.1 of that document — the reference error
is an *empirical estimate*, not a bound — is the single most load-bearing caveat in the package.

**Before forming a view on trustworthiness:** read `EVIDENCE_REGISTER_GUIDE.md` Appendix A (all 32
records) and `KNOWN_LIMITATIONS.md` §5 (the six open findings). A project that lists its own
documentation defects is not thereby correct, but the list is where to start probing.

**If you intend to reproduce anything:** `REPRODUCTION_GUIDE.md`, in full, before running commands.

## 3. The categories, and why they are not interchangeable

### Evidence categories (what is known, and how)

| Category | Count | Meaning | How to treat it |
| --- | --- | --- | --- |
| **Source-reported** | 17 | A value stated by an identified external source, with locator and usually a quotation | A *report*, not a measurement verified by this project. Confidence varies; seven records rest on secondary compilations |
| **Derived** | 4 | Computed by the project from other recorded values, with the arithmetic shown | Inherits the uncertainty of its inputs. Derived ≠ measured |
| **Assumed** | 1 | Not reported by any source; supplied explicitly by a researcher | Flagged on every run that uses it. Never inserted on the researcher's behalf |
| **Conflicting** | 5 | Sources disagree | Both values preserved and cross-linked; **not** averaged, resolved, or chosen for convenience |
| **Unknown** | 5 | Not established | No placeholder, no generic substitute, no inference from a similar quantity |

A `SOURCE_REPORTED` value is not "true because it is in the register"; a `DERIVED` value is not
independent evidence; an `ASSUMED` value is not evidence at all; a conflict is not resolved by
preferring one side; and an `UNKNOWN` is not filled in to make a model run. These five categories
answer different questions and cannot be substituted for one another.

### Validation categories (what has been established, and to what standard)

| Category | Question | Status here |
| --- | --- | --- |
| **Software verification** | Does the code solve the *stated equations* correctly, and do the numerical methods behave as claimed? | Substantially addressed for the implemented equations, with declared gaps |
| **Model validation** | Are the *stated equations* an adequate representation of the physical system for the intended scenario? | **Not performed.** No comparison against independent physics, experiment, or higher-fidelity model |
| **Physical validation** | Does the model agree with *measured reality* — flight data, ground tests, tracked objects? | **Not performed and not claimed.** No flight data is used anywhere |

A verification `PASS` is a numerical criterion result. It is not evidence of model adequacy and it is
not evidence of physical agreement. Conversely, the absence of physical validation does not by itself
indicate a defect in the implementation — it indicates that a different kind of work has not been
done. The project deliberately keeps these three statements apart in its interface, its exports and
its documentation, and this package does not blur them.

### One further distinction worth holding

Where the evidence cannot decide something, the project reports `UNRESOLVED` (for an order estimate
that never settles) or `NOT_TESTED` (for a check that has not been run) or `BLOCKED` (for a model
missing required evidence). These are not failures and must not be read as passes: `UNRESOLVED`
means *the evidence cannot decide*, `NOT_TESTED` means *nobody has run it yet*, and `BLOCKED` means
*the inputs do not exist*.

## 4. Where each category is documented

- Evidence classes and all 32 records: `EVIDENCE_REGISTER_GUIDE.md` (structure, semantics, Appendix A).
- Verification vs validation, and which measurements an outsider can regenerate: 
  `VERIFICATION_AND_VALIDATION.md` §1 and the appendix on measurement provenance.
- Model assumptions and the equations as implemented: `MODEL_DOCUMENTATION.md`.
- Numerical-method limitations and parameter-bound quality: `MODEL_DOCUMENTATION.md` §6 and its
  `TETHER_PARAMETER_SPECS` appendix.
- Open documentation and presentation defects: `AUDIT_FINDINGS.md` and `KNOWN_LIMITATIONS.md` §5.

## 5. Verifying the package itself

```sh
sha256sum -c provenance/researcher-review-manifest.txt      # 8 documents + the archive
tar -tzf provenance/researcher-review-2026-11-03.tar.gz     # list contents
tar -xzf provenance/researcher-review-2026-11-03.tar.gz -C /tmp/pkg
diff -r --exclude=outreach /tmp/pkg/researcher-review researcher-review   # byte-for-byte comparison
# (--exclude=outreach because the outreach/ directory was added after the archive was sealed)
```

The application snapshot the documents describe is commit
`c06bcb5e5699f651caead61ee70ddb20a6c0db88` (tree `07680ac8…`), a fresh root commit: it does not
continue the project's earlier local commit chain, which was lost and is **not** restored. The
recovery record is `provenance/PROVENANCE.md`, and the bundle `provenance/otl-provenance.bundle`
reconstructs the snapshot exactly.

## 6. What the package does not contain

- No validation report, because no validation has been performed.
- No claim of flight qualification, operational suitability, or digital-twin fidelity.
- No endorsement, review, or affiliation by any agency, university, or named researcher.
- No fabricated measurements: every number quoted is a recorded result from the project's own checks,
  and the appendix in `VERIFICATION_AND_VALIDATION.md` states which of those an outsider can check
  independently and which require re-running this code.

If a statement in this index appears to conflict with the documents it summarises, the documents are
authoritative and the discrepancy should be reported.
