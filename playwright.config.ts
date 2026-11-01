import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests-e2e",
  timeout: 90_000,
  workers: 1,
  reporter: "./playwright-safe-reporter.ts",
  preserveOutput: "never",
  use: {
    baseURL: "http://127.0.0.1:3107",
    trace: "off",
    screenshot: "off",
    video: "off"
  }
});
