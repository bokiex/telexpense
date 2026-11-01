import { createHmac } from "node:crypto";
import { expect, test } from "@playwright/test";

// Use a separate synthetic identity from other journeys; the harness seeds it.
function syntheticInitData(): string {
  const token = process.env.E2E_BOT_TOKEN;
  if (!token) throw new Error("E2E_BOT_TOKEN is required");
  const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: 900000000002, first_name: "Synthetic" }) });
  const check = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(token).digest();
  params.set("hash", createHmac("sha256", secret).update(check).digest("hex"));
  return params.toString();
}

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, timezoneId: "UTC", trace: "off", screenshot: "off", video: "off" });

test("a due monthly rule materializes once and remains singular after reloads", async ({ page }) => {
  const initData = syntheticInitData();
  await page.goto("/");
  await page.evaluate((data) => { window.location.hash = new URLSearchParams({ tgWebAppData: data }).toString(); }, initData);
  await page.reload();
  expect(await page.evaluate((data) => window.Telegram?.WebApp?.initData === data, initData)).toBe(true);

  const nav = page.getByRole("navigation", { name: "App sections" });
  await nav.getByRole("button", { name: "Budget" }).click();
  await page.getByRole("button", { name: "Add Category" }).click();
  let dialog = page.getByRole("dialog", { name: "Add Category" });
  await dialog.getByLabel("Name", { exact: true }).fill("Synthetic Subscription");
  await dialog.getByRole("button", { name: "Add Category" }).click();
  await expect(dialog).toBeHidden();

  await nav.getByRole("button", { name: "Accounts" }).click();
  await page.getByRole("button", { name: "Add Account" }).click();
  dialog = page.getByRole("dialog", { name: "Add Account" });
  await dialog.getByLabel("Name", { exact: true }).fill("Recurring Wallet");
  await dialog.getByRole("button", { name: "Add Account" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("Recurring Wallet", { exact: true })).toBeVisible();

  await page.locator("section").filter({ has: page.getByText("Monthly Rules", { exact: true }) }).last().getByRole("button", { name: "Add", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Add Monthly Rule" });
  await dialog.getByLabel("Name", { exact: true }).fill("Synthetic Monthly Service");
  await dialog.getByLabel("Amount", { exact: true }).fill("14.25");
  await dialog.getByRole("combobox", { name: /^Category/ }).selectOption({ label: "Synthetic Subscription" });
  await dialog.getByRole("combobox", { name: /^From Account/ }).selectOption({ label: "Recurring Wallet" });
  // Day 1 is due on every day of every UTC month, including month boundaries.
  await dialog.getByLabel("Day", { exact: true }).fill("1");
  await dialog.getByRole("button", { name: "Add Rule" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("Synthetic Monthly Service", { exact: true })).toBeVisible();

  // A reload may use the dashboard cache, so explicitly invoke the real
  // authenticated summary endpoint each time before checking durable history.
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await page.request.get("/api/summary", { headers: { "X-Telegram-Init-Data": initData } });
    expect(response.ok()).toBeTruthy();
    await page.reload();
    await nav.getByRole("button", { name: "History" }).click();
    const row = page.locator("article").filter({ hasText: "Synthetic Monthly Service" });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("14.25");
    await expect(row).toContainText("Synthetic Subscription");
    await expect(row).toContainText("Recurring Wallet");
  }
});
