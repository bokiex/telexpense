import crypto from "node:crypto";

export type TelegramUser = {
  id: number;
  first_name?: string;
  username?: string;
};

export function validateTelegramInitData(initData: string, botToken: string, maxAgeSeconds = 86400) {
  const params = new URLSearchParams(initData);
  const receivedHash = params.get("hash");
  if (!receivedHash) throw new Error("Missing Telegram init data hash");
  params.delete("hash");

  const dataCheckString = Array.from(params.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secretKey = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  const expectedHash = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
  if (!crypto.timingSafeEqual(Buffer.from(expectedHash), Buffer.from(receivedHash))) {
    throw new Error("Invalid Telegram init data");
  }

  const authDate = Number(params.get("auth_date") || 0);
  if (!authDate || Date.now() / 1000 - authDate > maxAgeSeconds) {
    throw new Error("Telegram init data is expired");
  }

  const userValue = params.get("user");
  if (!userValue) throw new Error("Telegram user is missing");

  return {
    user: JSON.parse(userValue) as TelegramUser,
    queryId: params.get("query_id")
  };
}

export async function sendTelegramMessage(chatId: number, text: string, replyMarkup?: unknown) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.error("TELEGRAM_BOT_TOKEN is not configured; cannot send Telegram message.");
    throw new Error("TELEGRAM_BOT_TOKEN is not configured");
  }

  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      reply_markup: replyMarkup
    })
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.ok) {
    console.error("Telegram sendMessage failed", result);
    throw new Error(result?.description || "Telegram sendMessage failed");
  }
}

export function dashboardKeyboard() {
  const baseUrl = process.env.APP_BASE_URL || process.env.VERCEL_PROJECT_PRODUCTION_URL || "";
  if (!baseUrl || baseUrl.includes("your-public-domain.example")) return undefined;
  const normalized = baseUrl.startsWith("http") ? baseUrl : `https://${baseUrl}`;
  return {
    inline_keyboard: [[{ text: "Open dashboard", web_app: { url: normalized } }]]
  };
}
