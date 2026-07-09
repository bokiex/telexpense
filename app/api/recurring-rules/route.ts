import { NextRequest, NextResponse } from "next/server";
import { requireEnv } from "@/lib/env";
import { deleteRecurringRule, upsertRecurringRule } from "@/lib/repository";
import { validateTelegramInitData } from "@/lib/telegram";
import type { RecurringRuleType } from "@/lib/repository";

export const runtime = "nodejs";

const ruleTypes = new Set(["subscription", "investment_transfer", "loan_payment"]);

export async function POST(request: NextRequest) {
  try {
    const userId = authenticatedUserId(request);
    const body = await request.json();
    const id = body.id === null || body.id === undefined || body.id === "" ? null : Number(body.id);
    const name = String(body.name || "").trim();
    const ruleType = String(body.ruleType || "").trim();
    const amountCents = Number(body.amountCents);
    const currency = String(body.currency || "SGD").trim().toUpperCase();
    const category = String(body.category || "").trim().toLowerCase();
    const fromAccountId = Number(body.fromAccountId);
    const toAccountId = body.toAccountId === null || body.toAccountId === undefined || body.toAccountId === "" ? null : Number(body.toAccountId);
    const dayOfMonth = Number(body.dayOfMonth || 1);
    const active = body.active !== false;

    if (id !== null && (!Number.isSafeInteger(id) || id <= 0)) return NextResponse.json({ error: "Rule id is not valid." }, { status: 400 });
    if (!name) return NextResponse.json({ error: "Name is required." }, { status: 400 });
    if (!ruleTypes.has(ruleType)) return NextResponse.json({ error: "Rule type is not valid." }, { status: 400 });
    if (!Number.isSafeInteger(amountCents) || amountCents <= 0) return NextResponse.json({ error: "Amount must be a positive integer number of cents." }, { status: 400 });
    if (!/^[A-Z]{3}$/.test(currency)) return NextResponse.json({ error: "Currency must be a 3-letter code." }, { status: 400 });
    if (!category) return NextResponse.json({ error: "Category is required." }, { status: 400 });
    if (!Number.isSafeInteger(fromAccountId) || fromAccountId <= 0) return NextResponse.json({ error: "From account is required." }, { status: 400 });
    if ((ruleType === "investment_transfer" || ruleType === "loan_payment") && (!Number.isSafeInteger(toAccountId) || Number(toAccountId) <= 0)) {
      return NextResponse.json({ error: "To account is required for transfers." }, { status: 400 });
    }
    if (Number.isSafeInteger(toAccountId) && toAccountId === fromAccountId) {
      return NextResponse.json({ error: "From and to accounts must be different." }, { status: 400 });
    }
    if (!Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31) {
      return NextResponse.json({ error: "Day of month must be 1-31." }, { status: 400 });
    }

    const savedId = await upsertRecurringRule(userId, {
      id,
      name,
      ruleType: ruleType as RecurringRuleType,
      amountCents,
      currency,
      category,
      fromAccountId,
      toAccountId: Number.isSafeInteger(toAccountId) ? toAccountId : null,
      dayOfMonth,
      active
    });
    return NextResponse.json({ ok: true, id: savedId });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const userId = authenticatedUserId(request);
    const id = Number(request.nextUrl.searchParams.get("id"));
    if (!Number.isSafeInteger(id) || id <= 0) return NextResponse.json({ error: "Rule id is required." }, { status: 400 });
    await deleteRecurringRule(userId, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}

function authenticatedUserId(request: NextRequest) {
  const initData = request.headers.get("x-telegram-init-data") || "";
  const { user } = validateTelegramInitData(initData, requireEnv("TELEGRAM_BOT_TOKEN"));
  return user.id;
}

function errorResponse(error: unknown) {
  return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 401 });
}
