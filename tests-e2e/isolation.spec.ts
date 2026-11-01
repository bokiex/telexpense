import { expect, test } from "@playwright/test";
import { syntheticInitData } from "./auth";

test("users cannot read or mutate another user's transaction", async ({ request }) => {
  const owner = { "X-Telegram-Init-Data": syntheticInitData(900000000002) };
  const other = { "X-Telegram-Init-Data": syntheticInitData(900000000003) };
  const account = await request.post("/api/accounts", { headers: owner, data: { accountKey: "isolation-wallet", name: "Isolation Wallet", accountType: "cash" } });
  expect(account.ok()).toBeTruthy();
  const accountId = (await account.json()).id;
  const date = "2026-01-15";
  const data = { kind: "expense", category: "food", accountId, description: "Private synthetic expense", amountCents: -1234, occurredOn: date };
  const created = await request.post("/api/transactions", { headers: owner, data });
  expect(created.ok()).toBeTruthy();
  const id = (await created.json()).id;
  const history = "/api/transactions/history?month=2026-01";
  const ownerHistory = await request.get(history, { headers: owner });
  expect(ownerHistory.ok()).toBeTruthy();
  expect(JSON.stringify(await ownerHistory.json())).toContain("Private synthetic expense");
  const otherHistory = await request.get(history, { headers: other });
  expect(otherHistory.ok()).toBeTruthy();
  expect(JSON.stringify(await otherHistory.json())).not.toContain("Private synthetic expense");
  await request.patch(`/api/transactions/${id}`, { headers: other, data: { ...data, description: "Unauthorized edit" } });
  await request.delete(`/api/transactions/${id}`, { headers: other });
  const after = await request.get(history, { headers: owner });
  expect(after.ok()).toBeTruthy();
  const body = JSON.stringify(await after.json());
  expect(body).toContain("Private synthetic expense");
  expect(body).not.toContain("Unauthorized edit");
});

test("invalid signature and expired signed data cannot access protected data", async ({ request }) => {
  const valid = new URLSearchParams(syntheticInitData(900000000002));
  valid.set("user", JSON.stringify({ id: 900000000003, first_name: "Synthetic" }));
  for (const value of [valid.toString(), syntheticInitData(900000000002, Math.floor(Date.now() / 1000) - 86401)]) {
    const response = await request.get("/api/transactions/history?month=2026-01", { headers: { "X-Telegram-Init-Data": value } });
    expect(response.status()).toBe(401);
  }
});
