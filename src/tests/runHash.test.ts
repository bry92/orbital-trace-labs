/**
 * Result identity, provenance and legacy hash scope.
 *
 * The claims under test, kept deliberately separate:
 *   1. RESULT identity — identical inputs and results produce the same digest, no matter
 *      when the run happened, what it was called, or how long a check took.
 *   2. MUTATION sensitivity — changing anything that defines the answer changes it.
 *   3. PROVENANCE exclusion — run id, execution time, build id, code revision and
 *      per-check wall-clock timings are recorded but never bound.
 *   4. LEGACY scope — a record whose digest matches the pre-repair whole-record scope is
 *      intact under that scope and is never reported as tampered with.
 *   5. RE-HASH — the explicit action rebinds the scope and changes nothing else.
 */

import { describe, expect, it } from "vitest";
import { MU_EARTH, R_EARTH } from "../core/constants";
import type { ParameterInput } from "../core/validation";
import { executeExperiment } from "../engine/execute";
import { parseImportedRun } from "../export/importRun";
import { runToJson } from "../export/serialize";
import { reproduceStoredRun } from "../verification/reproducibility";
import { TWO_BODY_MODEL } from "../models/twoBody";
import {
  LEGACY_HASH_ID,
  RESULT_HASH_ID,
  RESULT_HASH_SPEC,
  computeLegacyPayloadHash,
  computePayloadHash,
  rehashRecord,
  resultPayloadOf,
  verifyStoredHash,
  type RunRecord,
} from "../core/run";

const LEO_R = R_EARTH + 400e3;
const V_CIRC = Math.sqrt(MU_EARTH / LEO_R);

function inputs(): ParameterInput[] {
  return [
    { paramId: "gravitationalParameter", value: MU_EARTH, unit: "m3s2" },
    { paramId: "initialPositionX", value: LEO_R / 1000, unit: "km" },
    { paramId: "initialPositionY", value: 0, unit: "km" },
    { paramId: "initialPositionZ", value: 0, unit: "km" },
    { paramId: "initialVelocityX", value: 0, unit: "kmps" },
    { paramId: "initialVelocityY", value: V_CIRC / 1000, unit: "kmps" },
    { paramId: "initialVelocityZ", value: 0, unit: "kmps" },
    { paramId: "duration", value: 0.5, unit: "h" },
    { paramId: "stepSeconds", value: 60, unit: "s" },
  ];
}

async function makeRun(scenario = "hash case", createdAt = new Date("2026-03-01T00:00:00.000Z")): Promise<RunRecord> {
  const res = await executeExperiment({
    modelId: "OTL-2BP",
    method: "RK4",
    scenarioName: scenario,
    inputs: inputs(),
    createdAt,
    maxStoredSamples: 2000,
  });
  if (!res.ok) throw new Error(res.issues.map((i) => i.message).join(" "));
  return res.record;
}

function clone(record: RunRecord): RunRecord {
  return JSON.parse(JSON.stringify(record)) as RunRecord;
}

describe("result identity", () => {
  it("is identical for identical results produced at different times", async () => {
    const a = await makeRun("same physics", new Date("2026-01-01T00:00:00.000Z"));
    const b = await makeRun("same physics", new Date("2026-09-09T12:34:56.000Z"));

    expect(a.runId).not.toBe(b.runId);
    expect(a.createdAtUtc).not.toBe(b.createdAtUtc);
    expect(JSON.stringify(a.metrics)).toBe(JSON.stringify(b.metrics));
    expect(JSON.stringify(a.series.data)).toBe(JSON.stringify(b.series.data));

    expect(a.payloadHash).toBe(b.payloadHash);
    const check = await verifyStoredHash(a);
    expect(check.scope).toBe("RESULT");
    expect(check.ok).toBe(true);
    console.log(`[HASH] identical results → ${a.payloadHash?.slice(0, 24)}… over ${check.bytes} bytes`);
  });

  it("does not bind provenance: run id, execution time, scenario label, build, revision or timings", async () => {
    const run = await makeRun();
    const original = await computePayloadHash(run);

    const altered = clone(run);
    altered.runId = "OTL-19990101T000000-DEADBEEF";
    altered.createdAtUtc = "1999-12-31T23:59:59.000Z";
    altered.scenarioName = "renamed after the fact";
    altered.app.buildId = "otl-build-some-other-build";
    altered.app.codeRevision = "0000000000000000000000000000000000000000";
    altered.app.codeRevisionStatus = "VERIFIED_MATCH" as never;
    altered.verification = altered.verification.map((c) => ({ ...c, durationMs: 987654.3 }));

    const after = await computePayloadHash(altered);
    expect(after).toBe(original);

    // The stored digest still verifies: provenance changes do not move result identity.
    expect((await verifyStoredHash(altered)).scope).toBe("RESULT");
    console.log(`[HASH] provenance-only changes preserved the digest ${original.slice(0, 16)}…`);
  });

  it("ignores wall-clock timings even when the whole check set is re-timed", async () => {
    const run = await makeRun();
    const retimed = clone(run);
    retimed.verification = retimed.verification.map((c, i) => ({ ...c, durationMs: i * 10 + 0.1 }));
    expect(await computePayloadHash(retimed)).toBe(await computePayloadHash(run));
  });
});

describe("mutation sensitivity", () => {
  const mutations: [string, (r: RunRecord) => void][] = [
    [
      "a metric value",
      (r) => {
        const m = r.metrics.find((x) => x.id === "finalRadius");
        if (m && m.value !== null) m.value *= 1.000001;
      },
    ],
    ["a recorded series sample", (r) => (r.series.data.y[2] = r.series.data.y[2] + 1)],
    ["a parameter value", (r) => (r.parameters[0].siValue *= 1.000001)],
    ["an initial condition", (r) => (r.initialConditions.positionXM *= 1.000001)],
    ["a solver setting", (r) => (r.solver.settings = { ...r.solver.settings, stepS: 61 })],
    ["a check outcome", (r) => (r.verification[0].outcome = "FAIL")],
    ["a check measured value", (r) => (r.verification[0].measuredValue = 12345.678)],
    ["a warning", (r) => r.warnings.push("inserted after the hash")],
    ["the data origin", (r) => (r.dataOrigin = "EVIDENCE_INFORMED_RECONSTRUCTION")],
    ["the model version", (r) => (r.model.version = "1.0.1")],
    ["the decimation rule", (r) => (r.series.decimation.rule = "rewritten rule")],
  ];

  for (const [label, mutate] of mutations) {
    it(`changes the digest when ${label} changes`, async () => {
      const run = await makeRun();
      const base = await computePayloadHash(run);
      const altered = clone(run);
      mutate(altered);
      const after = await computePayloadHash(altered);
      expect(after).not.toBe(base);
      expect((await verifyStoredHash(altered)).scope).toBe("MISMATCH");
    });
  }

  it("has a payload with no volatile field in it", async () => {
    const run = await makeRun();
    const serialised = JSON.stringify(resultPayloadOf(run));
    for (const volatile of ["runId", "createdAtUtc", "buildId", "codeRevision", "durationMs", "generatedAt"]) {
      expect(serialised).not.toContain(volatile);
    }
    // The result itself must be in there.
    for (const required of ["metrics", "series", "initialConditions", "parameters", "verification"]) {
      expect(serialised).toContain(required);
    }
    expect(RESULT_HASH_SPEC.excludedFields).toContain("verification[].durationMs");
    expect(RESULT_HASH_SPEC.includedFields).toContain("verification[].outcome");
  });
});

describe("the hash specification and the implemented payload agree", () => {
  /** Every leaf path in a value, with array indices collapsed to [] . */
  function leafPaths(value: unknown, prefix = ""): string[] {
    if (Array.isArray(value)) return value.flatMap((v) => leafPaths(v, `${prefix}[]`));
    if (value && typeof value === "object") {
      return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
        leafPaths(v, prefix ? `${prefix}.${k}` : k),
      );
    }
    return prefix ? [prefix] : [];
  }

  const normalise = (path: string): string => path.replace(/\[\]/g, "");

  function covered(leaf: string, declared: string): boolean {
    const l = normalise(leaf);
    const d = normalise(declared);
    return l === d || l.startsWith(`${d}.`);
  }

  /** A record with at least one entry in every array, so every declared path exists. */
  async function richLeaves(): Promise<string[]> {
    const run = await makeRun();
    run.warnings.push("a warning");
    run.limitations.push("a limitation");
    run.assumptions.push("an assumption");
    run.references.push({ label: "a reference" });
    run.unresolved.push({ item: "an item", reason: "a reason" });
    run.evidenceFlags.push("a flag");
    run.validationIssues.push({ code: "MODEL_WARNING", severity: "warning", paramId: null, message: "a message" });
    return leafPaths(resultPayloadOf(run)).map(normalise);
  }

  it("binds nothing that is declared provenance-only", async () => {
    const leaves = await richLeaves();
    for (const excluded of RESULT_HASH_SPEC.excludedFields) {
      const hit = leaves.find((leaf) => covered(leaf, excluded));
      expect(hit, `excluded field "${excluded}" is present in the hash payload as "${hit}"`).toBeUndefined();
    }
  });

  it("binds nothing undeclared", async () => {
    const leaves = await richLeaves();
    for (const leaf of leaves) {
      const declared = RESULT_HASH_SPEC.includedFields.some((d) => covered(leaf, d));
      expect(declared, `payload leaf "${leaf}" is hashed but not listed in includedFields`).toBe(true);
    }
  });

  it("declares nothing it does not actually bind", async () => {
    const leaves = await richLeaves();
    for (const declared of RESULT_HASH_SPEC.includedFields) {
      const present = leaves.some((leaf) => covered(leaf, declared));
      expect(present, `includedFields declares "${declared}" but the payload has no such path`).toBe(true);
    }
  });

  it("gives every record its own copy of the model's declared limitations and assumptions", async () => {
    const before = await makeRun();
    const declaredLimitations = before.limitations.length;
    const declaredAssumptions = before.assumptions.length;
    const baselineHash = await computePayloadHash(before);

    // Mutating a record must not reach the model registry, and must not change the
    // identity of a record produced afterwards.
    const victim = await makeRun();
    victim.limitations.push("injected limitation");
    victim.assumptions.push("injected assumption");
    victim.references.push({ label: "injected reference" });
    victim.unresolved.push({ item: "injected", reason: "injected" });
    victim.series.columns[0].label = "injected column label";

    const after = await makeRun();
    expect(after.limitations.length).toBe(declaredLimitations);
    expect(after.assumptions.length).toBe(declaredAssumptions);
    expect(after.limitations).not.toContain("injected limitation");
    expect(after.assumptions).not.toContain("injected assumption");
    expect(after.references.some((r) => r.label === "injected reference")).toBe(false);
    expect(after.series.columns[0].label).not.toBe("injected column label");
    expect(await computePayloadHash(after)).toBe(baselineHash);

    // The registry itself is untouched.
    expect(TWO_BODY_MODEL.limitations).not.toContain("injected limitation");
    expect(TWO_BODY_MODEL.assumptions).not.toContain("injected assumption");
    console.log(`[HASH] record arrays are independent; later digest unchanged at ${baselineHash.slice(0, 16)}…`);
  });

  it("holds its own arrays, not the model registry's", async () => {
    const a = await makeRun();
    const b = await makeRun();
    // Aliasing to a module-level constant would make these the same objects.
    expect(a.limitations).not.toBe(b.limitations);
    expect(a.assumptions).not.toBe(b.assumptions);
    expect(a.references).not.toBe(b.references);
    expect(a.references[0]).not.toBe(b.references[0]);
    expect(a.unresolved).not.toBe(b.unresolved);
    expect(a.series.columns).not.toBe(b.series.columns);
    expect(a.series.columns[0]).not.toBe(b.series.columns[0]);
    expect(a.solver.settings).not.toBe(b.solver.settings);
    // And specifically not the registry objects that the model modules return.
    expect(a.limitations).not.toBe(TWO_BODY_MODEL.limitations);
    expect(a.assumptions).not.toBe(TWO_BODY_MODEL.assumptions);
  });

  it("produces the same hash regardless of creation order or interference", async () => {
    const first = await makeRun();
    const expected = await computePayloadHash(first);

    // Interfere with an already-created record, then create more.
    first.limitations.push("interference");
    first.series.columns[0].label = "interference";
    first.references.push({ label: "interference" });

    const second = await makeRun();
    second.assumptions.push("interference");
    second.unresolved.push({ item: "interference", reason: "interference" });

    const third = await makeRun();
    expect(await computePayloadHash(third)).toBe(expected);
    expect(third.limitations).not.toContain("interference");
    expect(third.series.columns[0].label).not.toBe("interference");
    console.log(`[HASH] order-independent result identity: ${expected.slice(0, 16)}…`);
  });

  it("binds app.releaseLabel but not the researcher's scenario label", async () => {
    const run = await makeRun("original scenario label");
    const base = await computePayloadHash(run);

    const relabelledApp = clone(run);
    relabelledApp.app.releaseLabel = "v1.0-research-prototype-rebuilt";
    expect(await computePayloadHash(relabelledApp)).not.toBe(base);

    const renamedScenario = clone(run);
    renamedScenario.scenarioName = "renamed scenario label";
    expect(await computePayloadHash(renamedScenario)).toBe(base);

    console.log(`[HASH] releaseLabel is significant; scenarioName is provenance-only`);
  });
});

describe("legacy hash scope", () => {
  /** Build a record shaped the way pre-repair records were: whole-record hash, no spec id. */
  async function asLegacy(record: RunRecord): Promise<RunRecord> {
    const legacyShaped = clone(record);
    legacyShaped.hashSpec = { ...RESULT_HASH_SPEC, id: undefined };
    const digest = await computeLegacyPayloadHash(legacyShaped);
    return { ...legacyShaped, payloadHash: digest };
  }

  it("recognises a legacy digest as LEGACY, not as tampering", async () => {
    const legacy = await asLegacy(await makeRun());
    const check = await verifyStoredHash(legacy);
    expect(check.scope).toBe("LEGACY");
    expect(check.ok).toBe(false);
    expect(check.recorded).toBe(legacy.payloadHash);
    expect(check.legacyComputed).toBe(legacy.payloadHash);
    expect(check.computed).not.toBe(legacy.payloadHash);
    console.log(`[HASH] legacy record recognised: scope=${check.scope}, legacy=${check.legacyComputed.slice(0, 16)}…`);
  });

  it("stays LEGACY when only provenance differs from what was hashed", async () => {
    const legacy = await asLegacy(await makeRun());
    // Re-timing does not break the legacy digest, because the legacy scope bound the
    // timings that were stored at the time.
    expect((await verifyStoredHash(legacy)).scope).toBe("LEGACY");
  });

  it("reports MISMATCH when the recorded digest matches neither scope", async () => {
    const legacy = await asLegacy(await makeRun());
    const tampered = clone(legacy);
    tampered.metrics[0].value = (tampered.metrics[0].value ?? 0) + 1;
    const check = await verifyStoredHash(tampered);
    expect(check.scope).toBe("MISMATCH");
    expect(check.legacyComputed).not.toBe(check.recorded);
  });

  it("re-hashes explicitly without touching results or provenance", async () => {
    const legacy = await asLegacy(await makeRun());
    const rehashed = await rehashRecord(legacy);
    // Re-hashing must reproduce the same identity a fresh identical run would have.
    expect(rehashed.payloadHash).toBe(await computePayloadHash(await makeRun()));

    expect(rehashed.hashSpec.id).toBe(RESULT_HASH_ID);
    expect(rehashed.hashSpec.id).not.toBe(LEGACY_HASH_ID);
    expect(rehashed.hashStatus).toBe("COMPUTED");
    expect(rehashed.payloadHash).toBe(await computePayloadHash(legacy));

    // Nothing but the digest scope moved.
    expect(rehashed.runId).toBe(legacy.runId);
    expect(rehashed.createdAtUtc).toBe(legacy.createdAtUtc);
    expect(rehashed.app).toEqual(legacy.app);
    expect(rehashed.scenarioName).toBe(legacy.scenarioName);
    expect(JSON.stringify(rehashed.metrics)).toBe(JSON.stringify(legacy.metrics));
    expect(JSON.stringify(rehashed.series)).toBe(JSON.stringify(legacy.series));

    const check = await verifyStoredHash(rehashed);
    expect(check.scope).toBe("RESULT");
    expect(check.ok).toBe(true);
    console.log(`[HASH] re-hashed legacy record → ${rehashed.payloadHash?.slice(0, 16)}… (results unchanged)`);
  });

  it("imports a legacy-scope export with a warning instead of a mismatch", async () => {
    const base = await makeRun();
    const legacyShaped = clone(base);
    legacyShaped.hashSpec = { ...RESULT_HASH_SPEC, id: undefined };
    const legacy: RunRecord = { ...legacyShaped, payloadHash: await computeLegacyPayloadHash(legacyShaped) };

    const res = await parseImportedRun(runToJson(legacy));
    expect(res.ok).toBe(true);
    expect(res.hash.status).toBe("PASS");
    expect(res.hash.scope).toBe("LEGACY");
    expect(res.warnings.join(" ")).toMatch(/HASH_SCOPE_LEGACY/);
    console.log(`[HASH] legacy export imported: status=${res.hash.status}, scope=${res.hash.scope}`);
  });

  it("still rejects a genuinely altered legacy export", async () => {
    const base = await makeRun();
    const legacyShaped = clone(base);
    legacyShaped.hashSpec = { ...RESULT_HASH_SPEC, id: undefined };
    const legacy: RunRecord = { ...legacyShaped, payloadHash: await computeLegacyPayloadHash(legacyShaped) };

    const doc = JSON.parse(runToJson(legacy));
    doc.metrics[0].value = (doc.metrics[0].value ?? 0) + 1;
    const res = await parseImportedRun(JSON.stringify(doc));
    expect(res.ok).toBe(false);
    expect(res.errors.join(" ")).toMatch(/PAYLOAD_HASH_MISMATCH/);
  });

  it("reproduces a legacy record without failing its integrity step", async () => {
    const base = await makeRun();
    const legacyShaped = clone(base);
    legacyShaped.hashSpec = { ...RESULT_HASH_SPEC, id: undefined };
    const legacy: RunRecord = { ...legacyShaped, payloadHash: await computeLegacyPayloadHash(legacyShaped) };

    const result = await reproduceStoredRun(legacy);
    const hashStep = result.steps.find((s) => s.name === "Payload hash")!;
    expect(hashStep.outcome).toBe("PASS");
    expect(hashStep.detail).toMatch(/LEGACY/);
    expect(result.status).toBe("PASS");
    console.log(`[HASH] legacy reproduction: ${result.status} — ${hashStep.detail.slice(0, 80)}…`);
  }, 60000);
});
