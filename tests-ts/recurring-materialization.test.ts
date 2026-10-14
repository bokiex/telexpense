import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("../supabase/migrations/20261014090000_fix_recurring_materialization_and_account_transfers.sql", import.meta.url), "utf8");

test("recurring materialization claims each due rule once and gates on its scheduled day", () => {
  assert.match(migration, /not exists \(select 1 from public\.recurring_rule_runs/);
  assert.match(migration, /\)::date <= current_date/);
  assert.match(migration, /on conflict \(telegram_user_id, recurring_rule_id, month\) do nothing/);
});

test("recurring transfers write grouped signed legs and investment destinations as investments", () => {
  assert.match(migration, /case when leg\.destination and destination\.account_type = 'investment' then 'investment'/);
  assert.match(migration, /case when leg\.destination then abs\(r\.amount_cents\) else -abs\(r\.amount_cents\) end/);
  assert.match(migration, /r\.transfer_group_id, r\.id/);
  assert.match(migration, /'account_transfer'/);
});
