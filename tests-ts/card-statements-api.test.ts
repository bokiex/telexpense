import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { NextRequest } from "next/server";
import { GET, POST } from "../app/api/card-statements/route";

const token = "test-bot-token";
const input = { accountId: 1, closingDate: "2024-02-29", dueDate: "2024-03-20", originalAmountCents: 12000, remainingAmountCents: 5000 };

function initData(userId: number) {
  const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: userId }) });
  const check = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(token).digest();
  params.set("hash", createHmac("sha256", secret).update(check).digest("hex"));
  return params.toString();
}

function request(method: "GET" | "POST", userId?: number, body?: string) {
  return new NextRequest("https://example.test/api/card-statements", {
    method, headers: { ...(userId ? { "x-telegram-init-data": initData(userId) } : {}), "content-type": "application/json" },
    ...(body === undefined ? {} : { body })
  });
}

test("card statement API authenticates, isolates cards and records snapshots without changing balances or transactions", async (t) => {
  const oldFetch = globalThis.fetch;
  const env = { ...process.env };
  process.env.TELEGRAM_BOT_TOKEN = token;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.example.test";
  process.env.SUPABASE_SECRET_KEY = "test-key";
  t.after(() => { globalThis.fetch = oldFetch; process.env = env; });

  const accounts = [
    { id: 1, telegram_user_id: 10, account_type: "card", balance_cents: -15000 },
    { id: 2, telegram_user_id: 20, account_type: "card", balance_cents: -9000 },
    { id: 3, telegram_user_id: 10, account_type: "cash", balance_cents: 3000 },
    { id: 4, telegram_user_id: 10, account_type: "card", balance_cents: -3000 }
  ];
  const transactions = [{ id: 1, telegram_user_id: 10, account_id: 1, amount_cents: -15000 }];
  const beforeAccounts = structuredClone(accounts);
  const beforeTransactions = structuredClone(transactions);
  const statements: Record<string, unknown>[] = [{ id: 90, telegram_user_id: 20, account_id: 2, closing_date: "2024-02-29", due_date: "2024-03-20", original_amount_cents: 9000, remaining_amount_cents: 9000, payment_baseline: [] }];
  globalThis.fetch = async (resource, options) => {
    const url = new URL(typeof resource === "string" || resource instanceof URL ? resource : resource.url);
    const table = url.pathname.split("/").pop();
    const method = options?.method || "GET";
    const params = JSON.parse(String(options?.body)) as Record<string, unknown>;
    const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
    if (table === "read_card_statement_inputs") return json({ statements: statements.filter((s) => s.telegram_user_id === params.target_user_id && accounts.some((a) => a.id === s.account_id && a.telegram_user_id === s.telegram_user_id && a.account_type === "card")), payments: [] });
    if (table === "rebaseline_legacy_card_statement") {
      const statement = statements.find((s) => s.telegram_user_id === params.target_user_id && s.account_id === params.target_account_id && s.closing_date === params.target_closing_date && s.payment_baseline === null);
      if (!statement) return json(null);
      Object.assign(statement, { due_date: params.target_due_date, original_amount_cents: params.target_original_cents,
        remaining_amount_cents: params.target_remaining_cents, payment_baseline: [] });
      return json(statement.id);
    }
    if (table === "create_card_statement_snapshot") {
      if (!accounts.some((a) => a.telegram_user_id === params.target_user_id && a.id === params.target_account_id && a.account_type === "card")) return json(null);
      if (statements.some((s) => s.telegram_user_id === params.target_user_id && s.account_id === params.target_account_id && s.closing_date === params.target_closing_date)) return json({ code: "23505" }, 409);
      statements.push({ id: 91, telegram_user_id: params.target_user_id, account_id: params.target_account_id,
        closing_date: params.target_closing_date, due_date: params.target_due_date, original_amount_cents: params.target_original_cents,
        remaining_amount_cents: params.target_remaining_cents, payment_baseline: [] });
      return json(91, 201);
    }
    throw new Error(`Unexpected database operation: ${method} ${url}`);
  };

  assert.equal((await GET(request("GET"))).status, 401);
  assert.equal((await POST(request("POST", undefined, JSON.stringify(input)))).status, 401);
  assert.equal((await POST(request("POST", 10, "{"))).status, 400);
  for (const patch of [{ closingDate: "2023-02-29" }, { accountId: 0 }, { remainingAmountCents: 12001 }, { originalAmountCents: -1 }]) {
    assert.equal((await POST(request("POST", 10, JSON.stringify({ ...input, ...patch })))).status, 400);
  }
  for (const accountId of [2, 3, 999]) {
    assert.equal((await POST(request("POST", 10, JSON.stringify({ ...input, accountId })))).status, 404);
  }
  assert.deepEqual(await (await GET(request("GET", 10))).json(), { statements: [] });
  const created = await POST(request("POST", 10, JSON.stringify(input)));
  assert.equal(created.status, 201);
  assert.deepEqual(await created.json(), { ok: true, id: 91 });
  assert.equal((await POST(request("POST", 10, JSON.stringify(input)))).status, 409);
  assert.deepEqual(await (await GET(request("GET", 10))).json(), { statements: [{ id: 91, ...input }] });
  assert.deepEqual(await (await GET(request("GET", 20))).json(), { statements: [{ id: 90, accountId: 2, closingDate: "2024-02-29", dueDate: "2024-03-20", originalAmountCents: 9000, remainingAmountCents: 9000 }] });
  assert.deepEqual(accounts, beforeAccounts);
  assert.deepEqual(transactions, beforeTransactions);
  statements[1].payment_baseline = null;
  statements.push({ id: 92, telegram_user_id: 10, account_id: 3, closing_date: "2023-12-31", due_date: "2024-01-20", original_amount_cents: 1000, remaining_amount_cents: 1000, payment_baseline: null });
  statements.push({ id: 93, telegram_user_id: 10, account_id: 4, closing_date: "2024-01-31", due_date: "2024-02-20", original_amount_cents: 3000, remaining_amount_cents: 3000, payment_baseline: [] });
  const legacy = await GET(request("GET", 10));
  assert.equal(legacy.status, 200);
  assert.deepEqual(await legacy.json(), { statements: [{ id: 93, accountId: 4, closingDate: "2024-01-31", dueDate: "2024-02-20", originalAmountCents: 3000, remainingAmountCents: 3000 }], legacyAccounts: [{ accountId: 1, closingDates: ["2024-02-29"] }] });
  assert.equal((await POST(request("POST", 20, JSON.stringify({ ...input, replaceLegacy: true })))).status, 404);
  assert.equal((await POST(request("POST", 10, JSON.stringify({ ...input, replaceLegacy: true })))).status, 201);
  assert.deepEqual(await (await GET(request("GET", 10))).json(), { statements: [{ id: 91, ...input }, { id: 93, accountId: 4, closingDate: "2024-01-31", dueDate: "2024-02-20", originalAmountCents: 3000, remainingAmountCents: 3000 }] });
  assert.equal((await POST(request("POST", 10, JSON.stringify({ ...input, replaceLegacy: true })))).status, 404);
});


test("authenticated reads reconcile grouped bank payments without modifying balances", async (t) => {
  const oldFetch = globalThis.fetch;
  const env = { ...process.env };
  process.env.TELEGRAM_BOT_TOKEN = token;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.example.test";
  process.env.SUPABASE_SECRET_KEY = "test-key";
  t.after(() => { globalThis.fetch = oldFetch; process.env = env; });
  const accounts = [{ id: 1, telegram_user_id: 10, account_type: "card", balance_cents: -4000 },
    { id: 2, telegram_user_id: 10, account_type: "bank", balance_cents: 4000 }];
  const statements = [{ id: 1, telegram_user_id: 10, account_id: 1, closing_date: "2024-01-31", due_date: "2024-02-20", original_amount_cents: 10000, remaining_amount_cents: 8000, payment_baseline: [{ groupId: "payment", amountCents: 3000 }] }];
  // The snapshot already includes this payment, but editing/deleting it must
  // still change the remaining amount relative to its captured value.
  let amount = 3000;
  globalThis.fetch = async (resource, options) => {
    const url = new URL(typeof resource === "string" || resource instanceof URL ? resource : resource.url);
    assert.equal(url.pathname.split("/").pop(), "read_card_statement_inputs");
    const user = JSON.parse(String(options?.body)).target_user_id;
    return new Response(JSON.stringify({ statements: user === 10 ? statements : [],
      payments: user === 10 && amount ? [{ groupId: "payment", accountId: 1, amountCents: amount }] : [] }),
      { headers: { "content-type": "application/json" } });
  };
  const remaining = async (user: number) => (await (await GET(request("GET", user))).json()).statements;
  assert.equal((await remaining(10))[0].remainingAmountCents, 8000);
  assert.equal((await remaining(10))[0].remainingAmountCents, 8000);
  assert.deepEqual(await remaining(20), []);
  amount = 1000;
  assert.equal((await remaining(10))[0].remainingAmountCents, 10000);
  amount = 0;
  assert.equal((await remaining(10))[0].remainingAmountCents, 10000);
  assert.equal(accounts[0].balance_cents, -4000);
  assert.equal(accounts[1].balance_cents, 4000);
});

test("statement API passes persisted capture order to reconciliation", async (t) => {
  const oldFetch = globalThis.fetch;
  const env = { ...process.env };
  process.env.TELEGRAM_BOT_TOKEN = token;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.example.test";
  process.env.SUPABASE_SECRET_KEY = "test-key";
  t.after(() => { globalThis.fetch = oldFetch; process.env = env; });
  const p = { groupId: "payment", accountId: 1, amountCents: 10000 };
  globalThis.fetch = async () => new Response(JSON.stringify({
    // IDs intentionally disagree with order, as can happen after re-entry.
    statements: [
      { id: 1, capture_order: 2, account_id: 1, closing_date: "2024-01-31", due_date: "2024-02-20", original_amount_cents: 10000, remaining_amount_cents: 10000, payment_baseline: [p] },
      { id: 2, capture_order: 1, account_id: 1, closing_date: "2024-02-29", due_date: "2024-03-20", original_amount_cents: 10000, remaining_amount_cents: 10000, payment_baseline: [] }
    ], payments: [p]
  }), { headers: { "content-type": "application/json" } });
  const body = await (await GET(request("GET", 10))).json();
  assert.deepEqual(body.statements.map((s: { remainingAmountCents: number }) => s.remainingAmountCents), [10000, 0]);
});
