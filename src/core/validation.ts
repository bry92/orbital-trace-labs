/**
 * Declarative parameter specification and validation.
 *
 * Rules enforced here:
 *  - A required parameter that is missing or non-finite is an ERROR. No default is
 *    silently substituted, at any layer.
 *  - A value outside its documented range is an ERROR with a physical explanation.
 *  - A unit that does not match the parameter's quantity kind is an ERROR.
 *  - Physically meaningful but model-limited conditions are WARNINGS, and the run
 *    record carries them; they are never converted into a pass.
 */

import { UNITS, type QuantityKind } from "./units";

export type Severity = "error" | "warning";

export interface ValidationIssue {
  code: string;
  severity: Severity;
  paramId: string | null;
  message: string;
}

export interface ParameterSpec {
  id: string;
  label: string;
  quantity: QuantityKind;
  unit: string; // canonical display unit id for this parameter
  required: boolean;
  min?: number; // inclusive unless exclusiveMin
  max?: number;
  exclusiveMin?: boolean;
  description: string;
  /** Why the bound exists — shown to the user with range errors. */
  boundRationale?: string;
}

export interface ParameterInput {
  paramId: string;
  /** Value as entered by the researcher, in `unit`. */
  value: number | string | null;
  unit: string;
}

export interface ValidatedParameters {
  ok: boolean;
  issues: ValidationIssue[];
  /** SI values for every parameter that validated. Absent keys failed validation. */
  si: Record<string, number>;
  /** Echo of accepted inputs with both display and SI values, for provenance. */
  accepted: {
    paramId: string;
    label: string;
    enteredValue: number;
    /** Unit identifier (e.g. "kmps"), not the display symbol, so it can be re-validated. */
    enteredUnit: string;
    enteredUnitSymbol: string;
    siValue: number;
    siUnit: string;
  }[];
}

const SI_UNIT_FOR: Record<QuantityKind, string> = {
  length: "m",
  time: "s",
  mass: "kg",
  velocity: "mps",
  angle: "rad",
  angularRate: "radps",
  gravitationalParameter: "m3s2",
  force: "N",
  linearDensity: "kgpm",
  dimensionless: "none",
};

export function validateParameters(
  specs: readonly ParameterSpec[],
  inputs: readonly ParameterInput[],
): ValidatedParameters {
  const issues: ValidationIssue[] = [];
  const si: Record<string, number> = {};
  const accepted: ValidatedParameters["accepted"] = [];

  const seen = new Set<string>();
  for (const input of inputs) {
    if (seen.has(input.paramId)) {
      issues.push({
        code: "DUPLICATE_PARAMETER",
        severity: "error",
        paramId: input.paramId,
        message: `Parameter "${input.paramId}" was supplied more than once. Ambiguous inputs are rejected rather than merged.`,
      });
    }
    seen.add(input.paramId);
  }

  for (const spec of specs) {
    const input = inputs.find((i) => i.paramId === spec.id);
    if (!input) {
      if (spec.required) {
        issues.push({
          code: "MISSING_PARAMETER",
          severity: "error",
          paramId: spec.id,
          message: `Required parameter "${spec.label}" (${spec.id}) was not supplied. No default is substituted.`,
        });
      }
      continue;
    }
    if (input.value === null || input.value === "") {
      if (spec.required) {
        issues.push({
          code: "MISSING_PARAMETER",
          severity: "error",
          paramId: spec.id,
          message: `Required parameter "${spec.label}" (${spec.id}) is empty. No default is substituted.`,
        });
      }
      continue;
    }
    const numeric = typeof input.value === "number" ? input.value : Number(input.value);
    if (!Number.isFinite(numeric)) {
      issues.push({
        code: "NOT_FINITE",
        severity: "error",
        paramId: spec.id,
        message: `"${spec.label}" must be a finite number; received "${String(input.value)}".`,
      });
      continue;
    }

    const enteredUnit = input.unit;
    const unitDef = UNITS[enteredUnit];
    if (!unitDef) {
      issues.push({
        code: "UNKNOWN_UNIT",
        severity: "error",
        paramId: spec.id,
        message: `"${spec.label}" declares unknown unit "${enteredUnit}".`,
      });
      continue;
    }
    if (unitDef.quantity !== spec.quantity) {
      issues.push({
        code: "UNIT_MISMATCH",
        severity: "error",
        paramId: spec.id,
        message: `"${spec.label}" expects a ${spec.quantity} quantity (e.g. ${UNITS[spec.unit].symbol}) but unit "${unitDef.symbol}" is a ${unitDef.quantity} unit.`,
      });
      continue;
    }

    const siValue = numeric * unitDef.toSI;
    // Declared bounds are expressed in the parameter's canonical display unit and
    // converted to SI before comparison, so a bound is never compared across units.
    const boundToSI = UNITS[spec.unit].toSI;
    const minSI = spec.min === undefined ? undefined : spec.min * boundToSI;
    const maxSI = spec.max === undefined ? undefined : spec.max * boundToSI;

    if (minSI !== undefined) {
      const violates = spec.exclusiveMin ? siValue <= minSI : siValue < minSI;
      if (violates || !Number.isFinite(siValue)) {
        issues.push({
          code: "OUT_OF_RANGE",
          severity: "error",
          paramId: spec.id,
          message:
            `"${spec.label}" = ${numeric} ${unitDef.symbol} is outside the supported range ` +
            `(${spec.exclusiveMin ? ">" : ">="} ${spec.min} ${UNITS[spec.unit].symbol}). ` +
            (spec.boundRationale ?? ""),
        });
        continue;
      }
    }
    if (maxSI !== undefined && siValue > maxSI) {
      issues.push({
        code: "OUT_OF_RANGE",
        severity: "error",
        paramId: spec.id,
        message:
          `"${spec.label}" = ${numeric} ${unitDef.symbol} exceeds the supported maximum ` +
          `(${spec.max} ${UNITS[spec.unit].symbol}). ` +
          (spec.boundRationale ?? ""),
      });
      continue;
    }

    si[spec.id] = siValue;
    accepted.push({
      paramId: spec.id,
      label: spec.label,
      enteredValue: numeric,
      enteredUnit: enteredUnit,
      enteredUnitSymbol: unitDef.symbol,
      siValue,
      siUnit: UNITS[SI_UNIT_FOR[spec.quantity]].symbol,
    });
  }

  for (const input of inputs) {
    if (!specs.some((s) => s.id === input.paramId)) {
      issues.push({
        code: "UNKNOWN_PARAMETER",
        severity: "error",
        paramId: input.paramId,
        message: `Parameter "${input.paramId}" is not part of the selected model's input specification. Unknown fields are rejected so a typo cannot silently change a run.`,
      });
    }
  }

  return { ok: !issues.some((i) => i.severity === "error"), issues, si, accepted };
}
