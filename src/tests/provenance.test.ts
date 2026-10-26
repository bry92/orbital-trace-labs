/**
 * M3 tests: canonical payload hashing, artifact hashing, export/import integrity,
 * reproduction of a stored run, and comparison semantics.
 */

import { describe, expect, it } from "vitest";
import { MU_EARTH, R_EARTH } from "../core/constants";
import { canonicalize, sha256Hex } from "../core/canonical";
import { computePayloadHash, type RunRecord } from "../core/run";
import { executeExperiment } from "../engine/execute";
import { buildArtifacts, runToJson, seriesToCsv, technicalReport } from "../export/serialize";
import { parseImportedRun } from "../export/importRun";
import { reproduceStoredRun } from "../verification/reproducibility";
import { compareRuns } from "../review/compare";
import type { ParameterInput } from "../core/validation";

const LEO_R = R_EARTH + 400e3;
const V_CIRC = Math.sqrt(MU_EARTH / LEO_R);

function inputs(overrides: Partial<Record<string, number>> = {}): ParameterInput[] {
  return [
    { paramId: "gravitationalParameter", value: MU_EARTH, unit: "m3s2" },
    { paramId: "initialPositionX", value: LEO_R / 1000, unit: "km" },
    { paramId: "initialPositionY", value: 0, unit: "km" },
    { paramId: "initialPositionZ", value: 0, unit: "km" },
    { paramId: "initialVelocityX", value: 0, unit: "kmps" },
    { paramId: "initialVelocityY", value: (overrides.vy ?? V_CIRC) / 1000, unit: "kmps" },
    { paramId: "initialVelocityZ", value: 0, unit: "kmps" },
    { paramId: "duration", value: overrides.durationHours ?? 0.5, unit: "h" },
    { paramId: "stepSeconds", value: 60, unit: "s" },
  ];
}

async function makeRun(overrides: Partial<Record<string, number>> = {}, scenario = "M3 provenance case"): Promise<RunRecord> {
  const res = await executeExperiment({
    modelId: "OTL-2BP",
    method: "RK4",
    scenarioName: scenario,
    inputs: inputs(overrides),
    inputOrigins: { stepSeconds: "USER_EDITED" },
    maxStoredSamples: 2000,
  });
  if (!res.ok) throw new Error(`setup run failed: ${res.issues.map((i) => i.message).join(" ")}`);
  return res.record;
}

describe("canonical serialisation and SHA-256", () => {
  it("hashes the NIST 'abc' vector correctly", async () => {
    const digest = await sha256Hex("abc");
    console.log(`[HASH] SHA-256("abc") = ${digest}`);
    expect(digest).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("is independent of object key insertion order", () => {
    const a = canonicalize({ b: 1, a: [1, 2, { d: 4, c: 3 }] });
    const b = canonicalize({ a: [1, 2, { c: 3, d: 4 }], b: 1 });
    expect(a).toBe(b);
  });

  it("rejects non-finite numbers instead of coercing them", () => {
    expect(() => canonicalize({ x: NaN })).toThrow(/non-finite/);
    expect(() => canonicalize({ x: Infinity })).toThrow(/non-finite/);
  });
});

describe("run record provenance", () => {
  it("records a computed payload hash that verifies", async () => {
    const run = await makeRun();
    expect(run.hashStatus).toBe("COMPUTED");
    expect(run.payloadHash).toMatch(/^[0-9a-f]{64}$/);
    expect(run.app.codeRevisionStatus).toBe("UNVERIFIED");
    const { verifyStoredHash } = await import("../core/run");
    const check = await verifyStoredHash(run);
    console.log(`[HASH] payload ${run.payloadHash?.slice(0, 16)}… over ${check.bytes} canonical bytes`);
    expect(check.ok).toBe(true);
    expect(run.series.decimation.recordedSampleCount).toBeLessThanOrEqual(2000);
  });

  it("detects a tampered payload", async () => {
    const run = await makeRun();
    const tampered: RunRecord = JSON.parse(JSON.stringify(run));
    tampered.metrics = tampered.metrics.map((m) =>
      m.id === "finalRadius" && m.value !== null ? { ...m, value: m.value * 1.0001 } : m,
    );
    const { verifyStoredHash } = await import("../core/run");
    const check = await verifyStoredHash(tampered);
    console.log(`[HASH] tamper detection: ok=${check.ok}`);
    expect(check.ok).toBe(false);
  });

  it("uses a unique run id per execution", async () => {
    const [a, b] = await Promise.all([makeRun(), makeRun()]);
    expect(a.runId).not.toBe(b.runId);
  });
});

describe("exports", () => {
  it("writes a CSV whose header, units and row count match the stored series", async () => {
    const run = await makeRun();
    const csv = seriesToCsv(run);
    const lines = csv.trimEnd().split("\n");
    const headerLine = lines.findIndex((l) => l.startsWith("t [s]"));
    expect(headerLine).toBeGreaterThan(0);
    const header = lines[headerLine].split(",");
    const storedKeys = Object.keys(run.series.data);
    expect(header).toHaveLength(storedKeys.length);
    for (const key of storedKeys) {
      expect(header.some((h) => h.startsWith(`${key} [`))).toBe(true);
    }
    const dataRows = lines.length - headerLine - 1;
    expect(dataRows).toBe(run.series.data.t.length);
    // First data row must be exactly the stored first sample.
    const firstData = lines[headerLine + 1].split(",").map(Number);
    expect(firstData[0]).toBe(run.series.data.t[0]);
    console.log(`[EXPORT] CSV: ${dataRows} rows, ${header.length} columns, ${csv.length} bytes`);
  });

  it("produces a manifest whose artifact hashes match the artifact bytes", async () => {
    const run = await makeRun();
    const artifacts = await buildArtifacts(run);
    expect(artifacts).toHaveLength(5);
    for (const a of artifacts) {
      expect(await sha256Hex(a.content)).toBe(a.sha256);
      expect(a.bytes).toBe(new TextEncoder().encode(a.content).length);
    }
    const manifest = JSON.parse(artifacts[4].content);
    expect(manifest.payload.hash).toBe(run.payloadHash);
    expect(manifest.artifacts).toHaveLength(4);
    console.log(
      `[EXPORT] artifacts: ${artifacts.map((a) => `${a.name}(${a.bytes}B)`).join(", ")}`,
    );
  });

  it("includes computed values and provenance in the technical report", async () => {
    const run = await makeRun();
    const report = technicalReport(run);
    expect(report).toContain(run.runId);
    expect(report).toContain(run.payloadHash!.slice(0, 16));
    expect(report).toContain("RESEARCH PROTOTYPE");
    expect(report).toContain("Reproducing this run");
    expect(report).toContain("ε_E");
    console.log(`[EXPORT] report: ${report.length} chars`);
  });
});

describe("import validation", () => {
  it("accepts a genuine export and re-verifies its hash", async () => {
    const run = await makeRun();
    const res = await parseImportedRun(runToJson(run));
    if (!res.ok) console.log(`[IMPORT] errors=${res.errors.join(" || ")} warnings=${res.warnings.join(" || ")}`);
    expect(res.ok).toBe(true);
    expect(res.hash.status).toBe("PASS");
    expect(res.record?.runId).toBe(run.runId);
  });

  it("rejects an unsupported schema version", async () => {
    const run = await makeRun();
    const doc = JSON.parse(runToJson(run));
    doc.schemaVersion = "otl-run-v0";
    const res = await parseImportedRun(JSON.stringify(doc));
    expect(res.ok).toBe(false);
    expect(res.errors.join(" ")).toMatch(/schema version/i);
  });

  it("rejects a parameter stored with the wrong quantity's unit", async () => {
    const run = await makeRun();
    const doc = JSON.parse(runToJson(run));
    doc.parameters = doc.parameters.map((p: { paramId: string; enteredUnit: string }) =>
      p.paramId === "initialPositionX" ? { ...p, enteredUnit: "kg" } : p,
    );
    const res = await parseImportedRun(JSON.stringify(doc));
    expect(res.ok).toBe(false);
    expect(res.errors.join(" ")).toMatch(/unit/i);
  });

  it("rejects a payload whose hash does not match", async () => {
    const run = await makeRun();
    const doc = JSON.parse(runToJson(run));
    doc.metrics[0].value = 1;
    const res = await parseImportedRun(JSON.stringify(doc));
    expect(res.ok).toBe(false);
    expect(res.errors.join(" ")).toMatch(/PAYLOAD_HASH_MISMATCH/);
  });

  it("rejects a series with inconsistent column lengths", async () => {
    const run = await makeRun();
    const doc = JSON.parse(runToJson(run));
    doc.series.data.x = doc.series.data.x.slice(0, -1);
    const res = await parseImportedRun(JSON.stringify(doc));
    expect(res.ok).toBe(false);
    expect(res.errors.join(" ")).toMatch(/inconsistent length/i);
  });

  it("rejects malformed JSON", async () => {
    const res = await parseImportedRun("{not json");
    expect(res.ok).toBe(false);
    expect(res.hash.status).toBe("BLOCKED");
  });
});

describe("reproduction", () => {
  it("re-executes a stored run and matches series, metrics and verification", async () => {
    const run = await makeRun();
    const result = await reproduceStoredRun(run);
    for (const s of result.steps) console.log(`        ${s.name}: ${s.outcome} — ${s.detail}`);
    console.log(
      `[REPRO] status=${result.status} maxDiff=${result.maxNormalisedSeriesDifference?.toExponential(3)} tolerance=${result.tolerance.toExponential(1)} metrics=${result.metricDifferences.length}`,
    );
    console.log(`        reasons: ${result.reasons.join(" || ")}`);
    expect(result.status).toBe("PASS");
    expect(result.maxNormalisedSeriesDifference).not.toBeNull();
    expect(result.maxNormalisedSeriesDifference!).toBeLessThanOrEqual(result.tolerance);
  }, 30000);

  it("fails reproduction when the stored results were altered (with a valid self-hash)", async () => {
    const run = await makeRun();
    const altered: RunRecord = JSON.parse(JSON.stringify(run));
    altered.series.data.y = altered.series.data.y.map((v, i) => (i === 3 ? v + 1000 : v));
    altered.payloadHash = await computePayloadHash(altered); // valid hash over altered data
    const result = await reproduceStoredRun(altered);
    console.log(`[REPRO] altered-data status=${result.status} maxDiff=${result.maxNormalisedSeriesDifference?.toExponential(3)}`);
    expect(result.status).toBe("FAIL");
    expect(result.maxNormalisedSeriesDifference!).toBeGreaterThan(result.tolerance);
  }, 30000);

  it("reports BLOCKED rather than comparing across model versions", async () => {
    const run = await makeRun();
    const altered: RunRecord = JSON.parse(JSON.stringify(run));
    altered.model = { ...altered.model, version: "0.0.0-not-implemented" };
    altered.payloadHash = await computePayloadHash(altered);
    const result = await reproduceStoredRun(altered);
    expect(result.status).toBe("BLOCKED");
    expect(result.reasons.join(" ")).toMatch(/version differs/i);
  }, 30000);
});

describe("comparison", () => {
  it("reports identical runs as numerically equal but not identical records", async () => {
    const a = await makeRun({}, "comparison A");
    const b = await makeRun({}, "comparison A");
    const cmp = compareRuns([a, b]);
    expect(cmp.modelsComparable).toBe(true);
    expect(cmp.runIds).toHaveLength(2);
    expect(cmp.seriesDifferences[0].maxNormalisedDifference).toBe(0);
    console.log(
      `[COMPARE] identical configs: maxNormalisedDifference=${cmp.seriesDifferences[0].maxNormalisedDifference}, warnings=${cmp.warnings.length}`,
    );
    expect(a.runId).not.toBe(b.runId);
  }, 30000);

  it("flags differing inputs and quantifies the trajectory difference", async () => {
    const a = await makeRun();
    const b = await makeRun({ durationHours: 0.25 });
    const cmp = compareRuns([a, b]);
    const durationRow = cmp.inputRows.find((r) => r.field.includes("duration"));
    expect(durationRow?.cells.some((c) => c.differs)).toBe(true);
    console.log(
      `[COMPARE] duration difference flagged=${durationRow?.cells.some((c) => c.differs)}; series diff=${cmp.seriesDifferences[0].maxNormalisedDifference?.toExponential(3)} (${cmp.seriesDifferences[0].note})`,
    );
    expect(cmp.comparabilityStatement).toMatch(/OTL-2BP/);
  }, 30000);

  it("refuses to compare trajectories across different model versions", async () => {
    const a = await makeRun();
    const b: RunRecord = JSON.parse(JSON.stringify(a));
    b.runId = "OTL-FAKE-0001";
    b.model = { ...b.model, version: "9.9.9" };
    const cmp = compareRuns([a, b]);
    expect(cmp.modelsComparable).toBe(false);
    expect(cmp.warnings.join(" ")).toMatch(/not treated as equivalent/i);
    expect(cmp.seriesDifferences).toHaveLength(0);
  });
});
