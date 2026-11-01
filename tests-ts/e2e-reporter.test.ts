import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

test("E2E failure output identifies the journey without printing failure details", () => {
  const dir = mkdtempSync(join(process.cwd(), ".reporter-test-"));
  try {
    writeFileSync(join(dir, "journey.spec.js"), `const { test, expect } = require('@playwright/test');
test('synthetic journey', () => { expect('bearer-secret-example').toBe('different'); });\n`);
    writeFileSync(join(dir, "config.js"), `module.exports = { testDir: __dirname, reporter: ${JSON.stringify(resolve("playwright-safe-reporter.ts"))} };\n`);
    const result = spawnSync(resolve("node_modules/.bin/playwright"), ["test", "--config", join(dir, "config.js")], { encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.match(result.stdout, /FAIL.*synthetic journey/);
    assert.doesNotMatch(result.stdout + result.stderr, /bearer-secret-example/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
