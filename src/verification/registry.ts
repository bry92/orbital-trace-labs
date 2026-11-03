/** Verification registry: every registered check, executed against the live engine. */

import type { VerificationCheckResult } from "../models/types";
import { TWO_BODY_CHECKS } from "./twoBodyChecks";
import { TETHER_CHECKS } from "./tetherChecks";

export const ALL_CHECKS = [...TWO_BODY_CHECKS, ...TETHER_CHECKS];

function execute(check: (typeof ALL_CHECKS)[number]): VerificationCheckResult {
  const start = globalThis.performance?.now?.() ?? Date.now();
  let measuredValue: number | string | null = null;
  let outcome: VerificationCheckResult["outcome"] = "FAIL";
  let evidence = "Check did not return a result.";
  try {
    const r = check.run();
    measuredValue = r.measuredValue;
    outcome = r.outcome;
    evidence = r.evidence;
  } catch (err) {
    outcome = "FAIL";
    evidence = `Check threw: ${err instanceof Error ? err.message : String(err)}`;
  }
  const end = globalThis.performance?.now?.() ?? Date.now();
  return {
    checkId: check.checkId,
    title: check.title,
    modelId: check.modelId,
    criterion: check.criterion,
    expectedBehavior: check.expectedBehavior,
    measuredValue,
    measuredUnit: check.measuredUnit,
    tolerance: check.tolerance,
    toleranceJustification: check.toleranceJustification,
    method: check.method,
    outcome,
    evidence,
    limitations: check.limitations,
    durationMs: Math.round((end - start) * 10) / 10,
  };
}

/** Run a specific model's checks (used when recording a run). */
export function resultsForModel(modelId: string): VerificationCheckResult[] {
  return ALL_CHECKS.filter((c) => c.modelId === modelId).map(execute);
}

/** Run every registered check (Verification Center). */
export function runAllChecks(): VerificationCheckResult[] {
  return ALL_CHECKS.map(execute);
}

/**
 * Count outcomes over any list of `{ outcome }` records.
 *
 * Works for model checks and platform checks alike, so a summary can cover every
 * check displayed on the page. `TOTAL` always equals the number of records supplied
 * and `INVALID` counts outcomes outside the five recognised states, so the printed
 * counts always reconcile with the number of rows.
 */
export interface OutcomeSummary {
  PASS: number;
  FAIL: number;
  UNRESOLVED: number;
  NOT_TESTED: number;
  BLOCKED: number;
  INVALID: number;
  TOTAL: number;
}

export function checkSummary(results: readonly { outcome: string }[]): OutcomeSummary {
  const summary: OutcomeSummary = {
    PASS: 0,
    FAIL: 0,
    UNRESOLVED: 0,
    NOT_TESTED: 0,
    BLOCKED: 0,
    INVALID: 0,
    TOTAL: 0,
  };
  for (const r of results) {
    summary.TOTAL += 1;
    switch (r.outcome) {
      case "PASS":
        summary.PASS += 1;
        break;
      case "FAIL":
        summary.FAIL += 1;
        break;
      case "UNRESOLVED":
        summary.UNRESOLVED += 1;
        break;
      case "NOT_TESTED":
        summary.NOT_TESTED += 1;
        break;
      case "BLOCKED":
        summary.BLOCKED += 1;
        break;
      default:
        summary.INVALID += 1;
    }
  }
  return summary;
}
