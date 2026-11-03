/**
 * Tests of the verification summary counts.
 *
 * The bug these cover: the Verification Center summarised only the model checks while
 * the page also displays platform checks, so a NOT_TESTED platform check was omitted
 * from the totals and the four cards did not reconcile with the rows on screen.
 */

import { describe, expect, it } from "vitest";
import { ALL_CHECKS, checkSummary, runAllChecks } from "../verification/registry";

describe("checkSummary", () => {
  it("returns zeroed counts for an empty list", () => {
    expect(checkSummary([])).toEqual({
      PASS: 0,
      FAIL: 0,
      UNRESOLVED: 0,
      NOT_TESTED: 0,
      BLOCKED: 0,
      INVALID: 0,
      TOTAL: 0,
    });
  });

  it("counts every recognised outcome and always totals the input length", () => {
    const rows = [
      { outcome: "PASS" },
      { outcome: "PASS" },
      { outcome: "FAIL" },
      { outcome: "UNRESOLVED" },
      { outcome: "NOT_TESTED" },
      { outcome: "BLOCKED" },
    ];
    const s = checkSummary(rows);
    expect(s).toMatchObject({ PASS: 2, FAIL: 1, UNRESOLVED: 1, NOT_TESTED: 1, BLOCKED: 1, INVALID: 0, TOTAL: 6 });
    expect(s.PASS + s.FAIL + s.UNRESOLVED + s.NOT_TESTED + s.BLOCKED + s.INVALID).toBe(s.TOTAL);
  });

  it("counts unrecognised outcomes as INVALID rather than dropping them", () => {
    const s = checkSummary([{ outcome: "PASS" }, { outcome: "SKIPPED" }]);
    expect(s.INVALID).toBe(1);
    expect(s.TOTAL).toBe(2);
    expect(s.PASS + s.FAIL + s.UNRESOLVED + s.NOT_TESTED + s.BLOCKED + s.INVALID).toBe(s.TOTAL);
  });

  it("works for platform checks, which carry a narrower outcome union", () => {
    const platform = [{ outcome: "PASS" }, { outcome: "PASS" }, { outcome: "NOT_TESTED" }];
    const s = checkSummary(platform);
    expect(s.NOT_TESTED).toBe(1);
    expect(s.TOTAL).toBe(3);
  });

  it("reconciles with the live model-check registry", () => {
    const results = runAllChecks();
    const s = checkSummary(results);
    expect(s.TOTAL).toBe(results.length);
    expect(s.TOTAL).toBe(ALL_CHECKS.length);
    expect(s.INVALID).toBe(0);
    expect(s.PASS + s.FAIL + s.UNRESOLVED + s.NOT_TESTED + s.BLOCKED).toBe(results.length);
    // Convergence checks are part of the counted set, so the summary cannot undercount
    // the evidence shown on the page.
    expect(results.some((r) => r.checkId === "OT-TT-010")).toBe(true);
    expect(results.some((r) => r.checkId === "OT-TT-012")).toBe(true);
  });
});
