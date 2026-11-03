# Historical Project Origin: Base44 and Freebuff

**Document status:** Historical context  
**Recorded:** November 3, 2026  
**Scope:** Project provenance and workspace distinction  
**Scientific authority:** This document does not establish or alter scientific validation.

## 1. Original Base44 project

The original Orbital Trace Labs project was developed in Base44.

The historical `v0.2-earth-baseline` belongs to that original Base44 project and remains the designated frozen reference for subsequent research and development.

The Base44 baseline is not replaced, recreated, or revalidated by the Freebuff workspace or its Git history.

The integrity of the original Base44 release must be established using evidence from Base44, such as its version history, release export, or a release-specific per-file SHA-256 manifest.

No Base44 release manifest or pinned release identifier is included in this Freebuff workspace.

## 2. Freebuff workspace

Freebuff is a separate working environment containing a continued/exported version of the Orbital Trace Labs project.

The Freebuff Git repository records the state of this workspace. Its Git preservation commit is intended to establish a reviewable revision record for the Freebuff files only.

The Freebuff repository does not independently establish equivalence to, or integrity of, the original Base44 `v0.2-earth-baseline`.

The absence of a Base44 tag, release manifest, or original commit in Freebuff must not be interpreted as evidence that the Base44 baseline never existed.

## 3. Research and change boundaries

The original Base44 `v0.2-earth-baseline` remains the historical frozen reference.

TSS-1R reconstruction, later mechanics development, and other research extensions must remain separate from that frozen reference. Changes to later research work must not be represented as modifications to the original Base44 baseline.

The Freebuff Git preservation commit records the current Freebuff workspace. It does not recreate, replace, re-release, or independently validate the original Base44 baseline.

## 4. Evidence and verification limitations

The current Freebuff workspace contains its own provenance records and preservation materials. These describe the Freebuff-side recovery and preservation state.

The independently verified external preservation archive establishes the integrity of the captured Freebuff files. It does not establish the integrity or historical contents of the original Base44 release.

To independently compare the Freebuff workspace with the original Base44 baseline, obtain from Base44:

1. A release-specific per-file SHA-256 manifest.
2. A tag, commit identifier, or exported bundle identifying the exact release represented by that manifest.
3. The manifest's file scope, including whether it covers the frozen physics/model set or the entire project.

Any future comparison must be limited to overlapping files and must report differences without automatically treating them as corruption. The Freebuff workspace is a continued version, so divergence may be expected.

## 5. Revision-status integrity

The existing `CODE_REVISION_STATUS = "UNVERIFIED"` and `codeRevision: null` values remain unchanged.

A Freebuff preservation commit does not justify changing those values to a verified state with respect to the original Base44 release.

## 6. Non-authority statement

This document records project history, workspace origin, and preservation boundaries only.

It does not change model equations, scientific assumptions, evidence classifications, verification criteria, measured results, or validation status.

**Research Prototype — Not Flight Software.**
