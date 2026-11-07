import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { POST } from "../app/api/telegram/webhook/route";
import { supabaseConciseCaptureStore } from "../lib/conciseCaptureStore";

test("Telegram offers and accepts a category-only choice", async (t) => {
  const oldToken = process.env.TELEGRAM_BOT_TOKEN;
  process.env.TELEGRAM_BOT_TOKEN = "test-token";
  t.after(() => {
    if (oldToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = oldToken;
  });
  let pending = { token: "abc", kind: "expense" as const, description: "lunch", amountCents: -420, accountId: null as number | null, categoryId: null as number | null, subcategoryId: null as number | null, version: 0 };
  t.mock.method(supabaseConciseCaptureStore, "getPending", async () => ({ ...pending }));
  t.mock.method(supabaseConciseCaptureStore, "getCatalog", async () => ({
    categories: [
      { id: 1, sourceKey: "food", sourceName: "food", name: "Food", active: true, subcategories: [{ id: 10, name: "Daily" }] },
      { id: 2, sourceKey: "transport", sourceName: "transport", name: "Transport", active: true, subcategories: [{ id: 20, name: "Train" }] }
    ],
    accounts: [{ id: 7, accountKey: "card", name: "Card", active: true }, { id: 8, accountKey: "cash", name: "Cash", active: true }]
  }));
  t.mock.method(supabaseConciseCaptureStore, "updatePending", async (_user, _token, version, selection) => {
    if (version !== pending.version) return false;
    pending = { ...pending, ...selection, version: version + 1 };
    return true;
  });
  const messages: { text?: string; reply_markup?: { inline_keyboard: { text: string; callback_data?: string }[][] } }[] = [];
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    messages.push(JSON.parse(String(init?.body)));
    return Response.json({ ok: true });
  });
  const callback = (data: string) => POST(new NextRequest("https://example.test/api/telegram/webhook", {
    method: "POST",
    body: JSON.stringify({ callback_query: { id: "callback", data, from: { id: 42 }, message: { chat: { id: 42 } } } })
  }));
  await callback("pc:abc:c:1");
  const buttons = messages.flatMap((message) => message.reply_markup?.inline_keyboard.flat() ?? []);
  const skip = buttons.find((button) => button.text === "No subcategory");
  assert.equal(skip?.callback_data, "pc:abc:s:0:1");
  await callback(skip!.callback_data!);
  assert.equal(pending.subcategoryId, null);
  assert.ok(messages.some((message) => message.text === "Choose an account:"));
  const accountButton = messages.flatMap((message) => message.reply_markup?.inline_keyboard.flat() ?? []).find((button) => button.text === "Cash");
  assert.equal(accountButton?.callback_data, "pc:abc:a:8:2");
  await callback("pc:abc:c:2");
  await callback(skip!.callback_data!);
  await callback(accountButton!.callback_data!);
  assert.equal(pending.categoryId, 2);
  assert.equal(pending.accountId, null);
  assert.equal(pending.version, 3);
  assert.ok(messages.some((message) => message.text === "This subcategory is not available."));
  assert.ok(messages.some((message) => message.text === "This account is not available."));
});

test("Telegram webhook accepts an update without a webhook secret", async () => {
  const response = await POST(new NextRequest("https://example.test/api/telegram/webhook", {
    method: "POST",
    body: "{}"
  }));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
});
