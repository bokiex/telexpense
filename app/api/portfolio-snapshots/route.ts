import { NextRequest, NextResponse } from "next/server";
import { requireEnv } from "@/lib/env";
import { upsertPortfolioSnapshot } from "@/lib/repository";
import { validateTelegramInitData } from "@/lib/telegram";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const userId = authenticatedUserId(request);
    const body = await request.json();
    const accountId = Number(body.accountId);
    const month = String(body.month || "").trim();
    const portfolioValueCents = Number(body.portfolioValueCents);
    const currency = String(body.currency || "SGD").trim().toUpperCase();

    if (!Number.isFinite(accountId)) return NextResponse.json({ error: "Account id is required." }, { status: 400 });
    if (!/^\d{4}-\d{2}$/.test(month)) return NextResponse.json({ error: "Month must be YYYY-MM." }, { status: 400 });
    if (!Number.isFinite(portfolioValueCents) || portfolioValueCents < 0) {
      return NextResponse.json({ error: "Portfolio value is not valid." }, { status: 400 });
    }
    if (!/^[A-Z]{3}$/.test(currency)) return NextResponse.json({ error: "Currency must be a 3-letter code." }, { status: 400 });

    await upsertPortfolioSnapshot(userId, {
      accountId,
      month,
      portfolioValueCents: Math.round(portfolioValueCents),
      currency
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 401 });
  }
}

function authenticatedUserId(request: NextRequest) {
  const initData = request.headers.get("x-telegram-init-data") || "";
  const { user } = validateTelegramInitData(initData, requireEnv("TELEGRAM_BOT_TOKEN"));
  return user.id;
}
