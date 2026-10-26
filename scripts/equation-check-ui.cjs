/** Focused check: the two equation-verification rows render with their measured evidence. */
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
  await page.goto("http://127.0.0.1:3000/", { waitUntil: "networkidle" });
  await page.getByRole("tab", { name: "Verification", exact: true }).click();
  await page.waitForTimeout(3000);
  const panel = page.locator("section.panel", { hasText: "Measured checks against the live calculation engine" });
  for (const id of ["OT-TT-014", "OT-TT-015", "OT-TT-016", "OT-TT-017", "OT-TT-018"]) {
    const row = panel.locator("tr", { hasText: id }).first();
    const text = (await row.innerText()).replace(/\s+/g, " ");
    console.log(`\n${id}:`, text.slice(0, 420), "\n");
  }
  await panel.screenshot({ path: "artifacts/equation-checks.png" });
  await browser.close();
})().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
