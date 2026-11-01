import { expect, test } from "@playwright/test";
import { launchAuthenticated, syntheticInitData } from "./auth";

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, trace: "off", screenshot: "off", video: "off" });

test("a grouped transfer persists both account balance changes", async ({ page }) => {
  page.setDefaultTimeout(10000);
  const initData = syntheticInitData(900000000001);
  await launchAuthenticated(page, initData);

  const nav = page.getByRole("navigation", { name: "App sections" });
  await nav.getByRole("button", { name: "Accounts" }).click();
  for (const [name, opening] of [["Synthetic Transfer Source", "200"], ["Synthetic Transfer Destination", "50"]]) {
    await page.getByRole("button", { name: "Add Account" }).click();
    const dialog = page.getByRole("dialog", { name: "Add Account" });
    await dialog.getByLabel("Name", { exact: true }).fill(name);
    await dialog.getByLabel("Opening Balance").fill(opening);
    await dialog.getByRole("button", { name: "Add Account" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator("article").filter({ hasText: name })).toContainText(`${opening}.00`);
  }

  // The Next.js development indicator can cover this mobile navigation button.
  await nav.getByRole("button", { name: "Add" }).focus();
  await page.keyboard.press("Enter");
  await page.getByRole("radio", { name: "Transfer" }).click({ timeout: 10000 });
  await page.getByLabel("Amount", { exact: true }).fill("37.25");
  await page.getByLabel("What was this for? Optional").fill("Synthetic paired transfer");
  await page.getByLabel(/^From/).selectOption({ label: "Synthetic Transfer Source" });
  await page.getByRole("combobox", { name: /^To/ }).selectOption({ label: "Synthetic Transfer Destination" });
  await page.getByRole("button", { name: "Save transfer" }).click({ timeout: 10000 });
  await expect(page.getByLabel("Amount", { exact: true })).toHaveValue("");

  await nav.getByRole("button", { name: "Accounts" }).click();
  await expect(page.locator("article").filter({ hasText: "Synthetic Transfer Source" })).toContainText("162.75");
  await expect(page.locator("article").filter({ hasText: "Synthetic Transfer Destination" })).toContainText("87.25");

  await page.reload();
  await nav.getByRole("button", { name: "Accounts" }).click();
  await expect(page.locator("article").filter({ hasText: "Synthetic Transfer Source" })).toContainText("162.75");
  await expect(page.locator("article").filter({ hasText: "Synthetic Transfer Destination" })).toContainText("87.25");
  await nav.getByRole("button", { name: "History" }).click();
  const transfer = page.locator("article").filter({ hasText: "Synthetic paired transfer" });
  await expect(transfer).toHaveCount(1);
  await expect(transfer).toContainText("37.25");
  await expect(transfer).toContainText("Synthetic Transfer Source");
  await expect(transfer).toContainText("Synthetic Transfer Destination");
});
