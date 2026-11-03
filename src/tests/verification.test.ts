/**
 * Executes every registered verification check against the real engine.
 * A PASS here means the implementation met the stated numerical criterion on this
 * machine; it is not a claim of physical validation.
 */

import { describe, expect, it } from "vitest";
import { TWO_BODY_CHECKS } from "../verification/twoBodyChecks";

describe("OTL-2BP verification suite", () => {
  for (const check of TWO_BODY_CHECKS) {
    it(`${check.checkId} ${check.title}`, () => {
      const result = check.run();
      const measured =
        typeof result.measuredValue === "number" ? result.measuredValue.toExponential(6) : String(result.measuredValue);
      console.log(
        `[CHECK] ${check.checkId} outcome=${result.outcome} measured=${measured} (${check.measuredUnit}) tolerance=${check.tolerance}\n        evidence: ${result.evidence}`,
      );
      expect(result.outcome).toBe("PASS");
      expect(result.evidence.length).toBeGreaterThan(0);
      expect(check.toleranceJustification.length).toBeGreaterThan(20);
    });
  }

  it("runs every declared model check id", () => {
    const ids = TWO_BODY_CHECKS.map((c) => c.checkId);
    console.log(`[CHECK] registered check ids: ${ids.join(", ")}`);
    expect(ids).toEqual([
      "OT-TB-001",
      "OT-TB-002",
      "OT-TB-003",
      "OT-TB-004",
      "OT-TB-005",
      "OT-TB-006",
      "OT-TB-007",
      "OT-TB-008",
      "OT-TB-009",
    ]);
  });
});
