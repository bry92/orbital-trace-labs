/**
 * Run presentation mapping.
 *
 * The defects these cover: the summary header and the invariant charts read fixed
 * two-body metric and series keys, so a tether run showed empty cells, an "open orbit"
 * label for a quantity the model never defined, and charts that said "no computed
 * samples" although samples existed under different column names.
 */

import { describe, expect, it } from "vitest";
import { MU_EARTH, R_EARTH } from "../core/constants";
import type { ParameterInput } from "../core/validation";
import type { RunRecord } from "../core/run";
import { sampleOrdinal } from "../core/run";
import { executeExperiment } from "../engine/execute";
import { headlineMetrics, planCharts, sampleCounts } from "../ui/runPresentation";

const LEO_R = R_EARTH + 400e3;
const V_CIRC = Math.sqrt(MU_EARTH / LEO_R);

async function twoBodyRun(maxStoredSamples?: number): Promise<RunRecord> {
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
    scenarioName: "presentation case",
    inputs,
    maxStoredSamples,
  });
  if (!res.ok) throw new Error(res.issues.map((i) => i.message).join(" "));
  return res.record;
}

async function tetherRun(maxStoredSamples?: number): Promise<RunRecord> {
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
    { paramId: "duration", value: 1, unit: "h" },
    { paramId: "stepSeconds", value: 5, unit: "s" },
  ];
  const res = await executeExperiment({
    modelId: "OTL-TETH-1",
    method: "RK4",
    scenarioName: "tether presentation case",
    inputs,
    maxStoredSamples,
  });
  if (!res.ok) throw new Error(res.issues.map((i) => i.message).join(" "));
  return res.record;
}

describe("headline metrics", () => {
  it("resolves every tether headline from the tether model's own metrics", async () => {
    const run = await tetherRun();
    const headline = headlineMetrics(run);
    expect(headline.map((h) => h.id)).toEqual([
      "thetaFinal",
      "tetherLengthFinal",
      "tensionMax",
      "maxAbsTheta",
      "orbitPeriod",
    ]);
    for (const h of headline) {
      expect(h.notReportedByModel).toBe(false);
      expect(h.value).not.toBeNull();
      expect(h.unit.length).toBeGreaterThan(0);
    }
    // The two-body osculating period is not a tether quantity, so it must not appear.
    expect(headline.some((h) => h.id === "period")).toBe(false);
    console.log(
      `[PRESENTATION] tether headline: ${headline.map((h) => `${h.id}=${h.value?.toPrecision(4)} ${h.unit}`).join(", ")}`,
    );
  });

  it("resolves every two-body headline, including a null period with its own note", async () => {
    const run = await twoBodyRun();
    const headline = headlineMetrics(run);
    expect(headline.map((h) => h.id)).toEqual([
      "finalRadius",
      "finalSpeed",
      "epsEnergy",
      "epsAngularMomentum",
      "period",
    ]);
    for (const h of headline) expect(h.notReportedByModel).toBe(false);
    if (headline[4].value === null) {
      expect(headline[4].note).toMatch(/open orbit/i);
    }
  });

  it("falls back to the run's own metrics for an unmapped model, without inventing values", async () => {
    const run = await twoBodyRun();
    const foreign: RunRecord = { ...run, model: { ...run.model, id: "OTL-UNKNOWN-X" } };
    const headline = headlineMetrics(foreign);
    expect(headline.length).toBeGreaterThan(0);
    for (const h of headline) {
      expect(h.notReportedByModel).toBe(false);
      expect(run.metrics.some((m) => m.id === h.id)).toBe(true);
    }
  });
});

describe("chart plans", () => {
  it("maps tether invariants to the columns the tether model emits", async () => {
    const run = await tetherRun();
    const charts = planCharts(run);
    expect(charts.map((c) => c.id)).toEqual(["radius", "speed", "invariants", "energy"]);
    for (const c of charts) {
      expect(c.available).toBe(true);
      expect(c.unavailableReason).toBeNull();
      expect(c.x.length).toBeGreaterThan(1);
      expect(c.series.every((s) => s.values.length === c.x.length)).toBe(true);
    }
    const invariants = charts.find((c) => c.id === "invariants")!;
    expect(invariants.logY).toBe(true);
    expect(invariants.series.map((s) => s.label)).toEqual([
      "ε_E (reference orbit only)",
      "ε_h (reference orbit only)",
    ]);
    expect(invariants.caption).toMatch(/not closed/i);
  });

  it("keeps the two-body invariant and energy charts", async () => {
    const run = await twoBodyRun();
    const charts = planCharts(run);
    expect(charts.every((c) => c.available)).toBe(true);
    expect(charts.find((c) => c.id === "invariants")!.series.map((s) => s.label)).toEqual([
      "ε_E energy",
      "ε_h angular momentum",
    ]);
    expect(charts.find((c) => c.id === "energy")!.series[0].label).toContain("specific energy");
  });

  it("reports why a chart is unavailable instead of drawing an empty frame", async () => {
    const run = await twoBodyRun();
    const stripped: RunRecord = JSON.parse(JSON.stringify(run));
    delete stripped.series.data.epsEnergy;
    const charts = planCharts(stripped);
    const invariants = charts.find((c) => c.id === "invariants")!;
    expect(invariants.available).toBe(false);
    expect(invariants.unavailableReason).toContain('"epsEnergy"');
    expect(invariants.unavailableReason).toContain("Columns present:");
    expect(invariants.series).toEqual([]);
  });
});

describe("sample counts", () => {
  it("separates stored from computed samples and exposes decimation", async () => {
    const run = await tetherRun(100);
    const counts = sampleCounts(run);
    expect(counts.computed).toBeGreaterThan(counts.stored);
    expect(counts.stored).toBeLessThanOrEqual(101);

    // The `samples` metric is the COMPUTED count; that is why the summary must not use
    // it as the stored count.
    const metric = run.metrics.find((m) => m.id === "samples")!;
    expect(metric.value).toBe(counts.computed);
    expect(run.series.decimation.recordedEvery).toBeGreaterThan(1);
    console.log(`[PRESENTATION] stored ${counts.stored} of ${counts.computed} computed (stride ${run.series.decimation.recordedEvery})`);
  });
});

describe("ordinal wording", () => {
  it("formats counts as ordinals rather than appending th to every number", () => {
    expect(sampleOrdinal(1)).toBe("1st");
    expect(sampleOrdinal(2)).toBe("2nd");
    expect(sampleOrdinal(3)).toBe("3rd");
    expect(sampleOrdinal(4)).toBe("4th");
    expect(sampleOrdinal(11)).toBe("11th");
    expect(sampleOrdinal(12)).toBe("12th");
    expect(sampleOrdinal(13)).toBe("13th");
    expect(sampleOrdinal(21)).toBe("21st");
    expect(sampleOrdinal(22)).toBe("22nd");
    expect(sampleOrdinal(101)).toBe("101st");
    expect(sampleOrdinal(112)).toBe("112th");
  });

  it("uses the ordinal in the recorded decimation rule", async () => {
    const run = await tetherRun(100);
    expect(run.series.decimation.rule).toMatch(/Every \d+(st|nd|rd|th) sample plus the final sample\./);
    expect(run.series.decimation.rule).not.toMatch(/2th|3th|1th/);
  });
});
