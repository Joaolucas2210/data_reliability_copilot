// Automated accessibility + visual evidence. Writes screenshots and axe results to docs/design-system/.
// axe covers only a subset of WCAG 2.2 AA; see docs/design-system/README.md for the manual checklist.
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";

const OUT = new URL("../../docs/design-system/", import.meta.url).pathname;
mkdirSync(`${OUT}screenshots`, { recursive: true });

// API-backed pages are expected to show the error/empty state when the API is not running.
const PAGES = [
  ["gallery", "#/gallery"],
  ["health", "#/"],
  ["incidents", "#/incidents"],
  ["incident-detail", "#/incidents/inc_x"],
  ["investigation", "#/investigations/inv_x"],
  ["validation", "#/validation-runs/val_x"],
  ["evaluations", "#/evaluations"],
] as const;
const THEMES = ["light", "dark"] as const;
const results: Record<string, number | string[]> = {};

for (const theme of THEMES) {
  for (const [name, hash] of PAGES) {
    test(`axe ${name} ${theme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
      await page.goto(`/${hash}`);
      await page.waitForLoadState("networkidle"); // API calls settle (ok or error state)
      const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
      results[`${name}/${theme}`] = r.violations.length ? r.violations.map((v) => `${v.id} (${v.nodes.length})`) : 0;
      await page.screenshot({ path: `${OUT}screenshots/${name}-${theme}.png`, fullPage: true });
      expect(r.violations.map((v) => `${v.id}: ${v.nodes[0]?.target}`)).toEqual([]);
    });
  }
}

// Tab panels that are `hidden` are skipped by axe; activate each diagnosis tab and re-run.
for (const theme of THEMES) {
  test(`axe diagnosis tab panels ${theme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    await page.goto("/#/gallery");
    const tabs = page.getByRole("tablist", { name: "Diagnosis sections" }).getByRole("tab");
    const found: string[] = [];
    for (let i = 0; i < (await tabs.count()); i++) {
      await tabs.nth(i).click();
      const r = await new AxeBuilder({ page }).include('[role="tabpanel"]:not([hidden])').withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
      found.push(...r.violations.map((v) => `tab${i} ${v.id}`));
    }
    results[`gallery-tabpanels/${theme}`] = found.length ? found : 0;
    expect(found).toEqual([]);
  });
}

test("reflow at 320px: no horizontal page scroll (WCAG 1.4.10)", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  for (const [name, hash] of PAGES) {
    await page.goto(`/${hash}`);
    await page.waitForTimeout(300);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `${name} overflows by ${overflow}px`).toBeLessThanOrEqual(0);
  }
  await page.goto("/#/gallery");
  await page.screenshot({ path: `${OUT}screenshots/gallery-mobile-320.png`, fullPage: false });
});

test("keyboard: skip link first, tabs follow arrow keys", async ({ page }) => {
  await page.goto("/#/gallery");
  await page.keyboard.press("Tab");
  await expect(page.locator(":focus")).toHaveText("Skip to content");
  await page.keyboard.press("Enter");
  await expect(page.locator(":focus")).toHaveId("main");
  const first = page.getByRole("tab", { name: "First" });
  await first.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Second" })).toBeFocused();
  await expect(page.getByRole("tab", { name: "Second" })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Home");
  await expect(first).toBeFocused();
});

test.afterAll(() => {
  writeFileSync(`${OUT}a11y-results.json`, JSON.stringify({ generated_at: new Date().toISOString(), tags: "wcag2a,wcag2aa,wcag21a,wcag21aa,wcag22aa", violations: results }, null, 2));
});
