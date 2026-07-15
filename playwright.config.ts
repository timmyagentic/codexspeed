import { defineConfig, devices } from "@playwright/test";

const baseURL = "http://127.0.0.1:8791";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["line"]],
  webServer: {
    command: "node scripts/start-e2e-worker.mjs",
    gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
    url: `${baseURL}/api/v1/health`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
  use: {
    ...devices["Desktop Chrome"],
    baseURL,
    serviceWorkers: "block",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "setup",
      testMatch: /upload\.spec\.ts/u,
    },
    {
      name: "chromium",
      dependencies: ["setup"],
      testIgnore: /upload\.spec\.ts/u,
    },
  ],
});
