/**
 * Render smoke test: every section must render without throwing, using the same
 * components the browser uses. This is a rendering check only; it does not exercise
 * browser storage or interaction.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ErrorInfo } from "react";
import App from "../App";
import { MU_EARTH, R_EARTH } from "../core/constants";
import type { ParameterInput } from "../core/validation";
import { executeExperiment } from "../engine/execute";
import { Dashboard } from "../ui/Dashboard";
import { Laboratory } from "../ui/Laboratory";
import { Registry } from "../ui/Registry";
import { VerificationCenter } from "../ui/VerificationCenter";
import { Evidence } from "../ui/Evidence";
import { Compare } from "../ui/Compare";
import { About } from "../ui/About";
import { Reconstruction } from "../ui/Reconstruction";
import { RunDetail } from "../ui/RunDetail";
import { ErrorBoundary } from "../ui/ErrorBoundary";
import { clearDiagnostics, diagnosticsSnapshot } from "../ui/diagnostics";
import { Landing } from "../ui/Landing";
import { IMPLEMENTED_MODEL_IDS, MODELS } from "../models/registry";
import { EVIDENCE_REGISTER } from "../evidence/register";
import { ALL_CHECKS } from "../verification/registry";

const noop = () => undefined;
const LEO_R = R_EARTH + 400e3;
const V_CIRC = Math.sqrt(MU_EARTH / LEO_R);

async function tetherRun() {
  const inputs: ParameterInput[] = [
    { paramId: "gravitationalParameter", value: MU_EARTH, unit: "m3s2" },
    { paramId: "initialPositionX", value: LEO_R / 1000, unit: "km" },
    { paramId: "initialPositionY", value: 0, unit: "km" },
    { paramId: "initialPositionZ", value: 0, unit: "km" },
    { paramId: "initialVelocityX", value: 0, unit: "kmps" },
    { paramId: "initialVelocityY", value: V_CIRC / 1000, unit: "kmps" },
    { paramId: "initialVelocityZ", value: 0, unit: "kmps" },
    { paramId: "satelliteMass", value: 500, unit: "kg" },
    { paramId: "orbiterMass", value: 2000, unit: "kg" },
    { paramId: "tetherLength", value: 20, unit: "km" },
    { paramId: "deploymentRate", value: 0, unit: "mps" },
    { paramId: "theta0", value: 5, unit: "deg" },
    { paramId: "thetaDot0", value: 0, unit: "degps" },
    { paramId: "duration", value: 1, unit: "h" },
    { paramId: "stepSeconds", value: 30, unit: "s" },
  ];
  const res = await executeExperiment({
    modelId: "OTL-TETH-1",
    method: "RK4",
    scenarioName: "tether smoke case",
    inputs,
    maxStoredSamples: 200,
  });
  if (!res.ok) throw new Error(res.issues.map((i) => i.message).join(" "));
  return res.record;
}

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
      [
        "laboratory",
        renderToStaticMarkup(
          <Laboratory
            runs={[]}
            selectedRunId={null}
            onSelectRun={noop}
            onRunCreated={noop}
            repro={null}
            onReproduced={noop}
          />,
        ),
      ],
      ["registry", renderToStaticMarkup(<Registry />)],
      [
        "verification",
        renderToStaticMarkup(<VerificationCenter runs={[]} selectedRunId={null} repro={null} onReproduced={noop} />),
      ],
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

describe("tether run detail presentation", () => {
  it("shows the tether's own quantities, its charts, and no two-body placeholders", async () => {
    const run = await tetherRun();
    const html = renderToStaticMarkup(<RunDetail run={run} />);

    // Headline quantities come from the tether model.
    expect(html).toContain("Final libration angle");
    expect(html).toContain("Final tether length");
    expect(html).toContain("Maximum quasi-static vertical tension");
    // The old two-body-only labels must not appear.
    expect(html).not.toContain("Osculating period");
    expect(html).not.toContain("open orbit");
    // Charts are drawn from resolved columns, so no empty-frame message appears.
    expect(html).not.toContain("No computed samples available");
    expect(html).toContain("reference orbit only");

    // Stored and computed samples are distinguished.
    expect(html).toContain("Stored samples");
    expect(html).toContain(`of ${run.series.decimation.originalSampleCount.toLocaleString("en-US")} computed`);

    // Model-level verification is labelled as such.
    expect(html).toContain("Model-level verification recorded with this run");
    expect(html).toContain("not measured from this run");
    console.log(`[UI] tether detail ${html.length} characters`);
  });

  it("labels the hash scope and shows the result-identity digest", async () => {
    const run = await tetherRun();
    const html = renderToStaticMarkup(<RunDetail run={run} />);
    expect(html).toContain("Hash scope");
    expect(html).toContain("otl-result-hash-v1");
    expect(html).toContain("Result-identity SHA-256");
    expect(html).not.toContain("Payload SHA-256</dt>");
  });
});

describe("landing page", () => {
  const html = renderToStaticMarkup(
    <Landing
      runCount={0}
      onEnterLaboratory={noop}
      onOpenVerification={noop}
      onOpenEvidence={noop}
      onOpenRegistry={noop}
      onOpenReconstruction={noop}
      onOpenAbout={noop}
    />,
  );

  it("keeps the research-prototype designation prominent rather than in the footer alone", () => {
    const occurrences = (html.match(/RESEARCH PROTOTYPE — NOT FLIGHT SOFTWARE/g) ?? []).length;
    expect(occurrences).toBeGreaterThanOrEqual(2);
    console.log(`[UI] landing disclaimer occurrences: ${occurrences}`);
  });

  it("derives every displayed figure from the registries instead of hard-coding it", () => {
    const implemented = MODELS.filter((m) => IMPLEMENTED_MODEL_IDS.includes(m.id)).length;
    expect(html).toContain(`${implemented} of ${MODELS.length}`);
    expect(html).toContain(String(EVIDENCE_REGISTER.length));
    expect(html).toContain(String(ALL_CHECKS.length));
    // Both executable models and at least one declared-but-unavailable model are shown.
    expect(html).toContain("OTL-2BP");
    expect(html).toContain("OTL-TETH-1");
    expect(html).toContain("NOT_MODELED");
    expect(html).toContain("BLOCKED");
  });

  it("offers entry to the existing laboratory and states what is not established", () => {
    expect(html).toContain("Enter the laboratory");
    expect(html).toContain("Review the verification record");
    expect(html).toContain("reported as not computed");
    expect(html).not.toMatch(/validated against flight data/i);
    console.log(`[UI] landing: ${html.length} characters`);
  });

  it("adds no account, credential or external-service surface", () => {
    expect(html).not.toContain("<form");
    expect(html).not.toContain("Create account");
    expect(html).not.toContain("Log in");
    expect(html).not.toContain("Sign in");
    expect(html).not.toContain("fetch(");
  });
});

describe("error boundary diagnostics", () => {
  it("records a section-level diagnostic without touching stored results", () => {
    clearDiagnostics();
    const error = new Error("simulated render failure");
    const state = ErrorBoundary.getDerivedStateFromError(error);
    expect(state.error).toBe(error);

    const boundary = new ErrorBoundary({ view: "laboratory", children: null });
    boundary.componentDidCatch(error, { componentStack: "\n  at Laboratory" } as ErrorInfo);

    const entries = diagnosticsSnapshot();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ view: "laboratory", kind: "render", message: "simulated render failure" });
    expect(entries[0].stack).toContain("simulated render failure");
  });
});
