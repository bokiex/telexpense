import { NextRequest, NextResponse } from "next/server";
import { deleteBudget, setBudget } from "@/lib/repository";
import { validateTelegramInitData } from "@/lib/telegram";
import { requireEnv } from "@/lib/env";
import { isValidMonth } from "@/lib/validation";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const userId = authenticatedUserId(request);
    const body = await request.json();
    const category = String(body.category || "").trim().toLowerCase();
    const month = String(body.month || "").trim();
    const amountCents = Number(body.amountCents);
    const currency = String(body.currency || "USD").trim().toUpperCase();
    const subcategoryId = body.subcategoryId === null || body.subcategoryId === undefined || body.subcategoryId === ""
      ? null
      : Number(body.subcategoryId);

    if (!category) return NextResponse.json({ error: "Category is required." }, { status: 400 });
    if (!isValidMonth(month)) return NextResponse.json({ error: "Month must be YYYY-MM." }, { status: 400 });
    if (!Number.isSafeInteger(amountCents) || amountCents < 0) {
      return NextResponse.json({ error: "Budget amount is not valid." }, { status: 400 });
    }
    if (subcategoryId !== null && (!Number.isSafeInteger(subcategoryId) || subcategoryId <= 0)) {
      return NextResponse.json({ error: "Subcategory is not valid." }, { status: 400 });
    }

    if (!/^[A-Z]{3}$/.test(currency)) return NextResponse.json({ error: "Currency must be a 3-letter code." }, { status: 400 });
    await setBudget(userId, category, month, amountCents, currency, subcategoryId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const userId = authenticatedUserId(request);
    const category = String(request.nextUrl.searchParams.get("category") || "").trim().toLowerCase();
    const month = String(request.nextUrl.searchParams.get("month") || "").trim();
    const subcategoryParam = request.nextUrl.searchParams.get("subcategoryId");
    const subcategoryId = subcategoryParam === null || subcategoryParam === "" ? null : Number(subcategoryParam);

    if (!category) return NextResponse.json({ error: "Category is required." }, { status: 400 });
    if (!isValidMonth(month)) return NextResponse.json({ error: "Month must be YYYY-MM." }, { status: 400 });
    if (subcategoryId !== null && (!Number.isSafeInteger(subcategoryId) || subcategoryId <= 0)) {
      return NextResponse.json({ error: "Subcategory is not valid." }, { status: 400 });
    }

    await deleteBudget(userId, category, month, subcategoryId);
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
