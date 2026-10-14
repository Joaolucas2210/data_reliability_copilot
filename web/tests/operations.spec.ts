import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const run = {
  id: "run_operations", pipeline: "finance_daily", status: "succeeded",
  started_at: "2026-10-12T12:00:00Z", finished_at: "2026-10-12T12:00:15Z",
  dbt_version: "1.12.5", manifest_hash: "test",
};
const check = {
  id: "check_operations", pipeline_run_id: run.id, check_type: "invariant",
  check_name: "inv_reconciliation_amount", dataset_id: "rpt_daily_collections",
  status: "fail", observed_value: "100", expected: "0", failures: 1,
  message: null, evaluated_at: run.finished_at,
};

test("a run without checks is not presented as healthy", async ({ page }) => {
  await page.route("**/api/**", (route) => route.fulfill({ json: route.request().url().includes("/pipelines/health") ? [{
    pipeline: run.pipeline, last_run: { ...run, status: "running", finished_at: null },
    checks: { pass: 0, fail: 0, error: 0, warn: 0, skipped: 0 }, freshness: "unknown", open_incidents: 0,
  }] : [] }));
  await page.goto("/#/");
  await expect(page.getByText("Quality not evaluated")).toBeVisible();
  await expect(page.getByText("Checks passed")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Where the data goes" })).toBeVisible();
  await expect(page.locator(".data-flow li")).toHaveCount(4);
});

test("skipped checks stay visible and prevent an all-passed summary", async ({ page }) => {
  await page.route("**/api/**", (route) => route.fulfill({ json: route.request().url().includes("/pipelines/health") ? [{
    pipeline: run.pipeline, last_run: run,
    checks: { pass: 1, fail: 0, error: 0, warn: 0, skipped: 1 }, freshness: "unknown", open_incidents: 0,
  }] : [] }));
  await page.goto("/#/");
  await expect(page.getByText("Checks need attention")).toBeVisible();
  await expect(page.getByText("Quality checks on the last run (2)")).toBeVisible();
  await expect(page.getByText("Skipped", { exact: true })).toBeVisible();
});

test("run history opens recorded results and the related incident", async ({ page }) => {
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    const json = path === "/api/pipeline-runs" ? [{ ...run, total_checks: 2, passed_checks: 1, failed_checks: 1 }] : path === `/api/pipeline-runs/${run.id}` ? {
      run: { ...run, snapshot_schema: "snap_run_operations" }, execution: { rc_run: 0, rc_test: 1, rc_freshness: 0 }, checks: [check, { ...check, id: "check_pass", status: "pass", failures: 0, check_name: "inv_payment_id_unique" }],
      incidents: [{ id: "inc_operations", title: "Report does not match control totals", status: "open", severity: "high" }],
    } : [];
    return route.fulfill({ json });
  });
  await page.goto("/#/pipeline-runs");
  await expect(page.getByText("1 failed")).toBeVisible();
  await page.getByRole("link", { name: "finance_daily", exact: true }).click();
  await expect(page.getByText("Exit code 1")).toBeVisible();
  await expect(page.getByText("Report amount matches control totals", { exact: true })).toBeVisible();
  await expect(page.getByText("Each payment appears once in the report data", { exact: true })).toHaveCount(0);
  await page.getByText("All checks", { exact: true }).click();
  await expect(page.getByRole("radio", { name: "All checks", exact: true })).toBeChecked();
  await expect(page.getByText("Each payment appears once in the report data", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open incident" })).toHaveAttribute("href", "#/incidents/inc_operations");
});

test("pending stage results are not inferred from a completed run", async ({ page }) => {
  await page.route("**/api/**", (route) => route.fulfill({ json: route.request().url().includes(`/pipeline-runs/${run.id}`) ? {
    run: { ...run, snapshot_schema: null }, execution: null, checks: [], incidents: [],
  } : [] }));
  await page.goto(`/#/pipeline-runs/${run.id}`);
  await expect(page.getByText("No result recorded")).toHaveCount(3);
  await expect(page.getByText("Quality has not been evaluated", { exact: true })).toBeVisible();
  await expect(page.getByText("Completed successfully")).toHaveCount(0);
});

for (const theme of ["light", "dark"] as const) {
  test(`operational pages are accessible and fit at 320px: ${theme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
    await page.setViewportSize({ width: 320, height: 800 });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/api/**", (route) => {
      const path = new URL(route.request().url()).pathname;
      const json = path === "/api/pipelines/health" ? [{ pipeline: run.pipeline, last_run: run,
        checks: { pass: 0, warn: 0, fail: 1, error: 0, skipped: 0 }, freshness: "pass", open_incidents: 1,
      }] : path === "/api/pipeline-runs" ? [{ ...run, total_checks: 1, passed_checks: 0, failed_checks: 1 }] : path === `/api/pipeline-runs/${run.id}` ? {
        run: { ...run, snapshot_schema: "snap_run_operations" }, execution: { rc_run: 0, rc_test: 1, rc_freshness: 0 }, checks: [check],
        incidents: [{ id: "inc_operations", title: "Report does not match control totals", status: "open", severity: "high" }],
      } : [];
      return route.fulfill({ json });
    });
    for (const route of ["/", "/pipeline-runs", `/pipeline-runs/${run.id}`]) {
      await page.goto(`/#${route}`);
      await expect(page.getByText("finance_daily", { exact: true })).toBeVisible();
      const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
      expect(result.violations.map((v) => `${v.id}: ${v.nodes[0]?.target}`)).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
    }
    expect(errors).toEqual([]);
  });
}

test("run history refreshes when a new execution arrives", async ({ page }) => {
  await page.clock.install();
  let requests = 0;
  await page.route("**/api/**", (route) => {
    const isHistory = new URL(route.request().url()).pathname === "/api/pipeline-runs";
    if (isHistory) requests++;
    return route.fulfill({ json: isHistory ? [{ ...run, id: requests > 1 ? "run_new" : run.id, total_checks: 0, passed_checks: 0, failed_checks: 0 }] : [] });
  });
  await page.goto("/#/pipeline-runs");
  await expect(page.getByText(run.id, { exact: true })).toBeVisible();
  await page.clock.fastForward(10001);
  await expect(page.getByText("run_new", { exact: true })).toBeVisible();
});
