import { createHmac } from "node:crypto";
import { expect, test } from "@playwright/test";

// The server must use the same dedicated test token. Never use a real bot token.
function syntheticInitData(authDate = Math.floor(Date.now() / 1000)): string {
  const token = process.env.E2E_BOT_TOKEN;
  if (!token) throw new Error("E2E_BOT_TOKEN must be set to the dedicated test bot token");

  const params = new URLSearchParams({
    auth_date: String(authDate),
    user: JSON.stringify({ id: 900000000001, first_name: "Synthetic" })
  });
  const check = [...params.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(token).digest();
  params.set("hash", createHmac("sha256", secret).update(check).digest("hex"));
  return params.toString();
}

// Authentication-bearing URLs and browser state must not be recorded in artifacts.
test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, trace: "off", screenshot: "off", video: "off" });

test("expired and malformed authentication are rejected", async ({ request }) => {
  for (const value of [syntheticInitData(1), "invalid"]) {
    const response = await request.get("/api/summary?month=2026-01", { headers: { "X-Telegram-Init-Data": value } });
    expect(response.status()).toBe(401);
  }
});

test("budget progress reflects classified spending after reload", async ({ page }) => {
  const initData = syntheticInitData();
  await page.goto("/");
  await page.evaluate((data) => { window.location.hash = new URLSearchParams({ tgWebAppData: data }).toString(); }, initData);
  await page.reload();
  expect(await page.evaluate((data) => window.Telegram?.WebApp?.initData === data, initData)).toBe(true);

  const nav = page.getByRole("navigation", { name: "App sections" });
  await nav.getByRole("button", { name: "Accounts" }).click();
  await page.getByRole("button", { name: "Add Account" }).click();
  let dialog = page.getByRole("dialog", { name: "Add Account" });
  await dialog.getByLabel("Name", { exact: true }).fill("Synthetic Budget Wallet");
  await dialog.getByRole("button", { name: "Add Account" }).click();
  await expect(dialog).toBeHidden();

  await nav.getByRole("button", { name: "Budget" }).click();
  await page.getByRole("button", { name: "Add Category" }).click();
  dialog = page.getByRole("dialog", { name: "Add Category" });
  await dialog.getByLabel("Name", { exact: true }).fill("Synthetic Budget Food");
  await dialog.getByRole("button", { name: "Add Category" }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole("button", { name: "Set Synthetic Budget Food budget" }).click();
  dialog = page.getByRole("dialog", { name: "Set Budget" });
  await dialog.getByLabel("Budget Amount").fill("100");
  await dialog.getByRole("button", { name: "Set Budget", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("progressbar", { name: "Synthetic Budget Food budget 0% used" })).toBeVisible();
  await expect(page.locator(".budget-row-amount").getByText("0.00 / 100.00 · 0%", { exact: true })).toBeVisible();

  await nav.getByRole("button", { name: "History" }).click();
  await page.getByRole("button", { name: "Add Transaction" }).click();
  dialog = page.getByRole("dialog", { name: "Add Transaction" });
  await dialog.getByLabel("Amount", { exact: true }).fill("25.00");
  await dialog.getByLabel("Description", { exact: true }).fill("Synthetic budget lunch");
  await dialog.getByRole("combobox", { name: "Category", exact: true }).selectOption({ label: "Synthetic Budget Food" });
  await dialog.getByRole("combobox", { name: "Account", exact: true }).selectOption({ label: "Synthetic Budget Wallet" });
  await dialog.getByRole("button", { name: "Add Transaction" }).click();
  await expect(dialog).toBeHidden();

  await nav.getByRole("button", { name: "Budget" }).click();
  await expect(page.getByRole("progressbar", { name: "Synthetic Budget Food budget 25% used" })).toBeVisible();
  await expect(page.locator(".budget-row-amount").getByText("25.00 / 100.00 · 25%", { exact: true })).toBeVisible();
  await page.reload();
  await nav.getByRole("button", { name: "Budget" }).click();
  await expect(page.getByRole("progressbar", { name: "Synthetic Budget Food budget 25% used" })).toBeVisible();
  await expect(page.locator(".budget-row-amount").getByText("25.00 / 100.00 · 25%", { exact: true })).toBeVisible();
});

test("a classified transaction survives creation and editing, then deletion", async ({ page }) => {
  const initData = syntheticInitData();
  await page.goto("/");
  // Telegram's real script reads tgWebAppData from the launch fragment on reload.
  // Set it in the browser instead of passing a bearer credential to page.goto.
  await page.evaluate((data) => { window.location.hash = new URLSearchParams({ tgWebAppData: data }).toString(); }, initData);
  await page.reload();
  expect(await page.evaluate((data) => window.Telegram?.WebApp?.initData === data, initData)).toBe(true);

  const nav = page.getByRole("navigation", { name: "App sections" });
  await nav.getByRole("button", { name: "Accounts" }).click();
  await page.getByRole("button", { name: "Add Account" }).click();
  let dialog = page.getByRole("dialog", { name: "Add Account" });
  await dialog.getByLabel("Name", { exact: true }).fill("Synthetic Wallet");
  const accountResponse = page.waitForResponse(response => response.url().endsWith('/api/accounts') && response.request().method() === 'POST');
  await dialog.getByRole("button", { name: "Add Account" }).click();
  const result = await accountResponse;
  expect(result.ok()).toBeTruthy();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("Synthetic Wallet", { exact: true })).toBeVisible();

  await nav.getByRole("button", { name: "Budget" }).click();
  await page.getByRole("button", { name: "Add Category" }).click();
  dialog = page.getByRole("dialog", { name: "Add Category" });
  await dialog.getByLabel("Name", { exact: true }).fill("Synthetic Food");
  await dialog.getByRole("button", { name: "Add Category" }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole("button", { name: "Add subcategory to Synthetic Food" }).click();
  dialog = page.getByRole("dialog", { name: "Add Sub-category" });
  await dialog.getByLabel("Name", { exact: true }).fill("Synthetic Lunch");
  await dialog.getByRole("button", { name: "Add Sub-category" }).click();
  await expect(dialog).toBeHidden();

  await nav.getByRole("button", { name: "History" }).click();
  await page.getByRole("button", { name: "Add Transaction" }).click();
  dialog = page.getByRole("dialog", { name: "Add Transaction" });
  await dialog.getByLabel("Amount", { exact: true }).fill("12.34");
  await dialog.getByLabel("Description", { exact: true }).fill("Synthetic original lunch");
  await dialog.getByRole("combobox", { name: "Category", exact: true }).selectOption({ label: "Synthetic Food" });
  await dialog.getByRole("combobox", { name: "Sub-category", exact: true }).selectOption({ label: "Synthetic Lunch" });
  await dialog.getByRole("combobox", { name: "Account", exact: true }).selectOption({ label: "Synthetic Wallet" });
  await dialog.getByRole("button", { name: "Add Transaction" }).click();
  await expect(dialog).toBeHidden();

  await page.reload();
  await nav.getByRole("button", { name: "History" }).click();
  let row = page.locator("article").filter({ hasText: "Synthetic original lunch" });
  await expect(row).toContainText("12.34");
  await expect(row).toContainText("Synthetic Food › Synthetic Lunch › Synthetic Wallet");
  await row.getByRole("button", { name: "Edit transaction" }).click();
  dialog = page.getByRole("dialog", { name: "Edit Transaction" });
  await dialog.getByLabel("Amount", { exact: true }).fill("23.45");
  await dialog.getByLabel("Description", { exact: true }).fill("Synthetic edited lunch");
  await dialog.getByRole("button", { name: "Save Changes" }).click();
  await expect(dialog).toBeHidden();

  await page.reload();
  await nav.getByRole("button", { name: "History" }).click();
  row = page.locator("article").filter({ hasText: "Synthetic edited lunch" });
  await expect(row).toContainText("23.45");
  await expect(row).toContainText("Synthetic Food › Synthetic Lunch › Synthetic Wallet");
  await expect(page.getByText("Synthetic original lunch", { exact: true })).toHaveCount(0);
  await row.getByRole("button", { name: "Delete transaction" }).click();
  const confirmation = page.getByRole("alertdialog", { name: "Delete transaction?" });
  await confirmation.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(confirmation).toBeHidden();
  await expect(row).toHaveCount(0);

  await page.reload();
  const historyResponse = page.waitForResponse((response) => response.url().includes("/api/transactions/history?") && response.request().method() === "GET");
  await nav.getByRole("button", { name: "History" }).click();
  expect((await historyResponse).ok()).toBeTruthy();
  await expect(page.getByRole("button", { name: "Loading…" })).toBeHidden();
  await expect(page.getByRole("textbox", { name: "Search transactions" })).toBeVisible();
  await expect(page.getByText("Synthetic edited lunch", { exact: true })).toHaveCount(0);
});
