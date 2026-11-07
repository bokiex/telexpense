import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { NextRequest } from "next/server";
import { POST, DELETE } from "../app/api/categories/route";

const token = "category-test-token";
function initData(userId: number) {
  const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: userId }) });
  const check = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(token).digest();
  params.set("hash", createHmac("sha256", secret).update(check).digest("hex"));
  return params.toString();
}

const values = { sourceKey: "food-drink", sourceName: "food drink", name: "Food drink", group: "Needs", color: "#abcdef", icon: "Wallet" };
function request(method: "POST" | "DELETE", user: number, body: typeof values & { action?: string; subcategoryName?: string } = values) {
  const query = method === "DELETE" ? `?${new URLSearchParams({ sourceKey: body.sourceKey, sourceName: body.sourceName, month: "2024-01" })}` : "";
  return new NextRequest(`https://example.test/api/categories${query}`, { method, headers: { "x-telegram-init-data": initData(user), "content-type": "application/json" }, ...(method === "POST" ? { body: JSON.stringify(body) } : {}) });
}

test("category key collisions cannot rename or alter an existing financial identity", async (t) => {
  const oldFetch = globalThis.fetch;
  const env = { ...process.env };
  process.env.TELEGRAM_BOT_TOKEN = token;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.example.test";
  process.env.SUPABASE_SECRET_KEY = "test-key";
  t.after(() => { globalThis.fetch = oldFetch; process.env = env; });

  const rows = [{ id: 1, telegram_user_id: 10, source_key: "food-drink", source_name: "food-drink", name: "Food-drink", budget_group: "Savings", color: "#123456", icon: "Wallet", active: true }];
  const before = structuredClone(rows);
  let race = false;
  let renameBeforeUpdate = false;
  globalThis.fetch = async (resource, options) => {
    const url = new URL(typeof resource === "string" || resource instanceof URL ? resource : resource.url);
    const method = options?.method || "GET";
    const table = url.pathname.split("/").pop();
    const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
    if (table !== "categories") throw new Error(`Unexpected ${method} ${table}`);
    const match = (row: typeof rows[number]) => ["id", "telegram_user_id", "source_key", "source_name"].every((key) => {
      const filter = url.searchParams.get(key);
      return !filter || String(row[key as keyof typeof row]) === filter.slice(3);
    });
    if (method === "GET") return json(rows.filter(match));
    const payload = JSON.parse(String(options?.body));
    if (method === "PATCH") {
      assert.ok(!("source_name" in payload) && !("source_key" in payload));
      if (renameBeforeUpdate) {
        renameBeforeUpdate = false;
        const row = rows.find((item) => item.telegram_user_id === 20);
        assert.ok(row);
        row.source_name = "concurrently changed";
      }
      const matching = rows.filter(match);
      matching.forEach((row) => Object.assign(row, payload));
      return json(matching);
    }
    if (method === "POST") {
      if (race) { race = false; rows.push({ ...before[0], id: 3, telegram_user_id: 30 }); }
      const existing = rows.find((row) => row.telegram_user_id === payload.telegram_user_id && row.source_key === payload.source_key);
      if (existing) {
        if (url.searchParams.has("on_conflict")) return json({ code: "23503", message: "category source identity and owner are immutable" }, 409);
        return json({ code: "23505", message: "duplicate key" }, 409);
      }
      const row = { id: rows.length + 1, ...payload };
      rows.push(row);
      return json([row], 201);
    }
    throw new Error(`Unexpected ${method}`);
  };

  const collision = await POST(request("POST", 10));
  assert.equal(collision.status, 409);
  assert.match((await collision.json()).error, /category.*(key|identity)/i);
  assert.deepEqual(rows, before);
  const subcategory = await POST(request("POST", 10, { ...values, action: "add-subcategory", subcategoryName: "Coffee" }));
  assert.equal(subcategory.status, 409);
  assert.deepEqual(rows, before);
  const deleted = await DELETE(request("DELETE", 10));
  assert.equal(deleted.status, 409);
  assert.deepEqual(rows, before);

  // A normalized-equivalent identity updates metadata without changing source text.
  const equivalent = await POST(request("POST", 10, { ...values, sourceName: " FOOD-DRINK " }));
  assert.equal(equivalent.status, 200);
  assert.equal(rows[0].source_name, "food-drink");
  assert.equal(rows[0].budget_group, "Needs");
  assert.equal((await POST(request("POST", 20))).status, 200);
  assert.equal(rows.find((row) => row.telegram_user_id === 20)?.source_name, "food drink");

  // A conflicting insert between lookup and insert must not overwrite the winner.
  race = true;
  assert.equal((await POST(request("POST", 30))).status, 409);
  assert.deepEqual(rows.find((row) => row.telegram_user_id === 30), { ...before[0], id: 3, telegram_user_id: 30 });

  // Even on a pre-trigger database, an identity changed between read and
  // update cannot receive the stale request's metadata.
  const user20 = rows.find((row) => row.telegram_user_id === 20);
  assert.ok(user20);
  const previousName = user20.name;
  renameBeforeUpdate = true;
  assert.equal((await POST(request("POST", 20, { ...values, name: "Stale update" }))).status, 409);
  assert.equal(user20.name, previousName);
  assert.equal(user20.source_name, "concurrently changed");
});
