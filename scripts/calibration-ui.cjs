/**
 * Focused browser check for the balance-calibration row.
 *
 * Reads the summary cards (they must reconcile), opens the OT-TT-018 disclosure, and prints
 * the measured evidence so the budgeted / unbudgeted counts and the per-case diagnosis can
 * be seen to reach the UI. Environment-only tooling, not part of the application.
 */
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1400 } });
  await page.goto("http://127.0.0.1:3000/", { waitUntil: "networkidle" });
  await page.getByRole("tab", { name: "Verification", exact: true }).click();
  await page.waitForTimeout(3000);

  const panel = page.locator("section.panel", { hasText: "Measured checks against the live calculation engine" });
  const stats = await panel.locator(".stat").allInnerTexts();
  console.log("summary cards:\n" + stats.map((s) => s.replace(/\s+/g, " ")).join("\n"));
  const reconcile = await panel.locator(".disclosure-note, .tiny").allInnerTexts();
  console.log("\nreconciliation:\n" + reconcile.map((s) => s.replace(/\s+/g, " ")).join("\n"));

  const row = panel.locator("tr", { hasText: "OT-TT-018" }).first();
  console.log("\nrow:", (await row.innerText()).replace(/\s+/g, " "));
  await row.locator(".disclosure-toggle").click();
  const detail = await panel.locator("tr.disclosure-row").first().innerText();
  const flat = detail.replace(/\s+/g, " ");
  console.log("\ndetail (first 1200 chars):\n" + flat.slice(0, 1200));
  const ev = flat.indexOf("EVIDENCE");
  require("node:fs").writeFileSync("artifacts/calibration-evidence.txt", flat.slice(ev));
  console.log("\nevidence:\n" + flat.slice(ev, ev + 1400));
  console.log("\n(full evidence written to artifacts/calibration-evidence.txt)");

  await panel.screenshot({ path: "artifacts/equation-checks.png" });
  await panel.locator("tr.disclosure-row").first().screenshot({ path: "artifacts/calibration-evidence.png" });
  await row.screenshot({ path: "artifacts/calibration-row.png" });
  await browser.close();
})().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
