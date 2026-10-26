/**
 * Interactive browser check of the app in the local dev server (Playwright headless
 * Chromium). Environment tooling, not part of the application or its test suite.
 */
const { chromium } = require("playwright");
const crypto = require("node:crypto");
const fs = require("node:fs");

const URL = "http://127.0.0.1:3000/";
const OUT = "artifacts";

function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`)
      .join(",")}}`;
  }
  if (typeof v === "number") return JSON.stringify(Object.is(v, -0) ? 0 : v);
  return JSON.stringify(v);
}

/**
 * Independent reimplementation of the DECLARED hash scope, written from the
 * documentation only (not by importing app code). If this matches the file, an outside
 * reviewer can reproduce the digest from the stated field list.
 */
function declaredScopeDigest(artifact) {
  const s = artifact.study;
  const payload = {
    schemaVersion: artifact.schemaVersion,
    app: { name: artifact.app.name, version: artifact.app.version, releaseLabel: artifact.app.releaseLabel },
    study: {
      schemaVersion: s.schemaVersion,
      model: s.model,
      purpose: s.purpose,
      orderEstimator: s.orderEstimator,
      roundOffFloorRel: s.roundOffFloorRel,
      overallStatus: s.overallStatus,
      referenceErrorKind: s.referenceErrorKind,
      referenceErrorStatement: s.referenceErrorStatement,
      cases: s.cases,
      limitations: s.limitations,
    },
  };
  return crypto.createHash("sha256").update(canonical(payload), "utf8").digest("hex");
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, acceptDownloads: true });
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });
  page.on("pageerror", (e) => pageErrors.push(String(e)));

  await page.goto(URL, { waitUntil: "networkidle" });

  // ---------- Verification view ----------
  await page.getByRole("tab", { name: "Verification", exact: true }).click();
  const panel = page.locator("section.panel", { hasText: "Step-refinement convergence of the tether equations" });
  await panel.getByRole("heading", { level: 2 }).waitFor({ timeout: 30000 });
  await page.waitForTimeout(1200);

  console.log("=== convergence panel ===");
  console.log("badges:", await panel.locator(".badge").allInnerTexts());
  console.log("case headings:", (await panel.locator("h3").allInnerTexts()).map((s) => s.replace(/\s+/g, " ")));

  const metaText = await panel.innerText();
  const grab = (label) => {
    const i = metaText.indexOf(label);
    return i < 0 ? "n/a" : metaText.slice(i, i + 320).replace(/\s+/g, " ");
  };
  console.log("\nreference-error estimate block:", grab("EMPIRICAL REFERENCE-ERROR ESTIMATE"));
  console.log("\nreference-error status:", grab("REFERENCE-ERROR STATUS"));
  console.log("\nadequacy block:", grab("REFERENCE ADEQUACY (EXACT METRIC)"));
  console.log("\nindependent comparisons:", grab("INDEPENDENT REFERENCE COMPARISONS"));

  // Visual evidence captured before the deliberate failed imports below.
  await panel.screenshot({ path: `${OUT}/convergence-panel.png` });
  await page.screenshot({ path: `${OUT}/verification-view.png` });

  // ---------- Export twice; hash must be deterministic ----------
  async function exportArtifact(tag) {
    await panel.getByRole("button", { name: /Re-run study/ }).click();
    await page.waitForTimeout(2500);
    const [dl] = await Promise.all([
      page.waitForEvent("download"),
      panel.getByRole("button", { name: /Export hashed JSON/ }).click(),
    ]);
    const file = `${OUT}/${tag}-${dl.suggestedFilename()}`;
    await dl.saveAs(file);
    return { file, parsed: JSON.parse(fs.readFileSync(file, "utf8")) };
  }

  const first = await exportArtifact("export1");
  const second = await exportArtifact("export2");
  const d1 = declaredScopeDigest(first.parsed);
  const d2 = declaredScopeDigest(second.parsed);
  console.log("\n=== deterministic hash ===");
  console.log("first  export:", first.parsed.generatedAtUtc, "| study generated", first.parsed.study.generatedAtUtc, "| hash", first.parsed.payloadHash);
  console.log("second export:", second.parsed.generatedAtUtc, "| study generated", second.parsed.study.generatedAtUtc, "| hash", second.parsed.payloadHash);
  console.log("timestamps differ:", first.parsed.generatedAtUtc !== second.parsed.generatedAtUtc);
  console.log("OUT-OF-APP digest (declared scope) matches file:", d1 === first.parsed.payloadHash, "/", d2 === second.parsed.payloadHash);
  console.log("hashes equal across exports:", first.parsed.payloadHash === second.parsed.payloadHash);
  console.log("hashSpec excluded fields:", first.parsed.hashSpec.excludedFields.join(", "));

  // ---------- Import: valid, tampered, malformed, unsupported schema ----------
  async function importFile(label, file) {
    await panel.locator("#convergence-import").setInputFiles(file);
    await page.waitForTimeout(700);
    const text = await panel.innerText();
    const line = text
      .split("\n")
      .filter((l) =>
        /payload hash|MALFORMED_JSON|UNSUPPORTED_SCHEMA|UNSUPPORTED_REFERENCE_CLAIM|INVALID_STRUCTURE|modified after export|matches the file|Imported/i.test(l),
      )
      .slice(0, 4);
    const badges = await panel.locator(".badge").allInnerTexts();
    console.log(`${label}: badges=${JSON.stringify(badges)} ::`, line.length ? line.join(" / ").replace(/\s+/g, " ").slice(0, 320) : "no feedback");
  }

  console.log("\n=== import validation (real file input) ===");
  await importFile("valid file", first.file);

  const tampered = JSON.parse(JSON.stringify(first.parsed));
  tampered.study.cases[0].points[0].isolatedThetaErrRad = 1e-30;
  const tamperedFile = `${OUT}/tampered-convergence.json`;
  fs.writeFileSync(tamperedFile, JSON.stringify(tampered, null, 2));
  await importFile("tampered result", tamperedFile);

  const malformedFile = `${OUT}/malformed-convergence.json`;
  fs.writeFileSync(malformedFile, "{ not json");
  await importFile("malformed JSON", malformedFile);

  const unsupported = JSON.parse(JSON.stringify(first.parsed));
  unsupported.schemaVersion = "otl-convergence-artifact-v9";
  const unsupportedFile = `${OUT}/unsupported-convergence.json`;
  fs.writeFileSync(unsupportedFile, JSON.stringify(unsupported, null, 2));
  await importFile("unsupported schema", unsupportedFile);

  // A file that claims a rigorous bound: rejected, because this build computes none.
  const claim = JSON.parse(JSON.stringify(first.parsed));
  claim.study.referenceErrorKind = "RIGOROUS_BOUND";
  for (const c of claim.study.cases) c.reference.errorKind = "RIGOROUS_BOUND";
  const claimFile = `${OUT}/rigorous-claim-convergence.json`;
  fs.writeFileSync(claimFile, JSON.stringify(claim, null, 2));
  await importFile("rigorous-bound claim", claimFile);

  // The same file with a recomputed digest would pass an integrity-only check, which is
  // exactly why the claim itself is rejected structurally rather than trusted.
  const statusTamper = JSON.parse(JSON.stringify(first.parsed));
  // Both measured cases are PASS, so a tamper must change the status to something else
  // for the digest to move: using PASS would be a no-op and prove nothing.
  statusTamper.study.cases[1].acceptance.status = "FAIL";
  const statusFile = `${OUT}/status-tampered-convergence.json`;
  fs.writeFileSync(statusFile, JSON.stringify(statusTamper, null, 2));
  await importFile("tampered status", statusFile);

  // ---------- Summary counts ----------
  const checksPanel = page.locator("section.panel", { hasText: "Measured checks against the live calculation engine" });
  const outcomes = await checksPanel.locator("table.data tbody tr td.shrink .badge").allInnerTexts();
  const platformOutcomes = await page
    .locator("section.panel", { hasText: "Provenance and reproducibility checks" })
    .locator("table.data tbody tr td.shrink .badge")
    .allInnerTexts();
  const summaryLine = (await page.locator("body").innerText())
    .split("\n")
    .find((l) => l.includes("Counts cover every check")) ?? "not found";
  const statCards = await checksPanel.locator(".stat").allInnerTexts();
  console.log("\n=== summary counts ===");
  console.log("model check badges:", outcomes.length, outcomes.reduce((a, o) => ({ ...a, [o]: (a[o] ?? 0) + 1 }), {}));
  console.log("platform badges:", platformOutcomes);
  console.log("reconciliation line:", summaryLine.replace(/\s+/g, " "));
  console.log("stat cards:", statCards.map((s) => s.replace(/\s+/g, " ")));
  console.log("expected total = model + platform =", outcomes.length + platformOutcomes.length);

  await panel.screenshot({ path: `${OUT}/convergence-panel-import.png` });

  // ---------- Laboratory execution and reproduction ----------
  await page.getByRole("tab", { name: "Laboratory", exact: true }).click();
  await page.waitForTimeout(700);
  await page.getByRole("button", { name: /Execute calculation/ }).click();
  await page.waitForTimeout(4000);
  const labText = await page.locator("body").innerText();
  const runId = (labText.match(/OTL-\d{8}T\d{6}-[0-9A-F]{8}/) ?? ["NOT FOUND"])[0];
  await page.getByRole("button", { name: /^Reproduce$/ }).click();
  await page.waitForTimeout(4000);
  const reproText = await page.locator("body").innerText();
  console.log("\n=== laboratory ===");
  console.log("run id:", runId);
  console.log(
    "reproduction:",
    reproText.split("\n").filter((l) => /series difference|payload hash|Model version/i.test(l)).slice(0, 3).map((l) => l.replace(/\s+/g, " ")),
  );

  console.log("\nconsole errors:", consoleErrors.length ? consoleErrors : "none");
  console.log("page errors:", pageErrors.length ? pageErrors : "none");
  await browser.close();
})().catch((err) => {
  console.error("BROWSER CHECK FAILED:", err);
  process.exit(1);
});
