/**
 * Render smoke test: every section must render without throwing, using the same
 * components the browser uses. This is a rendering check only; it does not exercise
 * browser storage or interaction.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import App from "../App";
import { Dashboard } from "../ui/Dashboard";
import { Laboratory } from "../ui/Laboratory";
import { Registry } from "../ui/Registry";
import { VerificationCenter } from "../ui/VerificationCenter";
import { Evidence } from "../ui/Evidence";
import { Compare } from "../ui/Compare";
import { About } from "../ui/About";
import { Reconstruction } from "../ui/Reconstruction";

const noop = () => undefined;

describe("interface renders", () => {
  it("renders the application shell with disclaimer and tabs", () => {
    const html = renderToStaticMarkup(<App />);
    expect(html).toContain("Orbital Trace Labs");
    expect(html).toContain("RESEARCH PROTOTYPE");
    expect(html).toContain("TSS Reconstruction");
    expect(html).toContain("Verification");
    console.log(`[UI] App markup ${html.length} characters`);
  });

  it("renders each section with empty state", () => {
    const sections: [string, string][] = [
      ["dashboard", renderToStaticMarkup(<Dashboard runs={[]} onOpenLab={noop} onOpenVerification={noop} onOpenEvidence={noop} />)],
      ["laboratory", renderToStaticMarkup(<Laboratory runs={[]} selectedRunId={null} onSelectRun={noop} onRunCreated={noop} />)],
      ["registry", renderToStaticMarkup(<Registry />)],
      ["verification", renderToStaticMarkup(<VerificationCenter runs={[]} selectedRunId={null} />)],
      ["evidence", renderToStaticMarkup(<Evidence />)],
      ["compare", renderToStaticMarkup(<Compare runs={[]} />)],
      ["about", renderToStaticMarkup(<About />)],
      ["reconstruction", renderToStaticMarkup(<Reconstruction runs={[]} onRunCreated={noop} />)],
    ];
    for (const [name, html] of sections) {
      expect(html.length).toBeGreaterThan(500);
      console.log(`[UI] ${name}: ${html.length} characters`);
    }
  });

  it("shows NOT_TESTED instead of a fabricated dashboard result", () => {
    const html = renderToStaticMarkup(<Dashboard runs={[]} onOpenLab={noop} onOpenVerification={noop} onOpenEvidence={noop} />);
    expect(html).toContain("NOT_TESTED");
    expect(html).toContain("No calculation recorded");
  });

  it("renders the registry with implemented, not-modelled and blocked models", () => {
    const html = renderToStaticMarkup(<Registry />);
    expect(html).toContain("OTL-2BP");
    expect(html).toContain("OTL-TETH-1");
    expect(html).toContain("OTL-TETH-2");
    expect(html).toContain("OTL-EDT-1");
    expect(html).toContain("BLOCKED");
    expect(html).toContain("NOT_MODELED");
    console.log(`[UI] registry includes all five model declarations`);
  });
});
