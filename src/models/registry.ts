/**
 * Model registry. Only entries with status IMPLEMENTED are executable; the others
 * exist to record scope decisions and missing evidence explicitly.
 */

import type { ParameterSpec } from "../core/validation";
import type { ModelSpec } from "./types";
import { TWO_BODY_MODEL, TWO_BODY_MODEL_ID, twoBodyParameterSpecs, type TwoBodySolverMethod } from "./twoBody";
import { TETHER_MODEL, TETHER_MODEL_ID, TETHER_PARAMETER_SPECS } from "./tether";
import { EDT_MODEL, TETHER_COUPLED_MODEL, TETHER_DYNAMIC_DEPLOYMENT_MODEL } from "./notImplemented";

export const MODELS: ModelSpec[] = [
  TWO_BODY_MODEL,
  TETHER_MODEL,
  TETHER_DYNAMIC_DEPLOYMENT_MODEL,
  TETHER_COUPLED_MODEL,
  EDT_MODEL,
];

export const IMPLEMENTED_MODEL_IDS = MODELS.filter((m) => m.status === "IMPLEMENTED").map((m) => m.id);

export function getModel(id: string): ModelSpec | undefined {
  return MODELS.find((m) => m.id === id);
}

export function requireModel(id: string): ModelSpec {
  const model = getModel(id);
  if (!model) throw new Error(`Unknown model id: ${id}`);
  return model;
}

/** Parameter specification for a model, optionally specialised by solver method. */
export function parameterSpecsFor(modelId: string, method: TwoBodySolverMethod = "RK4"): ParameterSpec[] {
  if (modelId === TWO_BODY_MODEL_ID) return twoBodyParameterSpecs(method);
  if (modelId === TETHER_MODEL_ID) return TETHER_PARAMETER_SPECS;
  return [];
}
