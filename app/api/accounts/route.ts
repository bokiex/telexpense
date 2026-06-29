import { NextRequest, NextResponse } from "next/server";
import { requireEnv } from "@/lib/env";
import { upsertAccount } from "@/lib/repository";
import { validateTelegramInitData } from "@/lib/telegram";
import type { AccountType } from "@/lib/repository";
import { normalizeOpeningBalance } from "@/lib/finance";

export const runtime = "nodejs";

const accountTypes = new Set(["cash", "bank", "card", "investment", "loan", "other"]);

export async function POST(request: NextRequest) {
  try {
    const userId = authenticatedUserId(request);
    const body = await request.json();
    const accountKey = String(body.accountKey || "").trim();
    const name = String(body.name || "").trim();
    const institution = String(body.institution || "").trim();
    const accountType = String(body.accountType || "bank").trim();
    const openingBalanceCents = Number(body.openingBalanceCents || 0);
    const currency = String(body.currency || "USD").trim().toUpperCase();
    const color = String(body.color || "#60a5fa").trim();
    const icon = String(body.icon || "Wallet").trim();

    if (!accountKey) return NextResponse.json({ error: "Account key is required." }, { status: 400 });
    if (!name) return NextResponse.json({ error: "Account name is required." }, { status: 400 });
    if (!accountTypes.has(accountType)) return NextResponse.json({ error: "Account type is not valid." }, { status: 400 });
    if (!Number.isFinite(openingBalanceCents)) return NextResponse.json({ error: "Opening balance is not valid." }, { status: 400 });
    if (!/^[A-Z]{3}$/.test(currency)) return NextResponse.json({ error: "Currency must be a 3-letter code." }, { status: 400 });
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) return NextResponse.json({ error: "Color must be a hex value." }, { status: 400 });
    if (!icon) return NextResponse.json({ error: "Icon is required." }, { status: 400 });

    const id = await upsertAccount(userId, {
      accountKey,
      name,
      institution: institution || null,
      accountType: accountType as AccountType,
      openingBalanceCents: normalizeOpeningBalance(accountType as AccountType, openingBalanceCents),
      currency,
      color,
      icon
    });
    return NextResponse.json({ ok: true, id });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 401 });
  }
}

function authenticatedUserId(request: NextRequest) {
  const initData = request.headers.get("x-telegram-init-data") || "";
  const { user } = validateTelegramInitData(initData, requireEnv("TELEGRAM_BOT_TOKEN"));
  return user.id;
}
