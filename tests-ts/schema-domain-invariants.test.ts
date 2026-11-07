import { readFileSync } from "node:fs";
import { strict as assert } from "node:assert";
import { test } from "node:test";

const migration = readFileSync("supabase/migrations/20261107113216_schema_domain_invariants.sql", "utf8");

test("fresh schema contains the exact forward domain-invariant migration", () => {
  const schema = readFileSync("supabase/schema.sql", "utf8");
  assert.ok(schema.includes(migration), "schema.sql and forward migration must remain aligned");
});

test("disposable database fixture exercises migration reruns and check violations", () => {
  const fixture = readFileSync("tests-ts/fixtures/schema-domain-invariants.sql", "utf8");
  assert.equal(fixture.split("-- MIGRATION --").length - 1, 3);
  for (const name of [
    "budgets_month_format_check", "portfolio_snapshots_month_format_check", "recurring_rule_runs_month_format_check",
    "budgets_nonnegative_amount_check", "portfolio_snapshots_nonnegative_value_check", "recurring_rules_positive_amount_check",
    "transactions_ungrouped_sign_check"
  ]) {
    assert.ok(migration.includes(name), `missing ${name} in migration`);
    assert.ok(fixture.includes(`'${name}'`), `missing ${name} in database fixture`);
  }
});
