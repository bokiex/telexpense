import { NextRequest, NextResponse } from "next/server";
import { addTransactionFields } from "@/lib/repository";
import { validateTelegramInitData } from "@/lib/telegram";
import { requireEnv } from "@/lib/env";
import type { ParsedTransaction } from "@/lib/parser";
import { transactionCategory, transactionCategoryError } from "@/lib/transactionCategory";

export const runtime = "nodejs";

const kinds = new Set(["expense", "income", "investment", "transfer"]);

export async function POST(request: NextRequest) {
  try {
    const initData = request.headers.get("x-telegram-init-data") || "";
    const { user } = validateTelegramInitData(initData, requireEnv("TELEGRAM_BOT_TOKEN"));
    const body = await request.json();
    const kind = String(body.kind || "").trim().toLowerCase();
    const category = transactionCategory(kind, body.category);
    const accountId = body.accountId === null || body.accountId === undefined || body.accountId === "" ? NaN : Number(body.accountId);
    const subcategoryId = body.subcategoryId === null || body.subcategoryId === undefined || body.subcategoryId === "" ? null : Number(body.subcategoryId);
    const description = String(body.description || "").trim();
    const amountCents = Number(body.amountCents);
    const currency = String(body.currency || "USD").trim().toUpperCase();
    const occurredOn = String(body.occurredOn || "").trim();

    if (!kinds.has(kind)) return NextResponse.json({ error: "Transaction kind is not valid." }, { status: 400 });
    const categoryError = transactionCategoryError(kind, category);
    if (categoryError) return NextResponse.json({ error: categoryError }, { status: 400 });
    if (!Number.isFinite(accountId)) return NextResponse.json({ error: "Account id is required." }, { status: 400 });
    if (subcategoryId !== null && !Number.isSafeInteger(subcategoryId)) return NextResponse.json({ error: "Subcategory id is not valid." }, { status: 400 });
    if (!description) return NextResponse.json({ error: "Description is required." }, { status: 400 });
    if (!Number.isFinite(amountCents)) return NextResponse.json({ error: "Amount is not valid." }, { status: 400 });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(occurredOn)) {
      return NextResponse.json({ error: "Date must be YYYY-MM-DD." }, { status: 400 });
    }

    const id = await addTransactionFields(user.id, {
      kind: kind as ParsedTransaction["kind"],
      category,
      accountId,
      subcategoryId,
      description,
      amountCents: Math.round(amountCents),
      currency: currency || "USD",
      occurredOn
    });
    return NextResponse.json({ ok: true, id });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 401 });
  }
}
