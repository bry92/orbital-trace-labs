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

/**
 * The GTO preset used to advertise a 400 km perigee while its elements produced
 * 187 km. This derives periapsis and apoapsis from the preset's own initial state with
 * the vis-viva and eccentricity relations — not from the model's element solution and
 * not from numbers copied out of the interface — then checks three separate things:
 * the elements are internally consistent, the model reports the same radii, and the
 * prose agrees with the arithmetic.
 */
describe("documented altitudes agree with the preset's own elements", () => {
  const GTO = TWO_BODY_PRESETS.find((p) => p.id === "gto-eccentric");

  function deriveOrbit(preset: NonNullable<typeof GTO>) {
    const r = [
      preset.values.initialPositionX.value * 1000,
      preset.values.initialPositionY.value * 1000,
      preset.values.initialPositionZ.value * 1000,
    ];
    const v = [
      preset.values.initialVelocityX.value * 1000,
      preset.values.initialVelocityY.value * 1000,
      preset.values.initialVelocityZ.value * 1000,
    ];
    const rMag = Math.hypot(r[0], r[1], r[2]);
    const vMag = Math.hypot(v[0], v[1], v[2]);
    const energy = (vMag * vMag) / 2 - MU_EARTH / rMag;
    const hx = r[1] * v[2] - r[2] * v[1];
    const hy = r[2] * v[0] - r[0] * v[2];
    const hz = r[0] * v[1] - r[1] * v[0];
    const h = Math.hypot(hx, hy, hz);
    const e = Math.sqrt(Math.max(0, 1 + (2 * energy * h * h) / (MU_EARTH * MU_EARTH)));
    const a = -MU_EARTH / (2 * energy);
    return { a, e, rp: a * (1 - e), ra: a * (1 + e) };
  }

  function stated(text: string, pattern: RegExp): number {
    const match = text.match(pattern);
    if (!match) throw new Error(`Description does not state the expected quantity: ${pattern}`);
    return Number(match[1].replace(/[\s,]/g, ""));
  }

  it("has elements that match the model's reported periapsis and apoapsis", () => {
    expect(GTO).toBeDefined();
    const derived = deriveOrbit(GTO!);
    expect(derived.e).toBeCloseTo(0.7306, 3);
    expect(derived.a / 1000).toBeCloseTo(24371, 0);

    const applicable = new Set(twoBodyParameterSpecs(GTO!.method).map((s) => s.id));
    const inputs: ParameterInput[] = Object.entries(GTO!.values)
      .filter(([paramId]) => applicable.has(paramId))
      .map(([paramId, v]) => ({ paramId, value: v.value, unit: v.unit }));
    const v = validateTwoBodyInputs(inputs, GTO!.method);
    const res = calculateTwoBody(v.si, GTO!.method);
    const periapsis = res.metrics.find((m) => m.id === "periapsis")?.value ?? NaN;
    const apoapsis = res.metrics.find((m) => m.id === "apoapsis")?.value ?? NaN;
    expect(Math.abs(periapsis - derived.rp)).toBeLessThan(1);
    expect(Math.abs(apoapsis - derived.ra)).toBeLessThan(1);
  });

  it("documents the altitudes those radii actually produce", () => {
    const derived = deriveOrbit(GTO!);
    const perigeeAltKm = (derived.rp - R_EARTH) / 1000;
    const apogeeKm = derived.ra / 1000;
    expect(perigeeAltKm).toBeGreaterThan(100);
    expect(perigeeAltKm).toBeLessThan(300);

    const statedPerigee = stated(GTO!.description, /Perigee[^0-9]*([\d\s.,]+)\s*km altitude/);
    const statedApoapsisRadius = stated(GTO!.description, /geostationary radius\s*\(([\d\s.,]+)\s*km\)/);
    console.log(
      `[PRESET] gto-eccentric: derived perigee ${perigeeAltKm.toFixed(2)} km, apogee radius ${apogeeKm.toFixed(1)} km;` +
        ` documented ${statedPerigee} km / ${statedApoapsisRadius} km`,
    );
    expect(Math.abs(statedPerigee - perigeeAltKm)).toBeLessThanOrEqual(1);
    expect(Math.abs(statedApoapsisRadius - apogeeKm)).toBeLessThanOrEqual(1);
  });

  it("does not advertise a 400 km perigee, which these elements do not produce", () => {
    expect(GTO!.description).not.toMatch(/400\s*km/);
  });
});
