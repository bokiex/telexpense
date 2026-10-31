import { test } from "node:test";
import assert from "node:assert/strict";
import { createDashboardCache, telegramCacheUserId } from "../lib/dashboardCache";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); }
  };
}

test("dashboard snapshots are partitioned by user and month and expire after an hour", () => {
  const storage = memoryStorage();
  let now = Date.parse("2026-04-20T12:00:00Z");
  const cache = createDashboardCache(storage, 123, () => now);
  assert.equal(cache.write("2026-04", { month: "2026-04" }, cache.generation()), now);
  assert.deepEqual(cache.read("2026-04")?.value, { month: "2026-04" });
  assert.equal(cache.read("2026-03"), null);
  assert.equal(createDashboardCache(storage, 456, () => now).read("2026-04"), null);
  now += 60 * 60 * 1000;
  assert.equal(cache.read("2026-04"), null);
});

test("UTC day change expires snapshots and invalidation rejects older in-flight writes", () => {
  const storage = memoryStorage();
  let now = Date.parse("2026-04-20T23:59:00Z");
  const cache = createDashboardCache(storage, 123, () => now);
  const generation = cache.generation();
  cache.write("2026-04", { month: "2026-04" }, generation);
  now += 60_000;
  assert.equal(cache.read("2026-04"), null);
  cache.invalidate();
  assert.equal(cache.write("2026-04", { month: "2026-04" }, generation), null);
  assert.equal(cache.read("2026-04"), null);
});

test("cache tolerates unavailable storage and invalid identity data", () => {
  const cache = createDashboardCache({ getItem() { throw new Error("unavailable"); }, setItem() { throw new Error("unavailable"); } }, 123);
  assert.equal(cache.generation(), null);
  assert.equal(cache.read("2026-04"), null);
  assert.equal(cache.write("2026-04", {}, null), null);
  assert.doesNotThrow(() => cache.invalidate());
  assert.equal(telegramCacheUserId(""), null);
  assert.equal(telegramCacheUserId("user=bad"), null);
  assert.equal(telegramCacheUserId(new URLSearchParams({ user: JSON.stringify({ id: 123 }) }).toString()), 123);
  assert.equal(telegramCacheUserId(new URLSearchParams({ user: JSON.stringify({ id: -1 }) }).toString()), null);
});
