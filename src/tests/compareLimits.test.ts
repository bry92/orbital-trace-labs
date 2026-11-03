/**
 * Comparison behaviour at the limits.
 *
 * The defects these cover:
 *  - two runs with equal decimation strides but different durations produced no
 *    comparability warning at all (only differing strides warned);
 *  - a tether comparison never listed final libration angle, final length or tension,
 *    because the metric id list was two-body only;
 *  - a partially comparable pair could report a single trajectory number computed from
 *    a subset of columns;
 *  - verification rows were presented as per-run evidence although they are model-level.
 */

import { describe, expect, it } from "vitest";
import { MU_EARTH, R_EARTH } from "../core/constants";
import type { ParameterInput } from "../core/validation";
import type { RunRecord } from "../core/run";
import { executeExperiment } from "../engine/execute";
import { compareRuns } from "../review/compare";

const LEO_R = R_EARTH + 400e3;
const V_CIRC = Math.sqrt(MU_EARTH / LEO_R);

async function tetherRun(durationHours: number): Promise<RunRecord> {
  const inputs: ParameterInput[] = [
    { paramId: "gravitationalParameter", value: MU_EARTH, unit: "m3s2" },
    { paramId: "initialPositionX", value: LEO_R / 1000, unit: "km" },
    { paramId: "initialPositionY", value: 0, unit: "km" },
    { paramId: "initialPositionZ", value: 0, unit: "km" },
    { paramId: "initialVelocityX", value: 0, unit: "kmps" },
    { paramId: "initialVelocityY", value: V_CIRC / 1000, unit: "kmps" },
    { paramId: "initialVelocityZ", value: 0, unit: "kmps" },
    { paramId: "satelliteMass", value: 500, unit: "kg" },
    { paramId: "orbiterMass", value: 2000, unit: "kg" },
    { paramId: "tetherLength", value: 20, unit: "km" },
    { paramId: "deploymentRate", value: 0, unit: "mps" },
    { paramId: "theta0", value: 5, unit: "deg" },
    { paramId: "thetaDot0", value: 0, unit: "degps" },
    { paramId: "duration", value: durationHours, unit: "h" },
    { paramId: "stepSeconds", value: 10, unit: "s" },
  ];
  const res = await executeExperiment({
    modelId: "OTL-TETH-1",
    method: "RK4",
    scenarioName: `tether ${durationHours} h`,
    inputs,
  });
  if (!res.ok) throw new Error(res.issues.map((i) => i.message).join(" "));
  return res.record;
}

async function twoBodyRun(): Promise<RunRecord> {
  const inputs: ParameterInput[] = [
    { paramId: "gravitationalParameter", value: MU_EARTH, unit: "m3s2" },
    { paramId: "initialPositionX", value: LEO_R / 1000, unit: "km" },
    { paramId: "initialPositionY", value: 0, unit: "km" },
    { paramId: "initialPositionZ", value: 0, unit: "km" },
    { paramId: "initialVelocityX", value: 0, unit: "kmps" },
    { paramId: "initialVelocityY", value: V_CIRC / 1000, unit: "kmps" },
    { paramId: "initialVelocityZ", value: 0, unit: "kmps" },
    { paramId: "duration", value: 1, unit: "h" },
    { paramId: "stepSeconds", value: 20, unit: "s" },
  ];
  const res = await executeExperiment({
    modelId: "OTL-2BP",
    method: "RK4",
    scenarioName: "two-body comparison",
    inputs,
  });
  if (!res.ok) throw new Error(res.issues.map((i) => i.message).join(" "));
  return res.record;
}

describe("unequal sample counts at equal decimation stride", () => {
  it("warns when durations and stored sample counts differ", async () => {
    const a = await tetherRun(1);
    const b = await tetherRun(2);
    expect(a.series.decimation.recordedEvery).toBe(b.series.decimation.recordedEvery);
    expect(a.series.decimation.recordedSampleCount).not.toBe(b.series.decimation.recordedSampleCount);

    const cmp = compareRuns([a, b]);
    const joined = cmp.warnings.join(" | ");
    expect(joined).toMatch(/Stored sample counts differ/);
    expect(joined).toMatch(/durations differ/i);
    console.log(`[COMPARE] warnings: ${cmp.warnings.length} — ${joined}`);

    const pair = cmp.seriesDifferences[0];
    expect(pair.maxNormalisedDifference).toBeNull();
    expect(pair.note).toMatch(/no pointwise trajectory difference/i);
    expect(pair.note).toMatch(/No interpolation/i);
  });
});

describe("tether metric rows", () => {
  it("includes final libration angle, final length, tension and reference-orbit quantities", async () => {
    const a = await tetherRun(1);
    const b = await tetherRun(1);
    const cmp = compareRuns([a, b]);
    const fields = cmp.metricRows.map((r) => r.field);
    for (const expected of ["Final libration angle", "Final tether length L(t)", "Maximum quasi-static vertical tension"]) {
      expect(fields.some((f) => f.includes(expected))).toBe(true);
    }
    expect(fields).toContain("Stored samples");
    expect(fields).toContain("Computed samples");
    // Two-body-only ids must not appear as empty rows for a tether pair.
    expect(fields.some((f) => f.includes("semi-major axis"))).toBe(false);
    console.log(`[COMPARE] tether rows: ${cmp.metricRows.length}`);
  });
});

describe("no partial trajectory numbers", () => {
  it("reports NOT COMPUTED when one shared column has different sample times", async () => {
    const a = await twoBodyRun();
    const b: RunRecord = JSON.parse(JSON.stringify(a));
    b.runId = "OTL-SYNTH-0001";
    // Same lengths everywhere, but the time grid is shifted, so only `t` is skipped
    // while the other columns would still "match" point by point.
    b.series.data.t = b.series.data.t.map((v) => v + 1);

    const cmp = compareRuns([a, b]);
    const pair = cmp.seriesDifferences[0];
    expect(pair.maxNormalisedDifference).toBeNull();
    expect(pair.columnsCompared).toBeGreaterThan(0);
    expect(pair.note).toMatch(/\[t\]/);
    expect(pair.note).toMatch(/No interpolation/);
    console.log(`[COMPARE] partial pair: compared=${pair.columnsCompared}, reported=${pair.maxNormalisedDifference}`);
  });

  it("still reports an exact zero for genuinely identical runs", async () => {
    const a = await twoBodyRun();
    const b: RunRecord = JSON.parse(JSON.stringify(a));
    b.runId = "OTL-SYNTH-0002";
    const cmp = compareRuns([a, b]);
    expect(cmp.seriesDifferences[0].maxNormalisedDifference).toBe(0);
    expect(cmp.seriesDifferences[0].note).toMatch(/Maximum per-column/);
  });
});

describe("verification rows are labelled model-level", () => {
  it("does not present an identical model-level outcome as per-run evidence", async () => {
    const a = await tetherRun(1);
    const b = await tetherRun(1);
    const cmp = compareRuns([a, b]);
    expect(cmp.verificationRows.length).toBeGreaterThan(0);
    for (const row of cmp.verificationRows) {
      expect(row.note).toMatch(/not measured from these runs/i);
    }
  });

  it("explains a differing outcome as a model-version difference", async () => {
    const a = await tetherRun(1);
    const b: RunRecord = JSON.parse(JSON.stringify(a));
    b.runId = "OTL-SYNTH-0003";
    b.verification = b.verification.map((c, i) => (i === 0 ? { ...c, outcome: "FAIL" as const } : c));
    const cmp = compareRuns([a, b]);
    const differing = cmp.verificationRows.find((r) => r.cells.some((c) => c.differs));
    expect(differing).toBeDefined();
    expect(differing!.note).toMatch(/model-level outcome differs/i);
  });
});
