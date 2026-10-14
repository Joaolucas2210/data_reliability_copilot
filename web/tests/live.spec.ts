// Live-API evidence: screenshots + axe on pages filled with REAL data from `make demo`.
// Skipped unless LIVE_INCIDENT, LIVE_INVESTIGATION, LIVE_VALIDATION are set (needs `drc api` on :8000).
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";

const { LIVE_INCIDENT, LIVE_INVESTIGATION, LIVE_VALIDATION } = process.env;
const OUT = new URL("../../docs/evidence/ui/", import.meta.url).pathname;
const results: Record<string, number | string[]> = {};

test.skip(!LIVE_INCIDENT || !LIVE_INVESTIGATION || !LIVE_VALIDATION, "live ids not provided");

const PAGES = [
  ["health", "#/"],
  ["pipeline-runs", "#/pipeline-runs"],
  ["incidents", "#/incidents"],
  ["incident-detail", `#/incidents/${LIVE_INCIDENT}`],
  ["investigation", `#/investigations/${LIVE_INVESTIGATION}`],
  ["validation", `#/validation-runs/${LIVE_VALIDATION}`],
  ["evaluations", "#/evaluations"],
] as const;

for (const theme of ["light", "dark"] as const) {
  for (const [name, hash] of PAGES) {
    test(`live ${name} ${theme}`, async ({ page }) => {
      mkdirSync(OUT, { recursive: true });
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
      await page.goto(`/${hash}`);
      await page.waitForLoadState("networkidle");
      // A crashed React tree renders nothing and passes axe vacuously — require real content and no page errors.
      expect(errors).toEqual([]);
      await expect(page.locator("main h1").first()).toBeVisible();
      // Match the UI's actual error states (ErrorState / NotFound / ErrorBoundary), not help text like "quote not found".
      await expect(page.getByText(/Could not load data|It may have been removed|could not be displayed/)).toHaveCount(0);
      const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
      results[`${name}/${theme}`] = r.violations.length ? r.violations.map((v) => `${v.id} (${v.nodes.length})`) : 0;
      await page.screenshot({ path: `${OUT}${name}-${theme}.png`, fullPage: true });
      expect(r.violations.map((v) => `${v.id}: ${v.nodes[0]?.target}`)).toEqual([]);
    });
  }
}

for (const theme of ["light", "dark"] as const) {
  test(`live pipeline detail ${theme}`, async ({ page }) => {
    const response = await page.request.get(`/api/incidents/${LIVE_INCIDENT}`);
    expect(response.status()).toBe(200);
    const incident = await response.json();
    await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
    await page.goto(`/#/pipeline-runs/${incident.incident.last_pipeline_run_id}`);
    await expect(page.getByRole("heading", { name: "Quality checks", exact: true })).toBeVisible();
    await expect(page.getByText("No result recorded")).toHaveCount(0);
    const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    expect(result.violations.map((v) => v.id)).toEqual([]);
  });
}

test("live: viewer cannot start an investigation (access-denied state)", async ({ page }) => {
  await page.goto(`/#/incidents/${LIVE_INCIDENT}`);
  await page.waitForLoadState("networkidle");
  const res = await page.request.post(`/api/incidents/${LIVE_INCIDENT}/investigations`, { headers: { "X-DRC-Role": "viewer" } });
  expect(res.status()).toBe(403);
});

test.afterAll(() => {
  if (Object.keys(results).length)
    writeFileSync(`${OUT}a11y-live-results.json`, JSON.stringify({ generated_at: new Date().toISOString(), violations: results }, null, 2));
});
