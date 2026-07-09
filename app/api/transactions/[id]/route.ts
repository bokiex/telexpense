import { NextRequest, NextResponse } from "next/server";
import { deleteTransaction, updateTransactionFields } from "@/lib/repository";
import { validateTelegramInitData } from "@/lib/telegram";
import { requireEnv } from "@/lib/env";
import type { ParsedTransaction } from "@/lib/parser";
import {
  genericTransactionKindError,
  transactionCategory,
  transactionCategoryError
} from "@/lib/transactionCategory";
import { isValidDate, transactionAmountError } from "@/lib/validation";

export const runtime = "nodejs";

const kinds = new Set(["expense", "income", "investment", "transfer"]);

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const userId = authenticatedUserId(request);
    const transactionId = await transactionIdFromContext(context);
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
    const kindError = genericTransactionKindError(kind);
    if (kindError) return NextResponse.json({ error: kindError }, { status: 400 });
    const categoryError = transactionCategoryError(kind, category);
    if (categoryError) return NextResponse.json({ error: categoryError }, { status: 400 });
    if (!Number.isFinite(accountId)) return NextResponse.json({ error: "Account id is required." }, { status: 400 });
    if (subcategoryId !== null && !Number.isSafeInteger(subcategoryId)) return NextResponse.json({ error: "Subcategory id is not valid." }, { status: 400 });
    if (!description) return NextResponse.json({ error: "Description is required." }, { status: 400 });
    const amountError = transactionAmountError(kind as ParsedTransaction["kind"], amountCents);
    if (amountError) return NextResponse.json({ error: amountError }, { status: 400 });
    if (!/^[A-Z]{3}$/.test(currency)) return NextResponse.json({ error: "Currency must be a 3-letter code." }, { status: 400 });
    if (!isValidDate(occurredOn)) return NextResponse.json({ error: "Date must be a valid YYYY-MM-DD date." }, { status: 400 });

    await updateTransactionFields(userId, transactionId, {
      kind: kind as ParsedTransaction["kind"],
      category,
      accountId,
      subcategoryId,
      description,
      amountCents,
      currency: currency || "USD",
      occurredOn
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const userId = authenticatedUserId(request);
    const transactionId = await transactionIdFromContext(context);
    await deleteTransaction(userId, transactionId);
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

async function transactionIdFromContext(context: RouteContext) {
  const { id } = await context.params;
  const transactionId = Number(id);
  if (!Number.isSafeInteger(transactionId) || transactionId <= 0) throw new Error("Transaction id is not valid.");
  return transactionId;
}

function errorResponse(error: unknown) {
  return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 401 });
}
