/** Shared scientific type definitions for models, runs and verification. */

import type { ParameterSpec } from "../core/validation";

export type ModelStatus = "IMPLEMENTED" | "PARTIAL" | "NOT_MODELED" | "BLOCKED";
export type EffectStatus = "MODELED" | "APPROXIMATE" | "NOT_MODELED";

export interface EquationRecord {
  id: string;
  statement: string;
  /** true only when the equation is actually evaluated by shipped code. */
  implementedInCode: boolean;
  note?: string;
}

export interface EffectDeclaration {
  effect: string;
  status: EffectStatus;
  note?: string;
}

export interface ReferenceRecord {
  label: string;
  url?: string;
  identifier?: string;
  note?: string;
}

export interface ModelSpec {
  id: string;
  version: string;
  name: string;
  family: string;
  status: ModelStatus;
  summary: string;
  statusRationale?: string;
  referenceFrame: string;
  coordinateConventions: string;
  unitConventions: string;
  initialConditionDefinition: string;
  massRepresentation: string;
  governingEquations: EquationRecord[];
  assumptions: string[];
  effects: EffectDeclaration[];
  numericalMethod: string;
  solverSettings: string[];
  validityLimits: string[];
  knownFailureModes: string[];
  verificationCheckIds: string[];
  /** Requirements that must be met before this model could be considered verifiable. */
  verificationRequirements?: string[];
  parameterSpecs: ParameterSpec[];
  limitations: string[];
  references: ReferenceRecord[];
  /** Explains which parts of the model are deliberately out of scope. */
  outOfScope: string[];
}

export interface SeriesColumn {
  key: string;
  label: string;
  unit: string;
}

export interface MetricRecord {
  id: string;
  label: string;
  value: number | null;
  unit: string;
  note?: string;
}

export interface SolverDescriptor {
  method: string;
  description: string;
  settings: Record<string, number | string>;
}

export interface CalculationResult {
  modelId: string;
  modelVersion: string;
  columns: SeriesColumn[];
  series: Record<string, number[]>;
  metrics: MetricRecord[];
  solver: SolverDescriptor;
  warnings: string[];
  limitations: string[];
  /** Set when a quantity is deliberately not reported, with the reason. */
  unresolved: { item: string; reason: string }[];
}

export type CheckOutcome = "PASS" | "FAIL" | "UNRESOLVED" | "NOT_TESTED" | "BLOCKED";

export interface VerificationCheckResult {
  checkId: string;
  title: string;
  modelId: string;
  criterion: string;
  expectedBehavior: string;
  measuredValue: number | string | null;
  measuredUnit: string;
  tolerance: string;
  toleranceJustification: string;
  method: string;
  outcome: CheckOutcome;
  evidence: string;
  limitations: string;
  durationMs?: number;
}

export interface VerificationCheckDefinition {
  checkId: string;
  title: string;
  modelId: string;
  criterion: string;
  expectedBehavior: string;
  measuredUnit: string;
  tolerance: string;
  toleranceJustification: string;
  method: string;
  limitations: string;
  run: () => { measuredValue: number | string | null; outcome: CheckOutcome; evidence: string };
}
