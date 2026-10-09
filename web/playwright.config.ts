import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests",
  reporter: [["list"]],
  workers: 1, // a11y-results.json is collected in one worker (afterAll)
  use: { baseURL: "http://127.0.0.1:4173" },
  webServer: { command: "npm run build && npm run preview", url: "http://127.0.0.1:4173", reuseExistingServer: true, timeout: 120_000 },
});
