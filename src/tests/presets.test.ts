/** Inspects every documented scenario preset through the same path the UI uses. */

import { describe, expect, it } from "vitest";
import { MU_EARTH, R_EARTH } from "../core/constants";
import type { ParameterInput } from "../core/validation";
import { TWO_BODY_PRESETS, twoBodyParameterSpecs, validateTwoBodyInputs, calculateTwoBody } from "../models/twoBody";

describe("documented scenario presets", () => {
  for (const preset of TWO_BODY_PRESETS) {
    it(`${preset.id}: validates and produces a finite, closed orbit`, () => {
      // Presets carry values for both solver methods; only the parameters that the
      // selected method declares are submitted, exactly as the Laboratory does.
      const applicable = new Set(twoBodyParameterSpecs(preset.method).map((s) => s.id));
      const inputs: ParameterInput[] = Object.entries(preset.values)
        .filter(([paramId]) => applicable.has(paramId))
        .map(([paramId, v]) => ({ paramId, value: v.value, unit: v.unit }));
      const v = validateTwoBodyInputs(inputs, preset.method);
      expect(v.issues.filter((i) => i.severity === "error")).toEqual([]);
      const res = calculateTwoBody(v.si, preset.method);
      const radius = res.metrics.find((m) => m.id === "finalRadius")?.value ?? NaN;
      const period = res.metrics.find((m) => m.id === "period")?.value ?? null;
      const ecc = res.metrics.find((m) => m.id === "eccentricity")?.value ?? NaN;
      const inc = res.metrics.find((m) => m.id === "inclination")?.value ?? NaN;
      console.log(
        `[PRESET] ${preset.id}: r0=${(v.si.initialPositionX / 1e3).toFixed(1)} km, e=${ecc.toFixed(4)}, i=${inc.toFixed(2)}°, T=${period ? (period / 3600).toFixed(3) + " h" : "null"}, final r=${(radius / 1e3).toFixed(1)} km, steps=${res.metrics.find((m) => m.id === "steps")?.value}, ε_E=${res.metrics.find((m) => m.id === "epsEnergy")?.value?.toExponential(2)}`,
      );
      expect(Number.isFinite(radius)).toBe(true);
      expect(period).not.toBeNull();
      expect(period!).toBeGreaterThan(0);
      expect(radius).toBeGreaterThan(R_EARTH);
      expect(v.extraWarnings.join(" ")).not.toContain("below the Earth");
    });
  }

  it("all presets use Earth's gravitational parameter", () => {
    for (const p of TWO_BODY_PRESETS) {
      expect(p.values.gravitationalParameter.value).toBe(MU_EARTH);
    }
  });
});
