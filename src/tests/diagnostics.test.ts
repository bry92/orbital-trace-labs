/**
 * Interface diagnostics log.
 *
 * It must be bounded, must hold no application data, and must be readable when a
 * transient exception has already been dismissed by the browser.
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  clearDiagnostics,
  diagnosticsAsText,
  diagnosticsSnapshot,
  recordDiagnostic,
} from "../ui/diagnostics";

beforeEach(() => clearDiagnostics());

describe("diagnostics log", () => {
  it("is bounded and drops the oldest entries first", () => {
    for (let i = 0; i < 25; i++) {
      recordDiagnostic({ view: "laboratory", kind: "render", message: `failure ${i}` });
    }
    const entries = diagnosticsSnapshot();
    expect(entries).toHaveLength(20);
    expect(entries[0].message).toBe("failure 5");
    expect(entries[entries.length - 1].message).toBe("failure 24");
  });

  it("stores only diagnostic fields, never run data", () => {
    recordDiagnostic({
      view: "compare",
      kind: "error",
      message: "Cannot read properties of undefined",
      stack: "TypeError: Cannot read properties of undefined\n  at Compare",
    });
    const [entry] = diagnosticsSnapshot();
    expect(Object.keys(entry).sort()).toEqual(["atUtc", "kind", "message", "stack", "view"]);
    expect(JSON.stringify(entry)).not.toContain("payloadHash");
    expect(JSON.stringify(entry)).not.toContain("parameters");
  });

  it("truncates long messages and stacks instead of growing without limit", () => {
    recordDiagnostic({ view: "window", kind: "error", message: "x".repeat(5000), stack: "y".repeat(20000) });
    const [entry] = diagnosticsSnapshot();
    expect(entry.message.length).toBeLessThan(2100);
    expect(entry.message).toContain("[truncated]");
    expect(entry.stack!.length).toBeLessThan(8100);
  });

  it("renders a readable report and says so when empty", () => {
    expect(diagnosticsAsText()).toMatch(/No interface exceptions/);
    recordDiagnostic({ view: "laboratory", kind: "render", message: "boom" });
    const text = diagnosticsAsText();
    expect(text).toContain("render in \"laboratory\": boom");
    expect(text).toMatch(/^\[\d{4}-\d{2}-\d{2}T/);
  });
});
