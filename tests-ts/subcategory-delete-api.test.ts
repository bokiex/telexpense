import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { NextRequest } from "next/server";
import { DELETE } from "../app/api/subcategories/route";

function signed(userId: number) {
  const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: userId }) });
  const check = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join("\n");
  const secret = createHmac("sha256", "WebAppData").update("test-token").digest();
  params.set("hash", createHmac("sha256", secret).update(check).digest("hex"));
  return params.toString();
}

function request(id: string, user?: number) {
  return new NextRequest(`https://example.test/api/subcategories?id=${id}`, { method: "DELETE", headers: user ? { "x-telegram-init-data": signed(user) } : {} });
}

test("subcategory deletion authenticates, validates and scopes the atomic RPC", async (t) => {
  const oldFetch = globalThis.fetch;
  const env = { ...process.env };
  process.env.TELEGRAM_BOT_TOKEN = "test-token";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.example.test";
  process.env.SUPABASE_SECRET_KEY = "test-key";
  t.after(() => { globalThis.fetch = oldFetch; process.env = env; });
  let result = "in_use";
  let calls = 0;
  globalThis.fetch = async (resource, options) => {
    calls++;
    assert.match(String(resource), /rpc\/delete_unused_subcategory/);
    assert.deepEqual(JSON.parse(String(options?.body)), { p_user_id: 10, p_subcategory_id: 4 });
    return new Response(JSON.stringify(result), { status: 200, headers: { "content-type": "application/json" } });
  };
  assert.equal((await DELETE(request("4"))).status, 401);
  for (const id of ["0", "-1", "1.5", "9007199254740992"]) assert.equal((await DELETE(request(id, 10))).status, 400);
  assert.equal(calls, 0);
  const conflict = await DELETE(request("4", 10));
  assert.equal(conflict.status, 409);
  assert.match((await conflict.json()).error, /transactions.*recurring rules.*budgets.*pending selections/);
  result = "not_found";
  assert.equal((await DELETE(request("4", 10))).status, 404);
  result = "deleted";
  assert.deepEqual(await (await DELETE(request("4", 10))).json(), { ok: true });
});
