/** Validation-layer tests: units, ranges, missing values, physics guards. */

import { describe, expect, it } from "vitest";
import { MU_EARTH, R_EARTH } from "../core/constants";
import { validateParameters, type ParameterInput } from "../core/validation";
import { twoBodyParameterSpecs, validateTwoBodyInputs } from "../models/twoBody";

const LEO_R = R_EARTH + 400e3;
const V_CIRC = Math.sqrt(MU_EARTH / LEO_R);

const base = (): ParameterInput[] => [
  { paramId: "gravitationalParameter", value: MU_EARTH, unit: "m3s2" },
  { paramId: "initialPositionX", value: LEO_R / 1000, unit: "km" },
  { paramId: "initialPositionY", value: 0, unit: "km" },
  { paramId: "initialPositionZ", value: 0, unit: "km" },
  { paramId: "initialVelocityX", value: 0, unit: "kmps" },
  { paramId: "initialVelocityY", value: V_CIRC / 1000, unit: "kmps" },
  { paramId: "initialVelocityZ", value: 0, unit: "kmps" },
  { paramId: "duration", value: 2, unit: "h" },
  { paramId: "stepSeconds", value: 10, unit: "s" },
];

describe("declarative parameter validation", () => {
  it("converts display units to SI exactly once", () => {
    const out = validateParameters(twoBodyParameterSpecs("RK4"), base());
    expect(out.ok).toBe(true);
    expect(out.si.initialPositionX).toBeCloseTo(LEO_R, 6);
    expect(out.si.initialVelocityY).toBeCloseTo(V_CIRC, 9);
    expect(out.si.duration).toBeCloseTo(7200, 9);
    const posEntry = out.accepted.find((a) => a.paramId === "initialPositionX");
    expect(posEntry?.enteredUnit).toBe("km");
    expect(posEntry?.siUnit).toBe("m");
  });

  it("rejects a missing required parameter without substituting a default", () => {
    const out = validateParameters(
      twoBodyParameterSpecs("RK4"),
      base().filter((p) => p.paramId !== "duration"),
    );
    expect(out.ok).toBe(false);
    expect(out.issues[0].code).toBe("MISSING_PARAMETER");
    expect(out.si.duration).toBeUndefined();
  });

  it("rejects an empty required value", () => {
    const out = validateParameters(
      twoBodyParameterSpecs("RK4"),
      base().map((p) => (p.paramId === "duration" ? { ...p, value: "" } : p)),
    );
    expect(out.ok).toBe(false);
    expect(out.issues[0].code).toBe("MISSING_PARAMETER");
  });

  it("rejects a unit of the wrong quantity", () => {
    const out = validateParameters(
      twoBodyParameterSpecs("RK4"),
      base().map((p) => (p.paramId === "initialPositionX" ? { ...p, unit: "kg" } : p)),
    );
    expect(out.ok).toBe(false);
    expect(out.issues[0].code).toBe("UNIT_MISMATCH");
  });

  it("rejects an unknown field rather than ignoring it", () => {
    const out = validateParameters(twoBodyParameterSpecs("RK4"), [
      ...base(),
      { paramId: "hiddenKnob", value: 1, unit: "none" },
    ]);
    expect(out.ok).toBe(false);
    expect(out.issues.some((i) => i.code === "UNKNOWN_PARAMETER")).toBe(true);
  });

  it("rejects duplicate parameters", () => {
    const out = validateParameters(twoBodyParameterSpecs("RK4"), [...base(), base()[0]]);
    expect(out.issues.some((i) => i.code === "DUPLICATE_PARAMETER")).toBe(true);
  });

  it("rejects a value outside the documented range with a reason", () => {
    const out = validateParameters(
      twoBodyParameterSpecs("RK4"),
      base().map((p) => (p.paramId === "duration" ? { ...p, value: -5 } : p)),
    );
    expect(out.ok).toBe(false);
    const issue = out.issues.find((i) => i.paramId === "duration");
    expect(issue?.code).toBe("OUT_OF_RANGE");
    expect(issue?.message).toMatch(/supported range/);
  });

  it("rejects non-numeric text", () => {
    const out = validateParameters(
      twoBodyParameterSpecs("RK4"),
      base().map((p) => (p.paramId === "duration" ? { ...p, value: "two hours" } : p)),
    );
    expect(out.issues[0].code).toBe("NOT_FINITE");
  });
});

describe("OTL-2BP physics guards", () => {
  it("accepts a valid circular state and reports no errors", () => {
    const v = validateTwoBodyInputs(base(), "RK4");
    expect(v.ok).toBe(true);
    expect(v.issues.filter((i) => i.severity === "error")).toHaveLength(0);
    console.log(`[VALID] accepted ${v.accepted.length} parameters, ${v.extraWarnings.length} warnings`);
  });

  it("rejects the singular zero-position state", () => {
    const v = validateTwoBodyInputs(
      base().map((p) => (p.paramId.startsWith("initialPosition") ? { ...p, value: 0 } : p)),
      "RK4",
    );
    expect(v.ok).toBe(false);
    expect(v.issues.some((i) => i.code === "SINGULAR_GEOMETRY")).toBe(true);
  });

  it("rejects the zero-velocity state that would break the h normalisation", () => {
    const v = validateTwoBodyInputs(
      base().map((p) => (p.paramId.startsWith("initialVelocity") ? { ...p, value: 0 } : p)),
      "RK4",
    );
    expect(v.ok).toBe(false);
    expect(v.issues.some((i) => i.code === "DEGENERATE_ANGULAR_MOMENTUM_NORMALIZATION")).toBe(true);
  });

  it("rejects a step budget that cannot be honoured", () => {
    // 5 h at a 0.01 s step needs 1.8e6 steps, above the 2e5 browser step budget.
    const v = validateTwoBodyInputs(
      base().map((p) => (p.paramId === "stepSeconds" ? { ...p, value: 0.01 } : p)),
      "RK4",
    );
    expect(v.ok).toBe(false);
    expect(v.issues.some((i) => i.code === "STEP_BUDGET_EXCEEDED")).toBe(true);
  });

  it("warns (does not fail) on an open orbit, and never reports a period", () => {
    const vEsc = Math.sqrt((2 * MU_EARTH) / LEO_R);
    const v = validateTwoBodyInputs(
      base().map((p) => (p.paramId === "initialVelocityY" ? { ...p, value: (1.2 * vEsc) / 1000 } : p)),
      "RK4",
    );
    expect(v.ok).toBe(true);
    expect(v.extraWarnings.some((w) => w.includes("open"))).toBe(true);
  });

  it("warns when the initial radius is below the Earth's surface", () => {
    const v = validateTwoBodyInputs(
      base().map((p) => (p.paramId === "initialPositionX" ? { ...p, value: 3000 } : p)),
      "RK4",
    );
    expect(v.ok).toBe(true);
    expect(v.extraWarnings.some((w) => w.includes("below the Earth equatorial radius"))).toBe(true);
  });

  it("warns when the step is coarse relative to the orbital period", () => {
    const v = validateTwoBodyInputs(
      base().map((p) => (p.paramId === "stepSeconds" ? { ...p, value: 400 } : p)),
      "RK4",
    );
    expect(v.ok).toBe(true);
    expect(v.extraWarnings.some((w) => w.includes("steps per orbital period"))).toBe(true);
  });

  it("requires DOPRI5 solver settings when that method is selected", () => {
    const v = validateTwoBodyInputs(base(), "DOPRI5");
    expect(v.ok).toBe(false);
    expect(v.issues.some((i) => i.code === "MISSING_PARAMETER")).toBe(true);
  });

  it("rejects an initial adaptive step larger than the maximum", () => {
    const dopriInputs: ParameterInput[] = [
      ...base().filter((p) => p.paramId !== "stepSeconds"),
      { paramId: "relTolerance", value: 1e-10, unit: "none" },
      { paramId: "absTolerance", value: 1e-10, unit: "none" },
      { paramId: "initialStepSeconds", value: 100, unit: "s" },
      { paramId: "maxStepSeconds", value: 10, unit: "s" },
    ];
    const v = validateTwoBodyInputs(dopriInputs, "DOPRI5");
    expect(v.ok).toBe(false);
    expect(v.issues.some((i) => i.code === "INVALID_SOLVER_SETTINGS")).toBe(true);
  });
});
