import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  timeout: 30000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["json", { outputFile: process.env.BROWSER_REPORT || (process.env.UI_BASE_URL?.startsWith('https:')?'reports/browser-production.json':'reports/browser.json') }]],
  use: {
    baseURL: process.env.UI_BASE_URL || "http://127.0.0.1:5173",
    trace: process.env.UI_BASE_URL?.startsWith('https:')?'off':"retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    {
      name: "mobile",
      use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" },
    },
  ],
});
