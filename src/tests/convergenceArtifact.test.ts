/**
 * Tests of the convergence export artifact.
 *
 * The claims under test:
 *  - the payload hash is deterministic in the RESULTS, and independent of export time,
 *    execution time and build identifier;
 *  - a change to any measured result changes the digest;
 *  - structurally invalid, malformed or unsupported files are rejected rather than
 *    repaired, and a hash mismatch is surfaced rather than hidden.
 */

import { describe, expect, it } from "vitest";
import {
  CONVERGENCE_ARTIFACT_SCHEMA,
  CONVERGENCE_HASH_SPEC,
  buildConvergenceArtifact,
  convergenceArtifactFile,
  convergenceArtifactJson,
  convergenceHashPayload,
  parseConvergenceArtifact,
  verifyConvergenceArtifact,
  type ConvergenceArtifact,
} from "../export/convergenceArtifact";
import { DEFAULT_CONVERGENCE_CONFIG, runTetherConvergence } from "../verification/tetherConvergence";

const study = runTetherConvergence(DEFAULT_CONVERGENCE_CONFIG);
const T1 = new Date("2026-01-02T03:04:05.000Z");
const T2 = new Date("2026-10-26T11:22:33.444Z");

async function artifactAt(date: Date): Promise<ConvergenceArtifact> {
  return buildConvergenceArtifact(study, date);
}

describe("deterministic result hash", () => {
  it("is identical for the same results exported at different times", async () => {
    const a = await artifactAt(T1);
    const b = await artifactAt(T2);
    expect(a.generatedAtUtc).not.toBe(b.generatedAtUtc);
    expect(a.payloadHash).toBe(b.payloadHash);
    expect(a.payloadBytes).toBe(b.payloadBytes);
  });

  it("does not depend on the build identifier or the execution timestamp", async () => {
    const original = await artifactAt(T1);
    const copy = JSON.parse(JSON.stringify(original)) as ConvergenceArtifact;
    copy.app.buildId = "otl-build-different-build";
    copy.study.generatedAtUtc = "1999-12-31T23:59:59.000Z";
    const check = await verifyConvergenceArtifact(copy);
    expect(check.ok).toBe(true);
    expect(check.computed).toBe(original.payloadHash);
  });

  it("changes when any measured result changes", async () => {
    const original = await artifactAt(T1);
    const mutated = JSON.parse(JSON.stringify(original)) as ConvergenceArtifact;
    mutated.study.cases[1].points[3].isolatedThetaErrRad *= 1.000001;
    const check = await verifyConvergenceArtifact(mutated);
    expect(check.ok).toBe(false);
    expect(check.computed).not.toBe(original.payloadHash);

    // The acceptance status is part of the hashed payload, so flipping it changes the
    // digest even though no numerical value changed.
    const tamperedStatus = JSON.parse(JSON.stringify(original)) as ConvergenceArtifact;
    tamperedStatus.study.cases[0].acceptance.status = "FAIL";
    const statusCheck = await verifyConvergenceArtifact(tamperedStatus);
    expect(statusCheck.ok).toBe(false);

    // So does changing a recorded reason, and the canonical payload shows both fields.
    const tamperedReason = JSON.parse(JSON.stringify(original)) as ConvergenceArtifact;
    tamperedReason.study.cases[0].acceptance.reasons = ["edited after export"];
    expect((await verifyConvergenceArtifact(tamperedReason)).ok).toBe(false);
    expect(JSON.stringify(convergenceHashPayload(tamperedReason))).toContain("edited after export");
  });

  it("binds the reference-error status into the digest", async () => {
    const original = await artifactAt(T1);
    const upgraded = JSON.parse(JSON.stringify(original)) as ConvergenceArtifact;
    upgraded.study.referenceErrorKind = "RIGOROUS_BOUND";
    upgraded.study.cases[0].reference.errorKind = "RIGOROUS_BOUND";
    expect((await verifyConvergenceArtifact(upgraded)).ok).toBe(false);
    expect((await verifyConvergenceArtifact(upgraded)).computed).not.toBe(original.payloadHash);
  });

  it("recomputes the same digest on repeated verification", async () => {
    const artifact = await artifactAt(T1);
    const first = await verifyConvergenceArtifact(artifact);
    const reparsed = JSON.parse(convergenceArtifactJson(artifact)) as ConvergenceArtifact;
    const second = await verifyConvergenceArtifact(reparsed);
    expect(first.computed).toBe(second.computed);
    expect(first.computed).toBe(artifact.payloadHash);
    expect(first.ok && second.ok).toBe(true);
  });

  it("has an explicitly documented, timestamp-free hash payload", async () => {
    const artifact = await artifactAt(T1);
    const payload = convergenceHashPayload(artifact);
    const serialised = JSON.stringify(payload);
    expect(serialised).not.toContain("generatedAtUtc");
    expect(serialised).not.toContain("buildId");
    for (const excluded of ["generatedAtUtc", "app.buildId", "study.generatedAtUtc", "payloadHash"]) {
      expect(CONVERGENCE_HASH_SPEC.excludedFields).toContain(excluded);
    }
    for (const included of [
      "study.cases",
      "study.overallStatus",
      "study.model",
      "app.version",
      "study.referenceErrorKind",
    ]) {
      expect(CONVERGENCE_HASH_SPEC.includedFields).toContain(included);
    }
    // The reference-error status is part of the hashed payload, so it cannot be
    // upgraded from empirical to rigorous without breaking the digest.
    expect(serialised).toContain("EMPIRICAL_ESTIMATE");
    // Exactly the declared fields are present at the top level.
    expect(Object.keys(payload).sort()).toEqual(["app", "schemaVersion", "study"]);
    expect(Object.keys(payload.app as Record<string, unknown>).sort()).toEqual(["name", "releaseLabel", "version"]);
  });
});

describe("serialisation of uncomputable quantities", () => {
  it("stores uncomputable orders as null and remains hashable", async () => {
    // A failing or degenerate case may have no computable order. If that were stored as
    // -Infinity, JSON would turn it into null and the canonicaliser would reject the
    // whole payload, making a failing study impossible to export.
    const copy = JSON.parse(JSON.stringify(study)) as typeof study;
    copy.cases[0].observedOrder.isolatedTheta = null;
    copy.cases[0].observedOrder.theta = null;
    copy.cases[0].orbitErrorOrder = null;
    const artifact = await buildConvergenceArtifact(copy, T1);
    const reparsed = JSON.parse(convergenceArtifactJson(artifact)) as ConvergenceArtifact;
    expect(reparsed.study.cases[0].observedOrder.isolatedTheta).toBeNull();
    expect(convergenceArtifactJson(artifact)).not.toMatch(/-?Infinity|NaN/);
    expect((await verifyConvergenceArtifact(reparsed)).ok).toBe(true);
  });

  it("records only finite orders or null in the measured study", () => {
    for (const c of study.cases) {
      for (const value of [c.observedOrder.theta, c.observedOrder.thetaRate, c.observedOrder.isolatedTheta, c.observedOrder.isolatedThetaRate, c.orbitErrorOrder]) {
        expect(value === null || Number.isFinite(value)).toBe(true);
      }
    }
  });
});

describe("export file", () => {
  it("is named, typed, hashed and self-verifying", async () => {
    const artifact = await artifactAt(T1);
    const file = await convergenceArtifactFile(artifact);
    expect(file.name).toBe("tether-convergence-1.0.0-2026-01-02.json");
    expect(file.mime).toBe("application/json");
    expect(file.bytes).toBeGreaterThan(1000);
    expect(file.sha256).toMatch(/^[0-9a-f]{64}$/);
    const parsed = JSON.parse(file.content) as ConvergenceArtifact;
    expect(parsed.schemaVersion).toBe(CONVERGENCE_ARTIFACT_SCHEMA);
    expect(parsed.study.cases).toHaveLength(2);
    expect((await verifyConvergenceArtifact(parsed)).ok).toBe(true);
    // Serialised text is pretty-printed but the hash is over the canonical payload.
    expect(convergenceArtifactJson(artifact)).toContain('"schemaVersion": "otl-convergence-artifact-v1"');
  });
});

describe("importing exported artifacts", () => {
  it("accepts a valid export and reports a matching digest", async () => {
    const artifact = await artifactAt(T1);
    const result = await parseConvergenceArtifact(convergenceArtifactJson(artifact));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.digestMatches).toBe(true);
    expect(result.computed).toBe(artifact.payloadHash);
    expect(result.artifact.study.cases.map((c) => c.caseId)).toEqual(["TC-1", "TC-2"]);
  });

  it("accepts a structurally valid file but reports a tampered digest", async () => {
    const artifact = await artifactAt(T1);
    const mutated = JSON.parse(JSON.stringify(artifact)) as ConvergenceArtifact;
    mutated.study.cases[0].points[0].thetaErrRad = 1e-30;
    const result = await parseConvergenceArtifact(JSON.stringify(mutated));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.digestMatches).toBe(false);
    expect(result.computed).not.toBe(result.recorded);
  });

  it("rejects malformed JSON with a specific code", async () => {
    const result = await parseConvergenceArtifact("{ this is not json");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("MALFORMED_JSON");
    expect(result.errors[0]).toMatch(/not valid JSON/);

    const arrayResult = await parseConvergenceArtifact("[1,2,3]");
    expect(arrayResult.ok).toBe(false);
    if (arrayResult.ok) return;
    expect(arrayResult.code).toBe("INVALID_STRUCTURE");
  });

  it("rejects unsupported artifact and study schemas", async () => {
    const artifact = await artifactAt(T1);
    const wrongArtifact = { ...artifact, schemaVersion: "otl-convergence-artifact-v2" };
    const a = await parseConvergenceArtifact(JSON.stringify(wrongArtifact));
    expect(a.ok).toBe(false);
    if (!a.ok) {
      expect(a.code).toBe("UNSUPPORTED_SCHEMA");
      expect(a.errors[0]).toContain("otl-convergence-artifact-v2");
    }

    const wrongStudy = JSON.parse(JSON.stringify(artifact)) as Record<string, unknown>;
    (wrongStudy.study as Record<string, unknown>).schemaVersion = "otl-tether-convergence-v0";
    const b = await parseConvergenceArtifact(JSON.stringify(wrongStudy));
    expect(b.ok).toBe(false);
    if (!b.ok) {
      expect(b.code).toBe("UNSUPPORTED_SCHEMA");
      expect(b.errors[0]).toContain("otl-tether-convergence-v0");
    }
  });

  it("rejects a reference-error claim this build cannot check", async () => {
    const artifact = await artifactAt(T1);
    for (const claim of ["RIGOROUS_BOUND", "VALIDATED_ENCLOSURE"] as const) {
      const copy = JSON.parse(JSON.stringify(artifact)) as ConvergenceArtifact;
      copy.study.referenceErrorKind = claim;
      for (const c of copy.study.cases) c.reference.errorKind = claim;
      const result = await parseConvergenceArtifact(JSON.stringify(copy));
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.code).toBe("UNSUPPORTED_REFERENCE_CLAIM");
      expect(result.errors[0]).toContain(claim);
    }

    // An unstated status is invalid structure, not an implicit claim.
    const unstated = JSON.parse(JSON.stringify(artifact)) as Record<string, unknown>;
    delete (unstated.study as Record<string, unknown>).referenceErrorKind;
    const noKind = await parseConvergenceArtifact(JSON.stringify(unstated));
    expect(noKind.ok).toBe(false);
    if (!noKind.ok) {
      expect(noKind.code).toBe("INVALID_STRUCTURE");
      expect(noKind.errors.join(" ")).toMatch(/referenceErrorKind is missing/);
    }

    // A case disagreeing with the study-level status is also rejected.
    const mismatched = JSON.parse(JSON.stringify(artifact)) as ConvergenceArtifact;
    mismatched.study.cases[1].reference.errorKind = "RIGOROUS_BOUND";
    const mismatch = await parseConvergenceArtifact(JSON.stringify(mismatched));
    expect(mismatch.ok).toBe(false);
    if (!mismatch.ok) expect(mismatch.errors.join(" ")).toMatch(/must equal study\.referenceErrorKind/);
  });

  it("rejects structurally invalid payloads instead of repairing them", async () => {
    const artifact = await artifactAt(T1);

    const noStudy = { ...artifact, study: undefined };
    const a = await parseConvergenceArtifact(JSON.stringify(noStudy));
    expect(a.ok).toBe(false);
    if (!a.ok) expect(a.code).toBe("INVALID_STRUCTURE");

    const missingHash = { ...artifact, payloadHash: "not-a-hash" };
    const b = await parseConvergenceArtifact(JSON.stringify(missingHash));
    expect(b.ok).toBe(false);
    if (!b.ok) {
      expect(b.code).toBe("INVALID_STRUCTURE");
      expect(b.errors.join(" ")).toMatch(/payloadHash/);
    }

    const badPoint = JSON.parse(JSON.stringify(artifact)) as ConvergenceArtifact;
    // JSON cannot carry Infinity, but it can carry null or a string: both are invalid.
    (badPoint.study.cases[0].points[1] as unknown as Record<string, unknown>).isolatedThetaErrRad = null;
    const c = await parseConvergenceArtifact(JSON.stringify(badPoint));
    expect(c.ok).toBe(false);
    if (!c.ok) {
      expect(c.code).toBe("INVALID_STRUCTURE");
      expect(c.errors.join(" ")).toMatch(/isolatedThetaErrRad must be a finite number/);
    }

    const badCase = JSON.parse(JSON.stringify(artifact)) as ConvergenceArtifact;
    badCase.study.cases = [];
    const d = await parseConvergenceArtifact(JSON.stringify(badCase));
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.errors.join(" ")).toMatch(/non-empty array/);
  });
});
