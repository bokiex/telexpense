import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { POST } from "../app/api/telegram/webhook/route";

test("Telegram webhook accepts an update without a webhook secret", async () => {
  const response = await POST(new NextRequest("https://example.test/api/telegram/webhook", {
    method: "POST",
    body: "{}"
  }));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
});
