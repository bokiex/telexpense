import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { POST } from "../app/api/telegram/webhook/route";

const webhookSecret = "test-webhook-secret";

function webhookRequest(secret?: string) {
  return new NextRequest("https://example.test/api/telegram/webhook", {
    method: "POST",
    headers: secret ? { "X-Telegram-Bot-Api-Secret-Token": secret } : undefined,
    body: "not json"
  });
}

test("Telegram webhook rejects a missing secret token before parsing its body", async () => {
  process.env.TELEGRAM_WEBHOOK_SECRET_TOKEN = webhookSecret;

  const response = await POST(webhookRequest());

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "Unauthorized" });
});

test("Telegram webhook rejects a mismatched secret token", async () => {
  process.env.TELEGRAM_WEBHOOK_SECRET_TOKEN = webhookSecret;

  const response = await POST(webhookRequest("wrong-secret"));

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "Unauthorized" });
});
