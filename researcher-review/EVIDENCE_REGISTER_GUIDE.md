# Evidence Register Guide

How the application classifies every quantitative claim it uses, what the classifications mean,
which records conflict, and which values are simply not known.

Source: `src/evidence/register.ts` (`EVIDENCE_REGISTER`, `EvidenceStatus`, `evidenceStatusCounts()`),
rendered in the **Evidence Register** tab.

**RESEARCH PROTOTYPE — NOT FLIGHT SOFTWARE.** The register records what sources say and what this
project assumes. It is not a validated dataset, and an entry's presence here does not make the
value correct.

---

## 1. Why the register exists

A numerical prototype drifts into over-claiming when a "reasonable" number is quietly inserted for
something nobody actually knows: a tether mass-per-length, an effective mass, a conductor
resistance. The register exists so that:

- every quantitative claim has an explicit **status** and, where applicable, a source, locator and
  quotation;
- conflicting reports are **preserved as conflicts**, never averaged or picked silently;
- unknown values are recorded as `UNKNOWN` and are **never** filled with a generic substitute;
- values a researcher must supply are labelled `ASSUMED` and travel with the run as evidence flags.

## 2. Record structure

Each `EvidenceRecord` carries:

| Field | Meaning |
| --- | --- |
| `id` | Stable identifier, e.g. `EV-PHY-001`, `EV-TSS1R-010`, `EV-ASM-001` |
| `claim` | The specific quantitative claim being recorded |
| `status` | One of the five classifications in §3 |
| `value` | The value as stated, or `null` when the value is itself unknown |
| `units` | Units of the stated value, or `null` |
| `sourceTitle`, `publisher`, `sourceUrl`, `locator` | Provenance of the claim |
| `quote` | Short transcription from the identified source, where available |
| `interpretation` | What this project does with the value, in plain language |
| `confidence` | `HIGH` / `MEDIUM` / `LOW` / `NONE` |
| `notes` | Caveats, including statements that a quantity is *not* propagated or *not* used |
| `conflictsWith` | Links to records reporting a different value for the same quantity |
| `derivation` | Present only on `DERIVED` records: the arithmetic performed |

Where a primary document could not be read, the record says so and the confidence is reduced —
rather than presenting a secondary summary as if it were the primary source.

## 3. Classifications

| Status | Meaning | Treatment in the application |
| --- | --- | --- |
| `SOURCE_REPORTED` | A value stated by an identified external source, with locator and usually a quotation | Usable as an input; never silently adjusted |
| `DERIVED` | Computed by this project from other recorded values, with the arithmetic shown in `derivation` | Usable, with the derivation attached |
| `ASSUMED` | Not reported by any source; a value the researcher must supply explicitly | Never inserted on the researcher's behalf; flagged on any run that uses it |
| `CONFLICT` | Two or more sources disagree | Both values preserved and cross-linked via `conflictsWith`; no reconciliation, no averaging |
| `UNKNOWN` | Not established | Recorded as unknown; no placeholder, no "typical" value, no inference from a similar quantity |

`confidence` is independent of status: a `SOURCE_REPORTED` value can be `MEDIUM` or `LOW` if only a
secondary summary was available, and an `ASSUMED` value is `NONE`.

## 4. Current register contents

Counts computed by `evidenceStatusCounts()`; the interface reads them at render time, so the
displayed figures cannot drift from the register.

| Status | Count |
| --- | --- |
| `SOURCE_REPORTED` | 17 |
| `DERIVED` | 4 |
| `ASSUMED` | 1 |
| `CONFLICT` | 5 |
| `UNKNOWN` | 5 |
| **Total records** | **32** |

The physical constants used by the models are `SOURCE_REPORTED` records and are referenced from
the code itself: `MU_EARTH` cites `EV-PHY-001` (IERS Conventions 2010, Table 1.1) and `R_EARTH`
cites `EV-PHY-002` (WGS-84 defining parameter) in `src/core/constants.ts`. The constants module
states that no constant is derived from any earlier version of the project and nothing is imported
from a frozen baseline.

## 5. Conflicts that are preserved (not resolved)

Five records are classified `CONFLICT`. The project's own summary groups them into four well-known
TSS-1 / TSS-1R discrepancies:

| Quantity | Reported values | Register treatment |
| --- | --- | --- |
| TSS-1R satellite mass | 517 kg vs 518 kg | Both preserved, cross-linked |
| Tether diameter | 2.54 mm vs 2.0 mm | Both preserved, cross-linked |
| TSS-1 deployed tether length | 256 m vs 262.1 m | Both preserved, cross-linked |
| TSS-1 orbit altitude | 230 nmi vs 296 km | Both preserved; the nmi→km conversion is a separate `DERIVED` record |

The fifth conflict is a second mass disagreement, for TSS-1 rather than TSS-1R: `EV-TSS1-005`
reports 518 kg while `EV-TSS1-006` records 515 kg from a search extract of the NASA board report.
All five pairs are listed individually in Appendix A, with the identifiers a reviewer needs to
follow each conflict through its `conflictsWith` links. **No conflict is resolved by choosing the
more convenient value**, and no computation silently prefers one side.

Practical consequence: the reconstruction workspace cannot be run without the researcher deciding
which side of a conflict to use, and that decision becomes part of the run's evidence flags.

## 6. Unknowns that stay unknown

| Quantity | Why it matters |
| --- | --- |
| Tether mass | Sets distributed mass and hence the validity of the point-mass dumbbell |
| Tether linear density (mass-per-length) | Would be needed for `OTL-TETH-2` (`EQ-T2-003`) |
| Orbiter-side effective mass | Recorded as `ASSUMED` (`EV-ASM-001`): no sourced value exists, so any number a researcher enters is an assumption, not evidence |
| TSS-1R insulation damage initiator | Relevant to interpreting the mission's electrical behaviour |
| Measured Lorentz thrust | Without it, no electrodynamic model can be benchmarked (`OTL-EDT-1` is `BLOCKED` partly for this reason) |

`EV-ASM-001` is worth reading closely: it exists to state that the orbiter-side effective mass is
**not** source-reported, and it has confidence `NONE`. The application never inserts a placeholder
mass on the researcher's behalf.

## 7. How the register is used at run time

- Values chosen from the register enter a run as parameters with `origin: "PRESET_DEFAULT"`; values
  the researcher edits carry `USER_EDITED`; imported values carry `IMPORTED` (`src/core/run.ts`).
- A reconstruction run that depends on an `ASSUMED` value is labelled
  `EVIDENCE_INFORMED_RECONSTRUCTION` and carries explicit `evidenceFlags`; it is **not** compared
  with flight data.
- Export artifacts repeat the assumptions, limitations, unresolved quantities and evidence flags of
  the run, so an exported file cannot be read without them.

## 8. What the register is not

- **Not a validated dataset.** A `SOURCE_REPORTED` value is a report, not a measurement verified by
  this project. Some records rest on secondary summaries, which is why confidence varies.
- **Not complete.** It covers the quantities this application uses or considered; it is not a
  literature survey of tether dynamics.
- **Not authoritative on TSS-1/TSS-1R.** Where sources disagree, the register records the
  disagreement; it does not adjudicate it.
- **Not free of transcription risk.** Quotations are short transcriptions, and transcription errors
  are possible. A reviewer with access to the primary documents should check them directly — this
  is listed in `RESEARCHER_REVIEW_QUESTIONS.md`.
- **No uncertainty propagation.** Source uncertainties, including the tabulated uncertainty in μ,
  are not propagated into results. μ is treated as an exact model constant.

## 9. How to inspect it

1. Open the application and select the **Evidence Register** tab.
2. Filter by status (`SOURCE_REPORTED`, `DERIVED`, `ASSUMED`, `CONFLICT`, `UNKNOWN`); the counts at
   the top are computed from the same array the table renders.
3. Open a record to see source title, publisher, URL, locator, quotation, interpretation,
   confidence, notes and conflict links.
4. For `CONFLICT` records, follow `conflictsWith` to the opposing record. Both sides remain
   visible; neither is marked as the winner.
5. For `DERIVED` records, check the `derivation` string — it shows the arithmetic.

The register can also be inspected without the interface: it is a typed array literal in
`src/evidence/register.ts`, and the status counts are computed by a four-line function at the end
of that file.

---

# Appendix A — Complete record inventory (all 32)

Every record in `EVIDENCE_REGISTER`, read individually from `src/evidence/register.ts`. The
"provenance issue" column states what a reviewer cannot verify from the record itself. No value
has been changed, inferred, or reconciled to produce this table.

## Source-reported (17)

| ID | Classification | Source reference | Provenance issue |
| --- | --- | --- | --- |
| `EV-PHY-001` | `SOURCE_REPORTED` | IERS Conventions (2010), Table 1.1; quote "GM(Earth) = 3.986004418e14 m^3 s^-2"; confidence HIGH | Tabulated uncertainty is not propagated; μ treated as exact |
| `EV-PHY-002` | `SOURCE_REPORTED` | NIMA WGS-84 (TR8350.2), locator "Defining parameters"; confidence HIGH | **No `sourceUrl`**; identified by document only |
| `EV-TSS1-001` | `SOURCE_REPORTED` | NASA, STS-46 mission page, "Mission Highlights"; 20 km planned; HIGH | Planned value, not a measured deployment |
| `EV-TSS1-002` | `SOURCE_REPORTED` | NASA, STS-46 mission page; "840 feet (256 meters)" max deployed; HIGH | Contested by `EV-TSS1-003` |
| `EV-TSS1-004` | `SOURCE_REPORTED` | NASA NTRS 19930016042 (Contingency Investigation Board); bolt/level-wind interference; MEDIUM | Board PDF not text-extracted, so no page number asserted |
| `EV-TSS1-005` | `SOURCE_REPORTED` | Gunter's Space Page datasheet; mass 518 kg; MEDIUM | Secondary compilation, not a NASA primary measurement |
| `EV-TSS1-007` | `SOURCE_REPORTED` | NASA MSFC, NTRS 20160005655; "0.10 inch diameter copper wire assembly"; HIGH | Diameter alone yields no mass-per-length; lay-up unspecified |
| `EV-TSS1-008` | `SOURCE_REPORTED` | Gunter's Space Page; total tether carried 22 km; LOW | Secondary source, no quote, no primary confirmation |
| `EV-TSS1-009` | `SOURCE_REPORTED` | NASA, STS-46 mission page; "Orbit Altitude: 230 nautical miles"; HIGH | Mission-orbit altitude, not post-deployment satellite altitude |
| `EV-TSS1R-001` | `SOURCE_REPORTED` | NASA MSFC, NTRS 20010022502 (Post Flight Engineering Performance Report); 20,700 m planned OST1; HIGH | Planned length only |
| `EV-TSS1R-002` | `SOURCE_REPORTED` | NASA MSFC, NTRS 20010022502; 19,695 m at break; HIGH | Deployed length, not total carried |
| `EV-TSS1R-003` | `SOURCE_REPORTED` | NASA STS-75 page + secondary account of TM 112426; arcing/burning then tensile failure; MEDIUM | Primary board report PDF could not be text-extracted |
| `EV-TSS1R-005` | `SOURCE_REPORTED` | AmericaSpace, "‘Rock Solid’… Part 1"; 517 kg; MEDIUM | Secondary reporting; contested by `EV-TSS1R-006` |
| `EV-TSS1R-007` | `SOURCE_REPORTED` | Gunter's Space Page; 2.54 mm (0.1 in); MEDIUM | Secondary; contested by `EV-TSS1R-008` |
| `EV-TSS1R-010` | `SOURCE_REPORTED` | NASA STS-75 page + ESA mission description; "160 nautical miles"; HIGH | Two sources agree after rounding; measurement method unstated |
| `EV-TSS1R-011` | `SOURCE_REPORTED` | NASA, STS-75 mission page; "about 480 milliamps"; HIGH | **Measurement method and uncertainty not stated**; 580 mA appears elsewhere for thrusters-on, treated as a different condition |
| `EV-TSS1R-012` | `SOURCE_REPORTED` | NASA, STS-75 mission page; "as high as 3,500 volts"; HIGH | Measurement method and uncertainty not stated |

## Derived (4)

| ID | Classification | Source reference | Provenance issue |
| --- | --- | --- | --- |
| `EV-DER-001` | `DERIVED` | From `EV-TSS1R-002` / `EV-TSS1R-001`; 19,695/20,700 = 0.95144; MEDIUM | Inherits both inputs' uncertainty; not itself source-reported |
| `EV-DER-002` | `DERIVED` | From `EV-TSS1-002` / `EV-TSS1-001`; 256/20,000 = 0.0128; MEDIUM | Uses the contested 256 m; the record states 262.1 m would give 1.31 % |
| `EV-DER-003` | `DERIVED` | Tension `T = 3μ_redμL/r³` derived in this application; MEDIUM | First order in `L/r`, vertical only, circular orbit only; not a structural prediction |
| `EV-DER-004` | `DERIVED` | From `EV-TSS1R-010`; 160 × 1852 = 296,320 m; HIGH | Conversion only; depends on the source-reported 160 nmi |

## Assumed (1)

| ID | Classification | Source reference | Provenance issue |
| --- | --- | --- | --- |
| `EV-ASM-001` | `ASSUMED` | "Derived from EV-TSS1-012 / EV-TSS1R (no sourced value)"; confidence **NONE** | Records that the orbiter-side effective mass is *not* source-reported; any entered value is an assumption and is flagged on the run |

## Conflicts (5) — preserved, never reconciled

| ID | Classification | Source reference | Provenance issue |
| --- | --- | --- | --- |
| `EV-TSS1-003` | `CONFLICT` | Spacefacts STS-46 report; 860 ft / 262.1 m; LOW | Secondary source, no quotation; conflicts with `EV-TSS1-002` (256 m) |
| `EV-TSS1-006` | `CONFLICT` | NASA NTRS 19930016042, "Search extract only — PDF page NOT verified"; 515 kg; LOW | **Page-level verification failed**; conflicts with `EV-TSS1-005` (518 kg) |
| `EV-TSS1-010` | `CONFLICT` | Gunter's Space Page; 296 × 296 km; LOW | Conflicts with `EV-TSS1-009` (230 nmi ≈ 426 km); sources do not explain the difference |
| `EV-TSS1R-006` | `CONFLICT` | Gunter's Space Page; 518 kg; LOW | Conflicts with `EV-TSS1R-005` (517 kg); 1 kg disagreement |
| `EV-TSS1R-008` | `CONFLICT` | AmericaSpace; 2.0 mm (0.08 in); LOW | No quotation; conflicts with `EV-TSS1R-007` (2.54 mm) |

## Unknown (5) — deliberately left empty

| ID | Classification | Source reference | Provenance issue |
| --- | --- | --- | --- |
| `EV-TSS1-011` | `UNKNOWN` | None; confidence NONE | No readable source located; **not** inferred from diameter or length; TETH-1 treats the tether as massless so it does not enter a calculation |
| `EV-TSS1-012` | `UNKNOWN` | None; NONE | Orbiter-side effective mass; a reconstruction is blocked unless the researcher supplies an assumed value (see `EV-ASM-001`) |
| `EV-TSS1R-004` | `UNKNOWN` | None; NONE | Insulation-damage initiator; accounts disagree between foreign-object penetration and tether defect |
| `EV-TSS1R-009` | `UNKNOWN` | None; NONE | A 7.36 kg/km figure appeared only in a search-index extract and is **explicitly excluded**; no generic mass-per-length substituted |
| `EV-TSS1R-013` | `UNKNOWN` | None; NONE | Measured Lorentz thrust; secondary force estimates lacked established measurement status, so `OTL-EDT-1` stays `BLOCKED` |

## Cross-cutting provenance observations

1. **Secondary-source dependence.** Seven records rest on compilations or reporting (Gunter's
   Space Page ×4, Spacefacts ×1, AmericaSpace ×2), all at LOW/MEDIUM confidence, plus one mixed
   NASA/secondary account (`EV-TSS1R-003`). No TSS-1/TSS-1R record is quoted from a page-verified
   primary instrument dataset.
2. **Two records failed page-level verification** (`EV-TSS1-006`, `EV-TSS1R-009`) and are recorded
   as such rather than promoted to evidence. `EV-TSS1R-009` is `UNKNOWN` despite a numeric value
   having been seen — the honest choice.
3. **Only one source-bearing record has no URL.** `EV-PHY-002` is identified by document only
   (WGS-84 TR8350.2); derived and unknown records have no source URL by nature. `EV-TSS1-004` cites
   an NTRS record URL but asserts no page number, so retrieval depends on the document identifier.
4. **Measured quantities lack stated uncertainty** (`EV-TSS1R-011` current, `EV-TSS1R-012` voltage):
   the values are presented as achieved, but no error bars exist to propagate.
5. **Every constant used by the models is traceable** to `EV-PHY-001` or `EV-PHY-002`, and
   `src/core/constants.ts` cites both by identifier in comments — the only two values that enter the
   equations.
