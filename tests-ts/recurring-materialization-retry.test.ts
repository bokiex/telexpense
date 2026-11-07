import assert from "node:assert/strict";
import test from "node:test";
import { materializeRecurringTransactions } from "../lib/repository";

test("recurring materialization retries only aborted transactions, per batch", async (t) => {
  const oldFetch = globalThis.fetch;
  const env = { ...process.env };
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.example.test";
  process.env.SUPABASE_SECRET_KEY = "test-key";
  t.after(() => { globalThis.fetch = oldFetch; process.env = env; });

  type Reply = { status: number; body: unknown };
  let replies: Reply[] = [];
  let calls: { rpc: string | undefined; body: unknown }[] = [];
  globalThis.fetch = async (resource, options) => {
    const url = new URL(typeof resource === "string" || resource instanceof URL ? resource : resource.url);
    calls.push({ rpc: url.pathname.split("/").pop(), body: JSON.parse(String(options?.body)) });
    const reply = replies.shift();
    assert.ok(reply, "unexpected RPC attempt");
    return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { "content-type": "application/json" } });
  };
  const error = (code: string): Reply => ({ status: 409, body: { code, message: "database error" } });
  const success = (users: number, rules: number): Reply => ({ status: 200, body: [{ users_processed: users, rules_materialized: rules }] });

  replies = [error("40P01"), success(1, 2), error("40001"), success(1, 1)];
  assert.deepEqual(await materializeRecurringTransactions("2024-03", 2, 4, 123), {
    usersProcessed: 2, rulesMaterialized: 3, batchesProcessed: 2
  });
  assert.deepEqual(calls, Array.from({ length: 4 }, () => ({
    rpc: "materialize_recurring_transactions_for_user",
    body: { target_month: "2024-03", batch_size: 2, target_telegram_user_id: 123 }
  })));

  calls = [];
  replies = [error("40P01"), success(1, 1)];
  assert.deepEqual(await materializeRecurringTransactions("2024-03", 2, 2), {
    usersProcessed: 1, rulesMaterialized: 1, batchesProcessed: 1
  });
  assert.equal(calls.length, 2);
  assert.ok(calls.every((call) => call.rpc === "materialize_recurring_transactions"));

  calls = [];
  replies = [error("40001"), error("40P01"), error("40001")];
  await assert.rejects(materializeRecurringTransactions("2024-03", 1, 1), (e) => typeof e === "object" && e !== null && "code" in e && e.code === "40001");
  assert.equal(calls.length, 3);
  assert.ok(calls.every((call) => call.rpc === "materialize_recurring_transactions"));
  assert.ok(calls.every((call) => JSON.stringify(call.body) === JSON.stringify({ target_month: "2024-03", batch_size: 1 })));

  calls = [];
  replies = [error("23503")];
  await assert.rejects(materializeRecurringTransactions("2024-03", 1, 1), (e) => typeof e === "object" && e !== null && "code" in e && e.code === "23503");
  assert.equal(calls.length, 1);

  calls = [];
  replies = [error("42P01")];
  assert.deepEqual(await materializeRecurringTransactions("2024-03", 1, 1), {
    usersProcessed: 0, rulesMaterialized: 0, batchesProcessed: 0
  });
  assert.equal(calls.length, 1);
});
