/**
 * Browser check for the convergence artifact: export the same study twice, compare the
 * bytes and the embedded hashes, then re-import one to confirm it verifies.
 * Environment-only tooling, not part of the application.
 */
const fs = require("node:fs");
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1200 }, acceptDownloads: true });
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:3000/", { waitUntil: "networkidle" });
  await page.getByRole("tab", { name: "Verification", exact: true }).click();
  await page.waitForTimeout(3500);

  const panel = page.locator("section.panel", { hasText: "Tether convergence" });
  const grab = async (name) => {
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export hashed JSON" }).first().click()]);
    const path = `artifacts/${name}`;
    await download.saveAs(path);
    return fs.readFileSync(path, "utf8");
  };

  const a = await grab("convergence-a.json");
  await page.waitForTimeout(1200); // a different export time must not change the digest
  const b = await grab("convergence-b.json");

  const hashOf = (t) => JSON.parse(t).payloadHash;
  console.log("export #1 digest:", hashOf(a));
  console.log("export #2 digest:", hashOf(b));
  console.log("identical bytes:", a === b);
  console.log("generatedAt differ:", JSON.parse(a).generatedAtUtc !== JSON.parse(b).generatedAtUtc, JSON.parse(a).generatedAtUtc, JSON.parse(b).generatedAtUtc);

  // Re-import the exported file through the UI.
  await page.locator('input[type="file"]').setInputFiles("artifacts/convergence-a.json");
  await page.waitForTimeout(1500);
  const importPanel = await panel.innerText();
  const idx = importPanel.indexOf("Import & verify an exported artifact");
  console.log("\nimport area:\n" + importPanel.slice(idx, idx + 900).replace(/\s+/g, " "));
  // Tamper with one measured error and re-import: the digest must no longer match, and the
  // importer must say so rather than accepting the file.
  const tampered = JSON.parse(a);
  const point = tampered.study.cases[0].points[0];
  const numericKey = Object.keys(point).find((k) => typeof point[k] === "number" && point[k] !== 0);
  tampered.study.cases[0].points[0][numericKey] = point[numericKey] * 2;
  fs.writeFileSync("artifacts/convergence-tampered.json", JSON.stringify(tampered, null, 2));
  await page.locator('input[type="file"]').setInputFiles("artifacts/convergence-tampered.json");
  await page.waitForTimeout(1500);
  const tamperText = (await panel.innerText()).replace(/\s+/g, " ");
  const ti = tamperText.indexOf("Import & verify an exported artifact");
  console.log(`\ntampered field: cases[0].points[0].${numericKey} x2`);
  console.log("tampered import:\n" + tamperText.slice(ti, ti + 520));

  // Altering a recorded acceptance status must also break the digest.
  const statusTampered = JSON.parse(a);
  statusTampered.study.cases[1].acceptance.status = "FAIL";
  fs.writeFileSync("artifacts/convergence-status-tampered.json", JSON.stringify(statusTampered, null, 2));
  await page.locator('input[type="file"]').setInputFiles("artifacts/convergence-status-tampered.json");
  await page.waitForTimeout(1200);
  const statusText = (await panel.innerText()).replace(/\s+/g, " ");
  const si = statusText.indexOf("Import & verify an exported artifact");
  console.log("\nstatus tampered (cases[1].acceptance.status -> FAIL):\n" + statusText.slice(si, si + 300));

  // Malformed JSON and an unsupported schema must be refused, not repaired.
  fs.writeFileSync("artifacts/convergence-malformed.json", "{ not json ");
  await page.locator('input[type="file"]').setInputFiles("artifacts/convergence-malformed.json");
  await page.waitForTimeout(900);
  console.log("\nmalformed:\n" + (await panel.innerText()).replace(/\s+/g, " ").slice(-320));

  const wrongSchema = { ...JSON.parse(a), schemaVersion: "otl-convergence-artifact-v999" };
  fs.writeFileSync("artifacts/convergence-schema.json", JSON.stringify(wrongSchema));
  await page.locator('input[type="file"]').setInputFiles("artifacts/convergence-schema.json");
  await page.waitForTimeout(900);
  console.log("\nunsupported schema:\n" + (await panel.innerText()).replace(/\s+/g, " ").slice(-320));

  await panel.screenshot({ path: "artifacts/convergence-export.png" });
  await browser.close();
})().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
