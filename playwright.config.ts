import { defineConfig, devices } from "@playwright/test";
import { VIEWPORTS } from "./e2e/capture-manifest";

// Core-journey smoke against ORBIT running locally (see docs/E2E.ko.md).
// Not part of `npm test`; run with `npm run test:e2e`.
const port = Number(process.env.ORBIT_E2E_PORT ?? 4317);
const baseURL = process.env.ORBIT_E2E_BASE_URL ?? `http://localhost:${port}`;

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./e2e/artifacts/test-results",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [
    ["list"],
    ["html", { outputFolder: "./e2e/artifacts/report", open: "never" }],
  ],
  use: {
    baseURL,
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: Object.entries(VIEWPORTS).map(([name, viewport]) => ({
    name,
    use: { ...devices["Desktop Chrome"], viewport },
  })),
  webServer: process.env.ORBIT_E2E_BASE_URL
    ? undefined
    : {
        command: "bash e2e/serve.sh",
        // 401 counts as ready: the route answers once the worker is up.
        url: `${baseURL}/api/version`,
        env: { ORBIT_E2E_PORT: String(port) },
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
        stdout: "ignore",
        stderr: "pipe",
      },
});
