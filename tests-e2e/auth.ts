import { createHmac } from "node:crypto";
import { expect, type Page } from "@playwright/test";

// The server must use the same dedicated test token, never a real bot token.
export function syntheticInitData(id: number, authDate = Math.floor(Date.now() / 1000)): string {
  const token = process.env.E2E_BOT_TOKEN;
  if (!token) throw new Error("E2E_BOT_TOKEN must be set to the dedicated test bot token");
  const params = new URLSearchParams({ auth_date: String(authDate), user: JSON.stringify({ id, first_name: "Synthetic" }) });
  const check = [...params.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(token).digest();
  params.set("hash", createHmac("sha256", secret).update(check).digest("hex"));
  return params.toString();
}

export async function launchAuthenticated(page: Page, initData: string): Promise<void> {
  await page.goto("/");
  // Telegram reads the launch fragment on reload; do not put credentials in page.goto.
  await page.evaluate((data) => { window.location.hash = new URLSearchParams({ tgWebAppData: data }).toString(); }, initData);
  await page.reload();
  expect(await page.evaluate((data) => window.Telegram?.WebApp?.initData === data, initData)).toBe(true);
}
