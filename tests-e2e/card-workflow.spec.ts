import { expect, test } from "@playwright/test";
import { syntheticInitData } from "./auth";

test("card purchases and grouped payments preserve balances and spending", async ({ request }) => {
  const headers = { "X-Telegram-Init-Data": syntheticInitData(900000000001) };
  const other = { "X-Telegram-Init-Data": syntheticInitData(900000000003) };
  const month = "2026-02";
  const occurredOn = `${month}-10`;
  const category = "card workflow food";
  const post = async (url: string, data: object) => {
    const response = await request.post(url, { headers, data });
    expect(response.status(), `${url}: ${await response.text()}`).toBe(200);
    return response.json();
  };
  await post("/api/categories", { sourceKey: category, sourceName: category, name: category, group: "Needs", color: "#123456", icon: "Wallet" });
  await post("/api/budgets", { category, month, amountCents: 20000 });
  const bank = await post("/api/accounts", { accountKey: "card-workflow-bank", name: "Card workflow bank", accountType: "bank", openingBalanceCents: 100000 });
  const card = await post("/api/accounts", { accountKey: "card-workflow-card", name: "Card workflow card", accountType: "card", openingBalanceCents: 30000 });
  await post("/api/transactions", { kind: "expense", category, accountId: card.id, description: "Card purchase", amountCents: -5000, occurredOn });

  const summary = async () => {
    const response = await request.get(`/api/summary?month=${month}`, { headers });
    expect(response.status()).toBe(200);
    return response.json();
  };
  const check = async (bankBalance: number, cardBalance: number) => {
    const data = await summary();
    expect(data.accounts.find((a: { id: number }) => a.id === bank.id).balanceCents).toBe(bankBalance);
    expect(data.accounts.find((a: { id: number }) => a.id === card.id).balanceCents).toBe(cardBalance);
    expect(data.health.spentCents).toBe(5000);
    expect(data.health.progressCents).toBe(5000);
    expect(data.health.remainingCents).toBe(15000);
    expect(data.categories.find((c: { category: string }) => c.category === category).spentCents).toBe(5000);
    return data;
  };
  await check(100000, -35000);
  const payment = { fromAccountId: bank.id, toAccountId: card.id, description: "Card payment", amountCents: 12000, occurredOn };
  await post("/api/transfers", payment);
  const afterPayment = await check(88000, -23000);
  const group = afterPayment.recent.find((tx: { description: string }) => tx.description === payment.description).transferGroupId;
  expect(group).toBeTruthy();
  const foreignSummary = await request.get(`/api/summary?month=${month}`, { headers: other });
  expect(foreignSummary.status()).toBe(200);
  expect((await foreignSummary.json()).accounts.some((a: { id: number }) => a.id === card.id)).toBe(false);
  await request.patch(`/api/transfers/${group}`, { headers: other, data: { ...payment, amountCents: 1 } });
  await request.delete(`/api/transfers/${group}`, { headers: other });
  await check(88000, -23000);
  const edited = await request.patch(`/api/transfers/${group}`, { headers, data: { ...payment, amountCents: 20000 } });
  expect(edited.status()).toBe(200);
  await check(80000, -15000);
  const deleted = await request.delete(`/api/transfers/${group}`, { headers });
  expect(deleted.status()).toBe(200);
  await check(100000, -35000);
});
