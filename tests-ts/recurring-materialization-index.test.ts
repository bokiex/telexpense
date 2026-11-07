import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const paths = [
  "supabase/schema.sql",
  "supabase/migrations/20261107113219_recurring_materialization_skip_locked.sql",
];

test("schema and migration index active rules in traversal order", () => {
  const index = /create index if not exists recurring_rules_active_traversal_idx\s+on public\.recurring_rules\s*\(telegram_user_id,\s*id\)\s+where active\s*;/i;
  for (const path of paths) {
    assert.match(readFileSync(path, "utf8"), index, path);
  }
});
