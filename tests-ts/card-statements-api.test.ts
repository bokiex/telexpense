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
    { id: 3, telegram_user_id: 10, account_type: "cash", balance_cents: 3000 }
  ];
  const transactions = [{ id: 1, telegram_user_id: 10, account_id: 1, amount_cents: -15000 }];
  const beforeAccounts = structuredClone(accounts);
  const beforeTransactions = structuredClone(transactions);
  const statements: Record<string, unknown>[] = [{ id: 90, telegram_user_id: 20, account_id: 2, closing_date: "2024-02-29", due_date: "2024-03-20", original_amount_cents: 9000, remaining_amount_cents: 9000 }];
  globalThis.fetch = async (resource, options) => {
    const url = new URL(typeof resource === "string" || resource instanceof URL ? resource : resource.url);
    const table = url.pathname.split("/").pop();
    const method = options?.method || "GET";
    const matches = (row: Record<string, unknown>) => [...url.searchParams].every(([key, value]) => !value.startsWith("eq.") || String(row[key]) === value.slice(3));
    const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
    if (table === "accounts" && method === "GET") return json(accounts.filter(matches));
    if (table === "card_statement_snapshots" && method === "GET") return json(statements.filter(matches));
    if (table === "card_statement_snapshots" && method === "POST") {
      const row = JSON.parse(String(options?.body)) as Record<string, unknown>;
      if (statements.some((s) => s.telegram_user_id === row.telegram_user_id && s.account_id === row.account_id && s.closing_date === row.closing_date)) return json({ code: "23505" }, 409);
      const saved = { ...row, id: 91 };
      statements.push(saved);
      return json({ id: saved.id }, 201);
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
});
