/**
 * Single execution path shared by the Simulation Laboratory, the historical
 * reconstruction workspace and the import/re-run check. Every path validates the
 * same way and produces the same run-record schema; no caller can bypass validation.
 */

import { buildRunRecord, type DataOrigin, type InputOrigin, type RunRecord, type RunParameter } from "../core/run";
import type { ParameterInput, ValidationIssue } from "../core/validation";
import { requireModel } from "../models/registry";
import { TWO_BODY_MODEL_ID, calculateTwoBody, validateTwoBodyInputs, type TwoBodySolverMethod } from "../models/twoBody";
import { TETHER_MODEL_ID, calculateTether, validateTetherInputs } from "../models/tether";
import type { CalculationResult, VerificationCheckResult } from "../models/types";
import { resultsForModel } from "../verification/registry";

export interface ExecuteRequest {
  modelId: string;
  /** Only meaningful for OTL-2BP; TETH-1 has a fixed RK4 solver. */
  method: TwoBodySolverMethod;
  scenarioName: string;
  inputs: ParameterInput[];
  inputOrigins?: Record<string, InputOrigin>;
  dataOrigin?: DataOrigin;
  evidenceFlags?: string[];
  createdAt?: Date;
  maxStoredSamples?: number;
}

export type ExecuteResult =
  | { ok: true; record: RunRecord; warnings: string[] }
  | { ok: false; issues: ValidationIssue[] };

type Accepted = ReturnType<typeof validateTwoBodyInputs>["accepted"];

export function initialConditionsFor(modelId: string, si: Record<string, number>): Record<string, number> {
  if (modelId === TWO_BODY_MODEL_ID) {
    return {
      positionXM: si.initialPositionX,
      positionYM: si.initialPositionY,
      positionZM: si.initialPositionZ,
      velocityXMS: si.initialVelocityX,
      velocityYMS: si.initialVelocityY,
      velocityZMS: si.initialVelocityZ,
      durationS: si.duration,
      muM3S2: si.gravitationalParameter,
    };
  }
  if (modelId === TETHER_MODEL_ID) {
    return {
      positionXM: si.initialPositionX,
      positionYM: si.initialPositionY,
      positionZM: si.initialPositionZ,
      velocityXMS: si.initialVelocityX,
      velocityYMS: si.initialVelocityY,
      velocityZMS: si.initialVelocityZ,
      durationS: si.duration,
      muM3S2: si.gravitationalParameter,
      satelliteMassKg: si.satelliteMass,
      counterweightMassKg: si.orbiterMass,
      tetherLengthM: si.tetherLength,
      deploymentRateMS: si.deploymentRate,
      theta0Rad: si.theta0,
      thetaDot0RadPerS: si.thetaDot0,
      fixedStepS: si.stepSeconds,
    };
  }
  throw new Error(`No initial-condition mapping defined for model ${modelId}`);
}

export async function executeExperiment(req: ExecuteRequest): Promise<ExecuteResult> {
  const model = requireModel(req.modelId);
  if (model.status !== "IMPLEMENTED") {
    return {
      ok: false,
      issues: [
        {
          code: "MODEL_NOT_IMPLEMENTED",
          severity: "error",
          paramId: null,
          message: `Model ${model.id} has status ${model.status}: ${model.statusRationale ?? "not executable in this build."}`,
        },
      ],
    };
  }

  let issues: ValidationIssue[];
  let si: Record<string, number>;
  let accepted: Accepted;
  let extraWarnings: string[] = [];
  let calculation: CalculationResult;

  if (req.modelId === TWO_BODY_MODEL_ID) {
    const v = validateTwoBodyInputs(req.inputs, req.method);
    issues = v.issues;
    si = v.si;
    accepted = v.accepted;
    extraWarnings = v.extraWarnings;
    if (!v.ok) return { ok: false, issues };
    calculation = calculateTwoBody(si, req.method);
  } else if (req.modelId === TETHER_MODEL_ID) {
    const v = validateTetherInputs(req.inputs);
    issues = v.issues;
    si = v.si;
    accepted = v.accepted;
    extraWarnings = v.extraWarnings;
    if (!v.ok) return { ok: false, issues };
    calculation = calculateTether(si);
  } else {
    return {
      ok: false,
      issues: [
        {
          code: "MODEL_NOT_EXECUTABLE",
          severity: "error",
          paramId: null,
          message: `No calculation path is registered for model ${req.modelId}.`,
        },
      ],
    };
  }

  const parameters: RunParameter[] = accepted.map((a) => ({
    ...a,
    origin: req.inputOrigins?.[a.paramId] ?? "USER_EDITED",
  }));

  const verification: VerificationCheckResult[] = resultsForModel(req.modelId);

  const record = await buildRunRecord({
    calculation,
    model,
    scenarioName: req.scenarioName,
    parameters,
    initialConditions: initialConditionsFor(req.modelId, si),
    verification,
    validationIssues: [
      ...issues,
      ...extraWarnings.map<ValidationIssue>((message) => ({
        code: "MODEL_WARNING",
        severity: "warning",
        paramId: null,
        message,
      })),
    ],
    evidenceFlags: req.evidenceFlags,
    dataOrigin: req.dataOrigin ?? "LIVE_CALCULATION",
    createdAt: req.createdAt,
    maxStoredSamples: req.maxStoredSamples,
  });

  return { ok: true, record, warnings: [...calculation.warnings, ...extraWarnings] };
}
