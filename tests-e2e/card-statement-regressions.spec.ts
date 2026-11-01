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
  const refreshed = page.waitForResponse((response) => response.url().includes("/api/card-statements") && response.request().method() === "GET");
  await dialog.getByRole("button", { name: "Save Account" }).click();
  await expect(dialog).toBeHidden();
  expect((await refreshed).ok()).toBe(true);
  await expect(cardView).toContainText("Next unpaid statement: 70.00");
});

for (const delayOldResponse of [false, true]) {
  test(`card statements refresh after the summary following recurring materialization${delayOldResponse ? " despite an older in-flight response" : ""}`, async ({ page, request }) => {
    const initData = syntheticInitData(900000000001);
    const headers = { "X-Telegram-Init-Data": initData };
    const post = async (url: string, data: object) => {
      const response = await request.post(url, { headers, data });
      expect(response.ok()).toBe(true);
      return response.json();
    };
    const suffix = delayOldResponse ? "race" : "idle";
    await post("/api/accounts", { accountKey: `materialize-bank-${suffix}`, name: `Materialize bank ${suffix}`, accountType: "bank" });
    const card = await post("/api/accounts", { accountKey: `materialize-card-${suffix}`, name: `Materialize card ${suffix}`, accountType: "card" });
    await post("/api/card-statements", { accountId: card.id, closingDate: "2024-01-31", dueDate: "2024-02-20", originalAmountCents: 10000, remainingAmountCents: 10000 });
    await launchAuthenticated(page, initData);
    let releaseSummary = () => {};
    let summaryCaptured = () => {};
    const summaryReady = new Promise<void>((resolve) => { summaryCaptured = resolve; });
    const allowSummary = new Promise<void>((resolve) => { releaseSummary = resolve; });
    let releaseOldResponse = () => {};
    let oldResponseCaptured = () => {};
    const oldResponseReady = new Promise<void>((resolve) => { oldResponseCaptured = resolve; });
    const release = new Promise<void>((resolve) => { releaseOldResponse = resolve; });
    let statementRequests = 0;
    let holdNextStatement = false;
    await page.route("**/api/card-statements", async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      statementRequests += 1;
      if (!holdNextStatement) return route.continue();
      holdNextStatement = false;
      const response = await route.fetch();
      oldResponseCaptured();
      await release;
      await route.fulfill({ response });
    });
    try {
      await page.getByRole("navigation", { name: "App sections" }).getByRole("button", { name: "Accounts" }).click();
      const cardView = page.locator("article.account-card").filter({ hasText: `Materialize card ${suffix}` });
      await expect(cardView).toContainText("Next unpaid statement: 100.00");
      if (delayOldResponse) {
        // A saved snapshot initiates a real statement refresh, which we hold
        // until after the later summary-triggered refresh has completed.
        await cardView.getByRole("button", { name: "Add statement snapshot" }).click();
        await cardView.getByLabel("Closing date").fill("2024-02-29");
        await cardView.getByLabel("Due date").fill("2024-03-20");
        await cardView.getByLabel("Original statement amount").fill("10");
        await cardView.getByLabel("Remaining amount", { exact: true }).fill("10");
        holdNextStatement = true;
        await cardView.getByRole("button", { name: "Save statement" }).click();
        await oldResponseReady;
      }
      await page.route("**/api/summary?*", async (route) => {
        const response = await route.fetch();
        summaryCaptured();
        await allowSummary;
        await route.fulfill({ response });
      });
      await page.locator("section").filter({ has: page.getByText("Monthly Rules", { exact: true }) }).last().getByRole("button", { name: "Add", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Add Monthly Rule" });
      await dialog.getByRole("radio", { name: "Account transfer" }).click();
      await dialog.getByLabel("Name", { exact: true }).fill(`Materialize payment ${suffix}`);
      await dialog.getByLabel("Amount", { exact: true }).fill("30");
      await dialog.getByLabel("From Account").selectOption({ label: `Materialize bank ${suffix}` });
      await dialog.getByLabel("To Account").selectOption({ label: `Materialize card ${suffix}` });
      // Saving materializes the due payment before reloading the summary.
      // Keep that summary response in flight to enforce the ordering boundary.
      const requestsBeforeSave = statementRequests;
      await dialog.getByRole("button", { name: "Add Rule" }).click();
      await expect(dialog).toBeHidden();
      await summaryReady;
      expect(statementRequests).toBe(requestsBeforeSave);
      releaseSummary();
      await expect(cardView).toContainText("Next unpaid statement: 70.00");
      if (delayOldResponse) {
        const oldResponseDelivered = page.waitForResponse((response) => response.url().includes("/api/card-statements") && response.request().method() === "GET");
        releaseOldResponse();
        await oldResponseDelivered;
        await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
        await expect(cardView).toContainText("Next unpaid statement: 70.00");
      }
    } finally {
      releaseSummary();
      releaseOldResponse();
    }
  });
}

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
