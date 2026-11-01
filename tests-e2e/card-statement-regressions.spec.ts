import { expect, test } from "@playwright/test";
import { launchAuthenticated, syntheticInitData } from "./auth";

test("payment source type changes do not erase statement payments", async ({ request }) => {
  const headers = { "X-Telegram-Init-Data": syntheticInitData(900000000001) };
  const post = async (url: string, data: object) => {
    const response = await request.post(url, { headers, data });
    expect(response.ok()).toBe(true);
    return response.json();
  };
  const source = { accountKey: "statement-stable-source", name: "Statement source", accountType: "bank", openingBalanceCents: 50000 };
  const bank = await post("/api/accounts", source);
  const card = await post("/api/accounts", { accountKey: "statement-stable-card", name: "Statement card", accountType: "card" });
  const payment = { fromAccountId: bank.id, toAccountId: card.id, description: "Statement payment", amountCents: 3000, occurredOn: "2024-02-01" };
  await post("/api/transfers", payment);
  const cash = await post("/api/accounts", { accountKey: "statement-other-source", name: "Other source", accountType: "cash" });
  const summary = await (await request.get("/api/summary?month=2024-02", { headers })).json();
  const group = summary.recent.find((tx: { description: string }) => tx.description === payment.description).transferGroupId;
  await post("/api/card-statements", { accountId: card.id, closingDate: "2024-01-31", dueDate: "2024-02-20", originalAmountCents: 10000, remainingAmountCents: 7000 });
  const remaining = async () => {
    const response = await request.get("/api/card-statements", { headers });
    expect(response.status()).toBe(200);
    return (await response.json()).statements.find((s: { accountId: number }) => s.accountId === card.id).remainingAmountCents;
  };
  expect(await remaining()).toBe(7000);
  await post("/api/accounts", { ...source, accountType: "cash" });
  expect(await remaining()).toBe(7000);
  expect((await request.patch(`/api/transfers/${group}`, { headers, data: { ...payment, fromAccountId: cash.id } })).status()).toBe(200);
  expect(await remaining()).toBe(10000);
});

test("an edited overpayment restores an imported paid statement", async ({ request }) => {
  const headers = { "X-Telegram-Init-Data": syntheticInitData(900000000001) };
  const post = async (url: string, data: object) => {
    const response = await request.post(url, { headers, data });
    expect(response.ok()).toBe(true);
    return response.json();
  };
  const bank = await post("/api/accounts", { accountKey: "statement-credit-bank", name: "Credit bank", accountType: "bank" });
  const card = await post("/api/accounts", { accountKey: "statement-credit-card", name: "Credit card", accountType: "card" });
  await post("/api/card-statements", { accountId: card.id, closingDate: "2024-01-31", dueDate: "2024-02-20", originalAmountCents: 10000, remainingAmountCents: 10000 });
  const payment = { fromAccountId: bank.id, toAccountId: card.id, description: "Credit attribution payment", amountCents: 20000, occurredOn: "2024-02-01" };
  await post("/api/transfers", payment);
  await post("/api/card-statements", { accountId: card.id, closingDate: "2024-02-29", dueDate: "2024-03-20", originalAmountCents: 10000, remainingAmountCents: 0 });
  const summary = await (await request.get("/api/summary?month=2024-02", { headers })).json();
  const group = summary.recent.find((tx: { description: string }) => tx.description === payment.description).transferGroupId;
  expect((await request.patch(`/api/transfers/${group}`, { headers, data: { ...payment, amountCents: 10000 } })).status()).toBe(200);
  const response = await request.get("/api/card-statements", { headers });
  expect(response.status()).toBe(200);
  const statements = (await response.json()).statements.filter((s: { accountId: number }) => s.accountId === card.id);
  expect(statements.map((s: { remainingAmountCents: number }) => s.remainingAmountCents)).toEqual([0, 10000]);
});

test("changing a payment source type refreshes the displayed card status", async ({ page, request }) => {
  const initData = syntheticInitData(900000000001);
  const headers = { "X-Telegram-Init-Data": initData };
  const post = async (url: string, data: object) => {
    const response = await request.post(url, { headers, data });
    expect(response.ok()).toBe(true);
    return response.json();
  };
  const source = { accountKey: "statement-refresh-source", name: "Refresh source", accountType: "bank" };
  const bank = await post("/api/accounts", source);
  const card = await post("/api/accounts", { accountKey: "statement-refresh-card", name: "Refresh card", accountType: "card" });
  await post("/api/card-statements", { accountId: card.id, closingDate: "2024-01-31", dueDate: "2024-02-20", originalAmountCents: 10000, remainingAmountCents: 10000 });
  await post("/api/transfers", { fromAccountId: bank.id, toAccountId: card.id, description: "Refresh payment", amountCents: 3000, occurredOn: "2024-02-01" });
  await launchAuthenticated(page, initData);
  await page.getByRole("navigation", { name: "App sections" }).getByRole("button", { name: "Accounts" }).click();
  const cardView = page.locator("article").filter({ hasText: "Refresh card" });
  await expect(cardView).toContainText("Next unpaid statement: 70.00");
  await page.locator("article").filter({ hasText: source.name }).getByRole("button", { name: `Edit ${source.name}` }).click();
  const dialog = page.getByRole("dialog", { name: "Edit Account" });
  await dialog.getByRole("radio").filter({ hasText: "Cash" }).click();
  await dialog.getByRole("button", { name: "Save Account" }).click();
  await expect(dialog).toBeHidden();
  await expect(cardView).toContainText("Next unpaid statement: 100.00");
});

test("editing an account back to card reloads its statements", async ({ page, request }) => {
  const initData = syntheticInitData(900000000001);
  const headers = { "X-Telegram-Init-Data": initData };
  const account = { accountKey: "statement-reappearing-card", name: "Reappearing card", accountType: "card" };
  const created = await request.post("/api/accounts", { headers, data: account });
  expect(created.status()).toBe(200);
  const { id } = await created.json();
  const imported = await request.post("/api/card-statements", { headers, data: { accountId: id, closingDate: "2024-01-31", dueDate: "2024-02-20", originalAmountCents: 4200, remainingAmountCents: 4200 } });
  expect(imported.status()).toBe(201);
  expect((await request.post("/api/accounts", { headers, data: { ...account, accountType: "cash" } })).status()).toBe(200);
  await launchAuthenticated(page, initData);
  await page.getByRole("navigation", { name: "App sections" }).getByRole("button", { name: "Accounts" }).click();
  const card = page.locator("article").filter({ hasText: account.name });
  await expect(card).toContainText("Cash");
  await card.getByRole("button", { name: `Edit ${account.name}` }).click();
  const dialog = page.getByRole("dialog", { name: "Edit Account" });
  await dialog.getByRole("radio", { name: "Card" }).click();
  await dialog.getByRole("button", { name: "Save Account" }).click();
  await expect(dialog).toBeHidden();
  await expect(card).toContainText("Next unpaid statement: 42.00");
});
